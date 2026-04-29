# 01 — Principios y alcance

## Qué es SharkTalents hoy

Plataforma **single-tenant** de evaluación de candidatos con 5 dimensiones (DISC, VELNA, técnica, emocional, integridad), 54 competencias calculadas, pipeline de decisión, y reportes al cliente generados con IA (traducidos ES/EN).

**Stack actual:**
- Backend: Catalyst Advanced I/O, TS → JS (commonjs)
- Frontend: React 18 + Vite + TS, servido por Client Hosting
- Auth: custom (SHA256 + JWT HS256 + admin único)
- IA: Claude Haiku 4.5 vía `@anthropic-ai/sdk`
- DB: Catalyst Datastore (ZCQL) — 8 tablas
- Archivos: Catalyst File Store para reportes grandes + transcripciones

## Qué es SharkTalents post-refactor

Plataforma **multi-tenant operativa end-to-end** (SaaS):
- Múltiples empresas/agencias usan la misma instancia con data aislada.
- Auth delegado a Clerk (users, orgs, MFA, SSO, invitations).
- Cada tenant tiene API keys para integrar con sus herramientas.
- Claude se conecta vía MCP para consultas en lenguaje natural.
- API pública documentada con OpenAPI.
- **Plan B operativo**: SharkTalents es la fuente de verdad del pipeline (no Recruit). Recruit queda como CRM back-office para Cris.
- **Portal cliente self-serve**: onboarding por Bookings + Zia, briefing transcrito, tracking estilo Uber Eats con 4 milestones.
- **Bot decisor**: cambia etapas automáticamente con confidence threshold; Cris decide solo top 3 finalistas.
- **Outbound LinkedIn**: HeyReach + pool interno propio.

**Tamaño:**
- 66 archivos de código (~15k LOC aprox)
- 9 rutas de admin + 2 rutas públicas + 3 páginas candidate + 1 página public report
- 27 endpoints HTTP
- 7 JSON seeds de preguntas (DISC, VELNA basic/mid/senior, integridad v1/v2, emocional)
- 54 competencias
- 27 perfiles PK

---

## Qué SÍ refactorizamos

### Arquitectura
- **Multi-tenancy**: agregar `tenant_id` en todas las tablas del dominio → [13](13_MULTITENANT.md)
- **Clerk integration**: reemplazar auth custom con Clerk (orgs = tenants) → [14](14_CLERK_AUTH.md)
- **API pública v1**: namespace `/api/v1/*` separado de admin → [15](15_API_PUBLICA.md)
- **MCP Server**: npm package `@sharktalents/mcp-server` → [16](16_MCP_SERVER.md)
- **Pipeline operativo**: state machine en SharkTalents con sync unidireccional a Recruit → [18](18_PIPELINE_OPERATIVO.md)
- **Outbox pattern** end-to-end para webhooks salientes Zoho + HeyReach + notificaciones cliente

### Backend
- Eliminar los N+1 queries (≈60% de los endpoints admin los tienen)
- Normalizar schema de DB: sacar el `score` JSON blob, convertir `pipeline_stage` en state machine, separar `ScreenExits` a tabla append-only
- Integrar prompt caching en Anthropic SDK
- Agregar timeouts, retry, circuit breaker en todas las integraciones externas
- Outbox pattern para operaciones que hoy son "fire-and-forget"
- Idempotencia en `/submit`, `/generate-explanations`, `/publish`
- Rate limiting en endpoints públicos **y por API key**
- Sanitización de `tech_prompt` antes de pasar a Anthropic
- Token tracking real (hoy es `console.log`) — **por tenant** para billing futuro

### Frontend
- Centralizar TODAS las URLs en env vars (hoy se arman con `window.location.origin`)
- **Reemplazar login custom con `@clerk/clerk-react`** (`<ClerkProvider>`, `<SignedIn>`, etc.)
- **`<OrganizationSwitcher>`** en sidebar (cambiar de tenant)
- **Página `/admin/api-keys`** para que el tenant gestione sus API keys
- **Página `/docs`** con Scalar UI (spec OpenAPI)
- **Portal cliente** (`/portal/*`) con onboarding self-serve y tracking funnel ([17](17_PORTAL_CLIENTE.md))
- **Página pública `/apply/<tenant>/<job-slug>`** para aplicación de candidatos ([18](18_PIPELINE_OPERATIVO.md))
- **Componente VideoRecorder** con MediaRecorder + audio fallback ([20](20_VIDEOS_DINAMICOS.md))
- **Inbox unificada outbound** para respuestas HeyReach + LinkedIn ([22](22_OUTBOUND_SOURCING.md))
- **Review queue** del bot decisor cuando confidence < threshold ([21](21_BOT_DECISOR.md))
- Error boundaries
- Versioning visible en UI
- Verificar uso consistente de `API_BASE`
- Mejorar rollback de optimistic updates en pipeline

### Infra
- `/health` endpoint
- Audit log
- Correlation IDs en logs
- Runbooks para los 5 incidents más probables
- ADRs para las decisiones arquitectónicas
- Scripts de deploy automatizados

### DX
- `.env.example` documentado
- Scripts en `scripts/` (generate-secret, deploy-frontend, etc.)
- CLAUDE.md actualizado con la nueva arquitectura
- Tests de smoke manuales en un runbook

---

## Qué NO refactorizamos (explícito)

Para controlar alcance:

1. **Las 5 dimensiones de evaluación.** DISC, VELNA, integridad, emoción, técnica se mantienen conceptualmente idénticas.
2. **El cálculo de las 54 competencias.** Ver [LOGICA_COMPETENCIAS.md](../evaluaciones/LOGICA_COMPETENCIAS.md). Se mantiene tal cual — solo se optimiza dónde/cuándo se calcula.
3. **Los 27 perfiles PK.** Tabla hardcoded en [pkProfiles.ts](../../shark/src/data/pkProfiles.ts) — se mantiene.
4. **El diseño visual de los reportes públicos.** Todo el styling de [ClientReport.tsx](../../shark/src/pages/public/ClientReport.tsx) — no tocamos nada visual (pero agregamos branding por tenant opcional).
5. **El modelo Claude.** Haiku 4.5 (`claude-haiku-4-5-20251001`). La ruta para subir a versiones futuras se documenta pero no se ejecuta.
6. **La estructura de Client Hosting.** `/app/` con HashRouter — se mantiene.
7. **Migración a Slate o AppSail.** Nos quedamos en Cloud Scale — ver ADR-001 abajo.
8. **Features funcionales nuevas.** Todo lo de [MEJORAS_PENDIENTES.md](../pendientes/MEJORAS_PENDIENTES.md) se pospone al post-refactor.
9. **Cross-tenant candidate sharing.** MVP: candidatos son por tenant (Opción A en [13](13_MULTITENANT.md)). Compartir entre tenants queda para v2.
10. **Webhooks salientes.** El schema se diseña pero no se implementa worker en v1 ([15](15_API_PUBLICA.md#6-webhooks-salientes-feature-futura)).
11. **SDK multi-lenguaje.** Generamos el spec OpenAPI, pero no publicamos SDKs (Node, Python) — se hace cuando haya tracción.
12. **Modo hosted del MCP Server.** MVP: solo stdio local (`npx`). HTTP/SSE hosted en futuro.
13. **Generación automatizada de contratos Sign más allá de templates simples.** Solo merge de campos básicos. Lógica condicional compleja queda fuera ([23](23_INTEGRACIONES_ZOHO.md)).
14. **Email outbound + cold call.** Outbound v1 = solo LinkedIn vía HeyReach + pool interno ([22](22_OUTBOUND_SOURCING.md)).
15. **Bot decisor en modo "Hot" desde día 1.** Rollout obligatorio Cold→Warm→Hot. Hot solo después de 2-3 puestos cerrados con feedback ([21](21_BOT_DECISOR.md)).

---

## ADR-001: Seguir con Cloud Scale

### Contexto
SharkTalents hoy corre en Catalyst Cloud Scale. Alternativa considerada: Slate.

### Decisión
**Nos quedamos en Cloud Scale.**

### Razones
1. Tenemos 1 Advanced I/O function ya deployado y funcionando.
2. Cloud Scale tiene **logs runtime nativos**, Slate no (requeriría Datadog/Logflare = costo extra).
3. Los flujos async (timeout de tests, cron futuro para outbox) necesitan Cron Functions que Slate no tiene nativamente.
4. Migrar a Slate implicaría reescribir 30+ endpoints con otro framework (Next.js/Astro).
5. No hay beneficio concreto para nuestro caso — Slate brilla para apps nuevas fullstack SPA-only.

### Consecuencias
- Mantenemos deploy semi-manual (via `catalyst deploy` CLI o DevOps GitHub Integration).
- No tenemos `git push = deploy` automático. Se mitiga con script `scripts/deploy-backend.sh`.
- CI/CD más simple que una migración.

---

## ADR-002: Mantener HashRouter en frontend

### Contexto
El frontend usa HashRouter (`#/admin/jobs/123`). Alternativa: BrowserRouter (`/admin/jobs/123`).

### Decisión
**Mantener HashRouter.**

### Razones
1. Client Hosting de Catalyst sirve archivos estáticos sin fallback routing — BrowserRouter requiere que todas las URLs redirijan a `index.html`, lo cual Catalyst **no soporta** sin función proxy.
2. HashRouter funciona perfectamente con hosting estático.
3. Los links públicos (reportes, test tokens) ya están acomodados con `#` y funcionan.
4. Migrar a BrowserRouter implicaría agregar un proxy function que intercepte rutas no-file y devuelva `index.html`. Complejidad innecesaria.

### Consecuencias
- URLs con `#` en la barra. No es SEO friendly pero tampoco es app SEO-dependent (es un SaaS B2B).
- Los links de reporte público siguen funcionando con `#/report/...`.

---

## ADR-003: TypeScript estricto en backend

### Contexto
Hoy [functions/sharktalents/tsconfig.json](../../functions/sharktalents/tsconfig.json) tiene `"strict": false`. El código usa mucho `any` y tipos implícitos.

### Decisión
**Migrar gradualmente a `"strict": true`** durante el refactor. Empezar con nuevos módulos y convertir los existentes conforme se tocan.

### Razones
1. Type safety atrapa bugs de integración (especialmente en el boundary con Anthropic SDK).
2. Refactorizar con tipos es más seguro que sin ellos.
3. El frontend ya es `strict: true` — consistencia.

### Consecuencias
- Esfuerzo extra por archivo migrado (~15 min).
- Más confianza al deployar.

---

## ADR-005: Clerk para auth y organizations

### Contexto
El refactor a multi-tenant necesita: users, roles, orgs, invitations, password reset, email verification. Implementar todo custom tiene costo alto y superficie de bugs.

### Decisión
**Usamos [Clerk](https://clerk.com/) como proveedor de auth + organizations.**

### Razones
1. **Free tier amplio:** 10k MAU gratis. Enough para los primeros ~50 tenants.
2. **Organizations built-in:** mapean 1:1 a nuestro concepto de tenant. Cero código para users/org-memberships.
3. **MFA, SSO, magic links, passkeys:** todo incluido, sin agregar código.
4. **Webhooks estandarizados:** `organization.created` → nosotros creamos Tenant en DB.
5. **React SDK maduro:** `@clerk/clerk-react` con componentes prebuilt.
6. **Backend SDK para verify JWT:** trivial.
7. **Migración-out posible:** API de export de users. No estamos locked-in (aunque sería trabajo).

### Consecuencias
- Dependencia externa nueva — agregar en `docs/INTEGRATIONS/clerk.md`.
- Runbook para caídas de Clerk (rareza — SLA 99.99%).
- Paymasters: desde plan Pro ($25/mes) el costo crece con MAU. Evaluar cuando tengamos tracción.

---

## ADR-006: API pública con OpenAPI + API keys por tenant

### Contexto
Queremos permitir que clientes integren SharkTalents con sus ATS/CRMs. Necesitamos auth por integración (no reusar JWT de usuario).

### Decisión
**API pública en `/api/v1/*` con autenticación por API key (token prefix `st_`).** Las keys se generan por tenant desde el panel admin. Spec en OpenAPI 3.1, docs servidas via `/docs` con Scalar.

### Razones
1. **API key es estándar** para integraciones server-to-server.
2. **Separación clara** entre API admin (/admin, JWT) y API pública (/v1, key).
3. **OpenAPI spec** habilita generación de SDKs a futuro + Swagger UI automática.
4. **Scope granular** por permissions (`read:jobs`, `write:candidates`, etc.).

### Consecuencias
- Superficie de API pública = más cuidado con rate limits, input validation, etc.
- Mantener el spec sincronizado con el código — agregar CI check que valide.

---

## ADR-008: SharkTalents como fuente de verdad del pipeline operativo

### Contexto
Antes del Plan B, Recruit era el hub de candidatos y SharkTalents solo evaluaba. El pipeline (cambios de etapa, notificaciones, automatizaciones) vivía en Recruit. Con la expansión operativa, queremos que SharkTalents absorba todo el flujo end-to-end y deje de depender del flujo manual de Cris en Recruit.

### Decisión
**SharkTalents es la fuente de verdad del pipeline operativo.** Recruit queda como CRM back-office (catálogo histórico + ejecutor de notificaciones automatizadas que ya están configuradas). Sync unidireccional SharkTalents → Recruit con outbox + queue.

### Razones
1. Eliminamos doble manejo de estado (Recruit + SharkTalents).
2. Bot decisor necesita autoridad sobre el pipeline para cambiar etapas; si Recruit también las cambia tenemos eco.
3. Notificaciones a candidatos siguen viviendo en Recruit (templates ya existen, no las migramos).
4. Permite seguir usando Recruit como vista CRM cómoda sin que sea fuente de verdad.

### Consecuencias
- Webhooks Recruit → SharkTalents solo para creación inicial (job board público gratis).
- Sync queue + dead letter cuando Recruit API falla.
- Si Recruit se cae, pipeline sigue funcionando; solo se atrasan notificaciones.

---

## ADR-009: Bot decisor con cold-start gradual rollout

### Contexto
Queremos un agente IA que tome decisiones de avance en el pipeline (no que solo recomiende). Pero no tenemos training data; arrancamos en frío.

### Decisión
**Rollout gradual Cold → Warm → Hot** con confidence threshold configurable por etapa. Few-shot + RAG con casos similares pasados (no fine-tuning porque Anthropic no lo expone). Cris siempre decide top 3 finalistas; cada override de Cris genera un training example.

### Razones
1. Sin data inicial, decisiones automáticas son riesgosas → Cold mode bot solo recomienda.
2. A medida que Cris confirma/corrige, RAG se enriquece → Warm: bot decide etapas tempranas, escala las complejas.
3. Hot: bot decide hasta finalistas, Cris solo confirma top 3.
4. Override + razón = training example automático.

### Consecuencias
- Necesitamos `BotDecisions` y `BotTrainingExamples` desde día 1.
- UI review queue para casos `confidence < threshold`.
- Ver [21](21_BOT_DECISOR.md).

---

## ADR-010: HeyReach como outbound LinkedIn (no Apollo, no Lusha)

### Contexto
Cris necesita complementar el inbound con outbound activo en LinkedIn (mercado Panamá es LinkedIn-strong, email outbound rinde menos). Evaluamos Apollo, Lusha, HeyReach, scraping custom.

### Decisión
**HeyReach** como herramienta principal de outbound LinkedIn.

### Razones
1. **API estable** → integramos a SharkTalents.
2. **LinkedIn-first** (Apollo y Lusha son email-first, dan datos pero no orquestan secuencias LinkedIn).
3. **Multi-LinkedIn account safety** — usamos cuenta dedicada, no la personal de Cris.
4. **Volumen 30-75 invites/mes** entra cómodo en límites safe de LinkedIn.
5. **$79/mo** vs Apollo/Lusha que cobran por contact lookup → predecible.

### Consecuencias
- Necesitamos cuenta LinkedIn dedicada (no la de Cris).
- Riesgo de baneo LinkedIn — mitigado con throttling + warmup.
- Pool interno propio en `CandidatePool` reduce dependencia.
- Ver [22](22_OUTBOUND_SOURCING.md).

---

## ADR-011: Videos dinámicos reemplazan entrevista intermedia (no la final)

### Contexto
Antes Cris hacía entrevista 1:1 con todo candidato avanzado (8-10 por puesto). No escala. Pero entrevista total automatizada pierde lectura humana del finalista.

### Decisión
**7 videos dinámicos generados por candidato** según resultados de evaluaciones previas reemplazan la entrevista intermedia. Cris solo entrevista 1:1 a los 3 finalistas.

### Razones
1. Genera 35x más data para evaluación (7 respuestas en video vs 1 conversación).
2. Whisper transcribe → IA puede analizar contenido + tono.
3. Cris ahorra ~6h/puesto.
4. Finalistas merecen contacto humano — entrevista final se mantiene.

### Consecuencias
- Necesitamos `VideoQuestions`, `VideoResponses`, generador IA.
- Política de retención obligatoria por GDPR.
- Fallback audio-only y texto.
- Ver [20](20_VIDEOS_DINAMICOS.md).

---

## ADR-007: MCP Server como package npm standalone

### Contexto
Queremos que Claude pueda conectarse directo a SharkTalents. El protocolo MCP es el estándar para esto.

### Decisión
**MCP Server es un package npm separado (`@sharktalents/mcp-server`)** que el usuario corre localmente (vía `npx` o config de Claude Desktop). Consume la API pública v1.

### Razones
1. **Estándar MCP:** Claude Desktop soporta stdio; HTTP es menos maduro.
2. **Desacoplado:** versionamos el MCP separado del backend. El spec OpenAPI v1 es la contract.
3. **Instalación trivial:** `npx @sharktalents/mcp-server` o config JSON.
4. **No suma dependencias al backend:** el MCP server no vive en Catalyst.

### Consecuencias
- Otro release pipeline (npm) además de Catalyst.
- Alternativa considerada: MCP hosted HTTP (futuro, cuando SSE sea mainstream).

---

## ADR-004: Sin tests automatizados en esta fase

### Contexto
El proyecto no tiene tests. Agregar tests durante el refactor sería ideal pero triplicaría el tiempo.

### Decisión
**No agregar tests automatizados en este refactor.** Dejar `docs/RUNBOOKS/smoke-tests.md` con tests manuales.

### Razones
1. Tests sin diseño claro son contraproducentes (generan mantenimiento sin valor).
2. Priorizar first: refactor estructural que habilita testeo después.
3. Post-refactor, dedicar una fase a tests.

### Consecuencias
- Dependemos de smoke tests manuales y QA durante el refactor.
- Mayor riesgo de regresiones. Mitigación: cada fase deja la app funcional y deployable, con checkpoint de smoke tests.

---

## Principios de ejecución

### 1. Cada fase deja la app deployable
No hacemos un refactor de 3 meses en una branch. Cada fase (1 a 8) es mergeable a `main` y deployable a prod.

### 2. Backward compatibility durante la migración
El schema viejo y el nuevo conviven mientras migramos. Endpoints viejos siguen funcionando hasta que el endpoint nuevo está listo + probado.

### 3. Feature flags para cambios arriesgados
Activar el nuevo prompt caching, circuit breaker, etc., con env vars (`ANTHROPIC_CACHING_ENABLED=true`). Se puede desactivar sin deploy.

### 4. Observabilidad antes de cambios grandes
[Fase 6 — Observability](07_FASE6_OBSERVABILITY.md) **debe estar lista** antes de las fases más arriesgadas (Anthropic, migración de datos). Si algo rompe, hay que poder debuggearlo.

### 5. Un cambio a la vez
No combinamos "refactor de DB" con "cambio de modelo de Claude" en el mismo PR. Un PR = un tipo de cambio.

### 6. YAGNI estricto
Si surge la tentación de "ya que estoy refactorizando este archivo, agrego esta feature chica…" — **NO**. Se anota en backlog y se hace post-refactor.

---

## Fuera de alcance (features que NO agregamos)

De [MEJORAS_PENDIENTES.md](../pendientes/MEJORAS_PENDIENTES.md):

1. DISC v2 (9 preguntas a corregir)
2. Normalización DISC más sofisticada
3. Upload de CV PDF al reporte
4. Preguntas sugeridas de entrevista en el reporte al cliente
5. Bonus de ganancia en VELNA numérica
6. Descarga Excel de candidatos (parcialmente existe — se deja)
7. Competencias visibles en reporte al cliente

Todas se retoman post-refactor como features nuevas.

---

## Criterios de "done" por fase

Antes de dar por cerrada cualquier fase:

- [ ] Todos los endpoints de la fase pasan smoke tests manuales.
- [ ] Logs nuevos tienen prefijos consistentes.
- [ ] Env vars nuevas están en `.env.example` y documentadas.
- [ ] CLAUDE.md actualizado si cambian convenciones.
- [ ] ADR escrito si hay decisión arquitectónica.
- [ ] Runbook actualizado si hay modo de falla nuevo.
- [ ] Checklist de [11](11_CHECKLIST_PROD.md) aplicable cumplido.
- [ ] Deploy a dev exitoso + 30 min sin incidents.

---

## Siguiente paso

→ [02_FASE1_FUNDAMENTOS.md](02_FASE1_FUNDAMENTOS.md) — configurar env vars, estructura de carpetas, y scripts base.
