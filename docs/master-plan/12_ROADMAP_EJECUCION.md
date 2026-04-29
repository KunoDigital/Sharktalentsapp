# 12 — Roadmap de ejecución

Cronograma del master plan completo: 8 fases core de refactor + 4 pilares de plataforma (multi-tenant, Clerk, API pública, MCP) + 7 pilares operativos Plan B (portal cliente, pipeline operativo, prueba doble eje, videos, bot decisor, outbound, integraciones Zoho).

---

## Resumen ejecutivo

**Duración total:** 24–28 semanas calendario para una persona full-time (vs 14-18 del refactor base).

**Estrategia:** cada fase deja la app funcional y deployable. Mergeamos a `main` al cierre de cada fase, no al final del refactor.

**Mitigación de riesgo:** fases paralelizables donde es posible. Dependencies explícitas abajo.

**Nota de ordering:**
- Multi-tenancy + Clerk se introducen TEMPRANO (Fase 2–3) porque agregar `tenant_id` retroactivamente es muy costoso.
- Plan B operativo (Fases 17-23) viene **después** del refactor base + plataforma. Razón: el pipeline operativo asume DB normalizada, multi-tenant y API pública ya estables.
- Bot decisor (21) **necesita data** de 2-3 puestos cerrados antes de pasar de Cold a Warm. No bloquea el deploy del resto.
- Outbound (22) puede arrancar como piloto después de tener pipeline operativo en producción.

---

## Diagrama de dependencies

```
          Fase 1                    (1 sem) — Fundamentos
            │
            ▼
          Fase 2                    (2 sem) — Base de datos
            │
            ├──────────────┐
            ▼              ▼
          Fase 3         Fase 4     (1 + 2 sem, paralelas) — Seguridad || Backend
            │              │
            └──────┬───────┘
                   ▼
                 Fase 5              (1 sem) — Anthropic
                   │
                   ▼
                 Fase 6              (1 sem) — Observability
                   │
                   ├──────────────┐
                   ▼              ▼
                 Fase 7         Fase 8     (1 + 1 sem, paralelas si dos personas) — Frontend || CI/CD
                   │              │
                   └──────┬───────┘
                          ▼
                    Migración            (1 sem) — Migración de datos
                          │
                          ▼
                    Hardening            (1 sem) — Smoke tests + fixes
```

---

## Timeline sugerido (1 persona, full-time)

| Semana | Fase | Deliverables | Riesgo |
|---|---|---|---|
| 1 | [Fase 1 — Fundamentos](02_FASE1_FUNDAMENTOS.md) | env vars (incl. Clerk), estructura, scripts, catalyst.json nuevo | Bajo |
| 2 | [Fase 13 — Multi-tenancy](13_MULTITENANT.md) + [Fase 14 — Clerk (1/2)](14_CLERK_AUTH.md) | Clerk setup frontend + backend verify, tabla Tenants, webhook Clerk | Alto |
| 3 | [Fase 14 — Clerk (2/2)](14_CLERK_AUTH.md) + inicio [Fase 2](03_FASE2_BASE_DATOS.md) | Login via Clerk funcional, admin migrado, schema nuevo diseñado | Alto |
| 4 | [Fase 2 — DB](03_FASE2_BASE_DATOS.md) | 30 tablas creadas en dev con tenant_id, módulos `db/*` | Alto |
| 5 | [Fase 3 — Seguridad](04_FASE3_SEGURIDAD.md) | Middleware, validación, rate limit por tenant, CORS, HMAC, access tokens | Medio |
| 6 | [Fase 4 — Backend (1/2)](05_FASE4_BACKEND.md) | handlers + services + N+1 eliminación (endpoints 1-4), tenant scope | Medio |
| 7 | [Fase 4 — Backend (2/2)](05_FASE4_BACKEND.md) | N+1 (endpoints 5-6) + idempotencia + outbox + seeds cache | Medio |
| 8 | [Fase 5 — Anthropic](06_FASE5_ANTHROPIC.md) | Caching, timeout, retry, breaker, token tracking real **por tenant** | Medio |
| 9 | [Fase 6 — Observability](07_FASE6_OBSERVABILITY.md) | /health, audit log con tenant, runbooks, UptimeRobot | Bajo |
| 10 | [Fase 7 — Frontend](08_FASE7_FRONTEND.md) | config.ts, error boundary, URLs, access tokens, OrgSwitcher | Bajo |
| 11 | [Fase 8 — CI/CD](09_FASE8_CICD_DEPLOY.md) + [Migración (1/2)](10_MIGRACION_DATOS.md) | Scripts deploy, git workflow, migración dev | Alto |
| 12 | Migración producción | Export → transform → import en prod con window | Muy alto |
| 13 | **[Fase 15 — API pública (1/2)](15_API_PUBLICA.md)** | Namespace `/api/v1/*`, ApiKeys, middleware requireApiKey, 5 endpoints | Medio |
| 14 | **[Fase 15 — API pública (2/2)](15_API_PUBLICA.md)** | 10+ endpoints, OpenAPI spec, `/docs` con Scalar, panel admin de API keys | Medio |
| 15 | **[Fase 16 — MCP Server (1/2)](16_MCP_SERVER.md)** | Package npm scaffold, 8 tools (read-only), auth | Medio |
| 16 | **[Fase 16 — MCP Server (2/2)](16_MCP_SERVER.md)** | 15+ tools, resources, docs, testing con Claude Desktop, publicar | Medio |
| 17 | Hardening plataforma | Smoke tests multi-tenant + API + MCP, fixes de bugs | Medio |
| 18 | **[Doc 23 — Integraciones Zoho](23_INTEGRACIONES_ZOHO.md)** | OAuth tokens encriptados, webhooks Recruit/Bookings/Sign con HMAC, Zia + Whisper fallback | Alto |
| 19 | **[Doc 18 — Pipeline operativo (1/2)](18_PIPELINE_OPERATIVO.md)** | `JobApplications` state machine completo, `/apply/<tenant>/<job-slug>` página pública, prefilter | Alto |
| 20 | **[Doc 18 — Pipeline operativo (2/2)](18_PIPELINE_OPERATIVO.md)** | Sync unidireccional → Recruit, ContinueTokens, auto-rejection rules | Alto |
| 21 | **[Doc 17 — Portal cliente](17_PORTAL_CLIENTE.md)** | Onboarding Bookings + Zia, JobProfileDrafts, 4 milestones notif (email + WhatsApp), tracking funnel | Medio |
| 22 | **[Doc 19 — Prueba técnica doble eje](19_PRUEBA_TECNICA_DOBLE_EJE.md)** + **[Doc 20 — Videos (1/2)](20_VIDEOS_DINAMICOS.md)** | TechnicalScores extendida + boss profile capture; VideoQuestions/VideoResponses schema, MediaRecorder | Medio |
| 23 | **[Doc 20 — Videos (2/2)](20_VIDEOS_DINAMICOS.md)** | Whisper transcripción, IA evaluation, retención 30d post-cierre, GDPR consent flow | Medio |
| 24 | **[Doc 21 — Bot decisor (1/2)](21_BOT_DECISOR.md)** | BotDecisions/BotTrainingExamples/ReviewQueue, modo Cold (recomendar only), few-shot prompt | Alto |
| 25 | **[Doc 21 — Bot decisor (2/2)](21_BOT_DECISOR.md)** | RAG sobre training examples, modo Warm (auto en etapas tempranas), override loop | Alto |
| 26 | **[Doc 22 — Outbound (1/2)](22_OUTBOUND_SOURCING.md)** | CandidatePool indexado, algoritmo de matching interno | Medio |
| 27 | **[Doc 22 — Outbound (2/2)](22_OUTBOUND_SOURCING.md)** | HeyReach API + cuenta dedicada LinkedIn, OutreachInbox unificado, throttling safety | Alto |
| 28 | Hardening Plan B + onboarding primer tenant externo | Smoke tests end-to-end del flujo completo cliente→candidato→reporte | Medio |

---

## Si hay 2 personas trabajando

| Semana | Dev 1 | Dev 2 |
|---|---|---|
| 1 | Fase 1 | Fase 1 (pair) |
| 2 | Fase 13 (multitenant) | Fase 14 (Clerk frontend) |
| 3 | Fase 2 (DB diseño) | Fase 14 (Clerk backend + webhooks) |
| 4 | Fase 2 (DB impl + módulos db/) | Fase 3 (seguridad) |
| 5 | Fase 4 (N+1 endpoints 1-4) | Fase 7 (frontend config + Clerk UI) |
| 6 | Fase 4 (N+1 endpoints 5-6) | Fase 5 (Anthropic) |
| 7 | Fase 6 (observability) | Fase 15 (API pública 1/2) |
| 8 | Fase 8 (CI/CD) | Fase 15 (API pública 2/2) |
| 9 | Migración producción | Fase 16 (MCP Server) |
| 10-11 | Hardening + docs | Onboarding primer tenant externo |
| 12-13 | Doc 23 (Zoho integrations) | Doc 18 (Pipeline operativo) |
| 14 | Doc 17 (Portal cliente) | Doc 18 cierre |
| 15 | Doc 19 + Doc 20 (1/2) | Doc 21 (Bot decisor 1/2) |
| 16 | Doc 20 (2/2) | Doc 21 (2/2) |
| 17 | Doc 22 (Outbound 1/2) | Hardening Plan B |
| 18 | Doc 22 (2/2) | Onboarding primer tenant externo |

Reducción: 28 → 18 semanas con 2 personas.

---

## Milestones entregables a prod

Cada milestone es un deploy a prod. Entre milestones, features pueden desplegarse a dev pero no a prod.

### Milestone 1 — "Base refactored" (post Fase 4)
Ocurre post-Fase 4. La app tiene:
- ✅ Modular
- ✅ N+1 eliminado
- ✅ Auth endurecida
- ✅ DB normalizada
- ⚠ Sin tokens reales, sin caching, sin health

**Impacto en user:** nada visible. Mejora de performance y seguridad internamente.

**Beneficio medible:** factura Catalyst baja ~50%. Latencia de endpoints admin baja.

### Milestone 2 — "Resilient Anthropic" (post Fase 5)
- ✅ Anthropic con caching + circuit breaker
- ✅ Token tracking real

**Impacto en user:** generación de reportes más confiable. Menos fallos por timeout.

**Beneficio medible:** factura Anthropic baja ~60% por caching.

### Milestone 3 — "Production-ready ops" (post Fase 6)
- ✅ /health, audit log, runbooks
- ✅ Monitoring externo activo
- ✅ Secretos rotados a las convenciones nuevas

**Impacto en user:** nada visible.

**Beneficio medible:** podemos debuggear incidents. Alertas tempranas.

### Milestone 4 — "Frontend polish" (post Fase 7)
- ✅ URLs configurables, versioning visible, access tokens
- ✅ Error boundaries

**Impacto en user:** reportes públicos requieren token nuevo (breaking change para links viejos).

**Comunicación:** enviar nuevos links a clientes que tengan reports publicados.

### Milestone 5 — "CI/CD robusto" (post Fase 8)
- ✅ Scripts de deploy + rollback
- ✅ Environments separados

**Impacto:** interno, para el equipo.

### Milestone 6 — "Migración + go-live multi-tenant" (mid)
- ✅ Data migrada al schema nuevo con `tenant_id` populated
- ✅ App sobre infraestructura nueva
- ✅ Login via Clerk activo
- ✅ Tenant "Kuno Digital" funcionando normal

**Impacto en user:** window de downtime (2-4h) durante migración. Post-migración, login distinto (Clerk), URLs de reportes cambian (con `?token=`).

### Milestone 7 — "API pública" (post Fase 15)
- ✅ Namespace `/api/v1/*` con 10+ endpoints
- ✅ `/docs` público con Scalar
- ✅ Panel admin puede crear/revocar API keys
- ✅ Rate limiting activo

**Impacto en user:** agencia/cliente puede integrar SharkTalents con sus ATS/CRMs.

**Beneficio:** producto pasa de "app cerrada" a "plataforma abierta".

### Milestone 8 — "MCP Server activo" (post Fase 16)
- ✅ Package npm publicado
- ✅ Claude Desktop puede conectar
- ✅ 15+ tools funcionando

**Impacto en user:** admin puede pedirle a Claude consultas/acciones en lenguaje natural.

**Beneficio:** diferenciador fuerte del producto. Marketing.

### Milestone 9 — "Plataforma multi-tenant viva"
- ✅ Un cliente que NO sea Kuno hace login, crea sus puestos, procesa candidatos.
- ✅ Isolation verificada end-to-end.

**Impacto:** validación real de multi-tenant.

### Milestone 10 — "Integraciones Zoho operando" (post Doc 23)
- ✅ OAuth tokens persistidos encriptados.
- ✅ Webhooks entrantes Recruit/Bookings/Sign verificados con HMAC/token.
- ✅ Sync queue Recruit con dead letter funcional.
- ✅ Whisper fallback corriendo cuando Zia no transcribe.

**Impacto:** Cris empieza a recibir candidatos vía hub gratis Recruit en SharkTalents sin tocar nada.

### Milestone 11 — "Pipeline operativo end-to-end" (post Doc 18 + 17)
- ✅ Página `/apply/<tenant>/<job-slug>` recibe aplicaciones directas.
- ✅ State machine `JobApplications` completo.
- ✅ Portal cliente con onboarding self-serve y briefing transcrito.
- ✅ 4 milestones de notificación funcionando (profile_ready, search_started, funnel_active, finalists_ready).
- ✅ Tracking estilo Uber Eats con refresh-aware UI.

**Impacto:** SharkTalents pasa a ser fuente de verdad operativa. Cliente no necesita reuniones para saber el estado.

### Milestone 12 — "Evaluación rica completa" (post Doc 19 + 20)
- ✅ Prueba técnica con scoring dual (knowledge + situational) y axis autonomy_vs_consult.
- ✅ Match candidato↔jefe calculado y visible en reporte.
- ✅ 7 videos dinámicos generados por candidato según resultados previos.
- ✅ Whisper transcribe y IA evalúa señales esperadas.
- ✅ GDPR consent obligatorio + retención 30 días post-cierre.

**Impacto:** Cris ahorra ~6h/puesto en entrevistas intermedias. Decide solo top 3 con mejor data que antes.

### Milestone 13 — "Bot decisor en Warm" (post Doc 21)
- ✅ Bot decide automáticamente etapas tempranas (prefilter, disc, technical) cuando confidence ≥ threshold.
- ✅ Casos < threshold caen a ReviewQueue.
- ✅ Cada override de Cris genera training example.
- ✅ RAG consulta casos similares pasados.

**Impacto:** Cris pasa de gestor de pipeline a supervisor + decisor de finalistas.

**Cuándo escalar a Hot:** después de 3 puestos cerrados con tasa de override < 20% en etapas decisivas.

### Milestone 14 — "Outbound sourcing activo" (post Doc 22)
- ✅ Pool interno con ≥150 candidatos indexados.
- ✅ Algoritmo de matching DISC + cognitive + área + idioma operativo.
- ✅ HeyReach corriendo con cuenta LinkedIn dedicada, ≤75 invites/mes.
- ✅ Inbox unificada para respuestas LinkedIn + email.

**Impacto:** Cris deja de depender 100% del inbound. Puede atacar puestos donde el inbound natural no llega.

---

## Dependencies críticas

### Antes de Fase 5 (Anthropic)
Necesita:
- Tabla `TokenUsage` (Fase 2) ✓
- Tabla `CircuitBreakers` (Fase 2) ✓
- `lib/retry.ts` (Fase 4) ✓
- `lib/env.ts` (Fase 1) ✓

### Antes de Fase 6 (Observability)
Necesita:
- `ctx` con `traceId` (Fase 4) ✓
- Tabla `AuditLog` (Fase 2) ✓
- Tabla `HealthChecks` (agregar en Fase 2 o Fase 6)
- Logger con prefijos (Fase 4) ✓

### Antes de Migración
Necesita:
- Schema nuevo completo (Fase 2) ✓
- Backend lee del schema nuevo (Fase 4 + Fase 5 + Fase 6) ✓
- Frontend apunta al schema nuevo a través de la API (Fase 7) ✓
- Scripts probados en dev (Fase 10) ✓

---

## Quick wins vs big rocks

### Quick wins (se pueden hacer ANTES del master plan si urge)
No requieren schema changes y son low-risk:

1. **Timeouts en Anthropic** — 1 línea de cambio, gran impacto.
2. **`ANTHROPIC_ENABLED` feature flag** — escape hatch.
3. **Logger con prefijos** — mejor debugging inmediato.
4. **`/health` endpoint básico** — sin DB checks primero.
5. **Rate limit en /admin/login** — anti brute force básico.
6. **URLs centralizadas en `config.ts`** — prerequisito para cambios futuros.

Estos pueden hacerse **en 1-2 días** y deployarse independientemente del refactor.

### Big rocks (requieren las fases completas)
- Schema normalizado (Fase 2)
- Prompt caching (Fase 5, post tabla TokenUsage)
- Access tokens en reportes (Fase 3 + Fase 7 + migración)

---

## Cronograma con dates tentativas

Asumiendo arranque el **2026-05-01**, 1 persona full-time:

| Semana | Calendario | Milestone |
|---|---|---|
| 1 | 2026-05-01 → 05-07 | Fase 1 |
| 2-3 | 2026-05-08 → 05-21 | Fase 2 |
| 4 | 2026-05-22 → 05-28 | Fase 3 |
| 5-6 | 2026-05-29 → 06-11 | Fase 4 → **Milestone 1 deploy** |
| 7 | 2026-06-12 → 06-18 | Fase 5 → **Milestone 2 deploy** |
| 8 | 2026-06-19 → 06-25 | Fase 6 → **Milestone 3 deploy** |
| 9 | 2026-06-26 → 07-02 | Fase 7 → **Milestone 4 deploy** |
| 10 | 2026-07-03 → 07-09 | Fase 8 + migración dev → **Milestone 5 deploy** |
| 11 | 2026-07-10 → 07-16 | Migración prod → **Milestone 6 deploy** |
| 12 | 2026-07-17 → 07-23 | Hardening plataforma |
| 13-14 | 2026-07-24 → 08-06 | Doc 15 (API pública 1+2) → **Milestone 7** |
| 15-16 | 2026-08-07 → 08-20 | Doc 16 (MCP Server 1+2) → **Milestone 8** |
| 17 | 2026-08-21 → 08-27 | Hardening + onboarding primer tenant → **Milestone 9** |
| 18 | 2026-08-28 → 09-03 | Doc 23 (Zoho integrations) → **Milestone 10** |
| 19-20 | 2026-09-04 → 09-17 | Doc 18 (Pipeline operativo 1+2) |
| 21 | 2026-09-18 → 09-24 | Doc 17 (Portal cliente) → **Milestone 11** |
| 22-23 | 2026-09-25 → 10-08 | Doc 19 + Doc 20 (Videos 1+2) → **Milestone 12** |
| 24-25 | 2026-10-09 → 10-22 | Doc 21 (Bot decisor 1+2) → **Milestone 13** |
| 26-27 | 2026-10-23 → 11-05 | Doc 22 (Outbound 1+2) → **Milestone 14** |
| 28 | 2026-11-06 → 11-12 | Hardening Plan B + onboarding tenant externo |

**Entrega final completa:** 2026-11-12.

**Entrega de plataforma base (sin Plan B operativo):** 2026-08-27.

Ajustar según velocidad real. Cada milestone deja la app viable, así que si hay pausa, no se pierde trabajo.

---

## Criterios para detener

Si algo sale mal, **cuándo parar**:

- **Bug crítico en prod que no se puede fixear en 2h:** rollback al milestone anterior, investigar sin presión.
- **3 semanas de retraso acumulado:** re-evaluar scope. Tal vez diferir Fase 8 a post-migración.
- **Factura Catalyst sube en vez de bajar:** pausar fases nuevas, investigar root cause.
- **Schema nuevo introduce inconsistencia:** rollback de migración, rediseñar problema específico.

---

## Plan de contingencia

### Si Fase 2 (DB) se atasca
- Hacer menos en esta fase: quizá solo normalizar `Results.score` y dejar el resto para v2.
- Priorizar las 5 tablas que dan más ROI: DiscScores, CognitiveScores, IntegrityScores, TokenUsage, CircuitBreakers.

### Si Fase 4 (N+1) es más complejo de lo esperado
- Enfoque endpoint por endpoint: cerrar 2 endpoints por semana en lugar de los 6 en 2 semanas.
- Milestones parciales: "N+1 eliminado en endpoints X, Y" como deploys intermedios.

### Si la migración es demasiado riesgosa
- Opción nuclear: **no migrar data**. Clientes nuevos usan schema nuevo. Reportes viejos se mantienen en el sistema viejo en modo read-only temporalmente.
- Mantener ambos sistemas 30 días hasta confirmar que nadie más necesita los reportes viejos.
- Apagar el sistema viejo definitivamente.

### Si Doc 18 (Pipeline operativo) se atasca
- Diferir auto-rejection rules; primero solo cambios manuales con el state machine.
- Sync a Recruit puede empezar manual (Cris cambia en ambos lados) hasta que la queue esté estable.

### Si Doc 21 (Bot decisor) genera demasiados falsos positivos
- Subir threshold drasticamente (de 0.75 a 0.90) → casi todo cae a ReviewQueue.
- Quedarse en modo Cold más tiempo (3-4 puestos en lugar de 1-2).
- Aceptar que el ahorro de tiempo del bot es bajo en mes 1-2 — el valor es la training data.

### Si HeyReach falla / banea cuenta LinkedIn
- Pausar campañas; pool interno sigue funcionando.
- Migrar a alternativa (Salesflow, Linked Helper) como fallback — sin reescribir el `OutreachContacts` schema, solo cambiar adapter.

### Si Whisper fallback genera costo alto
- Limitar transcripción a meetings > 5min y < 60min.
- Skip si ya existe transcript Zia (chequear antes).
- Cache de transcripts por hash de audio.

---

## Comunicación con stakeholders

### Al dueño del proyecto (Daisy / Kuno)
- Al inicio: este roadmap + [01_PRINCIPIOS_Y_ALCANCE.md](01_PRINCIPIOS_Y_ALCANCE.md).
- Cada semana: "estamos en Fase X, deliverables Y completados".
- Al final de cada milestone: demo + notas de release.

### A clientes con reportes publicados
- 2 semanas antes de Milestone 4: aviso de breaking change en URLs.
- Post-Milestone 4: nuevos links, mantener los viejos funcionando por 30 días con redirect.

### Al equipo técnico (futuro)
- README + CLAUDE.md + master-plan quedan como onboarding.
- Cada runbook tiene los pasos para debugging.

---

## Cierre del refactor

Al completar Milestone 6, la **plataforma base** está:

- ✅ Alineado con el manual de [aprendizajes/](../aprendizajes/)
- ✅ Auditoría de seguridad pasada
- ✅ Factura mensual controlada
- ✅ Observability operativa
- ✅ Lista para agregar features nuevas

Al completar Milestone 14, el **Plan B operativo** está vivo:

- ✅ SharkTalents es fuente de verdad del pipeline.
- ✅ Cliente self-serve (onboarding + tracking + finalistas).
- ✅ Bot decisor en Warm/Hot reduciendo carga manual de Cris.
- ✅ Outbound activo con HeyReach + pool interno.
- ✅ Recruit queda como CRM back-office cómodo, no crítico.

**Features diferidas** ([MEJORAS_PENDIENTES.md](../pendientes/MEJORAS_PENDIENTES.md)) pueden retomarse con la confianza de trabajar sobre una base sólida:

1. DISC v2 corregido
2. Upload de CV PDF (parte ya cubierta en Doc 18 — `JobApplications.resume_file_id`)
3. Preguntas sugeridas en reporte al cliente
4. Excel export
5. Competencias en reporte al cliente

---

## Cierre del master plan

Este documento + los 11 anteriores son el **contrato** del refactor. Si durante la ejecución aparece una decisión importante no cubierta:

1. **Escribir un ADR** nuevo en `docs/ADR/`.
2. Si requiere cambio de alcance, actualizar [01_PRINCIPIOS_Y_ALCANCE.md](01_PRINCIPIOS_Y_ALCANCE.md).
3. Si afecta varios docs, reflejar en todos o agregar nota "actualizado en ADR-XXX".

**Mantener el master plan vivo.** Un plan congelado vale 10× menos que uno actualizado.

---

## Fin

Fin del master plan. Go to [00_INDEX.md](00_INDEX.md) para volver al inicio.
