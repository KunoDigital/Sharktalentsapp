# 02 — Fase 1: Fundamentos

**Objetivo:** establecer los cimientos del refactor — env vars, estructura de carpetas, scripts base, documentación de referencia. Sin estos, las fases siguientes no pueden avanzar limpiamente.

**Tiempo estimado:** 1 semana.
**Dependencias:** ninguna.
**Riesgo:** bajo. No modifica código productivo, solo agrega estructura.

---

## Deliverables

- [ ] Env vars completas documentadas en `.env.example`
- [ ] `catalyst-config.json` limpio (sin `REPLACE_ME`, solo referencias)
- [ ] Estructura de carpetas nueva en `functions/api/`
- [ ] Scripts en `scripts/` operativos
- [ ] `README.md` raíz actualizado con setup completo
- [ ] `CLAUDE.md` con convenciones del proyecto
- [ ] Nuevo proyecto Catalyst inicializado (el `catalyst.json` que vamos a generar)

---

## 1. Inventario de env vars

Todas las variables que va a necesitar el sistema — para funcionar, para rotation, para cambiar ambiente.

### Backend (function `api`)

Ubicación en prod: Catalyst Console → Functions → api → Environment Variables.

**Auth — delegado a Clerk ([ver doc 14](14_CLERK_AUTH.md)):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | config (ok público) | Publishable key de Clerk | `pk_test_xxx` / `pk_live_xxx` | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | secret | Secret key para verify JWT backend | `sk_test_xxx` / `sk_live_xxx` | Clerk Dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | secret | Secret para verificar firmas de webhooks Clerk | `whsec_xxx` | Clerk Dashboard → Webhooks |

**Anthropic:**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | API key de Anthropic | `sk-ant-...` | Anthropic Console |

**Internal / infra:**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `INTERNAL_API_KEY` | secret | Key para llamadas function-to-function (cron → api) | 64 hex chars random | `scripts/generate-secret.sh` |
| `URL_SIGNING_SECRET` | secret | Secret para firmar URLs del proxy de archivos | 64 hex chars | `scripts/generate-secret.sh` |
| `CRYPTO_MASTER_KEY` | secret | Master key para cifrar `IntegrationSecrets`, `ZohoMeetings.transcript` y campos PII at rest | 32 bytes base64 | `scripts/generate-secret.sh` |
| `APP_BASE_URL` | config | URL pública de la app (para armar links absolutos) | `https://sharktalents.ai` | Depende de ambiente |
| `CLIENT_HOSTING_BASE` | config | Path del client hosting bajo `APP_BASE_URL` | `/app/index.html` | `/app/index.html` en Catalyst |
| `PUBLIC_REPORT_BASE` | config | Path base para reportes públicos | `/app/index.html#/report` | Derivado de los anteriores |
| `TEST_LINK_BASE` | config | Path base para links de pruebas al candidato | `/app/index.html#/test` | Derivado |
| `ANTHROPIC_MODEL` | config | Modelo a usar | `claude-haiku-4-5-20251001` | Cambiar para migrar modelos |
| `ANTHROPIC_CACHING_ENABLED` | flag | Activar prompt caching | `true` | Feature flag |
| `ANTHROPIC_TIMEOUT_MS` | config | Timeout de llamadas Anthropic | `25000` | 25s (< 30s de Catalyst) |
| `ANTHROPIC_MAX_RETRIES` | config | Max retries en fallos transitorios | `3` | Default |
| `CIRCUIT_BREAKER_THRESHOLD` | config | Fallos seguidos para abrir breaker | `5` | Default |
| `CIRCUIT_BREAKER_COOLDOWN_MS` | config | Tiempo de breaker abierto | `60000` | 1 min |
| `RATE_LIMIT_WINDOW_MS` | config | Ventana de rate limit | `60000` | 1 min |
| `RATE_LIMIT_MAX_REQUESTS` | config | Max requests por ventana | `30` | Depende del endpoint |
| `LOG_LEVEL` | config | Nivel mínimo de logs | `info` | `info` prod, `debug` dev |
| `APP_VERSION` | info | Versión del backend (leído desde git tag o package.json) | `1.0.0` | CI/CD o manual |

**Zoho (Recruit, Meeting, Zia, Bookings, Sign — ver [23](23_INTEGRACIONES_ZOHO.md)):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `ZOHO_DC` | config | Data center de Zoho | `com` / `eu` / `in` | Account Zoho |
| `ZOHO_CLIENT_ID` | secret | OAuth client ID compartido | `1000.xxxxx` | Zoho API Console |
| `ZOHO_CLIENT_SECRET` | secret | OAuth client secret | `xxxxx` | Zoho API Console |
| `ZOHO_RECRUIT_WEBHOOK_TOKEN` | secret | Token estático para validar webhook entrante de Recruit | 32 hex chars | `scripts/generate-secret.sh` |
| `ZOHO_MEETING_WEBHOOK_SECRET` | secret | HMAC secret para webhook Meeting | 32 hex chars | `scripts/generate-secret.sh` |
| `ZOHO_BOOKINGS_WEBHOOK_TOKEN` | secret | Token webhook Bookings | 32 hex chars | `scripts/generate-secret.sh` |
| `ZOHO_SIGN_WEBHOOK_SECRET` | secret | HMAC secret webhook Sign | 32 hex chars | `scripts/generate-secret.sh` |

**Whisper / OpenAI (fallback transcripción — [23](23_INTEGRACIONES_ZOHO.md), [20](20_VIDEOS_DINAMICOS.md)):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `OPENAI_API_KEY` | secret | API key OpenAI para Whisper | `sk-xxxxx` | OpenAI Console |
| `WHISPER_FALLBACK_ENABLED` | flag | Activar fallback Whisper cuando Zia no transcribe | `true` | Feature flag |
| `WHISPER_LANGUAGE_DEFAULT` | config | Idioma forzado (es/en/auto) | `es` | Default Panamá |

**HeyReach (outbound LinkedIn — [22](22_OUTBOUND_SOURCING.md)):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `HEYREACH_API_KEY` | secret | API key HeyReach por LinkedIn account | `hr_xxxxx` | HeyReach dashboard |
| `HEYREACH_LINKEDIN_ACCOUNT_ID` | config | Account ID de la cuenta LinkedIn dedicada | UUID | HeyReach dashboard |
| `HEYREACH_WEBHOOK_SECRET` | secret | HMAC para webhook entrante de respuestas | 32 hex chars | `scripts/generate-secret.sh` |
| `HEYREACH_DAILY_INVITE_LIMIT` | config | Tope diario de invites (safety) | `5` | Default conservador |

**WhatsApp (notificaciones cliente — [17](17_PORTAL_CLIENTE.md)):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `WHATSAPP_PROVIDER` | config | Proveedor WhatsApp Business API | `twilio` / `wati` / `meta` | TBD según costo |
| `WHATSAPP_API_KEY` | secret | API key del proveedor | varía | Provider dashboard |
| `WHATSAPP_FROM_NUMBER` | config | Número emisor verificado | `+507xxxxx` | Provider |

**Bot decisor — [21](21_BOT_DECISOR.md):**

| Nombre | Tipo | Descripción | Ejemplo | Origen |
|---|---|---|---|---|
| `BOT_MODE` | config | Estado global del bot decisor | `cold` / `warm` / `hot` | Manual override |
| `BOT_CONFIDENCE_THRESHOLD_DEFAULT` | config | Threshold default cuando no hay override por etapa | `0.75` | Configurable per-stage en DB |
| `BOT_RAG_TOP_K` | config | Cuántos casos similares pasar al prompt | `5` | Default |

### Frontend

Build-time, prefix `VITE_`. Ubicación: `shark/.env.development` y `shark/.env.production`.

**⚠️ Recordatorio:** todas las `VITE_*` van al bundle final visible. NUNCA secrets.

| Nombre | Tipo | Descripción | Ejemplo |
|---|---|---|---|
| `VITE_API_BASE` | config | URL del backend API (relativa o absoluta) | `/server/api/api` (prod), `http://localhost:3002/api` (dev) |
| `VITE_APP_VERSION` | info | Versión visible en UI | `1.0.0` |
| `VITE_APP_BASE_URL` | config | URL pública para armar links compartibles | `https://sharktalents.ai` |
| `VITE_CLIENT_HOSTING_PATH` | config | Path bajo el dominio | `/app/index.html` |
| `VITE_CLERK_PUBLISHABLE_KEY` | config (ok público) | Publishable key de Clerk | `pk_test_xxx` / `pk_live_xxx` |

### MCP Server (`packages/mcp-server`)

Env vars que el usuario final configura al correr el MCP:

| Nombre | Tipo | Descripción | Ejemplo |
|---|---|---|---|
| `ST_API_KEY` | secret | API key del tenant (empieza con `st_`) | Panel admin → API Keys → Create |
| `ST_API_BASE` | config | URL del backend (default: prod) | `https://sharktalents.ai/server/api/api/v1` |

Se pueden pasar por CLI: `npx @sharktalents/mcp-server --api-key st_xxx`.

---

## 2. `.env.example`

Archivo único en raíz del proyecto. Lo commiteamos, pero vale para onboarding.

Crear `/.env.example`:

```bash
# ==========================================
# SharkTalents — env vars template
# Copiá a .env.local para desarrollo
# ==========================================

# --- BACKEND ---

# Auth (Clerk)
CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
CLERK_WEBHOOK_SECRET=whsec_xxxxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-replace-me

# Internal
INTERNAL_API_KEY=generate-with-scripts/generate-secret.sh
URL_SIGNING_SECRET=generate-with-scripts/generate-secret.sh

# URLs (ajustar por ambiente)
APP_BASE_URL=https://sharktalents.ai
CLIENT_HOSTING_BASE=/app/index.html
PUBLIC_REPORT_BASE=/app/index.html#/report
TEST_LINK_BASE=/app/index.html#/test

# Anthropic config
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_CACHING_ENABLED=true
ANTHROPIC_TIMEOUT_MS=25000
ANTHROPIC_MAX_RETRIES=3

# Reliability
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_COOLDOWN_MS=60000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30

# API pública
API_V1_RATE_LIMIT_DEFAULT=60
API_V1_RATE_LIMIT_PER_TENANT=1000

# Crypto at-rest
CRYPTO_MASTER_KEY=generate-with-scripts/generate-secret.sh

# Zoho (Recruit / Meeting / Zia / Bookings / Sign)
ZOHO_DC=com
ZOHO_CLIENT_ID=1000.xxxxx
ZOHO_CLIENT_SECRET=xxxxx
ZOHO_RECRUIT_WEBHOOK_TOKEN=generate-with-scripts/generate-secret.sh
ZOHO_MEETING_WEBHOOK_SECRET=generate-with-scripts/generate-secret.sh
ZOHO_BOOKINGS_WEBHOOK_TOKEN=generate-with-scripts/generate-secret.sh
ZOHO_SIGN_WEBHOOK_SECRET=generate-with-scripts/generate-secret.sh

# OpenAI Whisper (fallback transcript + videos)
OPENAI_API_KEY=sk-xxxxx
WHISPER_FALLBACK_ENABLED=true
WHISPER_LANGUAGE_DEFAULT=es

# HeyReach (outbound LinkedIn)
HEYREACH_API_KEY=hr_xxxxx
HEYREACH_LINKEDIN_ACCOUNT_ID=xxxxx
HEYREACH_WEBHOOK_SECRET=generate-with-scripts/generate-secret.sh
HEYREACH_DAILY_INVITE_LIMIT=5

# WhatsApp (notificaciones cliente)
WHATSAPP_PROVIDER=twilio
WHATSAPP_API_KEY=xxxxx
WHATSAPP_FROM_NUMBER=+507xxxxx

# Bot decisor
BOT_MODE=cold
BOT_CONFIDENCE_THRESHOLD_DEFAULT=0.75
BOT_RAG_TOP_K=5

LOG_LEVEL=info
APP_VERSION=1.0.0

# --- FRONTEND (archivo separado en shark/.env.development y .env.production) ---
# VITE_API_BASE=/server/api/api
# VITE_APP_VERSION=1.0.0
# VITE_APP_BASE_URL=https://sharktalents.ai
# VITE_CLIENT_HOSTING_PATH=/app/index.html
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
```

**Nota sobre deprecación:** los env vars `ADMIN_USER`, `ADMIN_PASS_HASH`, `JWT_SECRET` del sistema viejo **se eliminan** al integrar Clerk. No se usan más. Ver [14_CLERK_AUTH.md](14_CLERK_AUTH.md).

---

## 3. Refactor de `catalyst-config.json`

El archivo actual tiene `"REPLACE_ME"` en cada env var — eso es aceptable para dev, pero en prod se configura en Catalyst Console. Cambio: **no poner valores reales de prod en el archivo commiteado**, y agregar comentario.

`functions/api/catalyst-config.json` (nuevo nombre de carpeta — ver sección 4):

```json
{
  "deployment": {
    "name": "api",
    "stack": "node20",
    "type": "advancedio",
    "memory": 512,
    "timeout": 30,
    "env_variables": {
      "ANTHROPIC_API_KEY": "set-in-catalyst-console",
      "ADMIN_USER": "set-in-catalyst-console",
      "ADMIN_PASS_HASH": "set-in-catalyst-console",
      "JWT_SECRET": "set-in-catalyst-console",
      "INTERNAL_API_KEY": "set-in-catalyst-console",
      "URL_SIGNING_SECRET": "set-in-catalyst-console",
      "APP_BASE_URL": "https://sharktalents.ai",
      "CLIENT_HOSTING_BASE": "/app/index.html",
      "PUBLIC_REPORT_BASE": "/app/index.html#/report",
      "TEST_LINK_BASE": "/app/index.html#/test",
      "ANTHROPIC_MODEL": "claude-haiku-4-5-20251001",
      "ANTHROPIC_CACHING_ENABLED": "true",
      "ANTHROPIC_TIMEOUT_MS": "25000",
      "ANTHROPIC_MAX_RETRIES": "3",
      "CIRCUIT_BREAKER_THRESHOLD": "5",
      "CIRCUIT_BREAKER_COOLDOWN_MS": "60000",
      "RATE_LIMIT_WINDOW_MS": "60000",
      "RATE_LIMIT_MAX_REQUESTS": "30",
      "LOG_LEVEL": "info",
      "APP_VERSION": "1.0.0"
    }
  },
  "execution": {
    "main": "index.js"
  }
}
```

**Nota:** los 6 secrets que dicen `set-in-catalyst-console` no hay que commitear con valores reales nunca. Los configurás una vez en la Console.

---

## 4. Estructura de carpetas nueva

### Backend

**Antes:**
```
functions/sharktalents/
├── index.js  (compilado)
├── catalyst-config.json
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── router.ts
│   ├── db.ts
│   ├── auth.ts
│   ├── helpers.ts
│   ├── routes/        (9 archivos)
│   ├── services/      (9 archivos)
│   ├── data/
│   └── seeds/
└── seeds/             (7 JSONs)
```

**Después:**
```
functions/api/
├── index.js                       (compilado, 40 líneas max)
├── catalyst-config.json
├── package.json
├── tsconfig.json                  (strict: true)
├── src/
│   ├── index.ts                   (entry, 30 líneas)
│   ├── router.ts                  (solo routing + middleware raíz)
│   ├── handlers/                  (por recurso, antes "routes/")
│   │   ├── auth.ts
│   │   ├── adminJobs.ts
│   │   ├── adminAssessments.ts
│   │   ├── adminResults.ts
│   │   ├── adminCandidates.ts
│   │   ├── adminLibrary.ts
│   │   ├── adminReports.ts
│   │   ├── publicTest.ts
│   │   ├── publicReport.ts
│   │   └── health.ts              (NUEVO)
│   ├── services/                  (lógica de negocio, sin HTTP)
│   │   ├── candidateScoring.ts
│   │   ├── clientReportGenerator.ts
│   │   ├── pdfGenerator.ts
│   │   ├── questionsStore.ts
│   │   ├── reportFileStore.ts
│   │   ├── reportGenerator.ts
│   │   ├── scoring.ts
│   │   ├── stateMachine.ts        (NUEVO — pipeline transitions)
│   │   ├── tokenTracker.ts        (REESCRITO — persistir en DB)
│   │   ├── auditLog.ts            (NUEVO)
│   │   └── outbox.ts              (NUEVO)
│   ├── integrations/              (NUEVO — wrappers de APIs externas)
│   │   ├── anthropic.ts           (MOVIDO de services/anthropic.ts)
│   │   └── catalystFileStore.ts   (MOVIDO de services/reportFileStore.ts)
│   ├── db/                        (NUEVO — queries por tabla)
│   │   ├── jobs.ts
│   │   ├── assessments.ts
│   │   ├── candidates.ts
│   │   ├── results.ts
│   │   ├── scores.ts              (DiscScores, CognitiveScores, etc.)
│   │   ├── pipelineTransitions.ts
│   │   ├── clientReports.ts
│   │   ├── reportCandidates.ts
│   │   ├── techLibrary.ts
│   │   ├── screenExits.ts
│   │   ├── processedEvents.ts
│   │   ├── outboxEvents.ts
│   │   ├── auditLog.ts
│   │   ├── tokenUsage.ts
│   │   ├── circuitBreakers.ts
│   │   ├── config.ts
│   │   └── helpers.ts             (normalizeRow, escapeSql, dateTime helpers)
│   ├── middleware/                (NUEVO)
│   │   ├── auth.ts                (authenticate, requireAdmin)
│   │   ├── rateLimit.ts
│   │   ├── internalAuth.ts
│   │   └── validation.ts
│   ├── lib/                       (NUEVO — utils genéricos)
│   │   ├── errors.ts              (AppError, ValidationError, etc.)
│   │   ├── hmac.ts
│   │   ├── retry.ts
│   │   ├── circuitBreaker.ts
│   │   ├── logger.ts              (log con prefijos)
│   │   └── env.ts                 (lectura y validación de env vars)
│   ├── data/
│   │   └── competencias.ts        (sin cambio)
│   └── seeds/
│       └── loadQuestions.ts       (con cache en memoria)
└── seeds/                         (sin cambio, 7 JSONs)
```

### Frontend

**Sin cambio estructural mayor.** Solo agregamos:
```
shark/
├── src/
│   ├── config.ts                  (NUEVO — centraliza env vars)
│   ├── components/
│   │   ├── ErrorBoundary.tsx      (NUEVO)
│   │   └── ...
│   ├── lib/
│   │   └── api.ts                 (REFACTOR — fetch wrapper mejorado)
│   └── ...
├── .env.development               (NUEVO)
├── .env.production                (NUEVO)
└── .env.example                   (NUEVO)
```

### Raíz
```
sharktalentsapp/
├── catalyst.json                  (regenerado cuando hagas catalyst init)
├── .env.example                   (NUEVO)
├── .gitignore                     (verificar que .env* estén)
├── scripts/                       (NUEVO)
│   ├── generate-secret.sh
│   ├── generate-password-hash.sh
│   ├── deploy-backend.sh
│   ├── deploy-frontend.sh
│   ├── migrate-schema.sh
│   └── rotate-secret.sh
├── docs/
│   ├── aprendizajes/              (existente)
│   ├── master-plan/               (este dir, existente)
│   ├── evaluaciones/              (existente)
│   ├── contenido-web/             (existente)
│   ├── pendientes/                (existente)
│   ├── ADR/                       (NUEVO — decisiones arquitectónicas)
│   │   ├── 001-cloud-scale-sobre-slate.md
│   │   ├── 002-hashrouter.md
│   │   ├── 003-typescript-strict.md
│   │   └── 004-sin-tests-automatizados.md
│   ├── INTEGRATIONS/              (NUEVO)
│   │   ├── anthropic.md
│   │   └── catalyst-file-store.md
│   └── RUNBOOKS/                  (NUEVO)
│       ├── cron-detenido.md
│       ├── anthropic-caido.md
│       ├── reporte-publico-404.md
│       ├── data-store-lento.md
│       └── smoke-tests.md
├── README.md                      (actualizado)
├── CLAUDE.md                      (NUEVO)
├── CHANGELOG.md                   (NUEVO)
├── shark/
└── functions/
```

---

## 5. Scripts base

### `scripts/generate-secret.sh`

```bash
#!/bin/bash
# Genera un secret hex de 32 bytes (64 chars) para env vars.
# Uso: scripts/generate-secret.sh

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `scripts/generate-password-hash.sh`

```bash
#!/bin/bash
# Genera salt+hash scrypt para password admin.
# Uso: scripts/generate-password-hash.sh 'mi-password'

if [ -z "$1" ]; then
  echo "Uso: $0 'password'"
  exit 1
fi

node <<EOF
const crypto = require('crypto');
const password = '$1';
const salt = crypto.randomBytes(16).toString('hex');
crypto.scrypt(password, salt, 64, (err, hash) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(salt + ':' + hash.toString('hex'));
});
EOF
```

### `scripts/deploy-backend.sh`

```bash
#!/bin/bash
# Deploy de backend a Catalyst.
# Uso: scripts/deploy-backend.sh [dev|prod]

set -e
ENV=${1:-dev}
cd "$(dirname "$0")/.."

echo "▶ Building TypeScript..."
cd functions/api && npm run build && cd ../..

echo "▶ Deploying to Catalyst ($ENV)..."
if [ "$ENV" = "prod" ]; then
  catalyst deploy --only functions:api --env production
else
  catalyst deploy --only functions:api
fi

echo "✓ Deploy completo"
```

### `scripts/deploy-frontend.sh`

```bash
#!/bin/bash
# Build + zip del frontend para upload a Client Hosting.
# Uso: scripts/deploy-frontend.sh

set -e
cd "$(dirname "$0")/../frontend"

VERSION=$(node -p "require('./package.json').version")
echo "▶ Building version $VERSION..."

npm install
npm run build

cd build
ZIP="../sharktalents-frontend-${VERSION}.zip"
rm -f "$ZIP"
zip -rq "$ZIP" .
cd ..

echo "✓ ZIP listo: shark/sharktalents-frontend-${VERSION}.zip"
echo ""
echo "Siguiente paso:"
echo "  1. Ir a Catalyst Console → Client Hosting"
echo "  2. Upload del zip"
```

### `scripts/rotate-secret.sh`

```bash
#!/bin/bash
# Guide interactivo para rotation de un secret.
# Uso: scripts/rotate-secret.sh JWT_SECRET

SECRET_NAME=$1
if [ -z "$SECRET_NAME" ]; then
  echo "Uso: $0 SECRET_NAME"
  exit 1
fi

NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "Plan de rotation para $SECRET_NAME"
echo "================================="
echo "Nuevo secret (guardalo seguro):"
echo "$NEW"
echo ""
echo "Pasos:"
echo "1. En Catalyst Console → Functions → api → Env Vars:"
echo "   - Cambiar ${SECRET_NAME}_OLD = (valor actual de $SECRET_NAME)"
echo "   - Cambiar $SECRET_NAME = $NEW"
echo "2. Redeploy backend."
echo "3. Código actual debe aceptar ambos valores (old + new)."
echo "4. Esperar 48h."
echo "5. Remover ${SECRET_NAME}_OLD de env vars + redeploy."
```

Todos los scripts van con `chmod +x scripts/*.sh`.

---

## 6. `.gitignore` actualizado

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Compiled output (JS desde TS)
functions/api/handlers/
functions/api/services/
functions/api/integrations/
functions/api/db/
functions/api/middleware/
functions/api/lib/
functions/api/data/
functions/api/seeds/*.js
functions/api/*.js
!functions/api/index.js

# Build artifacts
shark/build/
shark/dist/
shark/*.zip

# Environment / secrets
.env
.env.local
.env.production
.env.development
*.env
!.env.example

# IDE
.vscode/
.idea/
*.swp
.DS_Store

# Logs
*.log
npm-debug.log*

# OS
Thumbs.db

# Temp files
*.tmp
*.bak

# Catalyst
.catalyst/
.catalystrc
```

---

## 7. `CLAUDE.md` en la raíz

Archivo de instrucciones para agentes IA que operen en el repo. Template:

```markdown
# CLAUDE.md — Instrucciones para agentes IA

## Contexto del proyecto
SharkTalents — plataforma de evaluación de candidatos con IA.
Stack: Zoho Catalyst Advanced I/O + Node 20 + React 18 + Vite.

## Cosas críticas antes de escribir código

1. **Leé** [docs/aprendizajes/](docs/aprendizajes/) — tenemos un manual propio de patrones.
2. **Leé** [docs/master-plan/](docs/master-plan/) si estamos en refactor.
3. **NUNCA hardcodees URLs** — usar env vars de [src/config.ts](shark/src/config.ts) o [lib/env.ts](functions/api/src/lib/env.ts).
4. **NUNCA loguees secrets/PII** — usá fragmentos (primeros 4 + últimos 4 chars).
5. **NUNCA comentes código sin valor** — CLAUDE.md dice NO comentar el "qué" del código.
6. **TODO query ZCQL** debe usar `escapeSql()` de [db/helpers.ts](functions/api/src/db/helpers.ts).

## Convenciones de código

- **Backend TS:** `strict: true`, commonjs, Node 20.
- **Frontend TS:** `strict: true`, ESM, React 18.
- **Tablas DB:** `PascalCase` plural (Users, Orders).
- **Columnas:** `snake_case`.
- **Prefijos de logs:** `[MODULE-SUBMODULE]` en mayúsculas.
- **Commits:** imperativo + por qué. Ej: `Agregar rate limit a /test/:token/start — evitar abuse de candidatos enumerando tokens`.

## Comandos comunes

```bash
# Backend
cd functions/api && npm run build
npm run start  # local

# Frontend
cd frontend && npm run dev
npm run build

# Deploy
./scripts/deploy-backend.sh prod
./scripts/deploy-frontend.sh

# Secrets
./scripts/generate-secret.sh
./scripts/generate-password-hash.sh 'mi-password'
```

## Archivos clave

- [functions/api/src/index.ts](functions/api/src/index.ts) — entry backend
- [functions/api/src/router.ts](functions/api/src/router.ts) — routing
- [functions/api/src/lib/env.ts](functions/api/src/lib/env.ts) — lectura de env vars
- [shark/src/config.ts](shark/src/config.ts) — config frontend
- [shark/src/lib/api.ts](shark/src/lib/api.ts) — cliente HTTP

## Prohibiciones explícitas

- ❌ `console.log` sin prefijo.
- ❌ `await fetch(...)` sin timeout.
- ❌ Hardcodear `https://myapp-123456.development.catalystserverless.com`.
- ❌ Agregar columnas a una god-table — crear tabla nueva.
- ❌ `*` en CORS con credentials.
- ❌ Commit de `.env` con valores reales.
```

---

## 8. Setup del nuevo proyecto Catalyst

Ya borraste `catalyst.json`. Para regenerar:

```bash
cd /Users/usuario/sharktalentsapp
catalyst init
# Client Setup: React web app
# Choose option: TypeScript
# Name: react-app (scaffold temporal, lo borramos después)
# Functions: Advanced I/O Functions
# Function name: api   ← ESTE ES EL NOMBRE NUEVO
```

Después:
1. Borrar `react-app/` (es scaffold que no usamos).
2. Editar `catalyst.json` para que `client.source` apunte a `shark/build`.
3. Mover `functions/sharktalents/` a `functions/api/` (git mv).
4. Actualizar `catalyst.json` `functions.targets: ["api"]`.

`catalyst.json` final:
```json
{
  "functions": {
    "targets": ["api"],
    "ignore": [],
    "source": "functions"
  },
  "client": {
    "source": "shark/build"
  }
}
```

---

## 9. Setup del DataStore en la nueva consola Catalyst

Cuando inicializaste el nuevo proyecto Catalyst, perdiste el DataStore viejo. Hay que recrear las tablas. Esta fase solo crea las **actuales** tal cual están — el schema nuevo se diseña en [Fase 2](03_FASE2_BASE_DATOS.md).

Ir a Catalyst Console → DataStore → Create Table. Crear estas 8 tablas con las columnas del schema actual:

1. **Jobs**
2. **Assessments**
3. **AssessmentQuestions**
4. **Candidates**
5. **Results**
6. **ClientReports**
7. **ReportCandidates**
8. **TechLibrary**

Schema detallado (columnas y tipos) en [03_FASE2_BASE_DATOS.md](03_FASE2_BASE_DATOS.md) sección "schema actual".

**Estrategia:** dejar el schema viejo funcionando mientras migramos en Fase 2. La Fase 1 solo recrea el estado actual para poder empezar a trabajar.

---

## 10. Checklist de cierre Fase 1

- [ ] `catalyst.json` regenerado con la nueva config
- [ ] Nombre de function cambiado de `sharktalents` a `api`
- [ ] `functions/api/` con estructura nueva (subcarpetas vacías por ahora)
- [ ] `scripts/` con los 5 scripts y ejecutables
- [ ] `.env.example` commiteado
- [ ] `.gitignore` actualizado
- [ ] `CLAUDE.md` commiteado
- [ ] `docs/ADR/001-cloud-scale-sobre-slate.md` escrito
- [ ] `docs/ADR/002-hashrouter.md` escrito
- [ ] `docs/ADR/003-typescript-strict.md` escrito
- [ ] `docs/ADR/004-sin-tests-automatizados.md` escrito
- [ ] `docs/RUNBOOKS/smoke-tests.md` con los tests manuales actuales
- [ ] Catalyst Console: env vars configuradas en Functions → api
- [ ] Catalyst Console: DataStore con las 8 tablas recreadas
- [ ] Smoke test: login → crear puesto → ver pipeline → descargar reporte → todo OK
- [ ] Deploy a dev exitoso
- [ ] README.md actualizado

Cuando todo esté tildado → cerrar Fase 1.

---

## Siguiente paso

→ [03_FASE2_BASE_DATOS.md](03_FASE2_BASE_DATOS.md) — diseñar el schema normalizado.
