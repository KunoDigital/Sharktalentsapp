# Block 2 — Tablas DIFERIDAS

> **Cuándo crearlas:** cuando la feature lo necesite. **NO** ahora.
>
> El Block 1 (10 tablas en [MIGRATIONS_BLOCK1.md](MIGRATIONS_BLOCK1.md)) cubre el flujo
> end-to-end básico (crear puesto → recibir candidato → tests → reporte).
>
> Las tablas de este doc se necesitan cuando agregás features específicas:
> - `TokenUsage` → cuando querés ver cuánto gastás en Anthropic
> - `ClientReports` → cuando los reportes son URLs persistentes (no se generan al vuelo)
> - `JobProfileDrafts` → cuando guardás drafts entre sesiones (hoy se pierde si refrescás)
> - `ApiKeys` → cuando exponés API pública para integraciones externas
> - `TechLibrary` → biblioteca de preguntas técnicas reutilizables

## Cómo usar este doc

Mismo flujo que Block 1: Catalyst Console → Cloud Scale → Data Store → + Create Table.

Las reglas universales aplican:
- ROWID, CREATEDTIME, MODIFIEDTIME, CREATORID los crea Catalyst solo
- VarChar max = 255. Si pasa, usar Text
- `Email` y `Phone` no existen → usar Var Char

---

## 1. TokenUsage — tracking de gasto Anthropic

> Útil cuando querés saber: cuánto gasté este mes, qué puesto consumió más, etc.
>
> Sin esta tabla: solo logs estructurados (no queryeable).

**Table name:** `TokenUsage`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| job_id | Var Char | 50 | No | No | |
| action | Var Char | 50 | Sí | No | |
| model | Var Char | 50 | Sí | No | claude-haiku-4-5 |
| input_tokens | Int | | Sí | No | 0 |
| output_tokens | Int | | Sí | No | 0 |
| cached_tokens | Int | | Sí | No | 0 |
| duration_ms | Int | | Sí | No | 0 |
| created_at | DateTime | | Sí | No | |

**Endpoint que va a usarla:** `lib/anthropic.ts` (registra cada call). Cuando crees la tabla, descomentás el código de `recordTokenUsage()`.

---

## 2. ClientReports — cache persistido del bundle del reporte

> Hoy: cada GET /report/bundle/<token> regenera el bundle (4 queries + N llamadas Anthropic).
> Hay un cache in-memory por instancia (TTL 1h, eviction LRU a 100), pero se pierde
> cuando Catalyst hace cold-start.
>
> Con esta tabla: el bundle (datos + narrativas IA) se persiste 7 días desde la primera
> generación. Re-aperturas son lookup directo. Cris ve quién abrió + cuándo + cuántas veces.

**Table name:** `ClientReports`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| job_id | Var Char | 50 | Sí | No | |
| cache_key | Var Char | 64 | Sí | No | |
| bundle_payload | Text | 100000 | Sí | No | |
| status | Var Char | 20 | Sí | No | active |
| opened_count | Int | | Sí | No | 0 |
| last_opened_at | DateTime | | No | No | |
| generated_at | DateTime | | Sí | No | |
| expires_at | DateTime | | Sí | No | |

**Sobre `cache_key`:** sha256 de `{job_id, sorted result_ids, ideal_profile JSON}`.
Si Cris agrega un finalist nuevo, el set de result_ids cambia → key distinto → cache miss
→ se regenera. Misma lógica si edita el ideal_profile.

**Sobre `status`:**
- `active` — vigente, lookup lo encuentra
- `revoked` — invalidado manualmente (ej: error en datos, queremos forzar regeneración)
- `expired` — pasó `expires_at` (no se filtra automáticamente; el código chequea expiry)

**Sobre `bundle_payload`:** JSON con la respuesta completa de `/report/bundle/<token>`
(job + candidates + narratives + summary). Tamaño típico 5-30KB. Catalyst Var Char no
soporta más de 8000, por eso `Text 100000` (margen amplio).

**Migración suave:** el código backend chequea si la tabla existe antes de leer/escribir.
Si no existe, sigue funcionando con el cache in-memory. Endpoints como
`POST /api/portals/issue` no fallan por la falta de tabla.

---

## 3. ReportCandidates — qué candidatos van en cada reporte

**Table name:** `ReportCandidates`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| report_id | Var Char | 50 | Sí | No | |
| candidate_id | Var Char | 50 | Sí | No | |
| order_idx | Int | | Sí | No | 0 |
| narrative_es | Text | | No | No | |
| narrative_en | Text | | No | No | |

---

## 4. JobProfileDrafts — drafts persistentes con histórico

> Hoy: el draft de IA se genera, lo revisás, lo aplicás o descartás. Si refrescás, se pierde.
>
> Con esta tabla: cada draft queda guardado, con histórico de versiones (vos editás, IA refina).

**Table name:** `JobProfileDrafts`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| transcript | Text | | No | No | |
| transcript_source | Var Char | 30 | Sí | No | manual |
| meeting_url | Var Char | 255 | No | No | |
| draft_payload | Text | | Sí | No | |
| status | Var Char | 30 | Sí | No | draft_generated |
| version | Int | | Sí | No | 1 |
| highlights | Text | | No | No | |
| created_by | Var Char | 255 | Sí | No | |
| client_email | Var Char | 255 | No | No | |
| client_approved_at | DateTime | | No | No | |
| job_id | Var Char | 50 | No | No | |
| created_at | DateTime | | Sí | No | |
| updated_at | DateTime | | Sí | No | |

---

## 5. ApiKeys — API pública para integraciones externas

> Solo cuando vayas a exponer tu backend a Zapier, Make, MCP, etc.

**Table name:** `ApiKeys`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| name | Var Char | 100 | Sí | No | |
| key_hash | Var Char | 128 | Sí | Sí | |
| key_prefix | Var Char | 10 | Sí | No | |
| created_by_user | Var Char | 50 | Sí | No | |
| permissions | Text | | Sí | No | [] |
| rate_limit_per_min | Int | | Sí | No | 60 |
| last_used_at | DateTime | | No | No | |
| expires_at | DateTime | | No | No | |
| is_active | Boolean | | Sí | No | true |
| revoked_at | DateTime | | No | No | |
| created_at | DateTime | | Sí | No | |

---

## 6. TechLibrary — biblioteca de preguntas técnicas reutilizables

> Hoy: cada vez que creás un puesto, IA genera preguntas técnicas desde cero.
>
> Con esta tabla: vos curatás un set, las preguntas buenas se guardan, IA reutiliza
> + adapta. Mejor calidad, menos costo de tokens.

**Table name:** `TechLibrary`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | No | No | |
| topic | Var Char | 100 | Sí | No | |
| difficulty | Var Char | 20 | Sí | No | mid |
| question_text | Text | | Sí | No | |
| options | Text | | No | No | |
| correct_option_idx | Int | | No | No | |
| explanation | Text | | No | No | |
| times_used | Int | | Sí | No | 0 |
| times_passed | Int | | Sí | No | 0 |
| is_public | Boolean | | Sí | No | false |
| created_at | DateTime | | Sí | No | |

---

## 7. AntiCheatEvents — persistir eventos del candidato

> Hoy: los eventos anti-trampa van a logs estructurados (visible en Catalyst Console)
> pero no son queryeables.
>
> Con esta tabla: vos podés filtrar candidatos con >5 eventos anti-trampa, ver patrones, etc.

**Table name:** `AntiCheatEvents`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| result_id | Var Char | 50 | Sí | No | |
| phase | Var Char | 30 | Sí | No | |
| event_type | Var Char | 30 | Sí | No | |
| question_id | Var Char | 50 | No | No | |
| duration_ms | Int | | No | No | |
| created_at | DateTime | | Sí | No | |

**Endpoint que va a usarla:** `features/publicTest.ts` (cuando llega el submit con anti_cheat events).
Hoy se loguean. Cuando exista la tabla, se persisten.

---

## 8. CircuitBreakers — estado del breaker entre instancias

> Hoy: el circuit breaker es in-memory por instancia. Si Catalyst escala a 2+ instancias,
> cada una tiene su breaker propio (puede haber inconsistencia).
>
> Con esta tabla: estado compartido entre instancias.

**Table name:** `CircuitBreakers`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| name | Var Char | 50 | Sí | Sí | |
| state | Var Char | 20 | Sí | No | closed |
| consecutive_failures | Int | | Sí | No | 0 |
| opened_at | DateTime | | No | No | |
| total_calls | Int | | Sí | No | 0 |
| total_failures | Int | | Sí | No | 0 |
| updated_at | DateTime | | Sí | No | |

---

## 9. Config — feature flags y thresholds dinámicos

> Hoy: thresholds (ej: BOT_CONFIDENCE_THRESHOLD_DEFAULT) están en env vars.
> Cambiarlos = re-deploy.
>
> Con esta tabla: cambiar valores en runtime sin re-deploy.

**Table name:** `Config`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| key | Var Char | 100 | Sí | Sí | |
| value | Text | | Sí | No | |
| value_type | Var Char | 20 | Sí | No | string |
| tenant_id | Var Char | 50 | No | No | |
| description | Var Char | 200 | No | No | |
| updated_by | Var Char | 50 | Sí | No | |
| updated_at | DateTime | | Sí | No | |

---

## 10. BotDecisions — log de decisiones del bot decisor

> Cada vez que el bot recomienda una transición, se persiste acá. Audit + base para
> calcular % de overrides y ajustar el threshold de confianza.

**Table name:** `BotDecisions`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| application_id | Var Char | 50 | Sí | No | |
| job_id | Var Char | 50 | Sí | No | |
| from_stage | Var Char | 50 | Sí | No | |
| to_stage_proposed | Var Char | 50 | Sí | No | |
| decision | Var Char | 30 | Sí | No | |
| confidence | Int | | Sí | No | 0 |
| rationale | Text | 5000 | Sí | No | |
| similar_cases | Text | 2000 | No | No | |
| auto_executed | Boolean | | Sí | No | false |
| executed_at | DateTime | | No | No | |
| overridden | Boolean | | Sí | No | false |
| overridden_by | Var Char | 50 | No | No | |
| overridden_at | DateTime | | No | No | |
| overridden_reason | Var Char | 1000 | No | No | |
| created_at | DateTime | | Sí | No | |

**Sobre `confidence`:** entero 0-100 (no Decimal). El backend convierte el output IA (0.0-1.0) a entero al persistir y de vuelta al leer.

---

## 11. ReviewQueue — cola humana cuando confidence < threshold

> Cuando el bot recomienda algo con baja confianza o forzó human review, el item entra acá.
> Cris ve la cola y resuelve cada uno (confirm o override).

**Table name:** `ReviewQueue`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| application_id | Var Char | 50 | Sí | No | |
| bot_decision_id | Var Char | 50 | Sí | No | |
| reason | Var Char | 500 | Sí | No | |
| priority | Var Char | 20 | Sí | No | normal |
| resolved_at | DateTime | | No | No | |
| resolved_by | Var Char | 50 | No | No | |
| resolution | Var Char | 30 | No | No | |
| created_at | DateTime | | Sí | No | |

**Endpoints relacionados:** `GET /api/bot/review-queue` lista pendientes (con join a BotDecisions); `POST /api/bot/review-queue/:id/decide` resuelve.

---

## 12. VideoQuestions — preguntas de video personalizadas por candidato (doc 20)

> Cuando el candidato pasa las 4 pruebas, IA genera 7 preguntas custom (8 si requiere inglés).
> Persisten acá; el candidato las ve via `GET /test/<token>/videos`.

**Table name:** `VideoQuestions`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| application_id | Var Char | 50 | Sí | No | |
| question_id | Var Char | 20 | Sí | No | |
| category | Var Char | 30 | Sí | No | |
| question_text | Text | 1000 | Sí | No | |
| rationale_internal | Text | 1000 | No | No | |
| expected_signals | Text | 2000 | No | No | |
| max_duration_sec | Int | | Sí | No | 60 |
| created_at | DateTime | | Sí | No | |

**Categorías válidas:** `technical`, `weakness_followup`, `situational`, `cv_claim_check`, `integrity_check`, `english_check`.

**`rationale_internal`:** explicación de por qué se generó esta pregunta (Cris la ve, candidato NO).

---

## 13. VideoResponses — respuestas del candidato (transcript + análisis IA)

> Cada attempt del candidato persiste acá. Máximo 2 attempts por pregunta.
> El video físico se guarda en Catalyst File Store; acá solo el `catalyst_file_id`.

**Table name:** `VideoResponses`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| application_id | Var Char | 50 | Sí | No | |
| question_id | Var Char | 20 | Sí | No | |
| attempt | Int | | Sí | No | 1 |
| catalyst_file_id | Var Char | 50 | No | No | |
| duration_sec | Int | | No | No | |
| transcript | Text | 20000 | No | No | |
| transcript_status | Var Char | 20 | Sí | No | pending |
| analysis_payload | Text | 20000 | No | No | |
| analysis_status | Var Char | 20 | Sí | No | pending |
| submitted_at | DateTime | | Sí | No | |

**Estados:**
- `transcript_status`: `pending` (esperando Whisper/Zia), `ok`, `failed`.
- `analysis_status`: `pending` (esperando IA), `ok`, `failed`.

**Flujo asíncrono típico:**
1. Candidato submitea → row creado con `transcript_status='pending'`.
2. Worker de transcripción procesa → update `transcript` + `transcript_status='ok'`.
3. Cris dispara `POST /api/applications/:id/videos/:responseId/analyze` (o trigger automático) → IA analiza el transcript → update `analysis_payload` + `analysis_status='ok'`.

**Auto-delete físico:** cuando el puesto cierra + 30 días, el video físico (catalyst_file_id) se borra. El transcript + analysis quedan en BD para auditoría.

---

## 15. CandidatePool — pool interno para sourcing capa 1 (doc 22)

> Cuando hay puesto nuevo, sistema sugiere candidatos del pool histórico (que aplicaron a otros
> puestos del tenant) ordenados por match. Cris elige a quién contactar — esa es la capa 1 ANTES
> de pagar HeyReach.

**Table name:** `CandidatePool`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| candidate_id | Var Char | 50 | Sí | No | |
| tags | Text | 2000 | No | No | [] |
| disponible_para_outreach | Boolean | | Sí | No | true |
| last_active | DateTime | | No | No | |
| contact_preference | Var Char | 20 | Sí | No | email |
| times_contacted | Int | | Sí | No | 0 |
| last_contacted_at | DateTime | | No | No | |
| notes_internal | Text | 2000 | No | No | |
| disc_d | Int | | No | No | |
| disc_i | Int | | No | No | |
| disc_s | Int | | No | No | |
| disc_c | Int | | No | No | |
| velna_indice | Int | | No | No | |
| cognitive_level | Var Char | 20 | No | No | |
| languages | Text | 500 | No | No | [] |
| created_at | DateTime | | Sí | No | |
| updated_at | DateTime | | Sí | No | |

**Snapshot fields (disc_d/i/s/c, velna_indice, cognitive_level):** copiados al insertar para evitar JOIN en cada match. Se actualizan cuando el candidato hace una nueva aplicación.

**`tags`:** JSON array, ej `["react", "typescript", "remote"]`. Búsqueda por tag se hace en memoria (ZCQL no soporta JSON-contains).

**Algoritmo de match:** `lib/candidatePoolMatcher.ts` con pesos: DISC (30) + cognitive level (20) + área tag (25) + idiomas (10) + recency (15) − penalty contactos previos (hasta −10). Score 0-100.

**Endpoints:**
- `GET /api/pool` (filtros: tag, available_only, limit)
- `POST /api/pool` (manual add con candidate_id existente)
- `PATCH /api/pool/:id` (actualizar tags / disponibilidad / notes)
- `DELETE /api/pool/:id` (soft-remove: disponible_para_outreach=false)
- `POST /api/pool/match` body `{ job_id, area_tags, requires_english, limit }` → top N matches

**Auto-populate del pool:** cuando un Candidate completa una Application, sistema podría auto-insertarlo (extensión futura — hoy el endpoint `POST /api/pool` es manual).

---

## 14. BotTrainingExamples — dataset para RAG/few-shot

> Cada decisión humana (sea confirmando o overrideando al bot) se guarda acá. En v1 son
> el dataset que el bot consulta como "casos similares" cuando toma decisiones nuevas.

**Table name:** `BotTrainingExamples`

| Columna | Tipo | Largo | Obligatorio | Único | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 50 | Sí | No | |
| application_id | Var Char | 50 | Sí | No | |
| job_id | Var Char | 50 | Sí | No | |
| job_cognitive_level | Var Char | 20 | Sí | No | |
| candidate_disc_d | Int | | No | No | |
| candidate_disc_i | Int | | No | No | |
| candidate_disc_s | Int | | No | No | |
| candidate_disc_c | Int | | No | No | |
| candidate_cognitive_indice | Int | | No | No | |
| candidate_technical_pct | Int | | No | No | |
| candidate_integrity_overall | Var Char | 20 | No | No | |
| from_stage | Var Char | 50 | Sí | No | |
| to_stage_chosen | Var Char | 50 | Sí | No | |
| chosen_by | Var Char | 50 | Sí | No | |
| rationale_human | Text | 2000 | Sí | No | |
| bot_had_suggested | Var Char | 50 | No | No | |
| bot_confidence | Int | | No | No | |
| was_override | Boolean | | Sí | No | false |
| quality | Var Char | 20 | Sí | No | standard |
| created_at | DateTime | | Sí | No | |

**Sobre `quality`:** `standard` (default), `high` (caso clásico de referencia), `noise` (Cris se equivocó después). Solo `standard` y `high` se usan en few-shot.

---

## Orden recomendado de creación

Cuando llegue el momento de cada feature:

1. **TokenUsage** — primer mes después de empezar a usar IA. Querés ver cuánto gastás.
2. **JobProfileDrafts** — cuando los clientes empiezan a tener varias iteraciones de un mismo puesto.
3. **ClientReports + ReportCandidates** — cuando los clientes piden volver a abrir reportes viejos.
4. **AntiCheatEvents** — cuando tengas patrones de fraude que querés analizar.
5. **TechLibrary** — cuando la IA esté generando preguntas suficiente y querés curarlas.
6. **ApiKeys** — cuando un cliente o integración pida acceso programático.
7. **CircuitBreakers + Config** — cuando escales a multi-instancia o querás flexibilidad runtime.
8. **BotDecisions + ReviewQueue + BotTrainingExamples** — cuando quieras pasar el bot a modo warm/hot. En cold mode no hace falta (el bot solo recomienda).
9. **VideoQuestions + VideoResponses** — cuando integres Whisper/Zia para transcripción y quieras videos dinámicos personalizados.
10. **CandidatePool** — cuando tengas ≥30 candidatos históricos en el tenant y quieras matching automático para puestos nuevos antes de pagar HeyReach.

Cada tabla agrega 5-15 minutos de creación en consola. No hace falta crear todas a la vez.
