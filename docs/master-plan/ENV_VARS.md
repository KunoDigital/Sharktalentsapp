# Variables de entorno — referencia completa

Todas las env vars que el backend espera. Configuralas en **Catalyst Console → Functions → api → Environment Variables**.

Las que dicen "default" en la columna `Por defecto` se aplican automáticamente si no las setteás.

## Auth (Clerk)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | string | **requerido** | Public key de Clerk. Empieza con `pk_test_` o `pk_live_` |
| `CLERK_SECRET_KEY` | string | **requerido** | Secret de Clerk. Empieza con `sk_test_` o `sk_live_`. ⚠️ Sensible |
| `CLERK_WEBHOOK_SECRET` | string | **requerido** | Para verificar firmas del webhook. Empieza con `whsec_` |

## IA (Anthropic Claude)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | string | **requerido** | API key de Anthropic. ⚠️ Sensible |
| `ANTHROPIC_MODEL` | string | `claude-haiku-4-5-20251001` | Modelo a usar. Cambialo a un Sonnet si necesitás más calidad |
| `ANTHROPIC_CACHING_ENABLED` | bool | `true` | Activa prompt caching (header beta). Reduce costo en system prompts |
| `ANTHROPIC_TIMEOUT_MS` | number | `25000` | Timeout por request. Debe ser < 30000 (timeout del function) |
| `ANTHROPIC_MAX_RETRIES` | number | `3` | Reintentos en errores 5xx/429 con backoff exponencial |

## Secrets internos

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `INTERNAL_API_KEY` | string | **requerido** | Para endpoints `/admin/*`. ⚠️ Sensible. Generar con `./scripts/generate-secret.sh` |
| `URL_SIGNING_SECRET` | string | **requerido** | Para firmar tokens de URLs públicas (reportes, tests). ⚠️ Sensible |
| `CRYPTO_MASTER_KEY` | string | **requerido** | Master key para encrypt at-rest de transcripts/PII. ⚠️ Sensible |

## URLs

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `APP_BASE_URL` | string | `https://sharktalents.ai` | URL canónica del frontend |
| `CLIENT_HOSTING_BASE` | string | `/app/index.html` | Path donde Catalyst sirve el frontend |
| `PUBLIC_REPORT_BASE` | string | `/app/index.html#/report` | Base para links de reportes públicos |
| `TEST_LINK_BASE` | string | `/app/index.html#/test` | Base para links de tests de candidatos |

## Reliability (timeouts, circuit breakers, rate limits)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `CIRCUIT_BREAKER_THRESHOLD` | number | `5` | Fallos consecutivos antes de abrir el breaker |
| `CIRCUIT_BREAKER_COOLDOWN_MS` | number | `60000` | Tiempo en estado `open` antes de pasar a `half_open` |
| `RATE_LIMIT_WINDOW_MS` | number | `60000` | Ventana del rate limiter (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | number | `30` | Max requests por IP/anon en la ventana |
| `API_V1_RATE_LIMIT_DEFAULT` | number | `60` | Max requests para endpoints públicos `/api/v1/...` |
| `API_V1_RATE_LIMIT_PER_TENANT` | number | `1000` | Max requests por tenant authenticado en la ventana |

## Logging

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `LOG_LEVEL` | string | `info` | Niveles: `debug`/`info`/`warn`/`error` |
| `APP_VERSION` | string | `0.0.0` | Versión semver. Útil para correlación de logs entre deploys |

## Bot decisor

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `BOT_MODE` | string | `cold` | `cold` = solo recomienda; `warm` = aplica auto si confidence > threshold; `hot` = full auto (futuro) |
| `BOT_CONFIDENCE_THRESHOLD_DEFAULT` | number | `0.75` | Threshold para que el bot aplique decisión automáticamente en modo `warm` |
| `BOT_RAG_TOP_K` | number | `5` | Cantidad de casos similares (RAG) que el bot consulta para decidir (no implementado todavía) |

## CORS

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ALLOWED_ORIGINS` | string | `http://localhost:3000` | Lista comma-separated de origins permitidos. Agregá tu dominio prod. ⚠️ Nunca uses `*` con credentials |

## Catalyst File Store

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `FILESTORE_VIDEO_FOLDER_ID` | string | `''` | ID de la carpeta de Catalyst File Store donde se guardan videos del candidato. Sin esto, el upload de videos devuelve 503 |

## Integraciones externas (todas opcionales — vacío = integración off)

### Zoho Recruit (sync de pipeline)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ZOHO_RECRUIT_API_URL` | string | `''` | URL base del API. Sin esto, eventos `sync.recruit` quedan failed |
| `ZOHO_RECRUIT_OAUTH_TOKEN` | string | `''` | OAuth token. ⚠️ Sensible |

### Zoho Bookings (briefing cliente)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ZOHO_BOOKINGS_API_URL` | string | `''` | URL base del API |
| `ZOHO_BOOKINGS_OAUTH_TOKEN` | string | `''` | OAuth token. ⚠️ Sensible |
| `ZOHO_BOOKINGS_WORKSPACE_ID` | string | `''` | ID del workspace donde se crea el booking |
| `ZOHO_BOOKINGS_BRIEFING_SERVICE_ID` | string | `''` | ID del servicio "Briefing" definido en Zoho Bookings |

### Zoho Sign (firma electrónica de oferta laboral)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ZOHO_SIGN_API_URL` | string | `''` | URL base del API |
| `ZOHO_SIGN_OAUTH_TOKEN` | string | `''` | OAuth token. ⚠️ Sensible |
| `ZOHO_SIGN_WEBHOOK_SECRET` | string | `''` | Para verificar firma del webhook entrante (`/api/webhooks/zoho-sign`). ⚠️ Sensible |

### Zia (transcripción meetings) — webhook entrante

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `ZIA_WEBHOOK_SECRET` | string | `''` | Para verificar firma del webhook `/api/webhooks/zia`. Si vacío, el endpoint devuelve 503. ⚠️ Sensible |

### Whisper (fallback transcripción + análisis videos)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `WHISPER_API_URL` | string | `https://api.openai.com/v1/audio/transcriptions` | Endpoint compatible con Whisper. Default: OpenAI |
| `WHISPER_API_KEY` | string | `''` | API key de OpenAI (`sk-...`). ⚠️ Sensible |

### HeyReach (LinkedIn outbound)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `HEYREACH_API_URL` | string | `''` | URL base del API HeyReach |
| `HEYREACH_API_KEY` | string | `''` | API key. ⚠️ Sensible |
| `HEYREACH_WEBHOOK_SECRET` | string | `''` | Para verificar webhooks entrantes (mensajes/invites). Sin esto el endpoint devuelve 503. ⚠️ Sensible |

### Sentry (error tracking)

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `SENTRY_DSN` | string | `''` | DSN de Sentry. Si vacío, errores solo van a logs |
| `SENTRY_ENV` | string | `production` | Tag de environment en Sentry |

### Marketing funnel

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `MARKETING_SITE_KEY` | string | `''` | Key pública compartida con la landing externa para validar origen. Si vacío, endpoints `/api/marketing/*` devuelven 400 |
| `TURNSTILE_SECRET_KEY` | string | `''` | Cloudflare Turnstile secret para validar captcha en `/api/marketing/eval-request`. ⚠️ Sensible |

## Recetas comunes

### Setear todo en Development
```
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
ANTHROPIC_API_KEY=sk-ant-api03-...
INTERNAL_API_KEY=<output de generate-secret.sh>
URL_SIGNING_SECRET=<output de generate-secret.sh>
CRYPTO_MASTER_KEY=<output de generate-secret.sh>
APP_BASE_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
LOG_LEVEL=debug
```

### Setear todo en Production
```
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...
ANTHROPIC_API_KEY=sk-ant-api03-...
INTERNAL_API_KEY=<distinto al de dev — rotar>
URL_SIGNING_SECRET=<distinto al de dev>
CRYPTO_MASTER_KEY=<distinto al de dev>
APP_BASE_URL=https://sharktalents.ai
ALLOWED_ORIGINS=https://sharktalents.ai
LOG_LEVEL=info
BOT_MODE=cold      # ← arrancá conservador en prod
```

⚠️ **Nunca** uses los mismos secrets en dev y prod. Si dev se compromete, no debe afectar prod.

## Cómo verificar que todo cargó

Después del deploy, llamá al `/health`:

```bash
curl ${CATALYST_API_URL}/health
```

Si te tira `Missing required env var: ...` en los logs → falta esa env var. Setteala y re-deployá.
