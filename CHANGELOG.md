# Changelog

Cambios relevantes del proyecto. Sigue el formato [Keep a Changelog](https://keepachangelog.com/) y SemVer.

## [Unreleased]

### Added
- Master plan completo en `docs/master-plan/` (24 docs).
- Skeleton del backend `functions/api/` con TypeScript estricto, logger con prefijos, env loader, error classes y `/health` endpoint.
- Frontend migrado a Vite 5 + React 18 + TypeScript 5.6 (en `shark/`).
- `.env.example` raíz + `shark/.env.{example,development,production}`.
- Scripts base en `scripts/`: `generate-secret.sh`, `deploy-backend.sh`, `deploy-frontend.sh`, `rotate-secret.sh`.
- `CLAUDE.md` con convenciones para agentes IA.
- Skeleton `docs/ADR/`, `docs/INTEGRATIONS/`, `docs/RUNBOOKS/` con templates.
- **Fase 2 (parte 1) — multi-tenancy + Clerk:**
  - Backend `RequestContext` pattern con `traceId`, user/tenant scoping.
  - `lib/{context,http,db,slugify}.ts` helpers; `db/{helpers,tenants,processedEvents}.ts`.
  - `middleware/auth.ts` (verifyToken Clerk JWT) + `middleware/tenant.ts` (lookup `Tenants` por `clerk_org_id`).
  - `handlers/clerkWebhooks.ts` con verificación HMAC vía Svix + idempotencia vía `ProcessedEvents`.
  - Router refactoreado a pattern de `ctx`; `traceId` propagado en headers + logs.
  - Frontend integrado con `@clerk/clerk-react@5`: `<ClerkProvider>`, `<SignedIn/Out>`, `<UserButton>`, `<OrganizationSwitcher>`.
  - Docs `docs/INTEGRATIONS/clerk.md` + `docs/RUNBOOKS/clerk-caido.md`.
- **Frontend admin shell con mock data (Path A — desarrollo en paralelo a creación de tablas Catalyst):**
  - HashRouter + react-router-dom 7 con rutas `/`, `/jobs`, `/jobs/:id`, `/candidates`, `/reports`, `/inbox`, `/settings`.
  - `AdminLayout` con sidebar nav + branded header con `<OrganizationSwitcher>` + `<UserButton>`.
  - Mock data layer en `shark/src/data/mock{Jobs,Applications}.ts` con tipos derivados del master plan (states del pipeline operativo, sources, scores).
  - Páginas: Dashboard (stats + cards), JobsList (tabla), JobDetail (kanban + tabla por estado), CandidatesList (cross-job).
  - Stubs para Reportes, Inbox outbound, Settings con referencias a docs del master plan.
  - CSS limpio post-CRA, design system básico (status tags, kanban, data tables, stat cards).
- **Refactor backend a estructura plana feature-first** (rectifica error en master plan inicial):
  - Backend pasa de 8 carpetas (handlers/services/integrations/db/middleware/lib/data/seeds) a 2 carpetas (`features/` + `lib/`).
  - Cada feature en 1 archivo: handler HTTP + lógica + queries DB inline. Ej: `features/tenants.ts` consolida lo que antes era `handlers/clerkWebhooks.ts` + `db/tenants.ts` + `middleware/tenant.ts` + `db/processedEvents.ts`.
  - `lib/` queda solo con infrastructure compartida (env, logger, errors, http, db, dbHelpers, auth, processedEvents, slugify, context).
  - Master plan doc 02 actualizado con la decisión + tabla "antes vs después".
  - Master plan doc 03 actualizado: 54 tablas → 25 core + 29 deferred (crear cuando la feature lo necesita). Colapsos: 7 score tables → 2, 4 outreach → 2, 3 bot → 1, 2 notif → 1.
  - Razón del cambio: contexto real es 1 humano + agentes IA (no team de ingenieros). La estructura plana optimiza para "AI puede leer/modificar feature en 1 archivo + Cris puede spot-check sin perderse entre carpetas".

### Changed
- `catalyst.json` ahora apunta a `shark/dist` (Vite build output).
- `.gitignore` actualizado para coexistencia de `functions/api/` (nuevo) y `functions/sharktalents/` (legacy).

### Deprecated
- `frontend/` — código del prototipo single-tenant. Reemplazado por `shark/`.
- `functions/sharktalents/` — backend del prototipo. Reemplazado por `functions/api/`.

### Removed
- (sin remociones aún)

### Fixed
- (sin fixes aún)

### Security
- (sin items de seguridad aún)
