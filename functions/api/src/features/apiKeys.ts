/**
 * Gestión de API keys del tenant. Auth: Clerk JWT (admin del tenant).
 *
 * Endpoints:
 *   POST   /api/api-keys                → crear (devuelve plain key UNA vez)
 *   GET    /api/api-keys                → listar (sin hashes, solo prefix + metadatos)
 *   PATCH  /api/api-keys/:id             → actualizar nombre / permisos / rate_limit
 *   DELETE /api/api-keys/:id             → revocar (soft: revoked_at = now)
 *
 * Permisos disponibles: ver lib/apiKeysService.ts ALL_PERMISSIONS.
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { NotFoundError, ValidationError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import {
  generateApiKey,
  type ApiKeyRow,
  isValidPermission,
  ALL_PERMISSIONS,
} from '../lib/apiKeysService';
import { requireFeature } from '../lib/featureFlags';

const log = logger('API_KEYS_FEATURE');
const TABLE = 'ApiKeys';

const TABLE_NOT_READY = new AppError(
  503,
  'table_not_ready',
  `La tabla ${TABLE} todavía no fue creada. Crear en Catalyst Console (ver MIGRATIONS_BLOCK2.md §5) y reintentar.`,
);

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

function extractIdFromPath(url: string): string | null {
  return url.match(/^\/api\/api-keys\/([^/?]+)/)?.[1] ?? null;
}

function validatePermissions(raw: unknown): string {
  if (raw === undefined) return JSON.stringify([]);
  if (!Array.isArray(raw)) throw new ValidationError('permissions must be an array');
  const valid = raw.filter(isValidPermission);
  if (valid.length !== raw.length) {
    throw new ValidationError(
      `permissions contain invalid scopes. Allowed: ${ALL_PERMISSIONS.join(', ')}`,
    );
  }
  return JSON.stringify(valid);
}

function validateRateLimit(raw: unknown): number {
  if (raw === undefined) return 60;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new ValidationError('rate_limit_per_min must be 1..1000');
  }
  return n;
}

function sanitize(row: ApiKeyRow) {
  // No leak `key_hash` en respuestas
  const { key_hash, ...rest } = row;
  void key_hash;
  return rest;
}

// ===== Handlers =====

export async function createApiKey(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  await requireFeature(ctx, 'api');
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ValidationError('name required');
  if (name.length > 100) throw new ValidationError('name max 100 chars');

  const permissions = validatePermissions(body.permissions);
  const rateLimit = validateRateLimit(body.rate_limit_per_min);
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;

  const { plainKey, keyHash, keyPrefix } = generateApiKey();

  const insert = {
    tenant_id: tenantId,
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    created_by_user: ctx.user?.clerk_user_id ?? '',
    permissions,
    rate_limit_per_min: rateLimit,
    last_used_at: null,
    expires_at: expiresAt,
    is_active: true,
    revoked_at: null,
    created_at: now(),
  };

  const row = await datastore(ctx.req).table(TABLE).insertRow(insert);
  const inserted = unwrapRow<ApiKeyRow>(row, TABLE);
  if (!inserted) throw new AppError(500, 'create_failed', 'No se pudo crear la API key');

  void auditLog(ctx, {
    action: 'tenant.update',
    resource_type: 'api_key',
    resource_id: inserted.ROWID,
    changes: { name, permissions: JSON.parse(permissions) as string[], rate_limit_per_min: rateLimit },
  });

  log.info('api key created', { traceId: ctx.traceId, tenantId, keyId: inserted.ROWID, name });

  // ⚠️ plainKey solo se devuelve UNA vez aquí. Después de este response es irrecuperable.
  sendJson(ctx.res, 201, {
    api_key: {
      ...sanitize(inserted),
      plain_key: plainKey,
    },
    warning: 'Esta es la única vez que ves la key completa. Guardala en lugar seguro. Después solo verás el prefix.',
  });
}

export async function listApiKeys(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const query = `SELECT * FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}' ORDER BY CREATEDTIME DESC`;
  const rows = unwrapRows<ApiKeyRow>(
    (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
    TABLE,
  );

  sendJson(ctx.res, 200, {
    api_keys: rows.map(sanitize),
    count: rows.length,
  });
}

export async function patchApiKey(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('api key id missing');

  const existing = await fetchOne(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError('API key not found');

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const patch: Record<string, unknown> = { ROWID: id };

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new ValidationError('name invalid');
    patch.name = body.name.trim().slice(0, 100);
  }
  if (body.permissions !== undefined) {
    patch.permissions = validatePermissions(body.permissions);
  }
  if (body.rate_limit_per_min !== undefined) {
    patch.rate_limit_per_min = validateRateLimit(body.rate_limit_per_min);
  }

  const row = await datastore(ctx.req).table(TABLE).updateRow(patch as { ROWID: string });
  const updated = unwrapRow<ApiKeyRow>(row, TABLE);

  void auditLog(ctx, {
    action: 'tenant.update',
    resource_type: 'api_key',
    resource_id: id,
    changes: { name: patch.name, permissions: patch.permissions, rate_limit_per_min: patch.rate_limit_per_min },
  });

  sendJson(ctx.res, 200, { api_key: updated ? sanitize(updated) : null });
}

export async function revokeApiKey(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('api key id missing');

  const existing = await fetchOne(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError('API key not found');

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: id,
    is_active: false,
    revoked_at: now(),
  });

  void auditLog(ctx, {
    action: 'tenant.delete',
    resource_type: 'api_key',
    resource_id: id,
    changes: { name: existing.name, prefix: existing.key_prefix },
  });

  log.info('api key revoked', { traceId: ctx.traceId, tenantId, keyId: id });
  sendJson(ctx.res, 200, { revoked: true, id });
}

// ===== Helpers =====

async function fetchOne(req: IncomingMessage, id: string, tenantId: string): Promise<ApiKeyRow | null> {
  const q = `SELECT * FROM ${TABLE} WHERE ROWID = '${escapeSql(id)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const rows = unwrapRows<ApiKeyRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    TABLE,
  );
  return rows[0] ?? null;
}
