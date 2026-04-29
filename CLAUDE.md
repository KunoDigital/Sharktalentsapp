# CLAUDE.md — Instrucciones para agentes IA en SharkTalents

## Contexto del proyecto
SharkTalents — plataforma multi-tenant de evaluación de candidatos con IA, operativa end-to-end (briefing → outbound → evaluación → reporte).

**Stack:** Zoho Catalyst Advanced I/O (Node 20) + React 18 + Vite + TypeScript + Anthropic Claude Haiku 4.5 + Clerk (auth) + Zoho Recruit/Meeting/Bookings/Sign + HeyReach (LinkedIn outbound).

**Estado actual:** refactor v2 desde cero. Ver [docs/master-plan/](docs/master-plan/) — el plan manda.

## Antes de escribir código

1. **Leé** [docs/master-plan/00_INDEX.md](docs/master-plan/00_INDEX.md) y la fase específica que estés ejecutando.
2. **Leé** [docs/aprendizajes/](docs/aprendizajes/) — manual de patrones del proyecto.
3. **El plan manda.** Si la realidad del repo entra en conflicto con el master plan, alineá la realidad al plan, no al revés.
4. **NUNCA hardcodees URLs** — usar [shark/src/config.ts](shark/src/config.ts) o [functions/api/src/lib/env.ts](functions/api/src/lib/env.ts).
5. **NUNCA loguees secrets/PII** — si necesitás un secret en logs, usá fragmento (primeros 4 + últimos 4 chars).
6. **TODO query ZCQL** debe pasar por `escapeSql()` (en [functions/api/src/db/helpers.ts](functions/api/src/db/helpers.ts)).
7. **NUNCA `await fetch(...)` sin timeout.** Usar `fetchWithTimeout` o el SDK con timeout configurado.

## Convenciones de código

| Tema | Convención |
|---|---|
| Backend TS | `strict: true`, commonjs, Node 20, ES2022 target |
| Frontend TS | `strict: true`, ESM, React 18 |
| Tablas DB | `PascalCase` plural (Users, JobApplications) |
| Columnas | `snake_case` (created_at, tenant_id) |
| FKs | `<entity>_id` (job_id, candidate_id) |
| Booleans | `is_*` o `has_*` (is_active, has_signed) |
| Logs | Prefijo `[MODULE]` en mayúsculas — usar `logger('MODULE')` |
| Commits | Imperativo + por qué. Ej: "Agregar timeout a Anthropic — evita function muerta a 30s" |

## Comandos comunes

```bash
# Backend
cd functions/api && npm run build
npm run watch              # rebuild on save

# Frontend
cd shark && npm run dev    # localhost:3000
npm run build              # → shark/dist

# Deploy
./scripts/deploy-backend.sh prod
./scripts/deploy-frontend.sh

# Secrets
./scripts/generate-secret.sh
./scripts/rotate-secret.sh INTERNAL_API_KEY
```

## Archivos clave

- [functions/api/src/index.ts](functions/api/src/index.ts) — entry backend (advanced I/O handler)
- [functions/api/src/router.ts](functions/api/src/router.ts) — routing principal
- [functions/api/src/lib/env.ts](functions/api/src/lib/env.ts) — lectura/validación env vars
- [functions/api/src/lib/logger.ts](functions/api/src/lib/logger.ts) — logger con prefijos
- [functions/api/src/lib/errors.ts](functions/api/src/lib/errors.ts) — clases AppError, ValidationError, etc.
- [shark/src/main.tsx](shark/src/main.tsx) — entry frontend
- [shark/vite.config.ts](shark/vite.config.ts) — config Vite

## Prohibiciones explícitas

- ❌ `console.log(...)` sin prefijo (usá `logger('MODULE')`).
- ❌ `await fetch(...)` sin timeout.
- ❌ Hardcodear `https://*.catalystserverless.com` o cualquier URL de Catalyst.
- ❌ Agregar columnas a una tabla "god-table" — crear tabla nueva.
- ❌ `*` en CORS con credentials.
- ❌ Commit de `.env` con valores reales (solo `.env.example`).
- ❌ `--no-verify` en commits, `--force` en push (sin pedir confirmación).
- ❌ Comentarios que explican el "qué" del código (los nombres ya lo dicen).

## Cuando se acaba el contexto / sesión nueva

1. Leé [docs/master-plan/00_INDEX.md](docs/master-plan/00_INDEX.md).
2. Buscá la fase actual en [docs/master-plan/12_ROADMAP_EJECUCION.md](docs/master-plan/12_ROADMAP_EJECUCION.md).
3. Mirá los últimos commits con `git log --oneline -20` para entender dónde quedamos.
4. Si necesitás contexto del flujo operativo, [docs/master-plan/18_PIPELINE_OPERATIVO.md](docs/master-plan/18_PIPELINE_OPERATIVO.md) tiene el state machine completo.
