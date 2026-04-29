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
