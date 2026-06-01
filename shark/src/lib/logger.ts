/**
 * Logger frontend con redacción de PII y secrets.
 * Espejo del backend functions/api/src/lib/logger.ts.
 *
 * Uso:
 *   const log = logger('JOBS');
 *   log.info('cargando jobs', { tenantId: 'ten_1' });
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const raw = (import.meta.env.MODE === 'production' ? 'warn' : 'info') as Level;
  return LEVELS[raw] ?? LEVELS.info;
}

const SENSITIVE_KEYS = new Set([
  'password', 'apikey', 'api_key', 'secret', 'token', 'authorization',
  'clerk_secret_key', 'anthropic_api_key', 'internal_api_key',
]);

const PARTIAL_REDACT = new Set(['email', 'phone']);

function fragmentSecret(s: string): string {
  if (s.length < 8) return '<redacted>';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function partialRedactEmail(s: string): string {
  if (!s.includes('@')) return '<redacted>';
  const [local, domain] = s.split('@');
  return `${local.length > 2 ? `${local[0]}***${local.slice(-1)}` : '***'}@${domain}`;
}

function partialRedactPhone(s: string): string {
  return s.length < 6 ? '<redacted>' : `***${s.slice(-4)}`;
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = key.toLowerCase();
  if (PARTIAL_REDACT.has(lower) || lower.endsWith('_email') || lower.endsWith('_phone')) {
    if (lower.includes('email')) return partialRedactEmail(value);
    if (lower.includes('phone')) return partialRedactPhone(value);
  }
  if (
    SENSITIVE_KEYS.has(lower) ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('apikey') ||
    lower.includes('api_key')
  ) {
    return fragmentSecret(value);
  }
  return value;
}

function redactMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactMeta(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

export function logger(prefix: string) {
  return {
    debug(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.debug >= currentLevel()) console.log(`[${prefix}] DEBUG ${msg}`, redactMeta(meta) ?? '');
    },
    info(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.info >= currentLevel()) console.log(`[${prefix}] INFO ${msg}`, redactMeta(meta) ?? '');
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.warn >= currentLevel()) console.warn(`[${prefix}] WARN ${msg}`, redactMeta(meta) ?? '');
    },
    error(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.error >= currentLevel()) console.error(`[${prefix}] ERROR ${msg}`, redactMeta(meta) ?? '');
    },
  };
}

export const _internal = { redactMeta, redactValue };
