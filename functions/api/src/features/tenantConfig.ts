/**
 * Configuración runtime del tenant. Lee de tabla `Config` (deferred Block 2 §9).
 *
 * Si la tabla no existe, devuelve defaults de env vars (cold mode, threshold 0.75).
 * Cuando exista, Cris puede ajustar bot_threshold, bot_mode, etc. desde Settings sin re-deploy.
 *
 * Endpoints:
 *   GET   /api/tenant/config            → leer config actual
 *   PATCH /api/tenant/config            → actualizar valores (requiere tabla)
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { ValidationError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { env } from '../lib/env';

const log = logger('TENANT_CONFIG');
const TABLE = 'Config';

const TABLE_NOT_READY = new AppError(
  503,
  'table_not_ready',
  `La tabla ${TABLE} todavía no fue creada en Catalyst (deferred Block 2 §9). El sistema usa defaults del .env mientras tanto.`,
);

// Keys conocidos. Cada uno tiene un default desde env y validación de tipo.
type ConfigKey = 'bot_threshold' | 'bot_mode' | 'tecnica_default_min' | 'auto_purge_videos_days';

const KEY_VALIDATORS: Record<ConfigKey, (raw: unknown) => string | null> = {
  bot_threshold: (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) return 'bot_threshold debe ser 0..1 (decimal)';
    return null;
  },
  bot_mode: (raw) => {
    if (!['cold', 'warm', 'hot'].includes(String(raw))) return 'bot_mode debe ser cold|warm|hot';
    return null;
  },
  tecnica_default_min: (raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100) return 'tecnica_default_min debe ser 0..100';
    return null;
  },
  auto_purge_videos_days: (raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 365) return 'auto_purge_videos_days debe ser 1..365';
    return null;
  },
};

type ConfigRow = {
  ROWID: string;
  config_key: string;
  value: string;
  value_type: string;
  tenant_id: string | null;
  description: string | null;
  updated_by: string;
  updated_at: string;
};

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

function getDefaults() {
  const e = env();
  return {
    bot_threshold: e.BOT_CONFIDENCE_THRESHOLD_DEFAULT,
    bot_mode: e.BOT_MODE,
    tecnica_default_min: 60,
    auto_purge_videos_days: 30,
  };
}

async function loadFromTable(req: IncomingMessage, tenantId: string): Promise<Record<string, unknown>> {
  const q = `
    SELECT ROWID, config_key, value, value_type, tenant_id, description, updated_by, updated_at
    FROM ${TABLE}
    WHERE tenant_id = '${escapeSql(tenantId)}' OR tenant_id IS NULL
    ORDER BY tenant_id DESC
  `.replace(/\s+/g, ' ');
  const rows = unwrapRows<ConfigRow>((await zcql(req).executeZCQLQuery(q)) as unknown[], TABLE);

  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (out[r.config_key] !== undefined) continue; // tenant override gana sobre global (orden DESC pone tenant_id no-null primero)
    out[r.config_key] = parseValue(r.value, r.value_type);
  }
  return out;
}

function parseValue(raw: string, type: string): unknown {
  if (type === 'number' || type === 'int') return Number(raw);
  if (type === 'boolean') return raw === 'true';
  if (type === 'json') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

// ===== Handlers =====

export async function getTenantConfig(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const defaults = getDefaults();
  let fromTable: Record<string, unknown> = {};
  let tableExists = false;
  if (await isTableReady(ctx.req)) {
    tableExists = true;
    fromTable = await loadFromTable(ctx.req, tenantId);
  }

  const resolved = { ...defaults, ...fromTable };

  sendJson(ctx.res, 200, {
    config: resolved,
    sources: {
      bot_threshold: fromTable.bot_threshold !== undefined ? 'tenant_config' : 'env_default',
      bot_mode: fromTable.bot_mode !== undefined ? 'tenant_config' : 'env_default',
      tecnica_default_min: fromTable.tecnica_default_min !== undefined ? 'tenant_config' : 'default',
      auto_purge_videos_days: fromTable.auto_purge_videos_days !== undefined ? 'tenant_config' : 'default',
    },
    table_exists: tableExists,
  });
}

export async function patchTenantConfig(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const updates: Array<{ key: ConfigKey; value: unknown; type: string }> = [];

  for (const [key, value] of Object.entries(body)) {
    if (!(key in KEY_VALIDATORS)) {
      throw new ValidationError(`Key desconocida: ${key}. Permitidas: ${Object.keys(KEY_VALIDATORS).join(', ')}`);
    }
    const err = KEY_VALIDATORS[key as ConfigKey](value);
    if (err) throw new ValidationError(err);
    const type = typeof value === 'number' ? 'number' : (typeof value === 'boolean' ? 'boolean' : 'string');
    updates.push({ key: key as ConfigKey, value, type });
  }

  if (updates.length === 0) {
    sendJson(ctx.res, 200, { updated: 0, config: {} });
    return;
  }

  // Upsert por (tenant_id, config_key)
  for (const u of updates) {
    const existing = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE config_key = '${escapeSql(u.key)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];

    if (existing) {
      await datastore(ctx.req).table(TABLE).updateRow({
        ROWID: existing.ROWID,
        value: String(u.value),
        value_type: u.type,
        updated_by: ctx.user?.clerk_user_id ?? 'unknown',
        updated_at: now(),
      });
    } else {
      await datastore(ctx.req).table(TABLE).insertRow({
        config_key: u.key,
        value: String(u.value),
        value_type: u.type,
        tenant_id: tenantId,
        description: '',
        updated_by: ctx.user?.clerk_user_id ?? 'unknown',
        updated_at: now(),
      });
    }
  }

  void auditLog(ctx, {
    action: 'tenant.update',
    resource_type: 'tenant_config',
    resource_id: tenantId,
    changes: Object.fromEntries(updates.map((u) => [u.key, u.value])),
  });

  log.info('tenant config updated', {
    traceId: ctx.traceId,
    tenantId,
    keys: updates.map((u) => u.key),
  });

  // Devolver config actualizado
  const updated = await loadFromTable(ctx.req, tenantId);
  sendJson(ctx.res, 200, {
    updated: updates.length,
    config: { ...getDefaults(), ...updated },
  });
}

export function _resetTableReadyForTests() {
  tableReady = null;
}
