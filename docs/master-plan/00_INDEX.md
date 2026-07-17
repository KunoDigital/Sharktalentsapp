# Master Plan de Refactorización — SharkTalents

Plan integral para llevar SharkTalents de "prototipo single-tenant funcional" a **"plataforma multi-tenant con API pública + MCP server para LLMs"**, siguiendo el manual en [docs/aprendizajes/](../aprendizajes/).

**Stack final:** Zoho Catalyst Advanced I/O (Node 20) + React 18 + Vite + **Clerk** (auth + orgs) + Anthropic SDK con prompt caching + **MCP Server** para Claude + integración nativa Zoho (Recruit/Meeting/Zia/Bookings/Sign) + **HeyReach** para outbound LinkedIn.

**4 pilares de plataforma** (refactor original):
1. **Multi-tenancy** — múltiples empresas clientes con data aislada ([13](13_MULTITENANT.md))
2. **Clerk** — auth, users, organizations, SSO, MFA built-in ([14](14_CLERK_AUTH.md))
3. **API pública documentada** — OpenAPI + API keys por tenant + `/docs` ([15](15_API_PUBLICA.md))
4. **MCP Server** — Claude se conecta directo para queries en lenguaje natural ([16](16_MCP_SERVER.md))

**7 pilares operativos** (Plan B — SharkTalents absorbe la operación end-to-end):
5. **Portal cliente** — onboarding self-serve, briefing transcrito, tracking estilo Uber Eats ([17](17_PORTAL_CLIENTE.md))
6. **Pipeline operativo** — SharkTalents es fuente de verdad; Recruit queda como CRM back-office ([18](18_PIPELINE_OPERATIVO.md))
7. **Prueba técnica de doble eje** — knowledge + situational con axis autonomy_vs_consult ([19](19_PRUEBA_TECNICA_DOBLE_EJE.md))
8. **Videos dinámicos** — 7 preguntas generadas por candidato; reemplazan entrevista intermedia ([20](20_VIDEOS_DINAMICOS.md))
9. **Bot decisor** — cold→warm→hot rollout con few-shot+RAG; agente cambia de etapa, Cris supervisa finalistas ([21](21_BOT_DECISOR.md))
10. **Outbound sourcing** — pool interno + HeyReach para LinkedIn (mercado Panamá) ([22](22_OUTBOUND_SOURCING.md))
11. **Integraciones Zoho** — Recruit/Meeting/Zia/Bookings/Sign en un solo doc cross-funcional ([23](23_INTEGRACIONES_ZOHO.md))

**Mejoras adicionales (sesión 2026-05-05/06):**
12. **Test de inglés (opcional por puesto)** — multiple-choice + listening + writing IA-evaluado + speaking video, 4 niveles CEFR ([25](25_TEST_INGLES.md))
13. **Test de Mentalidades** — Adaptabilidad y Resiliencia basado en marco McKinsey Forward (entre DISC y VELNA, sin alertar al candidato) ([26](26_TEST_MENTALIDADES.md))
14. **ZeptoMail (Zoho transactional email)** — reemplazo de Postmark/SendGrid en el roadmap. Incluido en Zoho One de Cris, costo $0 adicional. Wire-up backend listo en `lib/zeptomailClient.ts` + `outbox.ts`. Pendiente verificar dominio + activar Mail Agent (Cris, ver [PUNCH_LIST.md](../PUNCH_LIST.md))

**CORE BUSINESS LOGIC del pipeline (sesión 2026-06-12/16):**
15. **Reglas del pipeline candidato** — Las 6 fases (Prefiltro/Técnica con bloque continuo Tec+Inglés+Mindset/Conductual/Integridad/Video/Finalistas), sub-estados, qué dispara auto-rechazo vs Duda CV, regla de naming Integridad backend↔frontend, modelo análisis IA contextual (Capa 4), velna_per_dimension por puesto. Fuente de verdad para todo el flujo del candidato. ([27](27_REGLAS_PIPELINE_CANDIDATO.md))

**Estimación total:** 24–28 semanas calendario para una persona (vs 14-18 del refactor base). Se puede ir deployando por fase — cada una deja la app funcional.

---

## Por qué este refactor

Hay dos motivaciones complementarias:

### 1. Deuda técnica del prototipo
Auditamos el código contra los 15 documentos de [aprendizajes/](../aprendizajes/) y encontramos 30+ anti-patterns críticos. Los más graves:

| # | Problema | Impacto | Doc ref |
|---|---|---|---|
| 1 | **N+1 queries** en casi todos los admin endpoints | Factura Catalyst 3–5× más alta, latencia alta | [07](../aprendizajes/07_PERFORMANCE_COSTOS.md), [12#7](../aprendizajes/12_ANTIPATTERNS.md) |
| 2 | **Sin timeout en llamadas Anthropic** | Function muere a los 30s si la API cuelga | [05](../aprendizajes/05_RELIABILITY.md), [12#17](../aprendizajes/12_ANTIPATTERNS.md) |
| 3 | **Sin retry / circuit breaker** | Fallos transitorios tumban flows | [05](../aprendizajes/05_RELIABILITY.md) |
| 4 | **Score guardado como JSON blob** en `Results.score` | Imposible queryear, auditoría dolorosa | [03](../aprendizajes/03_DATABASE_DESIGN.md), [12#14](../aprendizajes/12_ANTIPATTERNS.md) |
| 5 | **`pipeline_stage` como string libre** sin state machine | Estados inconsistentes posibles | [09](../aprendizajes/09_ESTADO_Y_FLUJOS.md) |
| 6 | **Sin idempotencia** en `/test/:token/submit` | Doble submit crea 2 results | [05](../aprendizajes/05_RELIABILITY.md) |
| 7 | **`tokenTracker.ts` solo hace `console.log`** | Costos reales invisibles | [07](../aprendizajes/07_PERFORMANCE_COSTOS.md) |
| 8 | **Sin `/health`** endpoint | Monitoreo externo imposible | [06](../aprendizajes/06_OBSERVABILITY.md) |
| 9 | **Sin prompt caching** en Anthropic | ~90% de tokens desperdiciados en prompts repetidos | [06_FASE5](06_FASE5_ANTHROPIC.md) |
| 10 | **URLs hardcoded** (`window.location.origin`, `/app/index.html`) | Imposible deployar a otro dominio | [12#10](../aprendizajes/12_ANTIPATTERNS.md) |
| 11 | **Seeds JSON leídos de disco en cada invocación** | Fetch innecesario ×N requests | [07](../aprendizajes/07_PERFORMANCE_COSTOS.md) |
| 12 | **Prompt injection posible** en `tech_prompt` concatenado directo | Riesgo de seguridad medio | [04](../aprendizajes/04_SEGURIDAD.md) |

### 2. Transición a plataforma multi-tenant

El prototipo actual es single-tenant (un admin único, Kuno). Para escalar a más clientes:
- **Necesitamos separación de data** entre tenants → [13_MULTITENANT.md](13_MULTITENANT.md)
- **Login robusto** con invitations, SSO, MFA → [14_CLERK_AUTH.md](14_CLERK_AUTH.md) (delegamos a Clerk)
- **API pública** para que clientes integren con sus ATS/CRMs → [15_API_PUBLICA.md](15_API_PUBLICA.md)
- **Conexión nativa con Claude** (diferenciador fuerte del producto) → [16_MCP_SERVER.md](16_MCP_SERVER.md)

---

## Mapa de documentos

### Refactor base (12 docs)

| # | Documento | Cuándo leerlo | Tiempo lectura |
|---|---|---|---|
| 01 | [Principios y alcance](01_PRINCIPIOS_Y_ALCANCE.md) | Antes de arrancar | 10 min |
| 02 | [Fase 1 — Fundamentos](02_FASE1_FUNDAMENTOS.md) | Primera fase de ejecución | 15 min |
| 03 | [Fase 2 — Base de datos](03_FASE2_BASE_DATOS.md) | Antes de rediseñar el schema | 25 min |
| 04 | [Fase 3 — Seguridad](04_FASE3_SEGURIDAD.md) | En paralelo a Fase 4 | 20 min |
| 05 | [Fase 4 — Backend](05_FASE4_BACKEND.md) | Después de Fase 2 | 25 min |
| 06 | [Fase 5 — Anthropic](06_FASE5_ANTHROPIC.md) | Después de Fase 4 | 20 min |
| 07 | [Fase 6 — Observability](07_FASE6_OBSERVABILITY.md) | Pre-producción | 15 min |
| 08 | [Fase 7 — Frontend](08_FASE7_FRONTEND.md) | Puede ir en paralelo | 20 min |
| 09 | [Fase 8 — CI/CD y Deploy](09_FASE8_CICD_DEPLOY.md) | Antes del primer deploy refactorizado | 15 min |
| 10 | [Migración de datos](10_MIGRACION_DATOS.md) | Justo antes de cut-over | 20 min |
| 11 | [Checklist producción](11_CHECKLIST_PROD.md) | Antes de cada release | 10 min |
| 12 | [Roadmap de ejecución](12_ROADMAP_EJECUCION.md) | Para planificar el cronograma | 15 min |

### Pilares de plataforma (4 docs)

| # | Documento | Cuándo leerlo | Tiempo lectura |
|---|---|---|---|
| 13 | [Multitenancy](13_MULTITENANT.md) | Antes de rediseñar DB — cambia TODO el schema | 25 min |
| 14 | [Clerk Auth](14_CLERK_AUTH.md) | Junto con multitenancy — Clerk provee las orgs | 20 min |
| 15 | [API pública](15_API_PUBLICA.md) | Después de refactor core completo | 25 min |
| 16 | [MCP Server](16_MCP_SERVER.md) | Después de API pública (la reutiliza) | 25 min |

### Pilares operativos — Plan B (7 docs)

| # | Documento | Cuándo leerlo | Tiempo lectura |
|---|---|---|---|
| 17 | [Portal cliente](17_PORTAL_CLIENTE.md) | Después de multitenant — el portal es por org | 25 min |
| 18 | [Pipeline operativo](18_PIPELINE_OPERATIVO.md) | Antes de tocar `JobApplications` — define el state machine | 30 min |
| 19 | [Prueba técnica doble eje](19_PRUEBA_TECNICA_DOBLE_EJE.md) | Después de pipeline operativo | 20 min |
| 20 | [Videos dinámicos](20_VIDEOS_DINAMICOS.md) | Después de prueba técnica doble eje | 25 min |
| 21 | [Bot decisor](21_BOT_DECISOR.md) | Después de tener data de 2-3 puestos cerrados | 25 min |
| 22 | [Outbound sourcing](22_OUTBOUND_SOURCING.md) | Cuando inbound no alcanza — Q3+ | 25 min |
| 22b | [Embudo headhunting Fase 2](22b_EMBUDO_HEADHUNTING_FASE2.md) | Decisión 2026-05-13: persona dedicada antes de automatizar video | 15 min |
| 23 | [Integraciones Zoho](23_INTEGRACIONES_ZOHO.md) | Antes de tocar cualquier webhook Zoho | 25 min |

**Tiempo total de lectura:** ~9 horas.

---

## Cómo leer y ejecutar

### Si sos Daisy (owner del proyecto)

1. Leé primero [01](01_PRINCIPIOS_Y_ALCANCE.md) y [12](12_ROADMAP_EJECUCION.md) para tener el panorama.
2. Aprobá o ajustá el alcance antes de invertir tiempo.
3. Usá [12](12_ROADMAP_EJECUCION.md) como cronograma.

### Si sos un agente IA ejecutando

1. Leé [00](00_INDEX.md) + [01](01_PRINCIPIOS_Y_ALCANCE.md) para contexto.
2. Ubicá la fase actual en [12](12_ROADMAP_EJECUCION.md).
3. Leé el doc de esa fase específica.
4. Consultá [docs/aprendizajes/](../aprendizajes/) para los detalles teóricos.
5. Usá [11](11_CHECKLIST_PROD.md) antes de cada milestone.

---

## Principios guía

Todos tomados del manual de [aprendizajes/](../aprendizajes/), aplicados al caso SharkTalents:

1. **Boring technology wins.** Catalyst + Node + React. No SSR, no websockets, no orquestadores.
2. **Idempotencia desde día 1.** Cada endpoint que modifica estado debe ser safe to retry.
3. **Observability no es opcional.** Logs con prefijos + health + audit log. Sin eso no hay refactor.
4. **Seguridad desde la primera línea.** HMAC, rate limit, input validation, escape SQL.
5. **Documentá mientras construís.** ADRs, runbooks, docs de integraciones en `docs/`.
6. **YAGNI.** No agregamos features nuevas durante el refactor. Ni una.
7. **Backward compatibility durante la migración.** El sistema debe seguir funcionando mientras refactorizamos.

---

## Qué NO está en este plan

Cosas que son deseables pero quedan fuera de este refactor inicial para no explotar el alcance:

- **Tests automatizados.** Se mencionan en checklist pero no se agregan masivamente. Dedicar una fase aparte después.
- **Internacionalización completa.** El reporte al cliente ya tiene ES/EN; no extendemos al panel admin.
- **Microservicios / split de funciones.** Mantenemos 1 Advanced I/O. Agregar funciones solo si hay una razón (cron).
- **Migración a Slate.** Nos quedamos en Cloud Scale (ver [ADR-001](01_PRINCIPIOS_Y_ALCANCE.md#adr-001)).
- **Cambiar modelo de Claude.** Seguimos con Haiku 4.5. Migración a versiones futuras se documenta pero no se ejecuta.
- **Features nuevas** (descarga Excel de candidatos, CV upload, preguntas sugeridas en reporte) — todas las de [MEJORAS_PENDIENTES.md](../pendientes/MEJORAS_PENDIENTES.md) se difieren al post-refactor.

---

## Métricas de éxito

Al final del refactor, debemos poder afirmar:

### Refactor base
- [ ] **0 N+1 queries** en endpoints admin (medible: queries por request < 5 para lista de 100 items).
- [ ] **Factura Catalyst < $15/mes** en operación normal (actualmente proyectada en $25–40).
- [ ] **0 timeouts en Anthropic** por mes (con timeout + retry + circuit breaker).
- [ ] **Prompt caching activo** con hit rate > 60% en prompts repetidos.
- [ ] **`/health` endpoint** pingeable cada 5 min por monitoring externo.
- [ ] **Audit log completo** de toda operación admin (crear/editar/publicar).
- [ ] **DB normalizada**: todo score queryeable sin parsear JSON.
- [ ] **State machine explícita** para pipeline (imposible estado inconsistente).
- [ ] **Todos los secrets en env vars**, rotables sin redeploy de consumers.
- [ ] **Todas las URLs configurables** vía env vars (nada hardcoded).
- [ ] **Pre/post deploy checklists** ejecutados en cada release.

### Plataforma multi-tenant
- [ ] **N tenants funcionando con data aislada** verificada con tests cross-tenant (user de A no ve data de B).
- [ ] **Clerk activo** con users, orgs, MFA, SSO funcional.
- [ ] **Token Usage tracked per tenant** para billing futuro.
- [ ] **API pública v1** con 10+ endpoints documentados en OpenAPI.
- [ ] **`/docs` con Swagger UI** o Scalar accesible públicamente.
- [ ] **API keys gestionables** desde panel admin del tenant.
- [ ] **Rate limiting por API key** activo.
- [ ] **MCP Server publicado** (npm o git) con 15+ tools.
- [ ] **Claude Desktop conecta OK** al MCP server usando la API key del tenant.
- [ ] **Todos los reportes públicos** requieren `?token=<access_token>` con HMAC validado.

### Pilares operativos (Plan B)
- [ ] **Portal cliente live** — onboarding self-serve, briefing con transcripción Zia/Whisper, tracking refresh-aware.
- [ ] **4 milestone notifications** (email + WhatsApp) disparándose: profile_ready, search_started, funnel_active, finalists_ready.
- [ ] **Pipeline operativo** dueño en SharkTalents con state machine completa de 25+ estados; sync unidireccional a Recruit funcionando.
- [ ] **Prueba técnica doble eje** activa con scoring separado knowledge vs situational + axis autonomy_vs_consult.
- [ ] **Boss profile capture** en onboarding y match candidato↔jefe calculado.
- [ ] **7 videos dinámicos** generados por candidato según resultados previos; transcripción Whisper; 2 attempts; retención 30 días post-cierre.
- [ ] **Bot decisor** en estado warm o hot, con override + feedback loop registrando training examples.
- [ ] **Pool interno de candidatos** con ≥150 perfiles indexados y algoritmo de matching activo.
- [ ] **HeyReach integrado** con cuenta LinkedIn dedicada, volumen ≤75 invites/mes, inbox unificada de respuestas.
- [ ] **Integraciones Zoho** (Recruit/Meeting/Zia/Bookings/Sign) con health endpoint reportando ok.
- [ ] **Whisper fallback** activo para meetings de Bookings sin transcripción Zia.

---

## Siguiente paso

→ Leer [01_PRINCIPIOS_Y_ALCANCE.md](01_PRINCIPIOS_Y_ALCANCE.md) para confirmar scope.

---

## Estado real (2026-05-08)

**v2 deployado en Catalyst Development.** Backend operacional + frontend wireado + Clerk auth + Anthropic conectado + ZeptoMail listo para enviar.

Para detalles del estado actual ver:
- **Resumen ejecutivo:** `README.md` raíz, sección "Estado actual"
- **Snapshot completo:** [12_ROADMAP_EJECUCION.md](12_ROADMAP_EJECUCION.md) sección "Snapshot estado real"
- **Punch list de Cris** (lo pendiente del lado humano): [../PUNCH_LIST.md](../PUNCH_LIST.md)
- **Tablas pendientes:** [MIGRATIONS_PENDIENTES.xlsx](MIGRATIONS_PENDIENTES.xlsx) + CSVs auxiliares
- **Catalyst Text 10K + File Store:** [../CATALYST_TEXT_LIMITS.md](../CATALYST_TEXT_LIMITS.md)
- **Friday runbook** (paso-a-paso para activar todo): [../FRIDAY_RUNBOOK.md](../FRIDAY_RUNBOOK.md)
- **Marketing funnel** (deferred): [24_MARKETING_FUNNEL.md](24_MARKETING_FUNNEL.md) + [24_MARKETING_FUNNEL_TECH_BRIEF.md](24_MARKETING_FUNNEL_TECH_BRIEF.md)
- **Notas de seguridad:** [../SECURITY_NOTES.md](../SECURITY_NOTES.md)

**Métricas al 2026-05-08:**
- Backend: 799 tests pasando, ~90 endpoints, 7 webhooks
- Frontend: 185 tests, 28+ pages, bundle ~370KB main
- Tablas Catalyst: 16 creadas + ~10 pendientes (Block 2 deferred, fallback graceful)
- Catalyst File Store: 3 folders configurados (`candidatevideos`, `englishlistening`, `largecontent`)
- Integraciones: 4 activas (Clerk, Anthropic, ZeptoMail, HeyReach) + 8 con código listo

**Cambios estructurales recientes (2026-05-08):**
- Refactor del límite Catalyst Text de 10K chars (antes asumíamos 64KB) + `lib/largeContentStore.ts` para overflow >9.5K
- ZeptoMail wireado + 2 emails al cliente (portal_access + report_ready) + recovery_link al candidato
- Emails al candidato delegados a Zoho Recruit (templates por stage, no en nuestro código)
- Env vars renombradas `CATALYST_*_FOLDER_ID` → `FILESTORE_*_FOLDER_ID` (Catalyst reserva el prefijo `CATALYST_`)
- Settings → tab "⚙️ Operacional" con botón manual para procesar outbox
