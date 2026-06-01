type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[raw] ?? LEVELS.info;
}

// Patrones de campos a redactar (PII y secrets)
const SENSITIVE_KEYS = new Set([
  'password', 'apiKey', 'api_key', 'secret', 'token', 'authorization',
  'clerk_secret_key', 'clerk_webhook_secret', 'anthropic_api_key',
  'internal_api_key', 'url_signing_secret', 'crypto_master_key',
  'phone', 'email', 'ssn', 'creditCard', 'credit_card',
  // PII expandido (aggressive)
  'dni', 'passport', 'address', 'birth_date', 'birthdate',
  'first_name', 'last_name', 'full_name', 'middle_name',
  'cv', 'resume', 'cv_text', 'cv_content', 'transcript',
  // Auth headers / cookies
  'cookie', 'set_cookie', 'x_internal_key', 'x-internal-key',
]);

const PARTIAL_REDACT = new Set(['email', 'phone']); // mostrar inicio + dominio para email

// Regex inline (en cualquier string del log, no solo en keys conocidos):
const RE_EMAIL_INLINE = /([a-zA-Z0-9_.+-])([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/g;
const RE_API_KEY = /\bst_live_[A-Za-z0-9_-]{20,}\b/g;
const RE_JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const RE_BEARER = /\b(Bearer|bearer)\s+[A-Za-z0-9_.-]{20,}/g;
const RE_PHONE_INLINE = /\b(\+?\d{1,3}[\s-]?)?\(?\d{3,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}\b/g;

function fragmentSecret(s: string): string {
  if (s.length < 8) return '<redacted>';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function partialRedactEmail(s: string): string {
  if (!s.includes('@')) return '<redacted>';
  const [local, domain] = s.split('@');
  const localShort = local.length > 2 ? `${local[0]}***${local.slice(-1)}` : '***';
  return `${localShort}@${domain}`;
}

function partialRedactPhone(s: string): string {
  if (s.length < 6) return '<redacted>';
  return `***${s.slice(-4)}`;
}

/**
 * Aplica redacción a strings que pueden tener PII inline (no en keys conocidos).
 * Útil para logs de errores donde el message tiene info embebida.
 */
function redactInlineString(s: string): string {
  let out = s;
  out = out.replace(RE_EMAIL_INLINE, (_, first, _mid, domain) => `${first}***@${domain}`);
  out = out.replace(RE_API_KEY, (m) => `${m.slice(0, 12)}...REDACTED`);
  out = out.replace(RE_JWT, (m) => `${m.slice(0, 12)}...REDACTED`);
  out = out.replace(RE_BEARER, (m) => {
    const idx = m.indexOf(' ');
    return `${m.slice(0, idx + 5)}...REDACTED`;
  });
  // Phone inline solo aplica si el string es corto (sino genera muchos falsos positivos en logs largos)
  if (s.length < 200) {
    out = out.replace(RE_PHONE_INLINE, (m) => (m.length >= 6 ? `***${m.slice(-4)}` : m));
  }
  return out;
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = key.toLowerCase();
  if (PARTIAL_REDACT.has(lower) || lower.endsWith('_email') || lower.endsWith('_phone')) {
    if (lower.includes('email')) return partialRedactEmail(value);
    if (lower.includes('phone')) return partialRedactPhone(value);
  }
  // CV / transcript / address: redactar completamente, son PII pesado
  if (lower === 'cv' || lower === 'resume' || lower === 'cv_text' || lower === 'transcript' || lower === 'address') {
    return value.length > 0 ? `<redacted ${value.length} chars>` : '<empty>';
  }
  // Nombres: parcial — primer letra + ***
  if (lower === 'first_name' || lower === 'last_name' || lower === 'full_name' || lower === 'middle_name' || lower === 'name') {
    if (value.length === 0) return value;
    return `${value[0]}***`;
  }
  if (SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('token') || lower.includes('apikey') || lower.includes('api_key')) {
    return fragmentSecret(value);
  }
  // Default: aplicar inline redaction (pesca PII embebida en mensajes de error, etc.)
  return redactInlineString(value);
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

function fmt(prefix: string, level: Level, msg: string, meta?: Record<string, unknown>): string {
  const safeMeta = redactMeta(meta);
  const base = `[${prefix}] ${level.toUpperCase()} ${msg}`;
  if (!safeMeta) return base;
  return `${base} ${JSON.stringify(safeMeta)}`;
}

export function logger(prefix: string) {
  return {
    debug(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.debug >= currentLevel()) console.log(fmt(prefix, 'debug', msg, meta));
    },
    info(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.info >= currentLevel()) console.log(fmt(prefix, 'info', msg, meta));
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.warn >= currentLevel()) console.warn(fmt(prefix, 'warn', msg, meta));
    },
    error(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.error >= currentLevel()) console.error(fmt(prefix, 'error', msg, meta));
    },
  };
}

// Exports para tests
export const _internal = { redactMeta, redactValue };
