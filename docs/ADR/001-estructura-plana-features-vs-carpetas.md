# ADR-001 — Estructura plana feature-first en backend

**Fecha:** 2026-04-30
**Status:** Aceptado
**Decisión por:** Cris (con AI agents)

## Contexto

El plan inicial del refactor proponía estructura backend con 8 carpetas:
`handlers/`, `services/`, `integrations/`, `db/`, `middleware/`, `lib/`, `data/`, `seeds/`.

El contexto real del equipo es: **1 persona (Cris) + agentes IA** colaborando. NO un equipo
de ingenieros con división de responsabilidades.

## Decisión

Adoptar estructura plana con 2 carpetas:
- `features/` — un archivo por dominio funcional (jobs, candidates, applications, etc.)
- `lib/` — infrastructure compartida (env, logger, errors, http, db, scoring, etc.)

Cada feature en 1 archivo: handler HTTP + lógica de negocio + queries DB inline.

Ejemplo: `features/tenants.ts` consolida lo que antes era `handlers/clerkWebhooks.ts` +
`db/tenants.ts` + `middleware/tenant.ts` + `db/processedEvents.ts`.

## Consecuencias

**Positivas:**
- AI puede leer/modificar una feature completa abriendo 1 archivo (vs saltar entre 4 carpetas).
- Cris puede spot-check sin perderse entre "¿en qué archivo está la lógica de tenants?".
- Menos abstracciones falsas — los "services" del plan original eran indirección por
  indirección, no había razón real para separar handler de service en este scope.

**Negativas:**
- Archivos largos (300-500 líneas en algunos casos). Mitigación: cada feature es
  internamente cohesivo, navegable por sección.
- Si el equipo crece a 3+ ingenieros con división de feature-ownership, esta estructura
  empieza a frenar. Pero el horizonte explícito del proyecto es "Cris + AI" — no escalar
  a equipo humano.

## Alternativas consideradas

- **Mantener estructura del plan original:** descartado por el contexto real (no team).
- **Hexagonal + DDD:** descartado por overkill — tenemos ~25 tablas y CRUD básicos, no
  domain logic compleja que justifique aggregates.

## Referencias

- `docs/master-plan/02_FASE1_FUNDAMENTOS.md` (sección "Antes vs Después")
- `CHANGELOG.md` entry 2026-04-30
