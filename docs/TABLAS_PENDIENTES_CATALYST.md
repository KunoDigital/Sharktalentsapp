# Tablas pendientes de crear en Catalyst Console

Schemas listos para crear cuando termines de testear todo. El backend tolera la ausencia de todas — solo las features que dependen de cada tabla quedan inactivas hasta que la crees.

**Cómo crearlas:**
1. Catalyst Console → tu app → Data Store → Create Table
2. Nombre exacto (case-sensitive)
3. Pegá cada columna con su tipo
4. Después de crear cada una, los endpoints que dependen empiezan a funcionar automáticamente (5-60s de eventual consistency en Catalyst).

---

## Tabla `Alerts` (Fase 0.1)

Sistema centralizado de notificaciones a Cris cuando algo falla.

**Sin esta tabla:** las alertas se loggean pero no se persisten, no aparecen en `/alerts`, los emails críticos NO se mandan a Cris.

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `severity` | Var Char (20) | Sí | — | 'critical' \| 'warning' \| 'info' |
| `code` | Var Char (100) | Sí | — | identificador agrupador ('outbox.failed.email.send_pending', etc.) |
| `message` | Var Char (500) | Sí | — | mensaje human-readable |
| `context` | Text | No | null | JSON con metadata adicional |
| `tenant_id` | Var Char (50) | No | null | tenant si aplica |
| `resource_type` | Var Char (50) | No | null | 'job' \| 'application' \| 'outbox_event' \| etc. |
| `resource_id` | Var Char (50) | No | null | ROWID del recurso |
| `status` | Var Char (20) | Sí | 'open' | 'open' \| 'acknowledged' \| 'resolved' |
| `occurrence_count` | Int | Sí | 1 | cuántas veces se repitió esta alerta en la ventana de 30 min |
| `created_at` | DateTime | Sí | — | primera vez que ocurrió |
| `last_occurred_at` | DateTime | Sí | — | última ocurrencia |
| `acknowledged_at` | DateTime | No | null | cuándo Cris la marcó como vista |
| `acknowledged_by` | Var Char (50) | No | null | quién la marcó como vista (clerk_user_id) |
| `resolved_at` | DateTime | No | null | cuándo se marcó como resuelta |

**Verificación:** después de crearla, andá a `/alerts` y debería mostrar "No hay alertas abiertas" en vez del banner amarillo de "tabla pendiente".

---

## Tabla `JobCosts` (Fase 0.2)

Tracking de gastos por puesto (Anthropic, emails, WhatsApp, storage).

**Sin esta tabla:** el panel "💰 Gastos del puesto" en JobDetail muestra "Cost tracking aún no disponible".

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `job_id` | Var Char (50) | Sí | — | ROWID del Job |
| `tenant_id` | Var Char (50) | No | null | tenant scope |
| `cost_type` | Var Char (20) | Sí | — | 'anthropic' \| 'email' \| 'whatsapp' \| 'storage' |
| `amount_usd` | Decimal (10,4) | Sí | — | costo en USD, 4 decimales |
| `count` | Int | Sí | 1 | cantidad de unidades (1 email, 1 WP, N tokens) |
| `occurred_at` | DateTime | Sí | — | timestamp del gasto |
| `metadata` | Var Char (2000) | No | null | JSON con detalles (feature, template, model) |

**Verificación:** después de crearla, refrescá JobDetail de cualquier puesto y el panel "💰 Gastos del puesto" debería mostrar "$0.00" (en vez del mensaje de "pendiente"). A medida que se generen tech questions, emails, WhatsApp, los números van subiendo.

---

---

## Columna `Jobs.prescreening_questions_cache` (Fase 1.1)

Agregar a tabla existente `Jobs`. Cache JSON con las preguntas calificatorias generadas por IA + status markers.

**Sin esta columna:** el endpoint genera las preguntas pero no persiste, el candidato no puede hacer prescreening, queda atascado en `prefilter_pending` para siempre.

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `prescreening_questions_cache` | Text | No | null | JSON array de preguntas O marker `{"status":"pending\|failed"}` |

**Verificación:** después de agregar la columna, ir a JobDetail, click "Generar prescreening con IA", esperá 30 seg. El status debería pasar a "ready" con count.

---

---

## Env vars que tenés que setear en Catalyst Console (Fase 1.4)

Catalyst Console → Functions → api → Environment Variables.

**WhatsApp via Twilio:**
- `WHATSAPP_PROVIDER` = `twilio` (default, podés omitir)
- `TWILIO_ACCOUNT_SID` = tu Account SID de Twilio (empieza con `AC...`)
- `TWILIO_AUTH_TOKEN` = tu Auth Token de Twilio
- `TWILIO_WHATSAPP_FROM` = formato `whatsapp:+14155238886` (sandbox de Twilio mientras testeás, después tu número aprobado)

**Para alertas del sistema a vos:**
- `RECRUITER_NOTIFY_EMAIL` (opcional, default `proyectos@kunodigital.com`) — email donde llegan las alertas críticas y notificaciones internas (ej. cliente pidió cambios)

**Setup Twilio paso a paso:**
1. Cuenta en twilio.com (ya tenés tarjeta de crédito en el sistema)
2. Console → Develop → Messaging → Try it out → Send a WhatsApp message
3. Activá el sandbox (mandás `join <code>` a `+1 415 523 8886` desde tu WhatsApp)
4. Copiá tu Account SID + Auth Token desde el dashboard
5. Pegá las 3 env vars de arriba
6. Probá mandando un mensaje desde la app — debería llegarte al WhatsApp

Después de testear con sandbox, comprás un número WhatsApp aprobado (~$5/mes) y cambiás el `TWILIO_WHATSAPP_FROM`.

---

## Tabla `EmailTemplateOverrides` (templates editables desde admin)

Permite editar los emails desde la UI sin redeploy. Si la tabla no existe, los templates funcionan con los defaults del código (todo lo de hoy sigue OK).

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `tenant_id` | Var Char (50) | No | null | null = override global (todos los tenants) |
| `template_key` | Var Char (100) | Sí | — | ej. `candidate_tecnica_invitation` |
| `locale` | Var Char (10) | Sí | — | `es` o `en` |
| `subject` | Var Char (500) | No | null | null = usar el subject del código |
| `body_html` | Text | No | null | null = usar el HTML del código |
| `body_text` | Text | No | null | null = usar el texto del código |
| `created_at` | DateTime | Sí | — | |
| `updated_at` | DateTime | Sí | — | |
| `updated_by` | Var Char (50) | No | null | clerk_user_id de quién editó |

**Verificación:** después de crear la tabla, ir a `/emails` en admin (existe ya) — debería permitirte ver overrides y editarlos.

---

## Tabla `SavedSearches` (búsquedas guardadas por usuario)

Permite a cada usuario guardar combos de filtros con nombre para reusar (ej. "React + Senior + Disponible" en el Pool).

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `tenant_id` | Var Char (50) | Sí | — | |
| `user_id` | Var Char (100) | Sí | — | clerk_user_id |
| `scope` | Var Char (20) | Sí | — | 'pool' \| 'candidates' \| 'jobs' |
| `name` | Var Char (100) | Sí | — | nombre que el usuario eligió |
| `filters` | Text | Sí | — | JSON con los filtros (estructura libre por scope) |
| `created_at` | DateTime | Sí | — | |
| `updated_at` | DateTime | Sí | — | |

**Verificación:** ir al Pool, configurar filtros, apretar "+ Guardar actual", nombrarlo. Debería aparecer arriba como chip clickeable.

---

## Tabla `UserFavorites` (bookmarks por usuario)

Permite a cada usuario marcar jobs/candidatos/drafts como favoritos para acceso rápido.

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `tenant_id` | Var Char (50) | Sí | — | |
| `user_id` | Var Char (100) | Sí | — | clerk_user_id de quien marcó |
| `resource_type` | Var Char (20) | Sí | — | 'job' \| 'candidate' \| 'draft' \| 'client' |
| `resource_id` | Var Char (50) | Sí | — | ROWID del recurso |
| `label` | Var Char (200) | No | null | nombre para mostrar (cache) |
| `created_at` | DateTime | Sí | — | |

**Verificación:** marcá ★ junto al título de un Job o Candidato, navegá a `/favorites`, debería aparecer.

---

## Tabla `CandidateTags` (clasificación libre por candidato)

Permite a Cris taguear candidatos para búsquedas futuras (ej. "react", "remote", "lider").

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `tenant_id` | Var Char (50) | Sí | — | |
| `candidate_id` | Var Char (50) | Sí | — | ROWID del Candidate |
| `tag` | Var Char (50) | Sí | — | lowercase, kebab-case (normalizado por backend) |
| `created_by` | Var Char (100) | Sí | — | clerk_user_id |
| `created_at` | DateTime | Sí | — | |

**Verificación:** ir a CandidateDetail, panel "🏷️ Tags" debería permitirte agregar tags con autocomplete.

---

## Tabla `CandidateNotes` (notas internas del recruiter)

Permite a Cris/su equipo dejar notas libres sobre cada candidato. Visible solo en admin, no se expone al cliente.

| Columna | Tipo | Mandatory | Default | Notas |
|---|---|---|---|---|
| `tenant_id` | Var Char (50) | Sí | — | |
| `application_id` | Var Char (50) | Sí | — | ROWID del Result |
| `author_id` | Var Char (100) | Sí | — | clerk_user_id de quien escribió |
| `author_name` | Var Char (255) | No | null | email para mostrar (más legible que ID) |
| `body` | Text | Sí | — | hasta 5000 chars |
| `is_pinned` | Boolean | Sí | false | notas pinned aparecen arriba |
| `created_at` | DateTime | Sí | — | |
| `updated_at` | DateTime | Sí | — | |

**Verificación:** ir a un CandidateDetail, panel "📝 Notas" debería permitirte escribir y aparecer la nota.

---

## Cron Job adicional — Recordatorio candidatos inactivos (Fase importante)

Setup similar al cron del outbox, en Catalyst Console → Cron Jobs.

**Create Cron Job:**
- **Name:** `candidate-reminders`
- **Trigger:** Cron Expression
- **Expression:** `0 14 * * *` (todos los días a las 14:00 UTC = 9 AM Panamá)
- **Function URL:** `https://[tu-app].catalystserverless.com/server/api/admin/candidate-reminders/send`
- **Method:** `POST`
- **Headers:**
  - `X-Internal-Key: [valor de INTERNAL_API_KEY]`
  - `Content-Type: application/json`
- **Body:** `{"inactive_days": 3, "max_send": 100}`

**Antes de activar, probá con dry_run:**
```bash
curl -X POST -H "X-Internal-Key: $KEY" \
  https://[tu-app].catalystserverless.com/server/api/admin/candidate-reminders/send \
  -d '{"inactive_days": 3, "dry_run": true}'
```

Devuelve preview de quiénes recibirían recordatorio sin mandar nada.

**Comportamiento:**
- Busca candidatos en stages activos sin completion en ≥ 3 días
- Dedup: no manda si ya recibió recordatorio en los últimos 7 días
- Cap de 100 envíos por ejecución (evita flood si hay backlog viejo)
- Email + WhatsApp (si tiene teléfono)

---

## (Próximas tablas/columnas se van agregando acá)

A medida que avanzamos en las fases, vamos sumando schemas. Al final tenés un solo documento para crear todo de una.
