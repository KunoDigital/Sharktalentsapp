# Block 1 — Crear 14 tablas en Catalyst Console

> **Cómo usar este doc:** seguilo de arriba hacia abajo. Por cada tabla:
> 1. En la consola → **Catalyst Project SharkTalentsapp → Development → Cloud Scale → Data Store → +Create Table**
> 2. Tipeás el **nombre exacto** que dice acá
> 3. Por cada columna, click en **+Add Column**, copiás los valores
> 4. Marcá la checkbox `[ ]` cuando termines la tabla
> 5. Al final corrés `node scripts/verify-tables.js` que confirma que todo quedó bien

**Tiempo estimado:** 35-50 min para las 14 tablas (~75 columnas).

**Notas universales:**
- `ROWID` lo crea Catalyst automáticamente (no lo agregás vos). Es siempre `BigInt`, único, primary key.
- `created_at` / `updated_at`: usar tipo `DateTime`, **NO** mandatory (Catalyst los completa solo si lo activás en "Auto fill") — pero por seguridad ponelos como mandatory para tu lógica.
- "Mandatory" = el campo es obligatorio (NOT NULL en SQL).
- "Unique" = constraint único a nivel BD.
- Para FKs (foreign keys): Catalyst no tiene FK reales en BD, las modelamos como `Text` que guarda el `ROWID` apuntado. La integridad la valida tu código.
- **Tipos válidos en Catalyst:** `Text`, `BigInt`, `Integer`, `Decimal`, `Boolean`, `DateTime`, `Email`, `URL`, `Phone`, `Encrypted`.

---

## Checklist de progreso

- [ ] **Tabla 1/14** — Tenants
- [ ] **Tabla 2/14** — ProcessedEvents
- [ ] **Tabla 3/14** — Jobs
- [ ] **Tabla 4/14** — Candidates
- [ ] **Tabla 5/14** — Results
- [ ] **Tabla 6/14** — PipelineTransitions
- [ ] **Tabla 7/14** — DiscScores
- [ ] **Tabla 8/14** — CognitiveScores
- [ ] **Tabla 9/14** — EmotionalScores
- [ ] **Tabla 10/14** — IntegrityScores
- [ ] **Tabla 11/14** — IntegrityDimensions
- [ ] **Tabla 12/14** — TechnicalScores
- [ ] **Tabla 13/14** — AuditLog
- [ ] **Tabla 14/14** — OutboxEvents

---

## 1. Tenants

> Las orgs de Clerk. Cada cliente que se registra en Sharktalents = una row acá.

**Table name:** `Tenants`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| clerk_org_id | Text | 50 | ✅ | ✅ | — | Viene del webhook de Clerk |
| name | Text | 255 | ✅ | — | — | Nombre visible de la org |
| slug | Text | 100 | ✅ | ✅ | — | URL-safe, usado en URLs públicas |
| plan | Text | 20 | ✅ | — | `free` | Valores: `free`/`starter`/`pro`/`enterprise` |
| status | Text | 20 | ✅ | — | `active` | Valores: `active`/`suspended`/`deleted` |
| max_active_jobs | Integer | — | ✅ | — | `5` | Límite del plan |
| max_candidates_per_month | Integer | — | ✅ | — | `50` | Límite del plan |
| features_enabled | Text | 2000 | — | — | `{}` | JSON: `{mcp:bool,api:bool,custom_branding:bool}` |
| branding_config | Text | 2000 | — | — | — | JSON branding (logo, color) |
| billing_email | Text | 255 | — | — | — | Email para facturación |
| created_at | DateTime | — | ✅ | — | — | |
| updated_at | DateTime | — | ✅ | — | — | |

---

## 2. ProcessedEvents

> Idempotencia de webhooks: si Clerk reenvía un evento, no lo procesamos 2 veces.

**Table name:** `ProcessedEvents`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| event_id | Text | 100 | ✅ | ✅ | — | ID externo del evento |
| provider | Text | 30 | ✅ | — | — | `clerk_webhook`/`submit_test`/`anthropic_call`/etc |
| received_at | DateTime | — | ✅ | — | — | |

---

## 3. Jobs

> Los puestos abiertos por cada tenant.

**Table name:** `Jobs`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| tenant_id | Text | 50 | ✅ | — | — | FK → Tenants.ROWID |
| title | Text | 255 | ✅ | — | — | |
| company | Text | 255 | ✅ | — | — | Cliente final (puede diferir del tenant) |
| tech_prompt | Text | 10000 | — | — | — | Prompt para generar técnica |
| cognitive_level | Text | 20 | ✅ | — | `mid` | `basic`/`mid`/`senior` |
| is_active | Boolean | — | ✅ | — | `true` | |
| company_context | Text | 5000 | — | — | — | Contexto para IA |
| ideal_profile | Text | 8000 | — | — | — | JSON: `{disc, disc_b?, velna, competencias, tecnica_minimo_pct, context_summary}` |
| tech_questions_cache | Text | 20000 | — | — | — | JSON array de preguntas técnicas generadas por IA. Se llena con `POST /api/jobs/<id>/tech-questions/generate` |
| created_by | Text | 255 | ✅ | — | — | clerk user_id |
| created_at | DateTime | — | ✅ | — | — | |
| updated_at | DateTime | — | ✅ | — | — | |

**Sobre `ideal_profile`:** se almacena como JSON serializado para no agregar 10+ columnas. El backend valida la shape en cada write. Es opcional — si el campo es null/no existe, el reporte se genera con scores crudos (sin afinidad contra perfil ideal). Ejemplo:

```json
{
  "disc": { "d": 65, "i": 35, "s": 25, "c": 75, "pk_code": "PK-09", "pk_name": "Estratega/Analítico" },
  "velna": { "verbal": 70, "espacial": 60, "logica": 80, "numerica": 70, "abstracta": 65 },
  "competencias": [
    { "name": "Análisis de cartera", "required_pct": 75 },
    { "name": "Negociación", "required_pct": 80 }
  ],
  "tecnica_minimo_pct": 70,
  "context_summary": "Banca corporativa en crecimiento, equipo de 4..."
}
```

**Migración suave:** el backend hace `omitIdealIfNull` antes de cada insert/update, así que jobs que no tienen este campo no fallan aunque la columna no exista todavía. Crear la columna manualmente cuando estés lista.

---

## 4. Candidates

> Las personas que aplican.

**Table name:** `Candidates`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| name | Text | 255 | ✅ | — | — | |
| email | Email | — | ✅ | — | — | Catalyst valida formato; unicidad la valida tu código |
| phone | Phone | — | — | — | — | |
| age | Integer | — | — | — | — | |
| salary_expectation | Integer | — | — | — | — | USD/mes |
| availability | Text | 30 | — | — | — | "Inmediata"/"15 días"/etc |
| interview_file_id | Text | 50 | — | — | — | FK → File Store cuando exista |
| created_at | DateTime | — | ✅ | — | — | |

---

## 5. Results

> La aplicación de un candidato a un puesto. **= JobApplications** del v1. Acá vive el state machine.

**Table name:** `Results`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| assessment_id | Text | 50 | ✅ | — | — | FK → Jobs.ROWID (nombre legacy del v1) |
| candidate_id | Text | 50 | ✅ | — | — | FK → Candidates.ROWID |
| answers | Text | 30000 | — | — | — | JSON `{questionId: number}` |
| pipeline_stage | Text | 30 | ✅ | — | `prefilter_pending` | Ver state machine en doc 03 |
| started_at | DateTime | — | ✅ | — | — | |
| completed_at | DateTime | — | — | — | — | |
| report_downloaded_at | DateTime | — | — | — | — | |
| idempotency_key | Text | 64 | — | — | — | Para dedup en /submit |

---

## 6. PipelineTransitions

> Append-only. Cada cambio de stage en una aplicación queda acá. Auditoría completa.

**Table name:** `PipelineTransitions`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | — | — | FK → Results.ROWID |
| from_stage | Text | 30 | — | — | — | Null para la primera transición |
| to_stage | Text | 30 | ✅ | — | — | |
| actor | Text | 50 | ✅ | — | — | `admin:<user_id>`/`system`/`webhook`/`timeout`/`bot` |
| reason | Text | 200 | — | — | — | |
| transitioned_at | DateTime | — | ✅ | — | — | |

---

## 7. DiscScores

> Resultado del DISC para una aplicación.

**Table name:** `DiscScores`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | ✅ | — | FK → Results.ROWID, único (1:1) |
| raw_d | Integer | — | ✅ | — | `0` | |
| raw_i | Integer | — | ✅ | — | `0` | |
| raw_s | Integer | — | ✅ | — | `0` | |
| raw_c | Integer | — | ✅ | — | `0` | |
| normalized_d | Integer | — | ✅ | — | `0` | 0-100 |
| normalized_i | Integer | — | ✅ | — | `0` | |
| normalized_s | Integer | — | ✅ | — | `0` | |
| normalized_c | Integer | — | ✅ | — | `0` | |
| perfil_dominante | Text | 1 | ✅ | — | `S` | `D`/`I`/`S`/`C` |
| pk_id | Text | 10 | — | — | — | `PK-05`/etc |

---

## 8. CognitiveScores

> Resultado VELNA (5 sub-tests).

**Table name:** `CognitiveScores`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | ✅ | — | FK → Results.ROWID |
| verbal | Integer | — | ✅ | — | `0` | |
| espacial | Integer | — | ✅ | — | `0` | |
| logica | Integer | — | ✅ | — | `0` | |
| numerica | Integer | — | ✅ | — | `0` | |
| abstracta | Integer | — | ✅ | — | `0` | |
| total | Integer | — | ✅ | — | `0` | Suma de aciertos |
| max | Integer | — | ✅ | — | `0` | Máximo posible |
| indice | Integer | — | ✅ | — | `0` | 0-100 |

---

## 9. EmotionalScores

**Table name:** `EmotionalScores`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | ✅ | — | FK → Results.ROWID |
| score | Integer | — | ✅ | — | `0` | 0-100 |
| perfil | Text | 12 | ✅ | — | `mesura` | `espontaneo`/`mesura`/`reflexivo` |

---

## 10. IntegrityScores

> Header del integrity test. El detalle por dimensión va en `IntegrityDimensions`.

**Table name:** `IntegrityScores`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | ✅ | — | FK → Results.ROWID |
| overall | Text | 10 | ✅ | — | `medio` | `bajo`/`medio`/`alto` |
| overall_pct | Integer | — | ✅ | — | `0` | 0-100 |
| recomendacion | Text | 100 | — | — | — | |
| buena_impresion | Text | 10 | ✅ | — | `medio` | Igual valores que overall |
| buena_impresion_pct | Integer | — | ✅ | — | `0` | |

---

## 11. IntegrityDimensions

> Una row por cada dimensión (15 dims × N aplicaciones).

**Table name:** `IntegrityDimensions`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | — | — | FK → Results.ROWID |
| dimension | Text | 30 | ✅ | — | — | `honestidad`/`hurto`/`soborno`/etc (15 valores) |
| nivel | Text | 10 | ✅ | — | `medio` | `bajo`/`medio`/`alto` |
| pct | Integer | — | ✅ | — | `0` | 0-100 |

---

## 12. TechnicalScores

**Table name:** `TechnicalScores`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| result_id | Text | 50 | ✅ | ✅ | — | FK → Results.ROWID |
| score_pct | Integer | — | ✅ | — | `0` | 0-100 |
| total_correct | Integer | — | ✅ | — | `0` | |
| total_questions | Integer | — | ✅ | — | `0` | |
| passed | Boolean | — | ✅ | — | `false` | `score_pct >= job.min_technical_score` |

**Doble eje (doc 19) — columnas adicionales:**

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| tec_situational_validity_pct | Int | — | — | — | — | 0-100. % de situacionales donde eligió una opción válida |
| tec_style_autonomy_consult | Int | — | — | — | — | 0-100. *100 del valor 0-1 (Catalyst no soporta Decimal limpio). 0=consult, 100=autonomy |
| tec_style_match_with_boss_pct | Int | — | — | — | — | 0-100. Match con `Jobs.ideal_profile.boss.style_autonomy_consult` |

**Migración suave:** son nullable; si la pregunta es modelo viejo (1 correcta), estas columnas quedan vacías. El backend hace `omitIfNull` antes del insert/update.

---

## 13. AuditLog

> Quién hizo qué y cuándo. Append-only.

**Table name:** `AuditLog`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| actor_user | Text | 255 | ✅ | — | — | clerk user_id o `system` |
| action | Text | 50 | ✅ | — | — | `job.create`/`job.update`/`report.publish`/etc |
| resource_type | Text | 30 | ✅ | — | — | `job`/`result`/`tenant`/etc |
| resource_id | Text | 50 | — | — | — | ROWID del recurso afectado |
| changes | Text | 5000 | — | — | — | JSON diff |
| ip | Text | 45 | — | — | — | Soporta IPv6 |
| user_agent | Text | 300 | — | — | — | |
| created_at | DateTime | — | ✅ | — | — | |

---

## 14. OutboxEvents

> Side-effects async. Cuando algo dispara una acción que no es crítica (mandar email, sync con Recruit), se mete acá y un worker la procesa.

**Table name:** `OutboxEvents`

| Column name | Type | Length | Mandatory | Unique | Default | Notas |
|---|---|---|---|---|---|---|
| event_type | Text | 50 | ✅ | — | — | `report.translate_en`/`email.send_pending`/etc |
| payload | Text | 5000 | ✅ | — | — | JSON con la data del evento |
| status | Text | 15 | ✅ | — | `pending` | `pending`/`processing`/`sent`/`failed` |
| retry_count | Integer | — | ✅ | — | `0` | |
| last_error | Text | 500 | — | — | — | Mensaje de error si falló |
| created_at | DateTime | — | ✅ | — | — | |
| processed_at | DateTime | — | — | — | — | Null hasta que se procese |

---

## Cuando termines

Corré desde la raíz del repo:

```bash
node scripts/verify-tables.js
```

El script lee la lista de tablas esperadas, llama a la SDK de Catalyst, y te dice:
- ✓ Tablas creadas correctamente
- ✕ Tablas faltantes
- ⚠️ Tablas con columnas faltantes / tipo equivocado

Si todo OK → seguís con deploy del backend.

## Si te trabás en alguna tabla

- **Catalyst no acepta el nombre:** los nombres son case-sensitive y no admiten espacios. Pegá exactamente como dice el `Table name:`.
- **Tipo "Email"/"Phone" no existe:** Catalyst los renombra como "Text" en algunos planes. Si no está, usá `Text(255)`.
- **Default no funciona en Boolean:** algunos campos boolean en Catalyst no aceptan default — dejá el campo vacío en "Default" y manejalo en código.
- **Encrypted:** no lo necesitás en Block 1, ignoralo si aparece.

Si una tabla tiene un error que no podés resolver → pegáme la screenshot y te ayudo.
