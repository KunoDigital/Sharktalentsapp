/**
 * Middleware que autentica via API key (header `Authorization: Bearer st_live_...`).
 *
 * Sets en ctx:
 *   ctx.tenantId
 *   ctx.tenant
 *   ctx.apiKey = { row, permissions }
 *
 * Si la key es válida pero la tabla `ApiKeys` no existe (migración pendiente),
 * devuelve 503 con mensaje claro de qué crear.
 *
 * Auth alternativa a Clerk JWT: rutas marcadas como auth='api_key' usan este flujo.
 * Las rutas que aceptan AMBAS (Clerk o API key) usan auth='tenant_or_api'.
 */
import type { RequestContext } from './context';
import { UnauthorizedError, AppError } from './errors';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';
import {
  hashApiKey,
  compareHashes,
  isKeyActive,
  parsePermissions,
  type ApiKeyRow,
  type ApiKeyPermission,
  KEY_PREFIX_LENGTH,
} from './apiKeysService';

const log = logger('API_KEY_AUTH');
const TABLE = 'ApiKeys';

export type ApiKeyContext = {
  row: ApiKeyRow;
  permissions: ApiKeyPermission[];
};

let tableReady: boolean | null = null;

async function checkTableReady(req: import('http').IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch (err) {
    log.debug('table not ready', { error: (err as Error).message });
    tableReady = false;
  }
  return tableReady;
}

function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function requireApiKey(ctx: RequestContext): Promise<ApiKeyContext> {
  const token = extractBearerToken(ctx.req.headers.authorization);
  if (!token) {
    throw new UnauthorizedError('Missing Authorization: Bearer <api_key>');
  }
  if (!token.startsWith('st_live_')) {
    throw new UnauthorizedError('Invalid API key format');
  }

  if (!(await checkTableReady(ctx.req))) {
    throw new AppError(
      503,
      'table_not_ready',
      `La tabla ${TABLE} no fue creada todavía. Crear según MIGRATIONS_BLOCK2.md §5 y reintentar.`,
    );
  }

  const keyHash = hashApiKey(token);
  const keyPrefix = token.slice(0, KEY_PREFIX_LENGTH);

  // Lookup por prefix + hash. Prefix evita full-table-scan, hash autentica.
  // La columna key_hash es UNIQUE, pero filtramos también por prefix por si hay coalisión inverosímil.
  const query = `
    SELECT * FROM ${TABLE}
    WHERE key_prefix = '${escapeSql(keyPrefix)}'
    LIMIT 5
  `.replace(/\s+/g, ' ');

  const rows = unwrapRows<ApiKeyRow>(
    (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
    TABLE,
  );

  const matched = rows.find((r) => compareHashes(r.key_hash, keyHash));
  if (!matched) {
    log.warn('api key not found', { traceId: ctx.traceId, prefix: keyPrefix });
    throw new UnauthorizedError('Invalid API key');
  }

  if (!isKeyActive(matched)) {
    log.warn('api key not active', { traceId: ctx.traceId, prefix: keyPrefix, revoked: matched.revoked_at });
    throw new UnauthorizedError('API key is inactive, revoked, or expired');
  }

  // Setear tenant context. NO lookup en Tenants (asumimos tenant_id válido al issue time).
  ctx.tenantId = matched.tenant_id;

  // Best-effort: actualizar last_used_at. Fire-and-forget.
  void updateLastUsed(ctx.req, matched.ROWID);

  const permissions = parsePermissions(matched.permissions);

  log.info('api key authenticated', {
    traceId: ctx.traceId,
    keyId: matched.ROWID,
    tenantId: matched.tenant_id,
    name: matched.name,
    perms_count: permissions.length,
  });

  return { row: matched, permissions };
}

async function updateLastUsed(req: import('http').IncomingMessage, rowId: string): Promise<void> {
  try {
    const { datastore } = await import('./db.js');
    await datastore(req).table(TABLE).updateRow({
      ROWID: rowId,
      last_used_at: new Date().toISOString(),
    });
  } catch (err) {
    log.warn('update last_used_at failed', { rowId, error: (err as Error).message });
  }
}

export function _resetTableReadyForTests() {
  tableReady = null;
}
