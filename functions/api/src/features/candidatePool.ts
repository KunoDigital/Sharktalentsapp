/**
 * Pool interno de candidatos (doc 22 capa 1).
 *
 * Endpoints:
 *   GET    /api/pool                  → listar pool del tenant (filtros: tag, available, limit)
 *   POST   /api/pool                  → agregar candidato al pool (manual o auto desde otro flow)
 *   PATCH  /api/pool/:id              → actualizar tags / disponibilidad / notes
 *   DELETE /api/pool/:id              → soft-remove (disponible_para_outreach=false)
 *   POST   /api/pool/match            → match con un job_id, devuelve top N candidatos ordenados
 *
 * Tabla `CandidatePool` es OPCIONAL (deferred Block 2). Sin ella → 503 con mensaje claro.
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, truncate, FIELD_LIMITS } from '../lib/dbLimits';
import { ValidationError, NotFoundError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { parseIdealProfile } from './jobs';
import {
  calculateMatchWithJobLevel,
  type PoolCandidateInput,
  type MatchResult,
} from '../lib/candidatePoolMatcher';

const log = logger('CANDIDATE_POOL');
const TABLE = 'CandidatePool';

const TABLE_NOT_READY = new AppError(
  503,
  'table_not_ready',
  `La tabla ${TABLE} todavía no fue creada en Catalyst. Ver MIGRATIONS_BLOCK2.md y reintentar.`,
);

let tableReady: boolean | null = null;

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

export type PoolRow = {
  ROWID: string;
  tenant_id: string;
  candidate_id: string;
  tags: string; // JSON array
  disponible_para_outreach: boolean;
  last_active: string | null;
  contact_preference: string;
  times_contacted: number;
  last_contacted_at: string | null;
  notes_internal: string | null;
  // Snapshot fields para matching sin JOIN
  disc_d: number | null;
  disc_i: number | null;
  disc_s: number | null;
  disc_c: number | null;
  velna_indice: number | null;
  cognitive_level: 'basic' | 'mid' | 'senior' | null;
  languages: string | null; // JSON array
  added_at: string;
  updated_at: string;
};

function tryParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToInput(row: PoolRow): PoolCandidateInput {
  return {
    candidate_id: row.candidate_id,
    disc: (row.disc_d != null && row.disc_i != null && row.disc_s != null && row.disc_c != null)
      ? { d: row.disc_d, i: row.disc_i, s: row.disc_s, c: row.disc_c }
      : null,
    cognitive_level: row.cognitive_level,
    velna_indice: row.velna_indice,
    tags: tryParseArray(row.tags),
    last_active: row.last_active,
    languages: tryParseArray(row.languages),
    disponible_para_outreach: row.disponible_para_outreach !== false,
    times_contacted: row.times_contacted ?? 0,
  };
}

// ===== Handlers =====

export async function listPool(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const availableOnly = url.searchParams.get('available_only') === 'true';
  const tag = url.searchParams.get('tag');
  // Tags multi: ?tags=react,senior&match=all|any (default any)
  const tagsParam = url.searchParams.get('tags');
  const matchMode = url.searchParams.get('match') === 'all' ? 'all' : 'any';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));

  const filters = [`tenant_id = '${escapeSql(tenantId)}'`];
  if (availableOnly) filters.push('disponible_para_outreach = true');

  const q = `SELECT * FROM ${TABLE} WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  const rows = unwrapRows<PoolRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE);

  // Filtrar por tags en memoria (ZCQL no permite contains en strings JSON)
  let filtered = rows;
  const tagsToMatch: string[] = tagsParam
    ? tagsParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : tag ? [tag.toLowerCase()] : [];
  if (tagsToMatch.length > 0) {
    filtered = rows.filter((r) => {
      const rowTags = tryParseArray(r.tags).map((t) => t.toLowerCase());
      if (matchMode === 'all') return tagsToMatch.every((t) => rowTags.includes(t));
      return tagsToMatch.some((t) => rowTags.includes(t));
    });
  }

  sendJson(ctx.res, 200, {
    pool: filtered.map((r) => ({
      ...r,
      tags: tryParseArray(r.tags),
      languages: tryParseArray(r.languages),
    })),
    count: filtered.length,
  });
}

export async function addToPool(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const candidateId = typeof body.candidate_id === 'string' ? body.candidate_id : '';
  if (!candidateId) throw new ValidationError('candidate_id required');

  // Validación: el candidato debe existir y pertenecer al tenant
  type CandidateExistsRow = { ROWID: string };
  const exists = unwrapRows<CandidateExistsRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Candidates WHERE ROWID = '${escapeSql(candidateId)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];
  if (!exists) throw new NotFoundError(`Candidate ${candidateId} not found`);

  // Verificar que no esté ya en el pool
  const dup = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE candidate_id = '${escapeSql(candidateId)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (dup) {
    throw new ValidationError('Candidate already in pool — usar PATCH para editar');
  }

  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 20) : [];
  const languages = Array.isArray(body.languages) ? body.languages.filter((l) => typeof l === 'string').slice(0, 10) : [];

  const insert = {
    tenant_id: tenantId,
    candidate_id: candidateId,
    tags: stringifyAndTruncate(tags, FIELD_LIMITS.POOL_TAGS, 'CandidatePool.tags'),
    disponible_para_outreach: body.disponible_para_outreach !== false,
    last_active: typeof body.last_active === 'string' ? body.last_active : now(),
    contact_preference: typeof body.contact_preference === 'string' ? body.contact_preference : 'email',
    times_contacted: 0,
    last_contacted_at: null,
    notes_internal: typeof body.notes_internal === 'string'
      ? truncate(body.notes_internal, FIELD_LIMITS.POOL_NOTES, 'CandidatePool.notes_internal')
      : null,
    disc_d: typeof body.disc_d === 'number' ? body.disc_d : null,
    disc_i: typeof body.disc_i === 'number' ? body.disc_i : null,
    disc_s: typeof body.disc_s === 'number' ? body.disc_s : null,
    disc_c: typeof body.disc_c === 'number' ? body.disc_c : null,
    velna_indice: typeof body.velna_indice === 'number' ? body.velna_indice : null,
    cognitive_level: typeof body.cognitive_level === 'string' && ['basic', 'mid', 'senior'].includes(body.cognitive_level)
      ? body.cognitive_level
      : null,
    languages: stringifyAndTruncate(languages, FIELD_LIMITS.POOL_LANGUAGES, 'CandidatePool.languages'),
    added_at: now(),
    updated_at: now(),
  };

  const row = await datastore(ctx.req).table(TABLE).insertRow(insert);
  const inserted = unwrapRow<PoolRow>(row, TABLE);

  void auditLog(ctx, {
    action: 'candidate.update',
    resource_type: 'candidate_pool',
    resource_id: inserted?.ROWID ?? null,
    changes: { candidate_id: candidateId, tags },
  });

  sendJson(ctx.res, 201, { pool_entry: inserted });
}

export async function patchPoolEntry(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;
  const id = ctx.req.url?.match(/^\/api\/pool\/([^/?]+)/)?.[1];
  if (!id) throw new ValidationError('pool entry id missing');

  const existing = await fetchPoolEntry(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError(`Pool entry ${id} not found`);

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const patch: Record<string, unknown> = { ROWID: id, updated_at: now() };

  if (Array.isArray(body.tags)) {
    const filteredTags = body.tags.filter((t) => typeof t === 'string').slice(0, 20);
    patch.tags = stringifyAndTruncate(filteredTags, FIELD_LIMITS.POOL_TAGS, 'CandidatePool.tags');
  }
  if (typeof body.disponible_para_outreach === 'boolean') {
    patch.disponible_para_outreach = body.disponible_para_outreach;
  }
  if (typeof body.notes_internal === 'string') {
    patch.notes_internal = truncate(body.notes_internal, FIELD_LIMITS.POOL_NOTES, 'CandidatePool.notes_internal');
  }
  if (typeof body.contact_preference === 'string') {
    patch.contact_preference = body.contact_preference;
  }
  if (Array.isArray(body.languages)) {
    const filteredLangs = body.languages.filter((l) => typeof l === 'string').slice(0, 10);
    patch.languages = stringifyAndTruncate(filteredLangs, FIELD_LIMITS.POOL_LANGUAGES, 'CandidatePool.languages');
  }

  await datastore(ctx.req).table(TABLE).updateRow(patch as { ROWID: string });
  const updated = await fetchPoolEntry(ctx.req, id, tenantId);

  sendJson(ctx.res, 200, { pool_entry: updated });
}

export async function removeFromPool(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;
  const id = ctx.req.url?.match(/^\/api\/pool\/([^/?]+)/)?.[1];
  if (!id) throw new ValidationError('pool entry id missing');

  const existing = await fetchPoolEntry(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError(`Pool entry ${id} not found`);

  // Soft-remove: solo marcamos disponible_para_outreach=false. No borramos el row.
  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: id,
    disponible_para_outreach: false,
    updated_at: now(),
  });

  log.info('pool entry removed', { traceId: ctx.traceId, tenantId, id });
  sendJson(ctx.res, 200, { removed: true, id });
}

export async function matchPool(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const jobId = typeof body.job_id === 'string' ? body.job_id : '';
  if (!jobId) throw new ValidationError('job_id required');
  const limit = Math.max(1, Math.min(50, typeof body.limit === 'number' ? body.limit : 20));
  const requiresEnglish = body.requires_english === true;
  const areaTags = Array.isArray(body.area_tags)
    ? body.area_tags.filter((t) => typeof t === 'string').slice(0, 20) as string[]
    : [];

  // Cargar job (para ideal_profile + cognitive_level)
  type JobPick = {
    ROWID: string;
    tenant_id: string;
    cognitive_level: 'basic' | 'mid' | 'senior';
    ideal_profile?: string | null;
  };
  const jobRow = unwrapRows<JobPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id, cognitive_level, ideal_profile FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];

  if (!jobRow || jobRow.tenant_id !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);

  const ideal = parseIdealProfile(jobRow.ideal_profile ?? null);

  // 2026-06-04 (audit fix #21): LIMIT en ambas queries. Sin LIMIT, un pool de 8.000
  // candidatos + un job con 1.500 Results traía 2.5MB+ a memoria por cada request.
  // 5.000 es generoso para casos reales (tenant grande), pero acota el blast radius.

  // Excluir candidatos que ya aplicaron a este job
  type AppliedRow = { candidate_id: string };
  const applied = unwrapRows<AppliedRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT candidate_id FROM Results WHERE assessment_id = '${escapeSql(jobId)}' LIMIT 300`,
    )) as unknown[],
    'Results',
  ).map((r) => r.candidate_id);
  const appliedSet = new Set(applied);

  // Cargar pool del tenant disponible
  const poolRows = unwrapRows<PoolRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}' AND disponible_para_outreach = true LIMIT 300`,
    )) as unknown[],
    TABLE,
  );

  const available = poolRows.filter((r) => !appliedSet.has(r.candidate_id));

  // Score cada uno
  const matched: Array<MatchResult & { pool_entry_id: string }> = available.map((row) => ({
    pool_entry_id: row.ROWID,
    ...calculateMatchWithJobLevel(rowToInput(row), ideal, jobRow.cognitive_level, {
      areaTags,
      requiresEnglish,
    }),
  }));

  matched.sort((a, b) => b.match_score - a.match_score);
  const top = matched.slice(0, limit);

  log.info('pool match', {
    traceId: ctx.traceId,
    tenantId,
    jobId,
    pool_size: poolRows.length,
    available: available.length,
    returned: top.length,
  });

  sendJson(ctx.res, 200, {
    job_id: jobId,
    pool_size: poolRows.length,
    available_for_match: available.length,
    matches: top,
  });
}

/**
 * POST /api/pool/:id/invite-to-job
 * Body: { job_id, send_email?: true }
 *
 * Crea una Application (Result) en stage 'prefilter_passed' del candidato del pool al job
 * indicado. Si send_email=true (default), encola email "Tenemos un puesto para vos".
 *
 * Idempotente: si ya hay un Result para ese candidate+job, devuelve el existente.
 */
export async function invitePoolToJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const poolId = ctx.req.url?.match(/^\/api\/pool\/([^/?]+)\/invite-to-job/)?.[1];
  if (!poolId) throw new ValidationError('pool id missing');

  const body = await readJsonBody<{ job_id?: string; send_email?: boolean }>(ctx.req);
  const jobId = typeof body.job_id === 'string' ? body.job_id : '';
  if (!jobId) throw new ValidationError('job_id required');
  const sendEmail = body.send_email !== false;

  const poolEntry = await fetchPoolEntry(ctx.req, poolId, tenantId);
  if (!poolEntry) throw new NotFoundError(`Pool entry ${poolId} not found`);

  // Validar que el job pertenece al tenant
  const jobRows = unwrapRows<{ ROWID: string; tenant_id: string; title: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id, title FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  );
  const job = jobRows[0];
  if (!job || job.tenant_id !== tenantId) {
    throw new NotFoundError(`Job ${jobId} not found in tenant`);
  }

  // Chequear si ya existe Result para este candidate+job
  let existingResult = unwrapRows<{ ROWID: string; pipeline_stage: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage FROM Results
       WHERE candidate_id = '${escapeSql(poolEntry.candidate_id)}'
         AND assessment_id = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  let createdNew = false;
  if (!existingResult) {
    // Crear Result nuevo en prefilter_passed (saltamos prescreening — vienen del pool)
    const inserted = await datastore(ctx.req).table('Results').insertRow({
      assessment_id: jobId,
      candidate_id: poolEntry.candidate_id,
      answers: null,
      pipeline_stage: 'prefilter_passed',
      started_at: now(),
      completed_at: null,
      report_downloaded_at: null,
      idempotency_key: null,
    });
    existingResult = unwrapRow<{ ROWID: string; pipeline_stage: string }>(inserted, 'Results') ?? undefined as never;
    createdNew = true;
  }

  // Actualizar pool entry: incrementar times_contacted + last_contacted_at
  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: poolId,
    times_contacted: (poolEntry.times_contacted ?? 0) + 1,
    last_contacted_at: now(),
    updated_at: now(),
  });

  // Mandar email opcionalmente
  if (sendEmail && createdNew) {
    void (async () => {
      try {
        const { notifyCandidateOnTransition } = await import('../lib/candidateNotifier.js');
        await notifyCandidateOnTransition(ctx.req, {
          applicationId: existingResult.ROWID,
          toStage: 'prefilter_passed',
        });
      } catch (err) {
        log.warn('invite email failed', { error: (err as Error).message });
      }
    })();
  }

  void auditLog(ctx, {
    action: 'application.create',
    resource_type: 'application',
    resource_id: existingResult.ROWID,
    changes: { source: 'pool_invite', pool_id: poolId, job_id: jobId, created_new: createdNew },
  });

  sendJson(ctx.res, createdNew ? 201 : 200, {
    application_id: existingResult.ROWID,
    job_title: job.title,
    created_new: createdNew,
    pipeline_stage: existingResult.pipeline_stage,
    email_sent: sendEmail && createdNew,
  });
}

async function fetchPoolEntry(req: IncomingMessage, id: string, tenantId: string): Promise<PoolRow | null> {
  const q = `SELECT * FROM ${TABLE} WHERE ROWID = '${escapeSql(id)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const rows = unwrapRows<PoolRow>((await zcql(req).executeZCQLQuery(q)) as unknown[], TABLE);
  return rows[0] ?? null;
}

export function _resetTableReadyForTests() {
  tableReady = null;
}
