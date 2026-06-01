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
  // CORS
  ALLOWED_ORIGINS: string;
  // Catalyst File Store
  FILESTORE_VIDEO_FOLDER_ID: string;
  FILESTORE_LARGE_CONTENT_FOLDER_ID: string;
  // Integraciones externas (opcionales — vacíos = integración desactivada)
  ZOHO_RECRUIT_API_URL: string;
  ZOHO_RECRUIT_OAUTH_TOKEN: string;
  ZOHO_RECRUIT_WEBHOOK_SECRET: string;
  HEYREACH_API_URL: string;
  HEYREACH_API_KEY: string;
  HEYREACH_WEBHOOK_SECRET: string;
  // Error tracking (opcional, vacío = off)
  SENTRY_DSN: string;
  SENTRY_ENV: string;
  // Marketing funnel (landing externa)
  MARKETING_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  // Zoho Bookings (briefing cliente)
  ZOHO_BOOKINGS_API_URL: string;
  ZOHO_BOOKINGS_OAUTH_TOKEN: string;
  ZOHO_BOOKINGS_WORKSPACE_ID: string;
  ZOHO_BOOKINGS_BRIEFING_SERVICE_ID: string;
  // Whisper / Zia (transcripción)
  WHISPER_API_URL: string;
  WHISPER_API_KEY: string;
  // Zoho Sign (firma electrónica)
  ZOHO_SIGN_API_URL: string;
  ZOHO_SIGN_OAUTH_TOKEN: string;
  ZOHO_SIGN_WEBHOOK_SECRET: string;
  ZOHO_SIGN_CONTRACT_TEMPLATE_ID: string;
  // Zia / Whisper webhook (transcripción entrante)
  ZIA_WEBHOOK_SECRET: string;
  // WhatsApp Business
  WHATSAPP_API_URL: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  // Zoho CRM (sync de leads + candidatos) — usa ZOHO_OAUTH_* compartido para auth
  ZOHO_CRM_API_URL: string;
  ZOHO_CRM_LEADS_MODULE: string;
  ZOHO_CRM_LEAD_LAYOUT_ID: string;
  // ZeptoMail (Zoho transactional email — incluido en Zoho One)
  ZEPTOMAIL_API_TOKEN: string;
  ZEPTOMAIL_FROM_EMAIL: string;
  ZEPTOMAIL_FROM_NAME: string;
  ZEPTOMAIL_REPLY_TO: string;
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
    ANTHROPIC_TIMEOUT_MS: asNumber('ANTHROPIC_TIMEOUT_MS', 55_000),
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
    ALLOWED_ORIGINS: optional('ALLOWED_ORIGINS', 'http://localhost:3000'),
    FILESTORE_VIDEO_FOLDER_ID: optional('FILESTORE_VIDEO_FOLDER_ID', ''),
    FILESTORE_LARGE_CONTENT_FOLDER_ID: optional('FILESTORE_LARGE_CONTENT_FOLDER_ID', ''),
    ZOHO_RECRUIT_API_URL: optional('ZOHO_RECRUIT_API_URL', ''),
    ZOHO_RECRUIT_OAUTH_TOKEN: optional('ZOHO_RECRUIT_OAUTH_TOKEN', ''),
    ZOHO_RECRUIT_WEBHOOK_SECRET: optional('ZOHO_RECRUIT_WEBHOOK_SECRET', ''),
    HEYREACH_API_URL: optional('HEYREACH_API_URL', ''),
    HEYREACH_API_KEY: optional('HEYREACH_API_KEY', ''),
    HEYREACH_WEBHOOK_SECRET: optional('HEYREACH_WEBHOOK_SECRET', ''),
    SENTRY_DSN: optional('SENTRY_DSN', ''),
    SENTRY_ENV: optional('SENTRY_ENV', 'production'),
    MARKETING_SITE_KEY: optional('MARKETING_SITE_KEY', ''),
    TURNSTILE_SECRET_KEY: optional('TURNSTILE_SECRET_KEY', ''),
    ZOHO_BOOKINGS_API_URL: optional('ZOHO_BOOKINGS_API_URL', ''),
    ZOHO_BOOKINGS_OAUTH_TOKEN: optional('ZOHO_BOOKINGS_OAUTH_TOKEN', ''),
    ZOHO_BOOKINGS_WORKSPACE_ID: optional('ZOHO_BOOKINGS_WORKSPACE_ID', ''),
    ZOHO_BOOKINGS_BRIEFING_SERVICE_ID: optional('ZOHO_BOOKINGS_BRIEFING_SERVICE_ID', ''),
    WHISPER_API_URL: optional('WHISPER_API_URL', 'https://api.openai.com/v1/audio/transcriptions'),
    WHISPER_API_KEY: optional('WHISPER_API_KEY', ''),
    ZOHO_SIGN_API_URL: optional('ZOHO_SIGN_API_URL', 'https://sign.zoho.com/api/v1'),
    ZOHO_SIGN_OAUTH_TOKEN: optional('ZOHO_SIGN_OAUTH_TOKEN', ''),
    ZOHO_SIGN_WEBHOOK_SECRET: optional('ZOHO_SIGN_WEBHOOK_SECRET', ''),
    ZOHO_SIGN_CONTRACT_TEMPLATE_ID: optional('ZOHO_SIGN_CONTRACT_TEMPLATE_ID', ''),
    ZIA_WEBHOOK_SECRET: optional('ZIA_WEBHOOK_SECRET', ''),
    WHATSAPP_API_URL: optional('WHATSAPP_API_URL', 'https://graph.facebook.com/v21.0'),
    WHATSAPP_ACCESS_TOKEN: optional('WHATSAPP_ACCESS_TOKEN', ''),
    WHATSAPP_PHONE_NUMBER_ID: optional('WHATSAPP_PHONE_NUMBER_ID', ''),
    WHATSAPP_VERIFY_TOKEN: optional('WHATSAPP_VERIFY_TOKEN', ''),
    WHATSAPP_APP_SECRET: optional('WHATSAPP_APP_SECRET', ''),
    ZOHO_CRM_API_URL: optional('ZOHO_CRM_API_URL', ''),
    ZOHO_CRM_LEADS_MODULE: optional('ZOHO_CRM_LEADS_MODULE', 'Leads'),
    ZOHO_CRM_LEAD_LAYOUT_ID: optional('ZOHO_CRM_LEAD_LAYOUT_ID', ''),
    ZEPTOMAIL_API_TOKEN: optional('ZEPTOMAIL_API_TOKEN', ''),
    ZEPTOMAIL_FROM_EMAIL: optional('ZEPTOMAIL_FROM_EMAIL', 'reportes@sharktalents.ai'),
    ZEPTOMAIL_FROM_NAME: optional('ZEPTOMAIL_FROM_NAME', 'SharkTalents'),
    ZEPTOMAIL_REPLY_TO: optional('ZEPTOMAIL_REPLY_TO', 'proyectos@kunodigital.com'),
  };
  return cached;
}
