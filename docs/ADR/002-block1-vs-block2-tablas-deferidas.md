# ADR-002 — Block 1 vs Block 2: tablas deferidas tolerantes

**Fecha:** 2026-05-01
**Status:** Aceptado

## Contexto

Plan inicial pedía ~54 tablas en BD. Cris está en build mode sin clientes reales y
no quiere parar a crear cada tabla en Catalyst Console (UI manual, ~5 min cada una).

## Decisión

1. **Dividir en 2 bloques:**
   - **Block 1 (10 tablas core):** lo mínimo para que la app responda (`Tenants`, `Jobs`,
     `Candidates`, `Results`, `Scores`, `IntegrityDimensions`, `PipelineTransitions`,
     `AuditLog`, `OutboxEvents`, `ProcessedEvents`).
   - **Block 2 (~15 tablas deferred):** features no-blocking (`TokenUsage`, `ClientReports`,
     `ApiKeys`, `JobProfileDrafts`, `VideoQuestions`, `VideoResponses`, `BotDecisions`,
     `ReviewQueue`, `BotTrainingExamples`, `CandidatePool`, etc.).

2. **El backend debe TOLERAR la ausencia de tablas Block 2:**
   - Cada feature que use una tabla Block 2 debe verificar `tableReady` con un SELECT/LIMIT.
   - Si no existe: devolver 503 con `code: 'table_not_ready'` y mensaje claro indicando qué
     crear y dónde está el schema.
   - Funcionalidades opcionales (como cache `ClientReports`) hacen no-op silencioso.

3. **Cris puede crear las tablas Block 2 todas en una sola sesión** cuando esté lista,
   sin que el código esté escrito-pero-roto en el medio.

## Consecuencias

**Positivas:**
- Velocidad de desarrollo: implementamos features completas sin dependencia de migraciones manuales.
- Reversibilidad: si una feature deferred no se usa, no quedan tablas vacías en BD.
- Onboarding gradual: tenants básicos pueden vivir solo con Block 1; Block 2 se activa
  para features avanzadas.

**Negativas:**
- ~40% del backend escrito devuelve 503 hasta que se creen las tablas Block 2.
- Riesgo de drift entre código y schema documentado si nadie verifica regularmente.
  Mitigación: `MIGRATIONS_BLOCK2.md` siempre updated, `verifyTables` flagea missing columns
  en Block 1 al menos.

## Alternativas consideradas

- **Auto-create de tablas vía Catalyst SDK al deploy:** descartado — Catalyst SDK no expone
  DDL programático en Cloud Scale; las tablas se crean en Console manualmente.
- **Crear todas las tablas upfront:** descartado por la razón explícita de Cris ("quiero
  hacerlo todo en una sesión, no interrumpir mi flow de código").

## Referencias

- `docs/master-plan/MIGRATIONS_BLOCK1.md` y `MIGRATIONS_BLOCK2.md`
- Memoria: `project_tablas_pendientes_v2.md`, `feedback_no_parar_por_tablas.md`
