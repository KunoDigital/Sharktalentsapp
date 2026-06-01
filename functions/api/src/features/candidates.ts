import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';

const log = logger('CANDIDATES');
const TABLE = 'Candidates';

export type Candidate = {
  ROWID: string;
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
  salary_expectation: number | null;
  availability: string | null;
  interview_file_id: string | null;
  created_at: string;
};

type CandidateInsert = Omit<Candidate, 'ROWID' | 'created_at'>;
type CandidatePatch = Partial<CandidateInsert>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new ValidationError('email is invalid');
  }
  if (email.length > 255) throw new ValidationError('email exceeds 255 chars');
  return email.toLowerCase();
}

function validateInsert(body: unknown): CandidateInsert {
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) {
    throw new ValidationError('name is required');
  }
  return {
    name: b.name.trim().slice(0, 255),
    email: validateEmail(b.email),
    phone: typeof b.phone === 'string' ? b.phone.slice(0, 50) : null,
    age: typeof b.age === 'number' && b.age > 0 && b.age < 150 ? Math.floor(b.age) : null,
    salary_expectation: typeof b.salary_expectation === 'number' && b.salary_expectation >= 0 ? Math.floor(b.salary_expectation) : null,
    availability: typeof b.availability === 'string' ? b.availability.slice(0, 30) : null,
    interview_file_id: typeof b.interview_file_id === 'string' ? b.interview_file_id : null,
  };
}

function validatePatch(body: unknown): CandidatePatch {
  const b = body as Record<string, unknown>;
  const out: CandidatePatch = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) throw new ValidationError('name invalid');
    out.name = b.name.trim().slice(0, 255);
  }
  if (b.email !== undefined) out.email = validateEmail(b.email);
  if (b.phone !== undefined) out.phone = typeof b.phone === 'string' ? b.phone.slice(0, 50) : null;
  if (b.age !== undefined) {
    out.age = typeof b.age === 'number' && b.age > 0 && b.age < 150 ? Math.floor(b.age) : null;
  }
  if (b.salary_expectation !== undefined) {
    out.salary_expectation = typeof b.salary_expectation === 'number' && b.salary_expectation >= 0
      ? Math.floor(b.salary_expectation) : null;
  }
  if (b.availability !== undefined) {
    out.availability = typeof b.availability === 'string' ? b.availability.slice(0, 30) : null;
  }
  if (b.interview_file_id !== undefined) {
    out.interview_file_id = typeof b.interview_file_id === 'string' ? b.interview_file_id : null;
  }
  return out;
}

// ---- DB ----

/**
 * Tenant-scoped lookup: el candidato debe tener al menos un Result en un Job del tenant.
 * Sin esto, cualquier admin puede leer/modificar candidatos de otros tenants si conoce el ROWID.
 */
async function getByIdScopedToTenant(req: IncomingMessage, candidateId: string, tenantId: string): Promise<Candidate | null> {
  const query = `
    SELECT C.*
    FROM Candidates C
    JOIN Results R ON R.candidate_id = C.ROWID
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE C.ROWID = '${escapeSql(candidateId)}'
      AND J.tenant_id = '${escapeSql(tenantId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Candidate>(result, TABLE)[0] ?? null;
}

/**
 * Búsqueda de candidato por email scope-eada al tenant. Usa el mismo JOIN que getByIdScopedToTenant.
 * Si el candidato existe pero NO está vinculado al tenant, devuelve null (no leak).
 */
async function getByEmailScopedToTenant(req: IncomingMessage, email: string, tenantId: string): Promise<Candidate | null> {
  const query = `
    SELECT C.*
    FROM Candidates C
    JOIN Results R ON R.candidate_id = C.ROWID
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE C.email = '${escapeSql(email)}'
      AND J.tenant_id = '${escapeSql(tenantId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Candidate>(result, TABLE)[0] ?? null;
}

async function getByEmailGlobal(req: IncomingMessage, email: string): Promise<Candidate | null> {
  // Lookup global SIN exponer al cliente — solo internal para deduplicación.
  // Si el email existe pero pertenece a otro tenant, se REUSA el ROWID pero NO se devuelven los datos.
  const query = `SELECT ROWID, email FROM ${TABLE} WHERE email = '${escapeSql(email)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Candidate>(result, TABLE)[0] ?? null;
}

async function listByTenant(req: IncomingMessage, tenantId: string, limit = 100): Promise<Candidate[]> {
  const query = `
    SELECT C.*
    FROM Candidates C
    JOIN Results R ON R.candidate_id = C.ROWID
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE J.tenant_id = '${escapeSql(tenantId)}'
    ORDER BY C.CREATEDTIME DESC
    LIMIT ${Math.min(limit, 500)}
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Candidate>(result, TABLE);
}

async function insertCandidate(req: IncomingMessage, payload: CandidateInsert): Promise<Candidate> {
  const row = await datastore(req).table(TABLE).insertRow({
    ...payload,
    created_at: now(),
  });
  return unwrapRow<Candidate>(row, TABLE) as Candidate;
}

async function updateCandidate(req: IncomingMessage, rowId: string, patch: CandidatePatch): Promise<Candidate | null> {
  const row = await datastore(req).table(TABLE).updateRow({ ROWID: rowId, ...patch });
  return unwrapRow<Candidate>(row, TABLE);
}

// ---- Handlers ----

export async function listCandidates(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));
  const candidates = await listByTenant(ctx.req, tenantId, limit);
  log.info('list', { traceId: ctx.traceId, tenantId, count: candidates.length });
  sendJson(ctx.res, 200, { candidates });
}

export async function getCandidate(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('candidate id missing in path');
  const candidate = await getByIdScopedToTenant(ctx.req, id, tenantId);
  if (!candidate) throw new NotFoundError(`Candidate ${id} not found`);
  sendJson(ctx.res, 200, { candidate });
}

export async function createCandidate(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const body = await readJsonBody(ctx.req);
  const draft = validateInsert(body);

  // 1) Existe ya en este tenant? → devolver el existente
  const sameTenantExisting = await getByEmailScopedToTenant(ctx.req, draft.email, tenantId);
  if (sameTenantExisting) {
    log.info('candidate exists in tenant, returning existing', {
      traceId: ctx.traceId,
      candidateId: sameTenantExisting.ROWID,
    });
    sendJson(ctx.res, 200, { candidate: sameTenantExisting, existed: true });
    return;
  }

  // 2) Existe globalmente (otro tenant)? → reutilizar ROWID pero NO exponer datos del otro tenant.
  //    Solo devolvemos el ROWID + email para que el caller pueda crear un Result.
  const globalExisting = await getByEmailGlobal(ctx.req, draft.email);
  if (globalExisting) {
    log.info('candidate exists in another tenant, reusing ROWID without exposing data', {
      traceId: ctx.traceId,
      candidateId: globalExisting.ROWID,
    });
    sendJson(ctx.res, 200, {
      candidate: { ROWID: globalExisting.ROWID, email: globalExisting.email },
      existed: true,
      cross_tenant: true,
    });
    return;
  }

  // 3) No existe en ningún lado → crear nuevo
  const created = await insertCandidate(ctx.req, draft);
  log.info('created', { traceId: ctx.traceId, candidateId: created.ROWID });
  void auditLog(ctx, {
    action: 'candidate.create',
    resource_type: 'candidate',
    resource_id: created.ROWID,
    changes: { name: draft.name }, // sin email/phone para no logear PII
  });
  sendJson(ctx.res, 201, { candidate: created, existed: false });
}

export async function patchCandidate(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('candidate id missing in path');

  // Solo se puede patchear un candidato si ya está vinculado al tenant via Result.
  const existing = await getByIdScopedToTenant(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError(`Candidate ${id} not found`);

  const body = await readJsonBody(ctx.req);
  const patch = validatePatch(body);

  // Si está cambiando email a uno que pertenece a OTRO tenant, rechazar (no podemos
  // crear conflicto entre tenants distintos).
  if (patch.email && patch.email !== existing.email) {
    const conflict = await getByEmailGlobal(ctx.req, patch.email);
    if (conflict && conflict.ROWID !== id) {
      throw new ValidationError(`Email already in use by another candidate`);
    }
  }

  const updated = await updateCandidate(ctx.req, id, patch);
  log.info('patched', { traceId: ctx.traceId, candidateId: id, fields: Object.keys(patch) });
  void auditLog(ctx, {
    action: 'candidate.update',
    resource_type: 'candidate',
    resource_id: id,
    changes: { fields: Object.keys(patch) }, // solo nombres de campos, sin valores PII
  });
  sendJson(ctx.res, 200, { candidate: updated });
}

function extractIdFromPath(url: string): string | null {
  const match = url.match(/^\/api\/candidates\/([^/?]+)/);
  return match?.[1] ?? null;
}
