/**
 * Saved searches por usuario — guarda combos de filtros con nombre para reusar.
 *
 *   GET    /api/saved-searches?scope=pool
 *   POST   /api/saved-searches
 *   DELETE /api/saved-searches/:id
 *
 * Cada saved search es: name + scope (pool|candidates|jobs) + filters JSON.
 * Scope tenant + user.
 *
 * Tabla: SavedSearches (deferred).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('SAVED_SEARCHES');
// 2026-06-04: nombre "SavedSearches" envenenado en Catalyst tras orphan; renombrado.
const TABLE = 'SavedFilters';

const VALID_SCOPES = new Set(['pool', 'candidates', 'jobs']);

type SearchRow = {
  ROWID: string;
  tenant_id: string;
  user_id: string;
  scope: string;
  name: string;
  filters: string; // JSON
  created_at: string;
  updated_at: string;
};

export async function listSavedSearches(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const scope = url.searchParams.get('scope');
  if (scope && !VALID_SCOPES.has(scope)) throw new ValidationError('scope inválido');

  try {
    const filters = [
      `tenant_id = '${escapeSql(tenantId)}'`,
      `user_id = '${escapeSql(userId)}'`,
    ];
    if (scope) filters.push(`scope = '${escapeSql(scope)}'`);
    const rows = unwrapRows<SearchRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM ${TABLE} WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT 50`,
      )) as unknown[],
      TABLE,
    );
    const items = rows.map((r) => ({
      ROWID: r.ROWID,
      scope: r.scope,
      name: r.name,
      filters: tryParseJson(r.filters),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    sendJson(ctx.res, 200, { searches: items });
  } catch (err) {
    log.debug('saved searches list failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { searches: [], table_not_ready: true });
  }
}

export async function createSavedSearch(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  const body = await readJsonBody<{ name?: string; scope?: string; filters?: unknown }>(ctx.req);
  const name = (body.name ?? '').trim().slice(0, 100);
  const scope = (body.scope ?? '').toLowerCase();
  if (!name) throw new ValidationError('name requerido');
  if (!VALID_SCOPES.has(scope)) throw new ValidationError(`scope debe ser uno de ${[...VALID_SCOPES].join(', ')}`);
  if (typeof body.filters !== 'object' || body.filters === null) throw new ValidationError('filters debe ser objeto');

  try {
    const inserted = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      user_id: userId,
      scope,
      name,
      filters: JSON.stringify(body.filters).slice(0, 5000),
      created_at: now(),
      updated_at: now(),
    });
    sendJson(ctx.res, 201, { ok: true, row: inserted });
  } catch (err) {
    log.warn('saved search insert failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'saved_search_insert_failed', message: (err as Error).message } });
  }
}

export async function deleteSavedSearch(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  const m = ctx.req.url?.match(/^\/api\/saved-searches\/([^/?]+)/);
  if (!m) throw new ValidationError('id missing');
  const searchId = m[1];

  const existing = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE}
       WHERE ROWID = '${escapeSql(searchId)}'
         AND tenant_id = '${escapeSql(tenantId)}'
         AND user_id = '${escapeSql(userId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError('Saved search no encontrada');

  await datastore(ctx.req).table(TABLE).deleteRow(searchId);
  sendJson(ctx.res, 200, { ok: true });
}

function tryParseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}
