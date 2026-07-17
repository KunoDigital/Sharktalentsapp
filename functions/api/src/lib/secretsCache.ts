/**
 * Lectura de secrets desde Catalyst Datastore tabla `Config`.
 *
 * Por qué Datastore y no env vars / Cache:
 *   - Catalyst Console env vars: cap <55 chars (verificado 2026-06-24 con OPENAI key fallida)
 *   - Catalyst Cache: TTL máximo 48h, no sirve para secrets permanentes
 *   - Datastore Text column: 10,000 chars sin expiración → solución correcta
 *
 * Schema de la tabla `Config` (existe ya en Catalyst desde 2026-06-25):
 *   tenant_id     VarChar mandatory   → usar "GLOBAL" para secrets a nivel sistema
 *   config_key    VarChar mandatory   → ej. "OPENAI_API_KEY"
 *   value         Text mandatory      → el secret (hasta 10K chars)
 *   value_type    VarChar mandatory   → "secret" / "string" / "number" / "json"
 *   updated_at    DateTime mandatory  → timestamp última actualización
 *   description   VarChar opcional    → para qué se usa este key
 *   updated_by    VarChar opcional    → quién lo actualizó
 *
 * Patrón de uso:
 *   const key = await getSecret('OPENAI_API_KEY', req);
 *   if (!key) throw new Error('OPENAI_API_KEY not configured in Config table');
 *
 * Performance: mem-cache 10 min en el lambda (1 read del Datastore por cold start).
 */

import { logger } from './logger';
import { escapeSql, unwrapRow } from './dbHelpers';

const log = logger('SECRETS_STORE');

const memCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const TABLE_NAME = 'Config';
const GLOBAL_TENANT = 'GLOBAL';

type ConfigRow = { tenant_id: string; config_key: string; value: string; value_type: string };

type CatalystApp = {
  zcql: () => {
    executeZCQLQuery: (query: string) => Promise<unknown[]>;
  };
};

type CatalystSDK = {
  initialize: (req: import('http').IncomingMessage) => CatalystApp;
};

/**
 * Lee un secret desde la tabla Config.
 * 1) mem-cache 10 min
 * 2) Datastore (tabla Config con tenant_id=GLOBAL + config_key=name)
 * 3) fallback a env var con el mismo nombre (dev local o keys cortas legacy)
 */
export async function getSecret(
  name: string,
  req: import('http').IncomingMessage,
): Promise<string> {
  const cached = memCache.get(name);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const catalyst = require('zcatalyst-sdk-node') as CatalystSDK;
    const app = catalyst.initialize(req);
    const zcql = app.zcql();
    const query =
      `SELECT tenant_id, config_key, value, value_type FROM ${TABLE_NAME} ` +
      `WHERE tenant_id = '${escapeSql(GLOBAL_TENANT)}' AND config_key = '${escapeSql(name)}' LIMIT 1`;
    const rows = await zcql.executeZCQLQuery(query);
    const row = rows.length > 0 ? unwrapRow<ConfigRow>(rows[0], TABLE_NAME) : null;
    const value = row?.value ?? '';

    if (value) {
      memCache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      log.debug('secret loaded from Config table', { name, length: value.length });
      return value;
    }
  } catch (err) {
    log.warn('Config table read failed, falling back to env', {
      name,
      error: (err as Error).message,
    });
  }

  const envValue = process.env[name] ?? '';
  if (envValue) {
    memCache.set(name, { value: envValue, expiresAt: Date.now() + CACHE_TTL_MS });
    log.debug('secret loaded from env fallback', { name, length: envValue.length });
  } else {
    log.warn('secret not found in Config table or env', { name });
  }
  return envValue;
}

/** Helper específico para OpenAI key. */
export async function getOpenAIKey(req: import('http').IncomingMessage): Promise<string> {
  return getSecret('OPENAI_API_KEY', req);
}

/** Limpia la cache en memoria. Para tests o cambios manuales de secret. */
export function clearSecretsMemCache(): void {
  memCache.clear();
}
