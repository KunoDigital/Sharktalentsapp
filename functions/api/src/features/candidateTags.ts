/**
 * Tags por candidato — clasificación libre por skills, intereses, áreas, etc.
 * para búsquedas futuras del pool.
 *
 *   GET    /api/candidates/:id/tags          — lista tags del candidato
 *   POST   /api/candidates/:id/tags          — agregar tag
 *   DELETE /api/candidates/:id/tags/:tagId   — borrar tag
 *
 *   GET    /api/tenant/tags                  — lista todos los tags del tenant (autocomplete)
 *   GET    /api/candidates/_by-tag?tag=X     — candidatos con un tag específico
 *
 * Diseño:
 *   - Tags son tenant-scoped (cada tenant tiene su vocabulario)
 *   - Normalizamos a lowercase para consistencia
 *   - Idempotente: si el tag ya existe, no duplica
 *
 * Tabla: CandidateTags (deferred).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('CANDIDATE_TAGS');
// 2026-06-04: nombre "CandidateTags" envenenado en Catalyst tras orphan; renombrado.
const TABLE = 'CandidateLabels';

type TagRow = {
  ROWID: string;
  tenant_id: string;
  candidate_id: string;
  tag: string;
  created_by: string;
  created_at: string;
};

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 50).replace(/\s+/g, '-');
}

function extractCandidateId(url: string, withTag = false): string | null {
  const re = withTag
    ? /^\/api\/candidates\/([^/]+)\/tags\/[^/]+/
    : /^\/api\/candidates\/([^/]+)\/tags/;
  return url.match(re)?.[1] ?? null;
}

function extractTagId(url: string): string | null {
  return url.match(/^\/api\/candidates\/[^/]+\/tags\/([^/?]+)/)?.[1] ?? null;
}

async function validateCandidateInTenant(req: RequestContext['req'], candidateId: string, tenantId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT C.ROWID FROM Candidates C
         JOIN Results R ON R.candidate_id = C.ROWID
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE C.ROWID = '${escapeSql(candidateId)}' AND J.tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    );
    return rows.length > 0;
  } catch { return false; }
}

export async function listCandidateTags(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const candidateId = extractCandidateId(ctx.req.url ?? '/');
  if (!candidateId) throw new ValidationError('candidate id missing in path');
  if (!(await validateCandidateInTenant(ctx.req, candidateId, tenantId))) {
    throw new NotFoundError(`Candidate ${candidateId} not found`);
  }
  try {
    const rows = unwrapRows<TagRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM ${TABLE}
         WHERE candidate_id = '${escapeSql(candidateId)}'
           AND tenant_id = '${escapeSql(tenantId)}'
         ORDER BY CREATEDTIME ASC LIMIT 100`,
      )) as unknown[],
      TABLE,
    );
    sendJson(ctx.res, 200, { tags: rows });
  } catch (err) {
    log.debug('tags list failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { tags: [], table_not_ready: true });
  }
}

export async function addCandidateTag(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const candidateId = extractCandidateId(ctx.req.url ?? '/');
  if (!candidateId) throw new ValidationError('candidate id missing in path');
  if (!(await validateCandidateInTenant(ctx.req, candidateId, tenantId))) {
    throw new NotFoundError(`Candidate ${candidateId} not found`);
  }
  const body = await readJsonBody<{ tag?: string }>(ctx.req);
  const tag = normalizeTag(typeof body.tag === 'string' ? body.tag : '');
  if (!tag) throw new ValidationError('tag requerido');

  try {
    // Dedup: chequear si ya existe
    const existing = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE}
         WHERE candidate_id = '${escapeSql(candidateId)}'
           AND tag = '${escapeSql(tag)}'
           AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];
    if (existing) {
      sendJson(ctx.res, 200, { ok: true, tag, already_existed: true, id: existing.ROWID });
      return;
    }
    const inserted = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      candidate_id: candidateId,
      tag,
      created_by: ctx.user?.clerk_user_id ?? 'unknown',
      created_at: now(),
    });
    sendJson(ctx.res, 201, { ok: true, tag, row: inserted });
  } catch (err) {
    log.warn('tag insert failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'tag_insert_failed', message: (err as Error).message } });
  }
}

export async function deleteCandidateTag(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const candidateId = extractCandidateId(ctx.req.url ?? '/', true);
  const tagId = extractTagId(ctx.req.url ?? '/');
  if (!candidateId || !tagId) throw new ValidationError('paths inválidos');

  const existing = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE}
       WHERE ROWID = '${escapeSql(tagId)}'
         AND candidate_id = '${escapeSql(candidateId)}'
         AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError('Tag no encontrado');
  await datastore(ctx.req).table(TABLE).deleteRow(tagId);
  sendJson(ctx.res, 200, { ok: true });
}

/**
 * POST /api/candidates/_bulk-tag
 * Body: { application_ids: string[], tag: string }
 *
 * Agrega un tag a múltiples candidatos a la vez. Recibe application_ids y deriva
 * los candidate_ids (porque la UI selecciona Applications, no Candidates).
 *
 * Idempotente: si un candidato ya tiene el tag, no duplica.
 */
export async function bulkTagCandidates(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const body = await readJsonBody<{ application_ids?: unknown; tag?: string }>(ctx.req);
  if (!Array.isArray(body.application_ids) || body.application_ids.length === 0) {
    throw new ValidationError('application_ids array requerido (non-empty)');
  }
  if (body.application_ids.length > 200) {
    throw new ValidationError('máximo 200 aplicaciones por bulk tag');
  }
  const tag = normalizeTag(typeof body.tag === 'string' ? body.tag : '');
  if (!tag) throw new ValidationError('tag requerido');

  // Derivar candidate_ids (scope tenant) desde application_ids
  const appIdsList = (body.application_ids as unknown[])
    .filter((id) => typeof id === 'string' && id)
    .map((id) => `'${escapeSql(id as string)}'`)
    .join(',');
  if (!appIdsList) {
    throw new ValidationError('ningún application_id válido');
  }

  let candidateIds: string[] = [];
  try {
    const rows = unwrapRows<{ candidate_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT DISTINCT R.candidate_id
         FROM Results R
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE R.ROWID IN (${appIdsList})
           AND J.tenant_id = '${escapeSql(tenantId)}'`,
      )) as unknown[],
      'Results',
    );
    candidateIds = rows.map((r) => r.candidate_id);
  } catch (err) {
    log.warn('candidate lookup failed for bulk tag', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'lookup_failed', message: (err as Error).message } });
    return;
  }

  const results = { tagged: 0, already_had: 0, failed: 0 };
  const userId = ctx.user?.clerk_user_id ?? 'unknown';

  for (const candidateId of candidateIds) {
    try {
      // Dedup
      const existing = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM ${TABLE}
           WHERE candidate_id = '${escapeSql(candidateId)}'
             AND tag = '${escapeSql(tag)}'
             AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
        )) as unknown[],
        TABLE,
      )[0];
      if (existing) {
        results.already_had += 1;
        continue;
      }
      await datastore(ctx.req).table(TABLE).insertRow({
        tenant_id: tenantId,
        candidate_id: candidateId,
        tag,
        created_by: userId,
        created_at: now(),
      });
      results.tagged += 1;
    } catch (err) {
      log.debug('bulk tag failed for candidate', { candidateId, error: (err as Error).message });
      results.failed += 1;
    }
  }

  sendJson(ctx.res, 200, { tag, total: candidateIds.length, ...results });
}

/**
 * GET /api/tenant/tags
 * Devuelve todos los tags únicos usados en el tenant con count.
 * Útil para autocomplete + filtros.
 */
export async function listTenantTags(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  try {
    const rows = unwrapRows<{ tag: string; cnt: number; c: number }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT tag, COUNT(ROWID) AS cnt FROM ${TABLE}
         WHERE tenant_id = '${escapeSql(tenantId)}'
         GROUP BY tag ORDER BY COUNT(ROWID) DESC LIMIT 200`,
      )) as unknown[],
      TABLE,
    );
    const tags = rows.map((r) => ({ tag: r.tag, count: Number(r.cnt ?? r.c ?? 0) }));
    sendJson(ctx.res, 200, { tags });
  } catch (err) {
    log.debug('tenant tags failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { tags: [], table_not_ready: true });
  }
}

/**
 * GET /api/candidates/_by-tag?tag=X
 * Lista candidatos del tenant que tienen el tag X.
 */
export async function listCandidatesByTag(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const tag = normalizeTag(url.searchParams.get('tag') ?? '');
  if (!tag) throw new ValidationError('tag requerido');
  try {
    const rows = unwrapRows<{ candidate_id: string; name: string; email: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT DISTINCT T.candidate_id, C.name, C.email
         FROM ${TABLE} T
         JOIN Candidates C ON C.ROWID = T.candidate_id
         WHERE T.tenant_id = '${escapeSql(tenantId)}' AND T.tag = '${escapeSql(tag)}'
         LIMIT 100`,
      )) as unknown[],
      TABLE,
    );
    sendJson(ctx.res, 200, { tag, candidates: rows });
  } catch (err) {
    log.debug('candidates by tag failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { tag, candidates: [], table_not_ready: true });
  }
}
