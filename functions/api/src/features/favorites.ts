/**
 * Sistema de favoritos por usuario — bookmark de jobs/candidatos/drafts para acceso rápido.
 *
 *   GET    /api/favorites                       — lista mis favoritos
 *   POST   /api/favorites                       — agregar
 *   DELETE /api/favorites/:type/:resourceId     — quitar
 *
 * Scope: tenant + user. Cada Cris tiene sus propios favoritos.
 *
 * Tabla: UserFavorites (deferred).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('FAVORITES');
// 2026-06-04: nombre "UserFavorites" envenenado en Catalyst tras orphan; renombrado.
const TABLE = 'Bookmarks';

const VALID_TYPES = new Set(['job', 'candidate', 'draft', 'client']);

type FavRow = {
  ROWID: string;
  tenant_id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
  label: string | null;
  created_at: string;
};

export async function listFavorites(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  try {
    const rows = unwrapRows<FavRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM ${TABLE}
         WHERE tenant_id = '${escapeSql(tenantId)}'
           AND user_id = '${escapeSql(userId)}'
         ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      TABLE,
    );
    sendJson(ctx.res, 200, { favorites: rows });
  } catch (err) {
    log.debug('favorites list failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { favorites: [], table_not_ready: true });
  }
}

export async function addFavorite(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  const body = await readJsonBody<{ resource_type?: string; resource_id?: string; label?: string }>(ctx.req);
  const type = (body.resource_type ?? '').toLowerCase();
  const resourceId = (body.resource_id ?? '').trim();
  if (!VALID_TYPES.has(type)) throw new ValidationError(`resource_type debe ser uno de ${[...VALID_TYPES].join(', ')}`);
  if (!resourceId) throw new ValidationError('resource_id requerido');
  const label = typeof body.label === 'string' ? body.label.slice(0, 200) : null;

  try {
    // Dedup
    const existing = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE}
         WHERE tenant_id = '${escapeSql(tenantId)}'
           AND user_id = '${escapeSql(userId)}'
           AND resource_type = '${escapeSql(type)}'
           AND resource_id = '${escapeSql(resourceId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];
    if (existing) {
      sendJson(ctx.res, 200, { ok: true, id: existing.ROWID, already_existed: true });
      return;
    }
    const inserted = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      user_id: userId,
      resource_type: type,
      resource_id: resourceId,
      label,
      created_at: now(),
    });
    sendJson(ctx.res, 201, { ok: true, row: inserted });
  } catch (err) {
    log.warn('favorite insert failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'favorite_insert_failed', message: (err as Error).message } });
  }
}

export async function removeFavorite(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  const m = ctx.req.url?.match(/^\/api\/favorites\/([^/]+)\/([^/?]+)/);
  if (!m) throw new ValidationError('paths inválidos');
  const type = m[1].toLowerCase();
  const resourceId = m[2];
  if (!VALID_TYPES.has(type)) throw new ValidationError('resource_type inválido');

  try {
    const existing = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE}
         WHERE tenant_id = '${escapeSql(tenantId)}'
           AND user_id = '${escapeSql(userId)}'
           AND resource_type = '${escapeSql(type)}'
           AND resource_id = '${escapeSql(resourceId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];
    if (!existing) {
      sendJson(ctx.res, 200, { ok: true, message: 'no estaba en favoritos' });
      return;
    }
    await datastore(ctx.req).table(TABLE).deleteRow(existing.ROWID);
    sendJson(ctx.res, 200, { ok: true });
  } catch (err) {
    log.warn('favorite delete failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'favorite_delete_failed', message: (err as Error).message } });
  }
}
