# SharkTalents

Plataforma multi-tenant de evaluación y operación de pipeline de talento, con IA. Construida sobre Zoho Catalyst (backend + hosting), React + Vite (frontend), Anthropic Claude Haiku 4.5 + Clerk (auth) + integraciones Zoho (Recruit, Meeting, Bookings, Sign) + HeyReach (outbound LinkedIn).

> ⚠️ **Refactor en curso desde cero.** El plan canónico es [docs/master-plan/](docs/master-plan/). El código de `frontend/` y `functions/sharktalents/` es **legado del prototipo single-tenant** — el código nuevo vive en `shark/` y `functions/api/`.

## Arquitectura

### Backend (`functions/api/`)
- Zoho Catalyst Advanced I/O Function (Node 20)
- TypeScript estricto → JavaScript commonjs
- Datastore: Catalyst (ZCQL) + File Store
- Auth: Clerk (users + organizations = tenants)
- IA: Claude Haiku 4.5 (Anthropic) con prompt caching
- Multi-tenant: `tenant_id` en todas las tablas de dominio

### Frontend (`shark/`)
- React 18 + TypeScript 5.6 + Vite 5
- React Router (HashRouter)
- Componentes Clerk (`<ClerkProvider>`, `<OrganizationSwitcher>`)
- Build a `shark/dist/` (servido por Catalyst Client Hosting)

### Integraciones
- **Zoho Recruit** — CRM back-office, sync unidireccional desde SharkTalents.
- **Zoho Meeting + Zia** — videocalls + transcripción (con fallback Whisper).
- **Zoho Bookings** — onboarding self-serve cliente, scheduling entrevistas.
- **Zoho Sign** — generación + firma de contratos.
- **HeyReach** — outbound LinkedIn (cuenta dedicada).
- **OpenAI Whisper** — transcripción fallback + videos dinámicos.

## Estructura del repo

```
sharktalentsapp/
├── catalyst.json                 Config Catalyst (apunta a shark/dist + functions/api)
├── .catalystrc                   Estado del proyecto Catalyst (project id, env)
├── .env.example                  Template de env vars backend
├── CLAUDE.md                     Convenciones para agentes IA
├── CHANGELOG.md
├── README.md                     (este archivo)
├── shark/                        ← FRONTEND NUEVO (Vite + React 18)
│   ├── index.html
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── config.ts             Centraliza VITE_* env vars
│   ├── .env.example
│   ├── .env.development
│   └── .env.production
├── functions/
│   ├── api/                      ← BACKEND NUEVO (Catalyst Advanced I/O)
│   │   ├── catalyst-config.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── index.js              Compilado (entry para Catalyst)
│   │   └── src/
│   │       ├── index.ts          Entry point
│   │       ├── router.ts         Routing
│   │       ├── handlers/         (un archivo por recurso REST)
│   │       ├── services/         (lógica de negocio)
│   │       ├── integrations/     (wrappers de APIs externas)
│   │       ├── db/               (queries por tabla)
│   │       ├── middleware/       (auth, rate limit, validation)
│   │       ├── lib/              (env, logger, errors, hmac, retry)
│   │       └── seeds/
│   └── sharktalents/             ← LEGACY (prototipo single-tenant)
├── frontend/                     ← LEGACY (prototipo single-tenant)
├── scripts/
│   ├── generate-secret.sh
│   ├── deploy-backend.sh
│   ├── deploy-frontend.sh
│   └── rotate-secret.sh
└── docs/
    ├── master-plan/              ← El plan canónico (24 docs)
    ├── aprendizajes/             ← Manual de patrones
    ├── ADR/                      ← Decisiones arquitectónicas
    ├── INTEGRATIONS/             ← Operación de integraciones
    └── RUNBOOKS/                 ← Procedimientos de incident
```

## Setup inicial

```bash
# Backend skeleton
cd functions/api
npm install
npm run build

# Frontend
cd ../../shark
npm install
npm run dev    # localhost:3000
```

## Variables de entorno

Lista completa en [.env.example](.env.example) (backend) y [shark/.env.example](shark/.env.example) (frontend).

Generar secrets:
```bash
./scripts/generate-secret.sh    # 64 hex chars
```

En producción se setean en Catalyst Console → Functions → api → Environment Variables.

## Comandos comunes

```bash
# Backend
cd functions/api && npm run build
npm run watch                              # rebuild on save

# Frontend
cd shark && npm run dev                    # localhost:3000
npm run build                              # → shark/dist

# Deploy
./scripts/deploy-backend.sh prod
./scripts/deploy-frontend.sh
```

## Por dónde empezar

1. **Para entender el proyecto:** [docs/master-plan/00_INDEX.md](docs/master-plan/00_INDEX.md).
2. **Para ejecutar refactor:** [docs/master-plan/12_ROADMAP_EJECUCION.md](docs/master-plan/12_ROADMAP_EJECUCION.md).
3. **Para escribir código:** [CLAUDE.md](CLAUDE.md) + [docs/aprendizajes/](docs/aprendizajes/).

## Dimensiones de evaluación (sin cambio respecto del prototipo)

1. **Conducta** — DISC.
2. **Cognición** — VELNA (Verbal, Espacial, Lógica, Numérica, Abstracta).
3. **Técnica** — preguntas IA contextualizadas + axis doble (knowledge + situational con autonomy_vs_consult).
4. **Emoción** — reactividad emocional.
5. **Integridad** — multidimensional con detector de deseabilidad social.

## Estado actual (2026-05-04)

**Backend:** ~80 endpoints HTTP, 693 tests pasando, multi-tenant Clerk operativo.
**Frontend:** 109 tests, 25+ pages wired, lazy-loaded (bundle main 362KB).
**Webhooks entrantes (6):** Clerk, HeyReach, Zia, Zoho Sign, Zoho Recruit, WhatsApp — todos con HMAC + idempotencia.

### Integraciones en código (15)

| Integración | Estado | Uso |
|---|---|---|
| Anthropic Claude Haiku 4.5 | ✅ activa | Drafts IA, narrativas reportes, bot decisor |
| Clerk | ✅ activa | Auth + organizations multi-tenant |
| Catalyst Email Service | ✅ activa | Outbox dispatcher de emails |
| Sentry (envelope sin SDK) | ✅ código listo | Error tracking opcional |
| Cloudflare Turnstile | ⚙️ env vars | Captcha para landing marketing |
| HeyReach | ⚙️ código listo | Outbound LinkedIn |
| Zoho Recruit (in/out) | ⚙️ código listo | Sync candidatos |
| Zoho Bookings | ⚙️ código listo | Briefing cliente |
| Zoho Sign (in/out) | ⚙️ código listo | Firma electrónica oferta |
| Zoho CRM | ⚙️ código listo | Sync marketing leads |
| Zia | ⚙️ webhook listo | Transcripción meetings |
| Whisper (OpenAI) | ⚙️ código listo | Fallback transcripción |
| WhatsApp Cloud API | ⚙️ código listo | Mensajería transaccional |
| MCP Server | ✅ separado en `mcp/` | 12 tools para agentes IA |

⚙️ = código completo, esperando OAuth tokens / API keys en env vars producción.

### Features end-to-end completos

**Pipeline candidato:** apply → prefilter → DISC → VELNA → integridad → emocional → técnica (doble eje) → videos dinámicos → bot decisor → finalist → review queue → oferta firmada → hired.

**Onboarding cliente:** booking briefing (Zoho Bookings) → meeting con Zia → transcript automático → IA arma draft del puesto → Cris revisa → cliente aprueba → Job activo.

**Reporte cliente:** narrativas IA por candidato (es/en) + conclusión con recomendación → portal cliente con tracking de aperturas + funnel + draft approval.

**Marketing funnel:** landing externa (Astro, no implementada) → quiz scoring → captura lead → eval gratis demo (DISC + Cognitiva + Integridad) → reporte automático → llamada → contrato.

### Tablas Catalyst pendientes

42 tablas pendientes de crear en Catalyst Console. Ver:
- [docs/master-plan/MIGRATIONS_AGREGAR_COLUMNAS.csv](docs/master-plan/MIGRATIONS_AGREGAR_COLUMNAS.csv) — 5 columnas a agregar a tablas existentes (Jobs, Results)
- [docs/master-plan/MIGRATIONS_NUEVAS.csv](docs/master-plan/MIGRATIONS_NUEVAS.csv) — 35 tablas a crear desde cero

El backend tolera todas las ausencias con fallback graceful (devuelve `table_ready: false` o lista vacía sin romper UI).

### Smoke test post-deploy

```bash
CATALYST_API_URL=https://...catalystserverless.com/server/api \
INTERNAL_API_KEY=... \
./scripts/smoke-test.sh
```

Pega a 20+ endpoints (públicos + admin) y reporta pass/fail. Útil para verificar deploys.

## Diagrama de flujo (lectura rápida)

```
                          ┌──────────────────┐
                          │  Landing externa │ (Astro, deferred)
                          │  marketing funnel│
                          └────────┬─────────┘
                                   │ POST /api/marketing/lead
                                   ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                  PLATAFORMA SHARKTALENTS                          │
   │                  (Catalyst Advanced I/O)                          │
   │                                                                   │
   │  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐     │
   │  │  Frontend      │  │  Backend     │  │  Outbox          │     │
   │  │  React + Vite  │──│  ~80 routes  │──│  Async events    │     │
   │  │  Clerk auth    │  │  ~25 features│  │  → integraciones │     │
   │  └────────────────┘  └──────────────┘  └────────┬─────────┘     │
   │                              │                    │               │
   │                              ▼                    ▼               │
   │                       ┌──────────────┐    ┌──────────────┐       │
   │                       │  Catalyst    │    │  External    │       │
   │                       │  Datastore   │    │  APIs        │       │
   │                       │  + FileStore │    │  (Anthropic, │       │
   │                       └──────────────┘    │   Zoho, etc) │       │
   │                                            └──────────────┘       │
   │                                                                   │
   │  ┌────────── 6 webhooks entrantes ───────────────────────┐       │
   │  │ /api/webhooks/{clerk, heyreach, zia, zoho-sign,      │       │
   │  │                zoho-recruit, whatsapp}                │       │
   │  │ HMAC + idempotency via ProcessedEvents                │       │
   │  └───────────────────────────────────────────────────────┘       │
   └──────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │  Reportes públicos /report/<token>
                                   │  Portal cliente   /portal/<token>
                                   │  Test candidato   /test/<token>
                                   ▼
                          ┌────────────────┐
                          │  Cliente final │
                          │  + candidatos  │
                          └────────────────┘
```
