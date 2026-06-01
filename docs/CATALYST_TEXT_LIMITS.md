# Catalyst Datastore — límites de texto y por qué importa

## El problema (lo que pasó en v1)

Cuando creabas tablas en Catalyst la primera vez, no te dejaba poner el "max length" en columnas Text. Luego en producción, cuando un texto largo (transcript, draft IA, JSON con DISC + competencias, etc.) se intentaba guardar, Catalyst:

- silenciosamente truncaba el dato, **o**
- tiraba un error 500 sin mensaje claro

El bug era invisible hasta que un cliente reportaba que un campo aparecía cortado o que el guardado fallaba.

## Los límites reales (verificados con soporte Catalyst, 2026-05-08)

| Tipo de columna | Límite real | Notas |
|----|----|----|
| **Var Char** | 255 chars max | Si pasaste más al crear, Catalyst lo rechaza. |
| **Text** | **10,000 chars por columna** | Confirmado por Catalyst help: si excede 10K, hay que usar File Store. |
| **File Store** | sin límite práctico | Para contenido > 9,500 chars usamos esto y guardamos solo el `file_id` en la columna Text. |

> **IMPORTANTE:** previamente asumimos 64 KB / fila 32 KB. **Eso era incorrecto.** El límite real por columna Text es **10,000 chars**. Documentación oficial Catalyst:
> *"The limit of text datatype in the Catalyst Datastore is 10000. If your message contains more than 10000 characters, please consider creating a file in the FileStore and upload the content to it."*

## Lo que arreglamos en v2

### 1. Truncate defensivo + File Store overflow

Dos archivos clave:

- [functions/api/src/lib/dbLimits.ts](../functions/api/src/lib/dbLimits.ts) — `FIELD_LIMITS` con el máximo por columna (≤ 9,500 chars siempre) + helpers `truncate()` y `stringifyAndTruncate()`.
- [functions/api/src/lib/largeContentStore.ts](../functions/api/src/lib/largeContentStore.ts) — para campos que pueden exceder 9,500 chars. Si el contenido entra inline → guarda en la columna; si no → sube al File Store y guarda `file:<id>` como marcador. Lectura transparente.

### 2. Patrón de uso

**Para campos cortos (≤ 9,500 chars siempre):**
```typescript
notes_internal: truncate(body.notes, FIELD_LIMITS.POOL_NOTES, 'CandidatePool.notes_internal'),
```

**Para campos que pueden exceder 9,500 (transcripts, drafts, payloads grandes):**
```typescript
import { persistLargeContent, persistLargeJson, loadLargeContent, loadLargeJson } from '../lib/largeContentStore';

// Al insertar:
const stored = await persistLargeJson(req, draftPayload, 'JobProfileDrafts.draft_payload');
await datastore(req).table('JobProfileDrafts').insertRow({ ..., draft_payload: stored });

// Al leer:
const payload = await loadLargeJson(req, row.draft_payload);  // descarga del File Store si era ref
```

Si trunca o sube al File Store, sale en logs:
```
[DB_LIMITS] truncating JobProfileDrafts.highlights: 4123 → 4000 chars
[LARGE_CONTENT] uploading large content to file store { contextLabel: 'ClientReports.bundle_payload', chars: 22341 }
```

## Tablas / columnas — estrategia de almacenamiento

### Campos que usan File Store (overflow > 9,500 chars)
| Tabla | Columna | Estrategia |
|----|----|----|
| ClientReports | bundle_payload | File Store (siempre — el JSON multi-candidato suele exceder 10K) |
| JobProfileDrafts | transcript | Inline si Whisper < 9.5K, sino File Store |
| JobProfileDrafts | draft_payload | Inline si JSON < 9.5K, sino File Store |
| Jobs | tech_questions_cache | Inline si pocas preguntas, sino File Store |
| Briefings | transcript_text | File Store (transcript completo de meeting 30-60min) |

### Campos inline (todos ≤ 9,500 chars con margen)
| Tabla | Columna | Límite |
|----|----|----|
| Jobs | ideal_profile | 8,000 |
| VideoResponses | transcript | 9,500 |
| VideoResponses | analysis_payload | 8,000 |
| VideoQuestions | question_text | 2,000 |
| VideoQuestions | rationale_internal | 1,000 |
| VideoQuestions | expected_signals | 2,000 |
| OutboxEvents | payload | 8,000 |
| RecruitSyncQueue | payload | 8,000 |
| MarketingLeads | quiz_data | 4,000 |
| MarketingLeads | calculator_data | 2,000 |
| CandidatePool | tags | 2,000 |
| CandidatePool | languages | 500 |
| CandidatePool | notes_internal | 4,000 |
| PrefQuestions (ex-PrefilterQuestions) | question_text | 1,000 |
| PrefQuestions (ex-PrefilterQuestions) | options | 2,000 |
| PrefQuestions (ex-PrefilterQuestions) | expected_answer | 500 |
| JobTrackingSnapshots | event_data | 2,000 |
| BotDecisions | rationale | 2,000 |
| BotTrainingExamples | scenario_summary | 2,000 |
| Notifications | message | 500 |
| PipelineTransitions | reason | 200 |
| ReviewQueue | reason | 1,000 |
| OutreachInbox/Templates | body | 4,000 |
| ClientNotificationTemplates | body_html | 8,000 |
| Tenants | branding_config | 4,000 |
| EnglishTestSessions | writing_text | 4,000 |
| IntegrationSecrets | encrypted_value | 4,000 |
| JobProfileDrafts | highlights | 4,000 |

## Configuración requerida

Para que el File Store overflow funcione, se necesita un folder dedicado en Catalyst Console:

1. Catalyst Console → File Store → Create Folder → nombre `large-content` (o el que prefieras).
2. Copiar el ROWID del folder.
3. Configurar en Catalyst Console env vars:
   ```
   FILESTORE_LARGE_CONTENT_FOLDER_ID=<rowid>
   ```

Si la env var no está configurada, los campos que necesiten File Store devuelven 503 con mensaje claro (`large_content_folder_not_configured`).

## Cuando crees una tabla nueva

1. **Var Char**: pon **255** como max (Catalyst no acepta más).
2. **Text**: no pongas max (Catalyst no te deja). El backend protege con `truncate()` o `persistLargeContent()`.
3. **Si una columna recibe JSON o texto largo** → decidí: ¿siempre cabe en 9,500? Usá `FIELD_LIMITS` + `truncate()`. ¿Puede exceder? Usá `persistLargeContent()`.
4. **No te preocupes por la suma total de la fila** — Catalyst limita por columna individual, no por fila.

## Cómo verificar si algo se truncó o subió al File Store

```bash
# En logs de Catalyst, filtrar por:
[DB_LIMITS] truncating          # algo entró cerca del 9.5K
[LARGE_CONTENT] uploading        # algo se fue al File Store
```

Si aparece muy seguido en una columna específica:
- ¿Está bien que vaya al File Store? (perf: una descarga extra por read).
- ¿Se puede comprimir el contenido? (ej: limitar tamaño del JSON).

## Por qué no validamos en frontend

El frontend ya valida tamaños razonables (ej: input maxLength). El truncate / File Store en backend es la **última línea de defensa** — protege contra:
- Tests automatizados que mandan strings gigantes.
- Bugs en la generación IA que produce JSON de 50KB.
- Datos importados de v1 que no respetaban límites.
- Inputs nuevos (transcripts más largos que el límite cuando agregamos meetings de 90 min).
