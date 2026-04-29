type EnvShape = {
  // Auth (Clerk)
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  // Anthropic
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_CACHING_ENABLED: boolean;
  ANTHROPIC_TIMEOUT_MS: number;
  ANTHROPIC_MAX_RETRIES: number;
  // Internal
  INTERNAL_API_KEY: string;
  URL_SIGNING_SECRET: string;
  CRYPTO_MASTER_KEY: string;
  // URLs
  APP_BASE_URL: string;
  CLIENT_HOSTING_BASE: string;
  PUBLIC_REPORT_BASE: string;
  TEST_LINK_BASE: string;
  // Reliability
  CIRCUIT_BREAKER_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  // API pública
  API_V1_RATE_LIMIT_DEFAULT: number;
  API_V1_RATE_LIMIT_PER_TENANT: number;
  // Logging
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  APP_VERSION: string;
  // Bot decisor
  BOT_MODE: 'cold' | 'warm' | 'hot';
  BOT_CONFIDENCE_THRESHOLD_DEFAULT: number;
  BOT_RAG_TOP_K: number;
};

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function asNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} is not a valid number: ${raw}`);
  return n;
}

function asBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw == null) return fallback;
  return raw === 'true' || raw === '1';
}

let cached: EnvShape | null = null;

export function env(): EnvShape {
  if (cached) return cached;
  cached = {
    CLERK_PUBLISHABLE_KEY: required('CLERK_PUBLISHABLE_KEY'),
    CLERK_SECRET_KEY: required('CLERK_SECRET_KEY'),
    CLERK_WEBHOOK_SECRET: required('CLERK_WEBHOOK_SECRET'),
    ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
    ANTHROPIC_MODEL: optional('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),
    ANTHROPIC_CACHING_ENABLED: asBool('ANTHROPIC_CACHING_ENABLED', true),
    ANTHROPIC_TIMEOUT_MS: asNumber('ANTHROPIC_TIMEOUT_MS', 25_000),
    ANTHROPIC_MAX_RETRIES: asNumber('ANTHROPIC_MAX_RETRIES', 3),
    INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
    URL_SIGNING_SECRET: required('URL_SIGNING_SECRET'),
    CRYPTO_MASTER_KEY: required('CRYPTO_MASTER_KEY'),
    APP_BASE_URL: required('APP_BASE_URL'),
    CLIENT_HOSTING_BASE: optional('CLIENT_HOSTING_BASE', '/app/index.html'),
    PUBLIC_REPORT_BASE: optional('PUBLIC_REPORT_BASE', '/app/index.html#/report'),
    TEST_LINK_BASE: optional('TEST_LINK_BASE', '/app/index.html#/test'),
    CIRCUIT_BREAKER_THRESHOLD: asNumber('CIRCUIT_BREAKER_THRESHOLD', 5),
    CIRCUIT_BREAKER_COOLDOWN_MS: asNumber('CIRCUIT_BREAKER_COOLDOWN_MS', 60_000),
    RATE_LIMIT_WINDOW_MS: asNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    RATE_LIMIT_MAX_REQUESTS: asNumber('RATE_LIMIT_MAX_REQUESTS', 30),
    API_V1_RATE_LIMIT_DEFAULT: asNumber('API_V1_RATE_LIMIT_DEFAULT', 60),
    API_V1_RATE_LIMIT_PER_TENANT: asNumber('API_V1_RATE_LIMIT_PER_TENANT', 1000),
    LOG_LEVEL: optional('LOG_LEVEL', 'info') as EnvShape['LOG_LEVEL'],
    APP_VERSION: optional('APP_VERSION', '0.0.0'),
    BOT_MODE: optional('BOT_MODE', 'cold') as EnvShape['BOT_MODE'],
    BOT_CONFIDENCE_THRESHOLD_DEFAULT: asNumber('BOT_CONFIDENCE_THRESHOLD_DEFAULT', 0.75),
    BOT_RAG_TOP_K: asNumber('BOT_RAG_TOP_K', 5),
  };
  return cached;
}
