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
