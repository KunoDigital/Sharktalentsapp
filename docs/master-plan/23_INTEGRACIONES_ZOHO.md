# 23 — Integraciones Zoho (Recruit, Meeting+Zia, Bookings, Sign)

> Doc de integración cross-funcional. Acá vive **cómo** SharkTalents habla con cada producto Zoho, qué API/webhook se usa, qué creds se requieren, y los gotchas conocidos. Los **qué** (flujos de negocio) viven en sus docs respectivos: [17](17_PORTAL_CLIENTE.md), [18](18_PIPELINE_OPERATIVO.md), [20](20_VIDEOS_DINAMICOS.md).

---

## Mapa de integraciones

| Producto Zoho | Rol en SharkTalents | Dirección | Mecanismo | Docs |
|---|---|---|---|---|
| **Recruit** (CRM) | Hub de candidatos antes que existiera SharkTalents; con Plan B sigue siendo CRM "back-office" para Cris | Bidireccional (lectura-escritura limitada) | OAuth 2.0 + Webhooks salientes Recruit→SharkTalents | [18](18_PIPELINE_OPERATIVO.md) |
| **Meeting** | Videocalls con cliente (briefing, finalistas) y con candidatos (entrevista 1:1 cuando aplica) | Lectura | OAuth 2.0 + Webhooks Meeting→SharkTalents | acá |
| **Zia** (AI) | Transcripción de grabaciones de Meeting | Lectura/llamada | API Zia o lectura desde Meeting cuando expone transcript | acá + [17](17_PORTAL_CLIENTE.md) |
| **Bookings** | Self-serve scheduling: cliente reserva briefing, candidato reserva entrevista | Lectura | OAuth 2.0 + Webhooks Bookings→SharkTalents | acá + [17](17_PORTAL_CLIENTE.md) |
| **Sign** | Generar y firmar contratos de servicio (cliente↔Kuno) y NDA candidato↔cliente final | Escritura | OAuth 2.0 (REST API) | acá |

---

## ADR-023-A — Recruit como CRM back-office (no fuente de verdad operativa)

**Decisión:** Recruit deja de ser fuente de verdad del **pipeline operativo**. SharkTalents es la fuente de verdad. Recruit conserva:
- Catálogo histórico de candidatos pre-existentes a SharkTalents.
- Notificaciones automatizadas que ya están configuradas (templates de email a candidatos por etapa, recordatorios).
- Vista CRM "cómoda" para Cris cuando quiera ver el pipeline en formato Kanban Zoho.

**Sync:** SharkTalents → Recruit (unidireccional, async, vía outbox). Cuando un `JobApplication` cambia de etapa en SharkTalents, encolamos un job que mapea la etapa SharkTalents al `Stage` de Recruit, llama API Recruit, y lo dispara con HMAC. Si falla, retry exponencial + dead-letter en `RecruitSyncQueue`.

**Por qué unidireccional:** evitamos loops. Recruit dispara workflows (emails a candidatos) cuando cambia el stage; si dejáramos que Recruit también modificara stage en SharkTalents tendríamos eco.

**Excepción:** webhook entrante Recruit→SharkTalents **solo** para creación inicial del candidato cuando llega vía hub gratis Recruit (LinkedIn free). Esa entrada crea el `JobApplication` en SharkTalents en estado `prefilter_pending`. A partir de ahí, SharkTalents manda.

---

## Recruit

### Auth (OAuth 2.0)

Zoho OAuth con scope mínimo:

```
ZohoRecruit.modules.candidates.READ
ZohoRecruit.modules.candidates.UPDATE
ZohoRecruit.modules.applications.READ
ZohoRecruit.modules.applications.UPDATE
ZohoRecruit.settings.READ
```

Refresh token guardado **encrypted** en `IntegrationSecrets` (tabla nueva, ver [03](03_FASE2_BASE_DATOS.md)) con `tenant_id` scope (un tenant podría conectarse a su propio Recruit en el futuro multi-tenant). Para el tenant Kuno usamos el Recruit corporativo de Kuno. Token rotation cada 60 días — alerta automática 7 días antes de expirar.

### Webhook entrante: candidato creado en hub gratis Recruit

Recruit dispara webhook `candidate.created` cuando llega aplicación al job board público de Recruit (versión gratis). Endpoint:

```
POST /server/sharktalents_function/api/webhooks/recruit/candidate-created
```

Headers:
- `X-Zoho-Webhook-Token: <static_token_from_env>` (Recruit no firma HMAC; usamos token estático rotable + IP allowlist Zoho)
- `Content-Type: application/json`

Body relevante:

```json
{
  "Candidate_Id": "...",
  "Full_Name": "...",
  "Email": "...",
  "Phone": "...",
  "Job_Opening_Id": "...",
  "Source": "LinkedIn Free",
  "Resume_URL": "...",
  "Created_Time": "..."
}
```

Handler:
1. Verifica `X-Zoho-Webhook-Token` contra env var.
2. Mapea `Job_Opening_Id` Recruit → `job_id` SharkTalents (tabla `RecruitJobMappings`).
3. Si no hay mapping, log warning + dead letter (no es error, puede ser un job que Cris no usa con SharkTalents).
4. Crea `JobApplication` en `prefilter_pending`.
5. Descarga CV desde `Resume_URL` (con cookie auth Recruit) y lo sube a Catalyst File Store bajo `/resumes/<application_id>.pdf`.
6. Encola `prefilter_invite` job (manda email/WhatsApp con link a `/apply/<tenant>/<job-slug>?continue=<token>`).

**Idempotencia:** llave `(tenant_id, recruit_candidate_id)` con UNIQUE constraint. Reintento del webhook no duplica.

### Sync saliente: cambio de etapa

Cuando SharkTalents cambia stage de `JobApplication`, escribe a `RecruitSyncQueue` con:

```ts
{
  application_id: string,
  recruit_candidate_id: string,
  recruit_job_id: string,
  target_stage: string, // mapeado vía RecruitStageMappings
  attempt: 0,
  next_attempt_at: timestamp
}
```

Cron `recruit_sync_drainer` corre cada 60s y procesa pendientes:

```ts
PUT https://recruit.zoho.com/recruit/v2/Candidates/{recruit_candidate_id}
{
  "data": [{ "Candidate_Stage": target_stage }]
}
```

Backoff: 30s, 5min, 30min, 4h, 24h. Después de 5 intentos → dead letter + alerta a Slack.

**Mapping de stages** en tabla `RecruitStageMappings(tenant_id, sharktalents_state, recruit_stage)`. Default seed:

| SharkTalents | Recruit Stage |
|---|---|
| `prefilter_passed` | New |
| `disc_completed` | Screening |
| `technical_completed` | Technical Test |
| `videos_completed` | Video Interview |
| `bot_decision_advance` | Recommended |
| `finalist` | Finalist |
| `offered` | Offer |
| `hired` | Hired |
| `auto_rejected_*` | Rejected |
| `rejected_by_admin` | Rejected |

### Lectura puntual: catálogo histórico

Para que Cris pueda buscar candidatos pre-SharkTalents desde la app, exponemos `/api/recruit/candidates/search?q=...` que delega a Recruit Search API. **No** importamos su data al `CandidatePool`. Si Cris quiere reactivar un candidato histórico, lo crea como `JobApplication` manualmente (un endpoint admin que copia los datos básicos de Recruit y arranca el flujo SharkTalents).

### Gotchas Recruit conocidos

- **Rate limit:** 100 req/min por org. Sync queue + cron evita problemas.
- **Stage names case-sensitive.** Usar exactamente lo que está en Recruit settings.
- **Resume URL expira en ~10 min.** Descargar inmediato en webhook handler, no después.
- **Webhook Recruit no reintenta si responde >2s.** Handler debe responder 202 rápido y procesar async (encolar y devolver).

---

## Meeting + Zia (transcripción)

### Contexto

Cris usa Zoho Meeting para:
- Briefing inicial con cliente (cuando no hace por email/Bookings — generalmente sí).
- Entrevista 1:1 con finalistas (top 3) — esta sí siempre humana.
- Demo / discovery con prospects.

**Zia transcribe** las grabaciones automáticamente cuando el meeting es agendado por un usuario Zoho desde la cuenta de Kuno. Cuando es agendado por el **cliente** desde Bookings, **Zia no transcribe** (limitación conocida). Ver ADR-023-B.

### ADR-023-B — Ruta de grabación cuando cliente agenda vía Bookings

**Problema:** cliente reserva briefing en Bookings (link público de Cris) → se crea Meeting de Zoho → no graba ni transcribe automático.

**Opciones evaluadas:**

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| A. Cris activa grabación manual al iniciar | Cris prende "record" antes de empezar | Simple | Olvido humano; no soluciona transcripción si Zia no se dispara |
| B. Cambiar Bookings para que cree el Meeting **a nombre de Cris** y no del cliente | Configurar service en Bookings con host = Cris | Zia sí transcribe porque el host es usuario Zoho | Hay que validar que Bookings lo permita; podría requerir crear el meeting vía API en lugar del integration nativo |
| C. Migrar grabación a Whisper post-meeting | Descargar mp4 de Meeting → Whisper API | Funciona siempre | Costo extra ($0.006/min × 30min ≈ $0.18/meeting), latencia de procesamiento |
| D. Usar Zoom + bot grabador externo | Otterize, Fathom, etc. | Mejor calidad transcripción | Sale del ecosistema Zoho, más costo |

**Decisión:** **B + C como fallback**.
- Default: configurar el servicio Bookings para que el meeting Zoho se cree con host=Cris (probar primero — si Zia transcribe, listo).
- Fallback: si la transcripción Zia no aparece dentro de 60min post-meeting, cron `whisper_fallback` descarga el mp4 y transcribe con Whisper.

**Implementación:**

```ts
// cron: whisper_fallback (cada 30 min)
const meetings = await catalystDB.query(`
  SELECT meeting_id, recording_url, ROWID
  FROM ZohoMeetings
  WHERE transcript_status = 'pending'
    AND ended_at < NOW() - INTERVAL 60 MINUTE
    AND whisper_attempted = false
`);
for (const m of meetings) {
  const mp4 = await downloadFromZoho(m.recording_url);
  const transcript = await whisper.transcribe(mp4, { language: 'es' });
  await catalystDB.update('ZohoMeetings', m.ROWID, {
    transcript: transcript.text,
    transcript_status: 'whisper_fallback',
    whisper_attempted: true,
  });
  await emitOutboxEvent('meeting.transcribed', { meeting_id: m.meeting_id });
}
```

### Webhook entrante: meeting ended

Zoho Meeting dispara webhook al terminar la reunión. Endpoint:

```
POST /server/sharktalents_function/api/webhooks/meeting/ended
```

Body:
```json
{
  "meeting_id": "...",
  "host_email": "...",
  "started_at": "...",
  "ended_at": "...",
  "duration_minutes": 32,
  "recording_url": "https://...",
  "transcript_id": "..." // null si Zia no transcribió
}
```

Handler:
1. Match `meeting_id` → `JobProfileDraft` (si es briefing) o `JobApplication.interview_meeting_id` (si es entrevista finalista).
2. Si `transcript_id != null`: poll Zia API hasta status=ready, descargar transcript, guardar en `ZohoMeetings.transcript`.
3. Si `transcript_id == null`: marcar `transcript_status = pending` para que `whisper_fallback` lo procese.
4. Emit `meeting.recorded` event al outbox.

### Cómo SharkTalents llama Zia API

```ts
// shark/utils/zoho-zia.ts
export async function fetchTranscript(meetingId: string): Promise<string | null> {
  const token = await getZohoAccessToken('meeting');
  const res = await fetchWithTimeout(
    `https://meeting.zoho.com/api/v2/meetings/${meetingId}/transcript`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    10_000
  );
  if (res.status === 404) return null; // no hay transcript todavía
  if (!res.ok) throw new Error(`Zia transcript fetch: ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ready') return null; // aún procesando
  return data.transcript_text;
}
```

Polling: si `transcript_status === 'pending'` y han pasado >5min desde meeting end, intentar fetch. Backoff 5/10/20/40 min, máx 4 intentos antes de cambiar a Whisper fallback.

### Privacidad de transcripts

- Transcripts contienen información sensible del cliente. Encriptar `transcript` column at rest con KMS (siguiente fase de seguridad — ver [04](04_FASE3_SEGURIDAD.md)).
- Retention: 12 meses. Cron `transcript_purger` borra cuerpo del transcript pero mantiene metadata (duración, participantes, summary IA) para reportes históricos.
- Cliente puede pedir borrado vía request en `/portal/data-rights`.

---

## Bookings

### Contexto

Zoho Bookings expone link público `https://kuno.zohobookings.com/portal/...` donde:
- **Clientes** reservan briefing inicial (servicio "Discovery Call SharkTalents", 30min).
- **Candidatos finalistas** reservan entrevista con Cris (servicio "Final Interview", 45min).

### Webhook entrante: appointment created

```
POST /server/sharktalents_function/api/webhooks/bookings/appointment-created
```

Body relevante:
```json
{
  "appointment_id": "...",
  "service_id": "...",
  "service_name": "Discovery Call SharkTalents",
  "customer_email": "...",
  "customer_name": "...",
  "start_time": "...",
  "end_time": "...",
  "meeting_url": "https://meet.zoho.com/...",
  "custom_fields": {
    "company_name": "...",
    "role_to_recruit": "..."
  }
}
```

Handler:
1. Routing por `service_id`:
   - Discovery Call → crea `JobProfileDraft` con `customer_email` y schedule de webhook `meeting.ended`.
   - Final Interview → match `customer_email` con `JobApplication`, set `interview_meeting_id`.
2. Si es Discovery Call de un cliente nuevo (no existe Tenant aún) → crea `Tenant` borrador en estado `pending_kickoff`.
3. Manda confirmación adicional con calendar invite (Bookings ya manda el de él, pero nosotros mandamos uno con el link al portal cliente).

### Custom fields obligatorios en cada servicio

Configurar en Bookings:

**Discovery Call SharkTalents:**
- `company_name` (text, required)
- `role_to_recruit` (text, required)
- `urgency` (dropdown: ASAP / 30 días / 60 días)
- `budget_range` (dropdown: <2k / 2-4k / 4-8k / 8k+)

**Final Interview:**
- `application_id` (hidden, prefill desde URL params cuando candidato llega del portal)

### Auto-record: configuración requerida

En Bookings:
- En cada servicio: Settings → Integrations → Zoho Meeting → "Create meeting in host's calendar" → asegurar host = `cris@kuno.com` (no el cliente).
- En Meeting: Settings → Recording → "Auto-record all meetings" = ON para esa cuenta.
- En Zia: Settings → Auto-transcribe → ON para Meeting de Cris.

Si esto se rompe en algún update Zoho, fallback Whisper toma el relevo (ver ADR-023-B).

---

## Sign

### Contexto

Dos casos de uso:

1. **Contrato de servicio Kuno↔Cliente** — cuando cliente firma briefing, recibe contrato auto-generado con su nombre, dirección, puesto a buscar, fee.
2. **NDA candidato↔Cliente Final** — opcional, solo si cliente lo pide (algunos exigen NDA antes de ver finalistas).

### Flujo: contrato de servicio

```
Cliente firma briefing en portal
  → SharkTalents emit `briefing.approved`
  → Outbox handler genera contrato:
       POST /api/v1/templates/{template_id}/createdocument
       body: {
         "templates": {
           "field_data": {
             "field_text_data": {
               "client_name": "...",
               "client_address": "...",
               "role_title": "...",
               "fee_amount": "...",
               "fee_currency": "USD"
             }
           },
           "actions": [{
             "action_type": "SIGN",
             "recipient_email": "cliente@empresa.com",
             "recipient_name": "..."
           }]
         }
       }
  → Sign genera document_id
  → Sign manda email al cliente con link de firma
  → Webhook `document.signed` cuando firma
  → SharkTalents marca `Tenant.contract_signed_at`
  → Activa portal cliente con permisos completos
```

### Templates en Sign

Crear 2 templates en Zoho Sign UI:
- `template_kuno_service_agreement` — contrato genérico con merge fields: `client_name`, `client_address`, `role_title`, `fee_amount`, `fee_currency`, `contract_date`.
- `template_candidate_nda` — NDA candidato con merge fields: `candidate_name`, `client_company_name`, `confidentiality_term_months`.

Template IDs guardados en `IntegrationSecrets.zoho_sign_templates` (JSON).

### Webhook entrante: document signed

```
POST /server/sharktalents_function/api/webhooks/sign/document-signed
```

Verifica HMAC con `ZOHO_SIGN_WEBHOOK_SECRET`. Body:

```json
{
  "request_id": "...",
  "document_id": "...",
  "request_status": "completed",
  "actions": [{
    "recipient_email": "...",
    "action_status": "SIGNED",
    "signed_time": "..."
  }]
}
```

Handler:
1. Match `document_id` → `Contract` o `NDA` row.
2. Update status, store signed PDF URL.
3. Trigger evento de negocio: `Tenant.contract_signed_at` (si es service) o `JobApplication.nda_signed_at` (si es NDA).

### Cancel/Reject

Si cliente rechaza firma → webhook `document.rejected` → notificar a Cris (Slack) para llamada manual.

---

## Tabla `IntegrationSecrets`

```sql
CREATE TABLE IntegrationSecrets (
  ROWID BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  provider VARCHAR(50) NOT NULL, -- 'zoho_recruit', 'zoho_meeting', 'zoho_bookings', 'zoho_sign'
  refresh_token TEXT NOT NULL, -- encrypted
  access_token TEXT, -- encrypted, short-lived cache
  access_token_expires_at TIMESTAMP,
  scopes TEXT,
  metadata JSON, -- template_ids, webhook_secrets, etc.
  rotated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE KEY (tenant_id, provider)
);
```

Encriptación at-rest con `CRYPTO_MASTER_KEY` (env var, ver [04](04_FASE3_SEGURIDAD.md)). Lectura solo desde funciones backend, nunca expuesto al frontend ni al MCP server público.

---

## Tabla `RecruitSyncQueue`

```sql
CREATE TABLE RecruitSyncQueue (
  ROWID BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  application_id BIGINT NOT NULL,
  recruit_candidate_id VARCHAR(64) NOT NULL,
  target_stage VARCHAR(50) NOT NULL,
  attempt INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL,
  last_error TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|in_progress|done|dead_letter
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  INDEX idx_pending (status, next_attempt_at)
);
```

---

## Tabla `ZohoMeetings`

```sql
CREATE TABLE ZohoMeetings (
  ROWID BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  meeting_id VARCHAR(64) UNIQUE NOT NULL,
  context_type VARCHAR(30) NOT NULL, -- 'discovery_call' | 'final_interview' | 'other'
  context_id BIGINT, -- job_profile_draft_id o application_id
  host_email VARCHAR(255),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_minutes INT,
  recording_url TEXT,
  transcript_id VARCHAR(64),
  transcript_status VARCHAR(30) DEFAULT 'pending', -- pending|zia_ready|whisper_fallback|failed
  transcript TEXT, -- encrypted
  whisper_attempted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Variables de entorno

```bash
# Zoho OAuth (compartido entre productos del mismo data center)
ZOHO_DC=com  # com|eu|in según account
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...

# Webhook tokens / secrets
ZOHO_RECRUIT_WEBHOOK_TOKEN=...   # static token
ZOHO_MEETING_WEBHOOK_SECRET=...  # HMAC
ZOHO_BOOKINGS_WEBHOOK_TOKEN=...
ZOHO_SIGN_WEBHOOK_SECRET=...     # HMAC

# Whisper fallback
OPENAI_API_KEY=...
WHISPER_FALLBACK_ENABLED=true

# Per-tenant feature flags (en DB, no env)
# - zoho_recruit_enabled
# - whisper_fallback_enabled
```

---

## Health checks de integraciones

Endpoint `/health/integrations` devuelve estado por provider:

```json
{
  "zoho_recruit": { "status": "ok", "last_successful_sync": "..." },
  "zoho_meeting": { "status": "degraded", "reason": "transcript polling lag", "last_check": "..." },
  "zoho_bookings": { "status": "ok" },
  "zoho_sign": { "status": "ok" },
  "whisper": { "status": "ok" }
}
```

Cron `integration_healthcheck` cada 5min hace una llamada de costo cero (GET /me o equivalente) a cada provider y actualiza tabla `IntegrationHealth`. Status:
- `ok` — última llamada <5min y succeed.
- `degraded` — backlog en queue o latencia elevada.
- `down` — última llamada falló o token expiró.

Alerta a Slack cuando un provider pasa de ok→down (no en cada chequeo).

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Token Zoho refresh falla y todo el sync se cae | Media | Cron de salud + alerta proactiva 7 días antes de expirar |
| Zia no transcribe meeting de Bookings | Alta (caso conocido) | Whisper fallback |
| Bookings cambia esquema de webhook payload | Baja | Schema validation con Zod + alerta si payload no parsea |
| Recruit rate limit hit cuando hacemos backfill histórico | Media | Sync queue con throttle |
| Cliente borra Meeting recording antes de transcribir | Baja | Cron whisper_fallback corre cada 30min, ventana corta |
| Sign template cambia merge fields → contratos rotos | Media | Versionar template_id en `IntegrationSecrets.metadata`; validar fields antes de createdocument |

---

## Siguiente paso

- Volvé a [00_INDEX.md](00_INDEX.md) para confirmar el orden total.
- Si vas a implementar: arrancá por [02_FASE1_FUNDAMENTOS.md](02_FASE1_FUNDAMENTOS.md) que ya incluye las env vars Zoho.

---

## Status de implementación (al 2026-05-03)

Todas las integraciones core fueron implementadas en código. Pendiente: setear OAuth tokens + configurar webhooks en cada Console Zoho. Quick reference:

### Recruit (saliente: SharkTalents → Recruit)

- **Dispatcher:** `features/outbox.ts:dispatchRecruitSync`
- **Producer:** cualquier transición de pipeline encolea evento `sync.recruit`
- **Endpoint:** REST API Recruit con OAuth Bearer + circuit breaker `zoho_recruit`
- **Env vars:** `ZOHO_RECRUIT_API_URL`, `ZOHO_RECRUIT_OAUTH_TOKEN`
- **Status:** ✅ código listo

### Recruit (entrante: Recruit → SharkTalents)

- **Webhook:** `features/zohoRecruitWebhook.ts` → `POST /api/webhooks/zoho-recruit`
- **Eventos:** `candidate.hired`, `candidate.rejected`, `candidate.status_changed`
- **Status mapping:** `mapRecruitStatusToStage()` traduce 8 statuses Recruit a nuestro pipeline
- **Validación state machine:** si Recruit hace una transición no allowed, loggea + 200 con `transition_not_allowed`
- **HMAC:** `ZOHO_RECRUIT_WEBHOOK_SECRET`. Idempotencia: `ProcessedEvents` con `provider='zoho_recruit_webhook'`
- **Status:** ✅ código listo

### Bookings (briefing cliente)

- **Cliente HTTP:** `lib/zohoBookingsClient.ts`
- **Endpoint local:** `POST /api/briefings/schedule` (auth tenant)
- **Frontend:** componente `BriefingForm` embedded en DraftsList → form colapsable "Agendar nuevo briefing"
- **Env vars:** `ZOHO_BOOKINGS_API_URL`, `ZOHO_BOOKINGS_OAUTH_TOKEN`, `ZOHO_BOOKINGS_WORKSPACE_ID`, `ZOHO_BOOKINGS_BRIEFING_SERVICE_ID`
- **Circuit breaker:** `zoho_bookings`
- **Status:** ✅ código listo

### Zia (transcripción meetings)

- **Webhook:** `features/ziaWebhook.ts` → `POST /api/webhooks/zia`
- **Body:** `{meeting_id, transcript, language?, duration_seconds?}`
- **HMAC:** `ZIA_WEBHOOK_SECRET`. Idempotencia: `ProcessedEvents` con `provider='zia_webhook'`
- **Flujo downstream:** enquea `briefing.transcript_received` → outbox dispatcher llama Anthropic → genera `JobProfileDraft` automático
- **Status:** ✅ código + auto-draft pipeline funcional

### Sign (firma electrónica de oferta)

- **Cliente HTTP:** `lib/zohoSignClient.ts` (createSignRequest/getSignRequest/cancelSignRequest)
- **Endpoint saliente:** `POST /api/applications/:id/send-offer` (auth tenant)
- **Frontend:** `OfferForm` embedded en CandidateDetail (visible cuando state=finalist)
- **Webhook entrante:** `features/zohoSignWebhook.ts` → `POST /api/webhooks/zoho-sign`
- **Mapeo:** `completed → hired`, `declined → offer_declined`, otros (sent/expired/recalled) no-op
- **HMAC:** `ZOHO_SIGN_WEBHOOK_SECRET`
- **Env vars:** `ZOHO_SIGN_API_URL`, `ZOHO_SIGN_OAUTH_TOKEN`
- **Status:** ✅ código listo

### CRM (marketing leads — tanda 10)

- **Cliente HTTP:** `lib/zohoCrmClient.ts` con `createLead` + `updateLeadStatus`
- **Producer:** outbox dispatcher `lead.captured` y `lead.eval_completed` (del marketing funnel)
- **Use case:** quiz del funnel → Lead en CRM con tag "SharkTalents Funnel" + score de calidad como description
- **Env vars:** `ZOHO_CRM_API_URL`, `ZOHO_CRM_LEADS_MODULE` (default `Leads`) — auth comparte `ZOHO_OAUTH_REFRESH_TOKEN` con Recruit/Sign/Bookings (refactor 2026-05-12). Refresh_token tiene que incluir scope `ZohoCRM.modules.ALL`.
- **Status:** ✅ código listo

### Meeting

Cubierto por Zia webhook. No requiere integración separada — cuando Cris activa Zia en sus meetings, Zia transcribe + POSTea a `/api/webhooks/zia`.

---

## Webhooks completos (5 total)

| Webhook | Endpoint | HMAC env var | Idempotencia key |
|---|---|---|---|
| Clerk | `/api/webhooks/clerk` | `CLERK_WEBHOOK_SECRET` | svix-id |
| HeyReach | `/api/webhooks/heyreach` | `HEYREACH_WEBHOOK_SECRET` | event_id |
| Zia | `/api/webhooks/zia` | `ZIA_WEBHOOK_SECRET` | meeting_id |
| Zoho Sign | `/api/webhooks/zoho-sign` | `ZOHO_SIGN_WEBHOOK_SECRET` | event_id |
| Zoho Recruit | `/api/webhooks/zoho-recruit` | `ZOHO_RECRUIT_WEBHOOK_SECRET` | event_id |

Todos: HMAC-SHA256 timing-safe + idempotencia via `ProcessedEvents` + audit log al aceptar.

Más WhatsApp Cloud API webhook (`/api/webhooks/whatsapp`, GET para verification + POST con `X-Hub-Signature-256`) — sigue el mismo patrón pero con la convención de Meta (verify_token + app_secret en lugar de un solo HMAC).

---

## Whisper como fallback de Zia

Si Zia no transcribe (timeout, audio corrupto), tenemos `lib/whisperClient.ts` invocable manual. Default OpenAI Whisper API. Env: `WHISPER_API_URL` (default), `WHISPER_API_KEY`. Circuit breaker `whisper`. Timeout 2min.
