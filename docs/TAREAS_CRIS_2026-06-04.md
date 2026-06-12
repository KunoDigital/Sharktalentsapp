# Tareas pendientes — Cris (4 junio 2026)

Lista corta y ordenada por urgencia. Cada una con el lugar exacto donde hacerla.

---

## 🔥 Antes del próximo redeploy (~5 min)

### 1. Catalyst Console — verificar que `E2E_BACKDOOR_ALLOWED` NO esté seteada
**Por qué:** el backdoor de Playwright ahora está cerrado por default. Solo se activa si está la variable `E2E_BACKDOOR_ALLOWED=true`. Como vos corrés todo en el ambiente Development de Catalyst, no necesitás tocar las otras E2E vars — solo asegurate que `E2E_BACKDOOR_ALLOWED` **NO** esté seteada.

**Dónde:** Catalyst Console → tu app → Functions → api → Environment Variables → **Development**.

**Qué hacer:**
- Si **NO** aparece `E2E_BACKDOOR_ALLOWED` en la lista → 👍 listo, nada que hacer.
- Si **SÍ** aparece y vale `true` → borrarla. El backdoor queda cerrado.

**Cuándo activarla en el futuro:** solo si vas a correr Playwright contra el ambiente Development desde tu máquina o CI. En ese caso, setearla a `true` temporalmente y borrarla cuando termines.

Las otras vars (`E2E_TEST_KEY`, `E2E_TEST_CLERK_ORG_ID`, `E2E_TEST_USER_ID`) pueden quedarse — sin el flag de arriba el backdoor no se activa aunque existan.

---

## 🆕 Para activar el presupuesto 20% del fee (~5 min)

### 2. Agregar columna `fee_usd` a la tabla Jobs
**Por qué:** sin esta columna, el JobForm guarda el fee localmente pero no llega al backend, y la barra de presupuesto siempre dice "Sin precio cargado".

**Dónde:** Catalyst Console → Data Store → Jobs → Add Column.

**Config exacta:**
- Name: `fee_usd`
- Type: **Double** (también está como "Decimal" en algunas versiones)
- Mandatory: **No** (puestos viejos van a quedar sin fee)
- Default value: dejar vacío
- Searchable: No

Después de crearla, esperar 30-60 seg para que Catalyst la propague antes de probar.

---

## 📦 Tablas Catalyst pendientes del intento anterior (~30 min)

Estas son las 5 que quedaron a medias hoy a la mañana cuando Catalyst estaba con problemas. **Crear cuando puedas**, las features asociadas tolereran su ausencia.

**Dónde:** Catalyst Console → Data Store → Create Table (con los nombres renombrados, no los originales).

| Nombre nuevo | Reemplaza al envenenado | Para qué sirve |
|---|---|---|
| `EmailOverrides` | EmailTemplateOverrides | Edición de templates de email desde admin |
| `SavedFilters` | SavedSearches | Búsquedas guardadas en Pool/Candidatos |
| `Bookmarks` | UserFavorites | Marcar puestos/candidatos como favoritos |
| `CandidateLabels` | CandidateTags | Tags libres a candidatos |
| `RecruiterNotes` | CandidateNotes | Notas internas sobre candidatos |

Las columnas exactas están en `docs/master-plan/SCHEMA_MANIFEST.json` (tablas 27-31).

Si querés que use el script para crearlas con el nombre nuevo: avisame y lo corro.

---

## ⏰ Cronómetro destrabador del outbox (NUEVO, ~5 min)

### 4a. Crear cron secundario en Catalyst Console
**Por qué:** además del cron principal del outbox, un cron dedicado que SOLO destrabe eventos colgados da redundancia: si el cron principal está caído o saturado, este sigue recuperando eventos perdidos.

**Dónde:** Catalyst Console → tu app → Cron Jobs → Create Cron Job.

**Config:**
- **Name:** `outbox-reset-stuck`
- **Schedule:** cada 2 min (expresión: `*/2 * * * *`)
- **Function URL:** `https://[tu-app].catalystserverless.com/server/api/admin/outbox/reset-stuck`
- **Method:** `POST`
- **Headers:**
  - `X-Internal-Key: <valor de INTERNAL_API_KEY>`
  - `Content-Type: application/json`
- **Body:** `{"stale_minutes": 5}` (eventos en "processing" más de 5 min vuelven a "pending")

⚠️ Hacelo DESPUÉS de configurar el cron principal del outbox (si todavía no lo hiciste).

---

## 🌐 Webhook Recruit → SharkTalents (cuando hagamos Fase 3.5)

### 3. Workflow rule en Zoho Recruit Console
**Por qué:** para que cuando un candidato se registre en Recruit, SharkTalents se entere y tome el control de los mensajes.

**Dónde:** Zoho Recruit Console → Setup → Automation → Workflow Rules → Create New.

**Config:**
- **Module:** Candidates
- **Trigger:** "Candidate is created" o "Candidate is associated to Job Opening"
- **Condition:** (opcional) solo si el Job_Opening tiene un tag específico (ej. "SharkTalents")
- **Action → Webhook:**
  - URL: `https://app.sharktalents.ai/server/api/api/webhooks/zoho-recruit`
  - Method: POST
  - Headers: `X-Zoho-Recruit-Secret: <el valor de ZOHO_RECRUIT_WEBHOOK_SECRET>`
  - Body (JSON):
    ```json
    {
      "event_id": "${Candidates.Candidate Id}-${current_timestamp}",
      "event_type": "candidate.created",
      "candidate_id": "${Candidates.Candidate Id}",
      "recruit_job_id": "${Candidates.Job_Opening.Id}"
    }
    ```

**¿Cristian o vos?** Esto lo puede hacer Cristian (es config técnica de Recruit). O vos siguiendo los pasos arriba — se hace en ~15 min.

**Antes de hacerlo:** avisame para que yo termine el handler `candidate.created` en backend (hoy solo escucha 3 eventos).

---

## 📱 Twilio WhatsApp (cuando Cristian libere el chip)

### 4. Cuenta + sandbox + env vars
**Dónde:** twilio.com + Catalyst Console.

**Pasos:**
1. Crear cuenta Twilio (necesita el chip de Cristian para validar el número).
2. Console → Develop → Messaging → Try it out → activar sandbox.
3. Joinear sandbox desde tu WhatsApp.
4. Copiar Account SID + Auth Token del dashboard.
5. Catalyst Console → Functions → api → Environment Variables → Add:
   - `TWILIO_ACCOUNT_SID = AC...`
   - `TWILIO_AUTH_TOKEN = ...`
   - `TWILIO_WHATSAPP_FROM = whatsapp:+14155238886` (sandbox)
   - `RECRUITER_WHATSAPP = +50760000000` (tu número real)

Después: redeploy del backend.

---

## 🎯 Decisiones pendientes (necesito tu respuesta)

### 5. Borradores Zia huérfanos (crítico #6 de auditoría)
Para ayudarte a decidir, agregué un endpoint que te dice cuántos hay y a qué clientes podrían pertenecer (basado en meeting URL / source).

**Para ver el reporte:**
```bash
curl -H "X-Internal-Key: <INTERNAL_API_KEY>" \
  https://app.sharktalents.ai/server/api/admin/diagnose/zia-orphan-drafts
```

Devuelve algo así:
```json
{
  "orphan_count": 3,
  "drafts": [
    { "rowid": "...", "status": "draft_generated", "source": "zia@...", "created_at": "...", "likely_client_hint": "email: diego@pixelweb.com" }
  ]
}
```

Decidí después de mirar la lista:
- **Sí, salvarlos:** decime los row IDs + el tenant_id que les corresponde a cada uno.
- **No, borrarlos:** los limpiamos.
- **Si `orphan_count` = 0:** no hay nada que hacer, decisión cerrada.

### 6. Crítico #2 — Secuestro de tenant vía site key pública
¿Empezamos la investigación previa antes de arreglarlo? Es el otro crítico con riesgo medio.

### 7. Cronograma para Fase 3.5 (webhook Recruit)
¿Quién hace el workflow rule de Recruit Console, Cristian o vos? Me decís y yo termino el handler backend en paralelo.

---

## ✅ Lista corta para hoy

Si solo querés hacer lo mínimo hoy:

1. Borrar las 3 env vars E2E del ambiente Production (#1).
2. Agregar columna `fee_usd` a Jobs (#2).
3. Cargar `fee_usd` en al menos un puesto activo para probar la barra de presupuesto.

Eso te toma ~15 min y desbloquea todos los fixes que metí hoy.
