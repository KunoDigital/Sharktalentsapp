/**
 * Notas del recruiter por candidato.
 *
 *   GET    /api/applications/:id/notes          — lista notas (más reciente primero)
 *   POST   /api/applications/:id/notes          — crear nota
 *   PATCH  /api/applications/:id/notes/:noteId  — editar (solo autor)
 *   DELETE /api/applications/:id/notes/:noteId  — borrar (solo autor)
 *
 * Tabla: CandidateNotes (deferred — backend tolera ausencia).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('CANDIDATE_NOTES');
// 2026-06-04: nombre "CandidateNotes" envenenado en Catalyst tras orphan; renombrado.
const TABLE = 'RecruiterNotes';

type NoteRow = {
  ROWID: string;
  tenant_id: string;
  application_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

function extractAppId(url: string): string | null {
  const m = url.match(/^\/api\/applications\/([^/]+)\/notes/);
  return m?.[1] ?? null;
}

function extractNoteId(url: string): string | null {
  const m = url.match(/^\/api\/applications\/[^/]+\/notes\/([^/?]+)/);
  return m?.[1] ?? null;
}

async function validateApplicationInTenant(req: RequestContext['req'], applicationId: string, tenantId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT R.ROWID FROM Results R
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE R.ROWID = '${escapeSql(applicationId)}' AND J.tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function listCandidateNotes(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const appId = extractAppId(ctx.req.url ?? '/');
  if (!appId) throw new ValidationError('application id missing in path');

  if (!(await validateApplicationInTenant(ctx.req, appId, tenantId))) {
    throw new NotFoundError(`Application ${appId} not found`);
  }

  try {
    const rows = unwrapRows<NoteRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM ${TABLE}
         WHERE application_id = '${escapeSql(appId)}'
           AND tenant_id = '${escapeSql(tenantId)}'
         ORDER BY is_pinned DESC, CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      TABLE,
    );
    sendJson(ctx.res, 200, { notes: rows });
  } catch (err) {
    log.debug('notes list failed (table may not exist)', { error: (err as Error).message });
    sendJson(ctx.res, 200, { notes: [], table_not_ready: true });
  }
}

export async function createCandidateNote(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const appId = extractAppId(ctx.req.url ?? '/');
  if (!appId) throw new ValidationError('application id missing in path');

  if (!(await validateApplicationInTenant(ctx.req, appId, tenantId))) {
    throw new NotFoundError(`Application ${appId} not found`);
  }

  const body = await readJsonBody<{ body?: string; is_pinned?: boolean }>(ctx.req);
  const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!noteBody) throw new ValidationError('body requerido');
  if (noteBody.length > 5000) throw new ValidationError('body máximo 5000 chars');

  try {
    const row = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      application_id: appId,
      author_id: ctx.user?.clerk_user_id ?? 'unknown',
      author_name: ctx.user?.email ?? null,
      body: noteBody,
      is_pinned: body.is_pinned === true,
      created_at: now(),
      updated_at: now(),
    });
    sendJson(ctx.res, 201, { note: row });
  } catch (err) {
    log.warn('note insert failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'note_insert_failed', message: (err as Error).message } });
  }
}

export async function updateCandidateNote(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const appId = extractAppId(ctx.req.url ?? '/');
  const noteId = extractNoteId(ctx.req.url ?? '/');
  if (!appId || !noteId) throw new ValidationError('paths inválidos');

  const existing = unwrapRows<NoteRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE}
       WHERE ROWID = '${escapeSql(noteId)}'
         AND application_id = '${escapeSql(appId)}'
         AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError('Nota no encontrada');

  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  if (existing.author_id !== userId) {
    throw new AppError(403, 'forbidden', 'Solo el autor puede editar su nota');
  }

  const body = await readJsonBody<{ body?: string; is_pinned?: boolean }>(ctx.req);
  const patch: { ROWID: string; updated_at: string; body?: string; is_pinned?: boolean } = { ROWID: noteId, updated_at: now() };
  if (typeof body.body === 'string') {
    const trimmed = body.body.trim();
    if (!trimmed) throw new ValidationError('body no puede estar vacío');
    if (trimmed.length > 5000) throw new ValidationError('body máximo 5000 chars');
    patch.body = trimmed;
  }
  if (typeof body.is_pinned === 'boolean') patch.is_pinned = body.is_pinned;

  try {
    await datastore(ctx.req).table(TABLE).updateRow(patch);
    sendJson(ctx.res, 200, { ok: true });
  } catch (err) {
    log.warn('note update failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'note_update_failed', message: (err as Error).message } });
  }
}

export async function deleteCandidateNote(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const appId = extractAppId(ctx.req.url ?? '/');
  const noteId = extractNoteId(ctx.req.url ?? '/');
  if (!appId || !noteId) throw new ValidationError('paths inválidos');

  const existing = unwrapRows<NoteRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE}
       WHERE ROWID = '${escapeSql(noteId)}'
         AND application_id = '${escapeSql(appId)}'
         AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError('Nota no encontrada');

  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  if (existing.author_id !== userId) {
    throw new AppError(403, 'forbidden', 'Solo el autor puede borrar su nota');
  }

  await datastore(ctx.req).table(TABLE).deleteRow(noteId);
  sendJson(ctx.res, 200, { ok: true });
}
