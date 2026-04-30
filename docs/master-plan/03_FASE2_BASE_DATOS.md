# 03 — Fase 2: Base de datos

**Objetivo:** normalizar el schema, eliminar JSON blobs queryeables, convertir `pipeline_stage` en state machine explícita, **agregar `tenant_id` en todas las tablas del dominio (multi-tenancy)**, y agregar las tablas faltantes (tenants, api keys, idempotencia, outbox, audit, token tracking, circuit breakers).

**Tiempo estimado:** 2 semanas.
**Dependencias:** Fase 1 completa.
**Riesgo:** alto — toca la estructura de datos. Hacer con backup + rollback plan.

**Referencias teóricas:** [03_DATABASE_DESIGN.md](../aprendizajes/03_DATABASE_DESIGN.md), [09_ESTADO_Y_FLUJOS.md](../aprendizajes/09_ESTADO_Y_FLUJOS.md), [12#3, #4, #14](../aprendizajes/12_ANTIPATTERNS.md).
**Ver también:** [13_MULTITENANT.md](13_MULTITENANT.md) para el detalle del modelo multi-tenant.

---

## ⚠️ Rectificación abril 2026

La versión inicial de este doc proponía **54 tablas** distribuidas en 3 bloques. **Eso fue exceso** para el contexto real de SharkTalents (1 humano + agentes IA — ver memoria `project_definicion_de_escalable.md`).

Reglas correctas para schema:

1. **Crear tabla solo cuando se necesita** — no pre-crear tablas para features que vienen en 3 meses. Tabla vacía durante meses = data stale + fricción mental sin valor.
2. **Colapsar tablas relacionadas** cuando la separación no aporta queryabilidad real.
3. **JSON columns son OK para data que solo se lee/muestra a humanos** (ej: rationale del bot, summary text). Solo normalizar lo que necesitás indexar/queryear.

### Reducción de schema: 54 → 25 tablas core (resto se agrega cuando se necesita)

**Colapsos aplicados:**

| Antes (separadas) | Después (colapsada) | Por qué |
|---|---|---|
| `DiscScores` + `CognitiveScores` + `EmotionalScores` + `IntegrityScores` + `IntegrityDimensions` + `TechnicalScores` + `CompetenciaScores` (7 tablas) | `Scores` (1 tabla con `type` enum + `summary` JSON) + `IntegrityDimensions` (queryable) (2 tablas) | Cuando querés "qué scores tiene Ariana" hacés 1 query, no 7. Las 15 dimensiones de integridad sí queryeables. |
| `OutreachCampaigns` + `OutreachContacts` + `OutreachInbox` + `OutreachTemplates` (4 tablas) | `OutreachCampaigns` + `OutreachMessages` (2 tablas) | Contacts + Inbox son la misma idea: registro de un contacto outbound. Templates pueden vivir como JSON en Campaigns. |
| `JobProfileDrafts` + `JobBossProfiles` (2 tablas) | `Jobs` con columnas extra para draft state + boss profile JSON | Boss profile es 1-1 con Job. Draft state es etapa transitoria del Job. |
| `BotDecisions` + `BotTrainingExamples` + `ReviewQueue` (3 tablas) | `BotDecisions` (1 tabla con flag `needs_review` + flag `is_training_example`) | Toda la lógica del bot decisor en 1 tabla. Review queue = filter `needs_review = true`. |
| `ClientNotifications` + `ClientNotificationTemplates` (2 tablas) | `Notifications` con `template_key` + templates en seeds JSON | Templates son data fija, viven en `seeds/`, no en DB. |
| `RecruitJobMappings` + `RecruitStageMappings` + `RecruitSyncQueue` (3 tablas) | `RecruitSync` (1 tabla con `mapping_type` + queue) | Recruit-specific data en una sola tabla. Mapping y queue son la misma idea (relación SharkTalents↔Recruit con estado). |
| `IntegrationSecrets` + `IntegrationHealth` + `ZohoMeetings` (3 tablas) | `IntegrationSecrets` + `IntegrationActivity` (2 tablas, `IntegrationActivity` = health + meetings + cualquier actividad de integración) | Health checks + meeting recordings son ambos "actividades de integración". |

**Total tras colapsos:** ~25 tablas vs 54 originales. **Las que quedan se crean cuando se necesitan, no de una.**

### Tablas que crear PRIMERO (Block 1 — para que SharkTalents arranque)

Solo estas para empezar a operar el flujo básico:

1. **`Tenants`** — la org del cliente (Clerk org)
2. **`ProcessedEvents`** — idempotencia para webhooks
3. **`Jobs`** — los puestos
4. **`Candidates`** — las personas
5. **`JobApplications`** — aplicaciones de candidato a puesto
6. **`ApplicationTransitions`** — append-only audit del state machine
7. **`Scores`** — scores normalizados (DISC, VELNA, técnica, integridad, emoción)
8. **`IntegrityDimensions`** — las 15 dims queryeables de integridad
9. **`AuditLog`** — eventos del sistema con `summary_text` en español
10. **`OutboxEvents`** — async side-effects (notif, sync Recruit, etc.)

10 tablas para tener un sistema funcionando end-to-end. Lo demás se agrega cuando lleguen las features.

### Tablas DIFERIDAS (crear cuando la feature lo necesita)

- **Block 2 — Plan B operativo (cuando arranque pipeline real):** `PrefilterQuestions`, `PrefilterAnswers`, `JobBossProfiles`*, `ContinueTokens`, `ClientNotifications`, `JobProfileDrafts`*, `JobTrackingSnapshots`. (* = ahora son columnas en `Jobs`)
- **Block 3 — Videos dinámicos (cuando arranque feature):** `VideoQuestions`, `VideoResponses`, `VideoConsents`
- **Block 4 — Bot decisor (cuando warm/hot mode):** `BotDecisions`
- **Block 5 — Outbound (cuando arranque outbound real):** `CandidatePool`, `OutreachCampaigns`, `OutreachMessages`
- **Block 6 — Integraciones Zoho (cuando se conecta cada una):** `IntegrationSecrets`, `IntegrationActivity`, `RecruitSync`
- **Block 7 — Plataforma:** `ApiKeys`, `TokenUsage`, `CircuitBreakers`, `Config`

**El resto del doc abajo describe el detalle de cada tabla.** Mantengo todo el spec porque es referencia útil cuando llegue el momento. Solo cambia *cuándo* crear cada una.

---

## Deliverables

- [ ] 17 tablas nuevas/rediseñadas creadas en Catalyst DataStore
- [ ] Script de migración de data vieja a nueva
- [ ] `db/` con un archivo por tabla
- [ ] State machine para `pipeline_stage` implementada
- [ ] Append-only `PipelineTransitions` con historial
- [ ] `ScreenExits` separada a tabla propia
- [ ] `Results.score` JSON eliminado — scores normalizados

---

## Schema actual (lo que tenemos hoy)

### 8 tablas existentes

**1. Jobs**
```
ROWID              BigInt (PK auto)
title              Text
company            Text
tech_prompt        Text (long)
cognitive_level    Text          ('basic' | 'mid' | 'senior')
is_active          Text          ('1' | '0')   ← anti-pattern: debería ser Boolean
created_by         Text
ideal_profile      Text (long)   ← JSON blob — tiene disc, disc_b, cognitive, competencias, company_context, cost_config, report_profile_desc, token_usage (!!)
ideal_competencias Text (long)   ← JSON array
created_at         Text
updated_at         Text
CREATEDTIME        DateTime (auto)
MODIFIEDTIME       DateTime (auto)
```

**Problemas:**
- `ideal_profile` es un mega-blob JSON con 7+ dominios mezclados (perfil ideal, contexto empresa, cost_config, report_profile_desc, token_usage).
- `is_active` como string es raro.

**2. Assessments**
```
ROWID         BigInt
job_id        Text    (FK a Jobs.ROWID)
type          Text    ('technical' | 'kudert' | 'integrity')
public_token  Text    (UUID)
questions     Text (long)  ← en technical es '[]' o '__FROM_SEEDS__'; en otros puede tener JSON (legacy)
status        Text    ('active' | ...)
generated_at  Text
created_at    Text
```

**3. AssessmentQuestions** (solo para technical, nuevo)
```
ROWID          BigInt
assessment_id  Text    (FK)
sort_order     Text    (número como string)
question_id    Text    ('ta1', 'tb2', ...)
text           Text (long)
options        Text (long)   ← JSON stringified
correct        Text          ('0'–'3')
kind           Text          ('ta' | 'tb')
created_at     Text
```

**4. Candidates**
```
ROWID                 BigInt
name                  Text
email                 Text
phone                 Text
age                   Text
salary_expectation    Text
availability          Text    ('disponible' | '15_dias' | 'negociar')
interview_file_id     Text    (ref a File Store)
created_at            Text
```

**5. Results**
```
ROWID                  BigInt
assessment_id          Text
candidate_id           Text
answers                Text (long)     ← JSON {questionId: number}
score                  Text (long)     ← JSON blob con TODO: disc + cognitive + emotional + integrity + competencias
ai_analysis            Text (long)     ← unused
screen_exits           Text            ← a veces "3", a veces {"count": 3, "log": [...]} 😱
screen_exit_log        Text            ← unused
report_downloaded_at   Text
pipeline_stage         Text            ← string libre: 'next_stage', 'rejected_kudert', 'interview_integrity', ...
started_at             Text
completed_at           Text
```

**Problemas críticos:**
- `score` es **el gran JSON blob god-object** que contiene todas las dimensiones. Imposible queryear "¿cuántos candidatos tienen DISC dominante?".
- `screen_exits` es de tipo variable — a veces string con número, a veces JSON. Violation masiva del principio de schema consistente.
- `pipeline_stage` no tiene state machine — puede tener cualquier string.

**6. ClientReports**
```
ROWID                    BigInt
job_id                   Text
company_slug             Text
job_slug                 Text
status                   Text    ('draft' | 'published')
published_at             Text
comparison_file_id       Text    (ref File Store)
en_comparison_file_id    Text    (ref File Store)
created_at               Text
```

**7. ReportCandidates**
```
ROWID                     BigInt
report_id                 Text
candidate_id              Text
references_json           Text (long)   ← JSON array de referencias
curriculum_file_id        Text          (ref File Store, no usado todavía)
explanation_summary       Text (long)   ← a veces JSON con TODO mezclado (!!)
explanation_disc          Text (long)
explanation_velna         Text (long)
explanation_emotion       Text (long)
explanation_technical     Text (long)
explanation_integrity     Text (long)
explanation_competencias  Text (long)
report_file_id            Text          (ref File Store — truth canónica)
sort_order                Text
```

**8. TechLibrary**
```
ROWID       BigInt
name        Text
company     Text
prompt      Text (long)
origin      Text    ('ai' | 'manual')
created_at  Text
```

---

## Schema nuevo (lo que queremos)

### Principios aplicados
1. **Una tabla = una entidad.** Ninguna god-table.
2. **Scores desnormalizados.** Cada dimensión en su tabla o columnas propias queryeable.
3. **State machine explícita** para `pipeline_stage`.
4. **Append-only para historia** (transitions, screen exits, outbox).
5. **Tablas de infra** para idempotencia, audit, tokens, circuit breakers, feature flags.

### Overview de tablas finales

**Multi-tenancy (nuevas):**
1. `Tenants` — metadata por cliente/agencia (sync con Clerk Orgs)
2. `ApiKeys` — keys para API pública por tenant

**Core (rediseñadas, con `tenant_id`):**
3. `Jobs` (limpio, sin mega-blob, + tenant_id)
4. `JobProfiles` (subset de Jobs.ideal_profile extraído)
5. `JobCompetencias` (array de competencias por job, antes en blob)
6. `JobCostConfig` (config de costos, antes en blob)
7. `Assessments` (+ tenant_id para queries rápidas)
8. `AssessmentQuestions` (+ tenant_id denormalizado)
9. `Candidates` (+ tenant_id — MVP: Opción A de isolation estricta)
10. `Results` (sin JSON `score`, + tenant_id)
11. `ClientReports` (+ tenant_id, + access_token)
12. `ReportCandidates` (+ tenant_id)
13. `TechLibrary` (+ tenant_id — biblioteca por tenant)

**Scores normalizados (nuevas, con `tenant_id` denormalizado):**
14. `DiscScores`
15. `CognitiveScores`
16. `EmotionalScores`
17. `IntegrityScores`
18. `IntegrityDimensions` (por result + dimension)
19. `TechnicalScores`
20. `CompetenciaScores` (por result + competencia)

**Eventos y estado (nuevas, con `tenant_id`):**
21. `ScreenExits` (append-only, por salida)
22. `PipelineTransitions` (append-only, historial de estados)

**Infra (nuevas):**
23. `ProcessedEvents` (idempotencia — global, sin tenant)
24. `OutboxEvents` (+ tenant_id — por tenant para scope)
25. `AuditLog` (+ tenant_id)
26. `TokenUsage` (+ tenant_id para billing)
27. `CircuitBreakers` (global por servicio externo)
28. `Config` (global o por tenant)
29. `RateLimitEvents` (global, key incluye tenant)
30. `HealthChecks` (global)

Total: **30 tablas.** Parece mucho pero cada una tiene responsabilidad clara y todas las del dominio llevan tenant_id.

---

## Detalle de tablas nuevas/rediseñadas

### 0. Tenants (NUEVA — ver [13_MULTITENANT.md](13_MULTITENANT.md))

```
ROWID                      BigInt
clerk_org_id               Text (50, unique check)
name                       Text (255)
slug                       Text (100, unique check)
plan                       Text (20)      ('free' | 'starter' | 'pro' | 'enterprise')
status                     Text (20)      ('active' | 'suspended' | 'deleted')
max_active_jobs            Integer
max_candidates_per_month   Integer
features_enabled           Text (long)     JSON { mcp, api, custom_branding }
branding_config            Text (long, nullable)
billing_email              Text (255, nullable)
created_at                 DateTime
updated_at                 DateTime
```

### 0b. ApiKeys (NUEVA — ver [15_API_PUBLICA.md](15_API_PUBLICA.md))

```
ROWID               BigInt
tenant_id           Text (50)
name                Text (100)
key_hash            Text (128, unique check)
key_prefix          Text (10)
created_by_user     Text (50)    (clerk user_id)
permissions         Text (long)  JSON array
rate_limit_per_min  Integer
last_used_at        DateTime nullable
expires_at          DateTime nullable
is_active           Boolean
created_at          DateTime
revoked_at          DateTime nullable
```

### 1. Jobs (rediseñada)

```
ROWID             BigInt
tenant_id         Text (50)       🆕 FK Tenants
title             Text (255)
company           Text (255)      (cliente final — puede diferir del tenant)
tech_prompt       Text (long, max 10000)
cognitive_level   Text (20)        ('basic' | 'mid' | 'senior')
is_active         Boolean
company_context   Text (long, nullable)    (movido del blob)
created_by        Text (255)       (clerk user_id)
created_at        DateTime
updated_at        DateTime
```

**Eliminado:** `ideal_profile` blob, `ideal_competencias` blob (van a `JobProfiles`).

### Nota sobre `tenant_id` en todas las tablas de dominio

De acá en adelante, **todas las tablas del dominio** (Assessments, Candidates, Results, scores normalizados, ScreenExits, PipelineTransitions, ClientReports, ReportCandidates, TechLibrary, AuditLog, TokenUsage, OutboxEvents) llevan una columna adicional:

```
tenant_id    Text (50)    FK a Tenants.ROWID (puede denormalizarse por performance)
```

Ver [13_MULTITENANT.md](13_MULTITENANT.md) para el racional completo. A continuación se detallan las tablas sin repetir la columna en cada una.

### 2. JobProfiles (NUEVA)

Extrae el perfil ideal del mega-blob anterior. Un row por job.

```
ROWID                    BigInt
job_id                   Text      (FK Jobs)
disc_d, disc_i, disc_s, disc_c    Integer (0-100)   (perfil A)
disc_b_d, disc_b_i, disc_b_s, disc_b_c  Integer nullable  (perfil B opcional)
cog_verbal, cog_espacial, cog_logica, cog_numerica, cog_abstracta  Integer (0-100)
min_technical_score      Integer   (default 60)
```

### 3. JobCompetencias (NUEVA)

Una row por competencia ideal del job.

```
ROWID            BigInt
job_id           Text
competencia_id   Text (50)
nivel_esperado   Integer (0-100)
sort_order       Integer
```

### 4. JobCostConfig (NUEVA)

Extraído del blob. Un row por job.

```
ROWID           BigInt
job_id          Text (FK, unique)
client_type     Text (20)         ('normal' | 'especial' | 'interno')
salary          Integer
advertising     Integer
hours           Decimal (5,2)
```

### 5. Assessments (sin cambio mayor)

```
ROWID         BigInt
job_id        Text
type          Text (20)     ('technical' | 'kudert' | 'integrity')
public_token  Text (36)     (UUID)
status        Text (20)     ('active' | 'archived')
generated_at  DateTime nullable
created_at    DateTime
```

Eliminado: `questions` (para `technical` va en `AssessmentQuestions`; para los otros se leen de seeds).

### 6. AssessmentQuestions (refinada)

```
ROWID          BigInt
assessment_id  Text (FK)
sort_order     Integer
question_id    Text (20)
text           Text (long, max 2000)
options        Text (long, max 2000)    (JSON — acepamos porque siempre se lee junto)
correct        Integer (0-3)
kind           Text (5)    ('ta' | 'tb')
created_at     DateTime
```

### 7. Candidates (refinada)

```
ROWID                 BigInt
name                  Text (255)
email                 Text (255, unique check en código)
phone                 Text (30, nullable)
age                   Integer nullable
salary_expectation    Integer nullable
availability          Text (20, nullable)
interview_file_id     Text (50, nullable)
created_at            DateTime
```

### 8. Results (rediseñada — sin `score` JSON)

```
ROWID                  BigInt
assessment_id          Text
candidate_id           Text
answers                Text (long, max 30000)   (JSON {questionId: number} — se queda, se lee junto)
ai_analysis            REMOVED (unused)
report_downloaded_at   DateTime nullable
pipeline_stage         Text (30)     (enum — ver state machine abajo)
started_at             DateTime
completed_at           DateTime nullable
idempotency_key        Text (64, nullable)   (para /submit)
```

Los scores **ya no están aquí**. Van a tablas propias con FK a `result_id`.

### 9. DiscScores (NUEVA)

```
ROWID                BigInt
result_id            Text (FK unique)
raw_d, raw_i, raw_s, raw_c   Integer (0-40)   (conteo crudo)
normalized_d, normalized_i, normalized_s, normalized_c   Integer (0-100)
perfil_dominante     Text (1)       ('D' | 'I' | 'S' | 'C')
pk_id                Text (10)      ('PK-05', etc, calculado al insertar)
```

### 10. CognitiveScores (NUEVA)

```
ROWID              BigInt
result_id          Text (FK unique)
verbal             Integer
espacial           Integer
logica             Integer
numerica           Integer
abstracta          Integer
total              Integer
max                Integer
indice             Integer (0-100)  (calculado: promedio * 100 / max)
```

### 11. EmotionalScores (NUEVA)

```
ROWID      BigInt
result_id  Text (FK unique)
score      Integer (0-100)
perfil     Text (12)    ('espontaneo' | 'mesura' | 'reflexivo')
```

### 12. IntegrityScores (NUEVA)

Header-level del test de integridad.

```
ROWID              BigInt
result_id          Text (FK unique)
overall            Text (10)   ('bajo' | 'medio' | 'alto')
overall_pct        Integer (0-100)
recomendacion      Text (100)
buena_impresion    Text (10)   ('bajo' | 'medio' | 'alto')
buena_impresion_pct Integer
```

### 13. IntegrityDimensions (NUEVA)

Una row por dimensión del integrity test.

```
ROWID           BigInt
result_id       Text (FK)
dimension       Text (30)     ('honestidad' | 'hurto' | 'soborno' | ... 15 dims)
nivel           Text (10)     ('bajo' | 'medio' | 'alto')
pct             Integer (0-100)
```

Índice implícito: `(result_id, dimension)` unique.

### 14. TechnicalScores (NUEVA)

```
ROWID          BigInt
result_id      Text (FK unique)
score_pct      Integer (0-100)
total_correct  Integer
total_questions Integer
passed         Boolean         (score_pct >= min_technical_score del job)
```

### 15. CompetenciaScores (NUEVA)

Una row por competencia calculada.

```
ROWID            BigInt
result_id        Text (FK)
competencia_id   Text (50)
nombre           Text (100)   (desnormalizado — nombre al momento del cálculo)
score            Integer (0-100)
```

### 16. ScreenExits (NUEVA, append-only)

Una row por cada salida de pantalla.

```
ROWID           BigInt
result_id       Text
section         Text (30, nullable)    ('DISC' | 'Verbal' | ...)
question_idx    Integer nullable
question_id     Text (30, nullable)
exit_type       Text (10)   ('tab' | 'window' | 'cursor')
left_at         DateTime
returned_at     DateTime nullable
duration_sec    Integer nullable
```

Reemplaza los campos `screen_exits` y `screen_exit_log` actuales que son JSON blob inconsistente.

### 17. PipelineTransitions (NUEVA, append-only)

Historia completa de cambios de estado.

```
ROWID             BigInt
result_id         Text
from_stage        Text (30, nullable)
to_stage          Text (30)
actor             Text (30)    ('admin:<user>' | 'system' | 'webhook' | 'timeout')
reason            Text (200, nullable)
transitioned_at   DateTime
```

### 18. ClientReports (rediseñada — con access_token)

```
ROWID                    BigInt
tenant_id                Text (50)       🆕
job_id                   Text
company_slug             Text (100)
job_slug                 Text (100)
status                   Text (20)    ('draft' | 'published' | 'archived')
published_at             DateTime nullable
comparison_file_id       Text (50, nullable)
en_comparison_file_id    Text (50, nullable)
access_token             Text (64, nullable)   🆕 HMAC para URLs públicos
created_at               DateTime
```

**Nota:** `access_token` se genera al crear report. Populated via migration para reportes legacy published.

### 19. ReportCandidates (limpiada)

**Eliminar** las 7 columnas `explanation_*` (todas van a File Store).

```
ROWID                    BigInt
report_id                Text
candidate_id             Text
references_json          Text (long, max 3000)   (array de referencias, se queda — lectura junto)
curriculum_file_id       Text (50, nullable)
report_file_id           Text (50, nullable)     (archivo con todas las explicaciones, desde File Store)
sort_order               Integer
```

### 20. TechLibrary (sin cambio)

```
ROWID       BigInt
name        Text (255)
company     Text (255, nullable)
prompt      Text (long)
origin      Text (10)    ('ai' | 'manual')
created_at  DateTime
```

### 21. ProcessedEvents (NUEVA — idempotencia)

```
ROWID         BigInt
event_id      Text (100, unique en código)
provider      Text (30)     ('submit_test' | 'anthropic_call' | 'webhook_*')
received_at   DateTime
```

### 22. OutboxEvents (NUEVA — async side-effects)

```
ROWID              BigInt
event_type         Text (50)    ('report.translate_en' | 'email.send_pending' | ...)
payload            Text (long)   (JSON)
status             Text (15)    ('pending' | 'processing' | 'sent' | 'failed')
retry_count        Integer (default 0)
last_error         Text (500, nullable)
created_at         DateTime
processed_at       DateTime nullable
```

### 23. AuditLog (NUEVA)

```
ROWID            BigInt
actor_user       Text (255)
action           Text (50)    ('job.create' | 'job.update' | 'report.publish' | ...)
resource_type    Text (30)
resource_id      Text (50, nullable)
changes          Text (long, max 5000, nullable)   (JSON diff)
ip               Text (45, nullable)
user_agent       Text (300, nullable)
created_at       DateTime
```

### 24. TokenUsage (NUEVA — tracking real Anthropic)

```
ROWID            BigInt
job_id           Text (50, nullable)
action           Text (50)    ('generate_technical' | 'report_explanation_*' | 'translate_en_*' | ...)
model            Text (50)    ('claude-haiku-4-5-20251001')
input_tokens     Integer
output_tokens    Integer
cached_tokens    Integer (default 0)
duration_ms      Integer
created_at       DateTime
```

### 25. CircuitBreakers (NUEVA)

```
ROWID              BigInt
service            Text (30, unique check)    ('anthropic' | ...)
failure_count      Integer (default 0)
open_until         BigInt (default 0)     (epoch ms; 0 = closed)
last_failure_at    DateTime nullable
last_success_at    DateTime nullable
last_error         Text (500, nullable)
```

### 26. Config (NUEVA — feature flags y thresholds dinámicos)

Complementa env vars con configuración runtime modificable sin redeploy.

```
ROWID         BigInt
key           Text (50, unique check)
value         Text (long)
value_type    Text (10)    ('string' | 'number' | 'boolean' | 'json')
description   Text (300)
updated_at    DateTime
updated_by    Text (100)
```

Uso: `FEATURE_REPORT_AUTO_COMPARE_ENABLED`, `MAX_CANDIDATES_PER_REPORT`, etc.

---

## Tablas Plan B — operativo (NUEVAS)

Estas tablas habilitan el pipeline operativo, portal cliente, videos dinámicos, bot decisor y outbound. Cada tabla tiene `tenant_id` (multi-tenant).

### 27. JobApplications (NUEVA — ver [18](18_PIPELINE_OPERATIVO.md))

Reemplaza al `Candidates`+`Results` viejo como entidad de aplicación a un puesto. Una app = un candidato + un job. Una persona puede aplicar a varios jobs.

```
ROWID                    BigInt
tenant_id                BigInt (FK Tenants)
candidate_id             BigInt (FK Candidates) -- persona
job_id                   BigInt (FK Jobs)
state                    Text (50)              -- ver state machine en [18]
recruit_candidate_id     Text (64, nullable)    -- correlación Recruit
source                   Text (30)              -- 'recruit_free' | 'linkedin_paid' | 'outbound_heyreach' | 'outbound_internal' | 'direct'
prefilter_status         Text (20)              -- 'pending' | 'passed' | 'failed' | 'salary_out_of_range'
resume_file_id           Text (100, nullable)   -- File Store ID
resume_summary           Text (long, nullable)  -- IA-generated
nda_signed_at            DateTime (nullable)
created_at               DateTime
updated_at               DateTime

INDEX idx_app_job_state (job_id, state)
INDEX idx_app_candidate (candidate_id)
UNIQUE (tenant_id, recruit_candidate_id) WHERE recruit_candidate_id IS NOT NULL
UNIQUE (job_id, candidate_id)            -- una sola app por (job, candidate)
```

### 28. ApplicationTransitions (NUEVA, append-only)

State machine audit log de `JobApplications`.

```
ROWID                BigInt
application_id       BigInt (FK)
tenant_id            BigInt
from_state           Text (50, nullable)
to_state             Text (50)
actor                Text (50)              -- 'bot' | 'admin:<userId>' | 'system' | 'webhook:<provider>'
confidence           Decimal(4,3, nullable) -- si actor=bot
reason               Text (long, nullable)
metadata             JSON (nullable)         -- {bot_decision_id, override_of, ...}
transitioned_at      DateTime

INDEX idx_app_trans (application_id, transitioned_at)
```

### 29. PrefilterQuestions (NUEVA — [18](18_PIPELINE_OPERATIVO.md))

Preguntas de prefiltro configurables por job.

```
ROWID            BigInt
tenant_id        BigInt
job_id           BigInt (FK Jobs)
question_text    Text (500)
question_type    Text (20)    -- 'salary_range' | 'language' | 'location' | 'years_exp' | 'boolean' | 'free_text'
options          JSON         -- para dropdowns/multi-choice
required         Boolean
disqualifying    Boolean      -- si la respuesta "mala" rechaza automático
disqualify_rule  JSON         -- ej: {operator: '>', value: 5000} para salary
order_index      Int

INDEX idx_pre_job (job_id, order_index)
```

### 30. PrefilterAnswers (NUEVA)

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt
question_id      BigInt
answer_text      Text (long)
answer_value     JSON          -- estructura según question_type
created_at       DateTime

UNIQUE (application_id, question_id)
```

### 31. RecruitStageMappings (NUEVA — [23](23_INTEGRACIONES_ZOHO.md))

```
ROWID                  BigInt
tenant_id              BigInt
sharktalents_state     Text (50)
recruit_stage          Text (100)

UNIQUE (tenant_id, sharktalents_state)
```

### 32. RecruitJobMappings (NUEVA)

Mapea jobs en Recruit ↔ jobs en SharkTalents para webhook entrante.

```
ROWID                  BigInt
tenant_id              BigInt
job_id                 BigInt (FK Jobs)
recruit_job_id         Text (64)
recruit_job_title      Text (200)
auto_intake_enabled    Boolean       -- si false, webhook crea pero no procesa

UNIQUE (tenant_id, recruit_job_id)
```

### 33. RecruitSyncQueue (NUEVA — outbox para sync saliente)

```
ROWID                  BigInt
tenant_id              BigInt
application_id         BigInt
recruit_candidate_id   Text (64)
target_stage           Text (100)
attempt                Int           -- 0..5
next_attempt_at        DateTime
last_error             Text (long, nullable)
status                 Text (20)     -- 'pending' | 'in_progress' | 'done' | 'dead_letter'
created_at             DateTime
completed_at           DateTime (nullable)

INDEX idx_recruit_sync_pending (status, next_attempt_at)
```

### 34. ContinueTokens (NUEVA — [18](18_PIPELINE_OPERATIVO.md))

Tokens HMAC para resumir aplicaciones desde email/WhatsApp sin login.

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt
token            Text (64, unique)
purpose          Text (30)     -- 'prefilter' | 'disc' | 'technical' | 'video' | 'final'
expires_at       DateTime
used_at          DateTime (nullable)
created_at       DateTime

UNIQUE (token)
INDEX idx_token_app (application_id)
```

### 35. JobBossProfiles (NUEVA — [19](19_PRUEBA_TECNICA_DOBLE_EJE.md))

Perfil de jefe directo capturado en onboarding del puesto. Permite calcular match candidato↔jefe.

```
ROWID                 BigInt
tenant_id             BigInt
job_id                BigInt (FK Jobs, unique)
boss_disc_d           Decimal(5,2, nullable)
boss_disc_i           Decimal(5,2, nullable)
boss_disc_s           Decimal(5,2, nullable)
boss_disc_c           Decimal(5,2, nullable)
boss_autonomy_score   Decimal(5,2, nullable)  -- escala 0-100 desde respuestas situacionales del jefe
boss_decision_speed   Decimal(5,2, nullable)
boss_communication    Text (50, nullable)     -- 'directo' | 'colaborativo' | ...
captured_via          Text (30)               -- 'briefing_form' | 'transcript_extract' | 'manual'
captured_at           DateTime

UNIQUE (job_id)
```

### 36. TechnicalScores (EXTENDIDA — agregar columnas)

Extender la tabla #14 con axis dual.

```
+ knowledge_score          Decimal(5,2)    -- 0-100 conocimiento factual
+ knowledge_max            Decimal(5,2)
+ situational_validity     Decimal(5,2)    -- 0-100 valido por contexto
+ situational_style        Decimal(5,2)    -- axis autonomy_vs_consult, -50..+50
+ axis_alignment_with_boss Decimal(5,2, nullable) -- match con JobBossProfiles
```

### 37. JobProfileDrafts (NUEVA — [17](17_PORTAL_CLIENTE.md))

Borrador de perfil de puesto generado desde transcript de discovery call.

```
ROWID                BigInt
tenant_id            BigInt
client_email         Text (255)
company_name         Text (200)
role_title           Text (200, nullable)
booking_id           Text (64, nullable)        -- Bookings appointment_id
meeting_id           Text (64, nullable)        -- ZohoMeetings.meeting_id
transcript_id        BigInt (nullable)          -- ZohoMeetings.ROWID
draft_payload        JSON                       -- estructura tentativa de Job
status               Text (20)                  -- 'pending_meeting' | 'transcript_ready' | 'draft_generated' | 'client_approved' | 'job_created'
job_id               BigInt (FK Jobs, nullable) -- si ya se materializó
client_approved_at   DateTime (nullable)
created_at           DateTime
updated_at           DateTime

INDEX idx_draft_status (tenant_id, status)
```

### 38. ClientNotifications (NUEVA — [17](17_PORTAL_CLIENTE.md))

Audit/outbox de notificaciones milestone al cliente.

```
ROWID            BigInt
tenant_id        BigInt
job_id           BigInt
milestone        Text (40)     -- 'profile_ready' | 'search_started' | 'funnel_active' | 'finalists_ready'
channel          Text (10)     -- 'email' | 'whatsapp' | 'both'
recipient_email  Text (255, nullable)
recipient_phone  Text (30, nullable)
template_id      Text (60)
payload          JSON
status           Text (20)     -- 'pending' | 'sent' | 'failed' | 'acked'
provider_id      Text (100, nullable)
sent_at          DateTime (nullable)
attempt          Int

INDEX idx_client_notif_pending (status, ROWID)
UNIQUE (job_id, milestone, channel)            -- 1 sola por milestone/canal
```

### 39. ClientNotificationTemplates (NUEVA)

```
ROWID            BigInt
tenant_id        BigInt
template_id      Text (60)
channel          Text (10)
language         Text (5)      -- 'es' | 'en'
subject          Text (200, nullable)
body             Text (long)
variables        JSON
updated_at       DateTime

UNIQUE (tenant_id, template_id, channel, language)
```

### 40. JobTrackingSnapshots (NUEVA — [17](17_PORTAL_CLIENTE.md))

Snapshots para tracking estilo Uber Eats (refresh aware).

```
ROWID            BigInt
tenant_id        BigInt
job_id           BigInt
captured_at      DateTime
funnel_stage     Text (40)
counts           JSON          -- { applied: 23, prefilter_passed: 12, disc: 8, ... }
eta_estimate     DateTime (nullable)
visible_to       Text (30)     -- 'client' | 'admin' | 'both'

INDEX idx_track_job (job_id, captured_at)
```

### 41. VideoQuestions (NUEVA — [20](20_VIDEOS_DINAMICOS.md))

7 preguntas dinámicas por candidato.

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt
order_index      Int           -- 1..7
category         Text (40)     -- 'technical' | 'weakness_followup' | 'situational' | 'cv_claim_check' | 'integrity_check' | 'english_check'
question_text    Text (long)
expected_signals JSON          -- guía para evaluación IA
generated_by     Text (30)     -- 'bot:<model>' | 'admin'
generated_at     DateTime
deadline_at      DateTime

UNIQUE (application_id, order_index)
INDEX idx_videoq_app (application_id)
```

### 42. VideoResponses (NUEVA)

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt
question_id      BigInt
attempt          Int           -- 1 | 2 (max 2 attempts)
modality         Text (10)     -- 'video' | 'audio' | 'text'
file_id          Text (100, nullable)        -- File Store
duration_sec     Int (nullable)
transcript       Text (long, nullable)       -- Whisper
transcript_lang  Text (5, nullable)
ia_evaluation    JSON (nullable)             -- score por signal
recorded_at      DateTime
expires_at       DateTime                    -- 30 días post job close

UNIQUE (question_id, attempt)
INDEX idx_videoresp_app (application_id)
INDEX idx_videoresp_expire (expires_at)
```

### 43. VideoConsents (NUEVA — GDPR)

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt (unique)
consent_given    Boolean
consent_text     Text (long)   -- snapshot del texto
ip               Text (45)
user_agent       Text (500)
consented_at     DateTime
revoked_at       DateTime (nullable)

UNIQUE (application_id)
```

### 44. BotDecisions (NUEVA — [21](21_BOT_DECISOR.md))

Cada decisión del bot decisor.

```
ROWID                  BigInt
tenant_id              BigInt
application_id         BigInt
stage                  Text (50)     -- de qué etapa salió la decisión
recommended_state      Text (50)
confidence             Decimal(4,3)  -- 0..1
mode                   Text (10)     -- 'cold' | 'warm' | 'hot'
threshold_at_decision  Decimal(4,3)
prompt_hash            Text (64)
rag_examples_used      JSON          -- IDs de BotTrainingExamples consultados
rationale              Text (long)
auto_applied           Boolean       -- true si confidence >= threshold
admin_override_state   Text (50, nullable)
admin_override_reason  Text (long, nullable)
admin_override_at      DateTime (nullable)
admin_override_by      Text (100, nullable)
created_at             DateTime

INDEX idx_botdec_app (application_id, created_at)
INDEX idx_botdec_review (auto_applied, confidence)
```

### 45. BotTrainingExamples (NUEVA)

Cada override genera un training example.

```
ROWID                BigInt
tenant_id            BigInt
application_id       BigInt
stage                Text (50)
context_snapshot     JSON          -- snapshot de scores y datos disponibles
correct_decision     Text (50)
correct_reason       Text (long)
example_quality      Text (10)     -- 'gold' (Cris) | 'silver' (auto-confirm) | 'bronze' (legacy import)
embedding            JSON (nullable)  -- futuro vector search
created_at           DateTime

INDEX idx_train_stage (stage, example_quality)
```

### 46. ReviewQueue (NUEVA)

Cuando confidence < threshold, va a queue manual.

```
ROWID            BigInt
tenant_id        BigInt
application_id   BigInt (unique)
bot_decision_id  BigInt (FK)
priority         Int           -- 1 (alta) .. 5 (baja)
assigned_to      Text (100, nullable)
status           Text (20)     -- 'open' | 'in_review' | 'resolved'
resolved_at      DateTime (nullable)
created_at       DateTime

INDEX idx_review_open (status, priority, created_at)
```

### 47. CandidatePool (NUEVA — [22](22_OUTBOUND_SOURCING.md))

Pool interno cross-job para outbound.

```
ROWID                  BigInt
tenant_id              BigInt
candidate_id           BigInt (FK Candidates, nullable)  -- si ya aplicó alguna vez
linkedin_url           Text (500, nullable, unique)
full_name              Text (200)
email                  Text (255, nullable)
phone                  Text (30, nullable)
country                Text (50, nullable)
city                   Text (100, nullable)
languages              JSON          -- ['es', 'en']
years_exp              Decimal(4,1, nullable)
technical_areas        JSON          -- ['frontend', 'react', 'node']
last_disc_d            Decimal(5,2, nullable)
last_disc_i            Decimal(5,2, nullable)
last_disc_s            Decimal(5,2, nullable)
last_disc_c            Decimal(5,2, nullable)
last_cognitive_level   Text (20, nullable)        -- 'basic' | 'mid' | 'senior'
last_evaluated_at      DateTime (nullable)
opt_out                Boolean
opt_out_reason         Text (200, nullable)
source                 Text (30)                  -- 'past_application' | 'manual' | 'heyreach_replied'
created_at             DateTime
updated_at             DateTime

INDEX idx_pool_match (tenant_id, last_evaluated_at)
INDEX idx_pool_email (email)
UNIQUE (linkedin_url) WHERE linkedin_url IS NOT NULL
```

### 48. OutreachCampaigns (NUEVA)

```
ROWID            BigInt
tenant_id        BigInt
job_id           BigInt (FK Jobs, nullable)
name             Text (100)
provider         Text (20)     -- 'heyreach' | 'internal'
provider_campaign_id Text (100, nullable)
status           Text (20)     -- 'draft' | 'active' | 'paused' | 'closed'
template_id      BigInt (FK OutreachTemplates, nullable)
target_count     Int
sent_count       Int
replied_count    Int
created_at       DateTime
launched_at      DateTime (nullable)
closed_at        DateTime (nullable)

INDEX idx_camp_status (tenant_id, status)
```

### 49. OutreachContacts (NUEVA)

```
ROWID                  BigInt
tenant_id              BigInt
campaign_id            BigInt
pool_member_id         BigInt (FK CandidatePool)
provider_contact_id    Text (100, nullable)        -- HeyReach lead id
status                 Text (30)                   -- 'queued' | 'invite_sent' | 'connected' | 'replied' | 'meeting_booked' | 'rejected' | 'unsubscribed'
last_action_at         DateTime
notes                  Text (long, nullable)

UNIQUE (campaign_id, pool_member_id)
INDEX idx_outreach_status (status)
```

### 50. OutreachInbox (NUEVA — inbox unificada)

```
ROWID            BigInt
tenant_id        BigInt
contact_id       BigInt (FK OutreachContacts)
direction        Text (10)     -- 'in' | 'out'
channel          Text (20)     -- 'linkedin_dm' | 'email' | 'whatsapp'
body             Text (long)
attachments      JSON
sent_at          DateTime
read_at          DateTime (nullable)
provider_message_id Text (100, nullable)

INDEX idx_inbox_contact (contact_id, sent_at)
INDEX idx_inbox_unread (tenant_id, read_at)
```

### 51. OutreachTemplates (NUEVA)

```
ROWID            BigInt
tenant_id        BigInt
template_id      Text (60)
channel          Text (20)
language         Text (5)
subject          Text (200, nullable)
body             Text (long)
variables        JSON
last_used_at     DateTime (nullable)

UNIQUE (tenant_id, template_id, channel, language)
```

### 52. IntegrationSecrets (NUEVA — [23](23_INTEGRACIONES_ZOHO.md))

OAuth tokens encriptados.

```
ROWID                      BigInt
tenant_id                  BigInt
provider                   Text (50)     -- 'zoho_recruit' | 'zoho_meeting' | 'zoho_bookings' | 'zoho_sign' | 'heyreach' | ...
refresh_token_enc          Text (long)   -- encrypted
access_token_enc           Text (long, nullable)
access_token_expires_at    DateTime (nullable)
scopes                     Text (long)
metadata                   JSON          -- template_ids, account_ids, etc.
rotated_at                 DateTime (nullable)
created_at                 DateTime

UNIQUE (tenant_id, provider)
```

### 53. ZohoMeetings (NUEVA)

```
ROWID                BigInt
tenant_id            BigInt
meeting_id           Text (64, unique)
context_type         Text (30)     -- 'discovery_call' | 'final_interview' | 'other'
context_id           BigInt (nullable)
host_email           Text (255, nullable)
started_at           DateTime (nullable)
ended_at             DateTime (nullable)
duration_minutes     Int (nullable)
recording_url        Text (long, nullable)
transcript_id        Text (64, nullable)
transcript_status    Text (30)     -- 'pending' | 'zia_ready' | 'whisper_fallback' | 'failed'
transcript_enc       Text (long, nullable)  -- encrypted
whisper_attempted    Boolean
created_at           DateTime

UNIQUE (meeting_id)
INDEX idx_zm_pending (transcript_status, ended_at)
```

### 54. IntegrationHealth (NUEVA)

```
ROWID                BigInt
tenant_id            BigInt
provider             Text (50)
status               Text (20)     -- 'ok' | 'degraded' | 'down'
last_check_at        DateTime
last_success_at      DateTime (nullable)
last_error           Text (long, nullable)

UNIQUE (tenant_id, provider)
```

---

## State machine de `pipeline_stage`

> Nota: este es el state machine **legado** del prototipo. Bajo Plan B, la fuente de verdad operativa pasa a `JobApplications.state` con un universo de estados más amplio. Ver [18](18_PIPELINE_OPERATIVO.md) para el state machine completo de Plan B.

### Estados válidos (enum)

```
-- Inicio
NULL                        -- estado "nuevo, sin decisión"

-- Pipeline técnica
next_stage                  -- pasa a siguiente etapa (aprobó técnica)
salary_out_of_range         -- filtrado por salario
rejected_technical          -- rechazado en técnica

-- Pipeline Kudert/Conductual
next_stage_kudert           -- aprobado conductualmente
review_cv_kudert            -- duda, revisar CV
rejected_kudert             -- rechazado conductualmente

-- Pipeline Integridad
interview_integrity         -- llamar a entrevista
rejected_integrity          -- rechazado por integridad

-- Final
hired                       -- contratado
declined_offer              -- rechazó la oferta
```

### Transiciones válidas

```javascript
const TRANSITIONS = {
  null: ['next_stage', 'salary_out_of_range', 'rejected_technical',
         'next_stage_kudert', 'review_cv_kudert', 'rejected_kudert',
         'interview_integrity', 'rejected_integrity'],

  next_stage: [null, 'rejected_technical', 'salary_out_of_range',
               'next_stage_kudert', 'review_cv_kudert', 'rejected_kudert',
               'interview_integrity', 'rejected_integrity', 'hired'],

  salary_out_of_range: [null, 'next_stage'],
  rejected_technical: [null],

  next_stage_kudert: [null, 'review_cv_kudert', 'rejected_kudert',
                      'interview_integrity', 'rejected_integrity', 'hired'],
  review_cv_kudert: [null, 'next_stage_kudert', 'rejected_kudert'],
  rejected_kudert: [null],

  interview_integrity: [null, 'rejected_integrity', 'hired', 'declined_offer'],
  rejected_integrity: [null],

  hired: ['declined_offer'],
  declined_offer: [null]
};
```

Implementación en [functions/api/src/services/stateMachine.ts](../../functions/api/src/services/stateMachine.ts):

```typescript
export async function transitionPipeline(
  req: any,
  resultId: string,
  newStage: string | null,
  actor: string,
  reason?: string
): Promise<void> {
  const result = await db.results.getById(req, resultId);
  const current = result.pipeline_stage || null;

  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(newStage)) {
    throw new ValidationError(
      `Invalid transition: ${current} → ${newStage}`
    );
  }

  // Idempotencia: si ya está en el target, no hacer nada
  if (current === newStage) return;

  await db.results.update(req, resultId, { pipeline_stage: newStage });
  await db.pipelineTransitions.insert(req, {
    result_id: resultId,
    from_stage: current,
    to_stage: newStage,
    actor,
    reason: reason || '',
    transitioned_at: db.now(),
  });

  console.log(`[PIPELINE] Result ${resultId}: ${current} → ${newStage} by ${actor}`);
}
```

---

## Convenciones de nombres

Aplicar consistentemente en todas las tablas:

- **Tablas:** `PascalCase` plural (`DiscScores`, no `disc_score`).
- **Columnas:** `snake_case` (`created_at`, `disc_d`).
- **FKs:** `<entity>_id` (`result_id`, no `resultId`).
- **Booleans:** prefijo `is_` o `has_` (`is_active`, `has_subscription`).
- **Timestamps:** sufijo `_at` (`created_at`, `transitioned_at`).
- **Enums:** `snake_case` para los valores string (`next_stage`, `rejected_kudert`).

---

## Checklist creación de tablas en Catalyst Console

Por cada tabla:

1. **Catalyst Console → DataStore → Create Table**
2. Nombre exacto en `PascalCase`.
3. Columnas:
   - Tipo correcto (`Text (short/long)`, `Integer`, `Decimal`, `Boolean`, `DateTime`, `BigInt`).
   - Longitudes apropiadas (no usar `Text (long)` si son 20 chars).
   - Nullable donde aplique.
4. No crear `id`, `created_at`, `modified_at` manualmente — Catalyst ya da `ROWID`, `CREATEDTIME`, `MODIFIEDTIME`.
5. Anotar el nombre exacto en `docs/master-plan/schema.md` (post-creación) para referencia.

### Tablas en el orden recomendado

Por dependencia de FKs:

1. `Tenants` (sin FKs — primera tabla crítica)
2. `Config`
3. `ApiKeys` → FK Tenants
4. `TechLibrary` → FK Tenants
5. `Jobs` → FK Tenants
6. `JobProfiles` → FK Jobs
7. `JobCompetencias` → FK Jobs
8. `JobCostConfig` → FK Jobs
9. `Candidates` → FK Tenants
10. `Assessments` → FK Jobs, Tenants (denormalizado)
11. `AssessmentQuestions` → FK Assessments (tenant denormalizado)
12. `Results` → FK Assessments, Candidates, Tenants (denormalizado)
13. `DiscScores` → FK Results, Tenants
14. `CognitiveScores` → FK Results, Tenants
15. `EmotionalScores` → FK Results, Tenants
16. `IntegrityScores` → FK Results, Tenants
17. `IntegrityDimensions` → FK Results, Tenants
18. `TechnicalScores` → FK Results, Tenants
19. `CompetenciaScores` → FK Results, Tenants
20. `ScreenExits` → FK Results, Tenants
21. `PipelineTransitions` → FK Results, Tenants
22. `ClientReports` → FK Jobs, Tenants
23. `ReportCandidates` → FK ClientReports, Candidates, Tenants
24. `ProcessedEvents` (global)
25. `OutboxEvents` → FK Tenants
26. `AuditLog` → FK Tenants
27. `TokenUsage` → FK Tenants
28. `CircuitBreakers` (global)
29. `RateLimitEvents` (global — key incluye tenant)
30. `HealthChecks` (global)

---

## Archivos `db/` — un módulo por tabla

Cada tabla tiene su `functions/api/src/db/<entity>.ts` con las funciones CRUD + queries específicas.

Template:

```typescript
// functions/api/src/db/discScores.ts
import * as db from './helpers';

export interface DiscScore {
  id: string;
  result_id: string;
  raw_d: number; raw_i: number; raw_s: number; raw_c: number;
  normalized_d: number; normalized_i: number; normalized_s: number; normalized_c: number;
  perfil_dominante: 'D' | 'I' | 'S' | 'C';
  pk_id: string | null;
}

export async function insert(req: any, data: Omit<DiscScore, 'id'>): Promise<DiscScore> {
  const row = await db.insert(req, 'DiscScores', data);
  return { id: row.ROWID, ...data };
}

export async function getByResultId(req: any, resultId: string): Promise<DiscScore | null> {
  return await db.queryOne(
    req,
    `SELECT * FROM DiscScores WHERE result_id = ${db.esc(resultId)}`,
    'DiscScores'
  );
}

export async function getByResultIds(req: any, resultIds: string[]): Promise<Map<string, DiscScore>> {
  if (resultIds.length === 0) return new Map();
  const list = resultIds.map(id => db.esc(id)).join(',');
  const rows = await db.queryAll(
    req,
    `SELECT * FROM DiscScores WHERE result_id IN (${list})`,
    'DiscScores'
  );
  return new Map(rows.map(r => [r.result_id, r]));
}
```

Cada query usa `escapeSql` y las que leen varios rows exponen una versión `batch` para eliminar N+1 (ver [Fase 4](05_FASE4_BACKEND.md)).

---

## Refinements a la escritura

### Al escribir un Result completo

Cuando un candidato termina un test (`/submit`), se deben crear:
- 1 row en `Results`
- 1 row en `DiscScores` (si es kudert)
- 1 row en `CognitiveScores` (si es kudert)
- 1 row en `EmotionalScores` (si es kudert)
- 54 rows en `CompetenciaScores` (si es kudert) — batch insert
- 1 row en `TechnicalScores` (si es technical)
- 1 row en `IntegrityScores` (si es integrity)
- 9-15 rows en `IntegrityDimensions` (si es integrity) — batch insert
- N rows en `ScreenExits` (de `exitLog`)

Esto son muchos inserts. Dos opciones:

**A) Insert secuencial** (simple, lento): ~60 inserts por submit = ~5 seg en Catalyst.

**B) Batch insert usando transaction-like pattern**:
```typescript
async function insertResultComplete(req: any, resultData: ...) {
  const result = await db.results.insert(req, { ... });
  const resultId = result.id;

  // Inserts en paralelo (Catalyst no tiene transactions, pero es aceptable)
  await Promise.all([
    db.discScores.insert(req, { result_id: resultId, ... }),
    db.cognitiveScores.insert(req, { result_id: resultId, ... }),
    db.emotionalScores.insert(req, { result_id: resultId, ... }),
    db.competenciaScores.insertBatch(req, competencias.map(c => ({
      result_id: resultId, ...c
    }))),
    ...screenExits.map(e => db.screenExits.insert(req, { result_id: resultId, ...e })),
  ]);

  return result;
}
```

**Riesgo:** si algún insert de los secundarios falla después del `Results`, queda orphan data. Mitigación:
- Sanity check en lectura: si `Results` existe pero `DiscScores` no, marcar como `status: 'incomplete'`.
- Cron de limpieza que detecte orphans y logée para revisión.

---

## Checklist de cierre Fase 2

- [ ] Todas las 26 tablas creadas en Catalyst Console (dev environment)
- [ ] Schema documentado en `docs/master-plan/schema.md` con la config exacta
- [ ] `functions/api/src/db/*.ts` escritos (26 archivos)
- [ ] `functions/api/src/db/helpers.ts` con `escapeSql`, `toCatalystDateTime`, etc.
- [ ] `functions/api/src/services/stateMachine.ts` implementado
- [ ] Smoke test: crear job → crear assessment → candidato hace test → ver results normalizados
- [ ] Query de sanity: `SELECT perfil_dominante, COUNT(*) FROM DiscScores GROUP BY perfil_dominante` funciona
- [ ] Query de sanity: `SELECT to_stage, COUNT(*) FROM PipelineTransitions GROUP BY to_stage` funciona
- [ ] Deploy a dev exitoso con schema nuevo
- [ ] [Script de migración](10_MIGRACION_DATOS.md) listo para probar en dev

---

## Siguiente paso

→ [04_FASE3_SEGURIDAD.md](04_FASE3_SEGURIDAD.md) — auth, HMAC, rate limiting. Puede ejecutarse en paralelo a [05_FASE4_BACKEND.md](05_FASE4_BACKEND.md).
