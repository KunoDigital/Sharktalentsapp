# Friday Runbook — Cris

**Fecha objetivo:** viernes 2026-05-08 (o el día que te sientes a ejecutar todo de una)
**Tiempo estimado total:** ~90 minutos si nada falla, ~120 con verificaciones
**Pre-requisito:** tener abierta una terminal en `/Users/usuario/sharktalentsapp` y estar logueada en Catalyst Console

Este doc tiene **TODO lo que tenés que hacer al 100%**. Cada paso incluye:
- ✅ exacto qué hacer
- 📋 valores a pegar (placeholders cuando son tuyos)
- 🔍 cómo verificar que funcionó
- ❌ qué hacer si falla

Si algo no funciona, **PARÁ y avisame** — no improvises, hay riesgo de pisar configuración.

---

## Paso 0 — Preparación (5 min)

### 0.1 Variables que necesitás a mano

Antes de empezar, preparate estos valores en un notepad/scratch (no en chat):

- [ ] **ELEVENLABS_API_KEY** — sacalo de https://elevenlabs.io/app/settings/api-keys (botón "Create API Key")
- [ ] **ZEPTOMAIL_API_TOKEN** — lo conseguís en el Paso 7
- [ ] **SENTRY_DSN** — lo conseguís en el Paso 8
- [ ] **INTERNAL_API_KEY** — el que ya pegaste en Catalyst Console (necesitás copiarlo de nuevo para verify-tables)

### 0.2 Pull último código

```bash
cd /Users/usuario/sharktalentsapp
git status
git log --oneline -5
```

Verifica que estás en la última versión (commit reciente con los tests nuevos).

---

## Paso 1 — Crear 2 tablas nuevas en Catalyst Console (~25 min)

### 1.1 Imprimir checklist amigable

```bash
./scripts/print-migrations-checklist.sh docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv
```

Te imprime en terminal cada columna con sus settings. Tenelo abierto mientras creás.

### 1.2 Crear `EnglishTestSessions` (18 columnas)

1. **Catalyst Console** → tu proyecto SharkTalentsApp → **Cloud Scale → Catalyst Datastore**
2. Click **Create Table** (arriba a la derecha)
3. Nombre: `EnglishTestSessions`
4. Click **Create**
5. Una vez creada, click en el nombre → **New Column** y agregá una por una:

| Columna | Tipo | Largo | Mandatory | Unique | Default |
|---|---|---|---|---|---|
| tenant_id | Var Char | 40 | Sí | No | — |
| result_id | Var Char | 40 | Sí | No | — |
| level_required | Var Char | 4 | Sí | No | — |
| started_at | DateTime | — | Sí | No | — |
| completed_at | DateTime | — | No | No | — |
| mc_score_pct | Int | — | No | No | — |
| listening_score_pct | Int | — | No | No | — |
| writing_score_pct | Int | — | No | No | — |
| total_score_pct | Int | — | No | No | — |
| passed | Boolean | — | Sí | No | false |
| writing_text | Text | — | No | No | — |
| writing_word_count | Int | — | No | No | — |
| writing_time_seconds | Int | — | No | No | — |
| writing_paste_attempts | Int | — | No | No | 0 |
| writing_focus_lost_count | Int | — | No | No | 0 |
| audio_listening_id | Var Char | 40 | No | No | — |
| video_response_id | Var Char | 40 | No | No | — |
| writing_analysis_json | Text | — | No | No | — |

### 1.3 Crear `MindsetScores` (20 columnas)

Mismo procedimiento. Columnas en `MIGRATIONS_TESTS_NUEVOS.csv`. Punto clave:
- `result_id` es **Unique = Sí** (un candidato solo tiene un score de mentalidades)

### 1.4 Agregar 3 columnas a `Jobs` (existente)

Click en tabla **Jobs** → **New Column**:

| Columna | Tipo | Largo | Mandatory | Default |
|---|---|---|---|---|
| english_required | Boolean | — | No | false |
| english_min_level | Var Char | 4 | No | — |
| mindset_test_enabled | Boolean | — | No | true |

### 🔍 Verificar Paso 1

```bash
INTERNAL_KEY="<pegá-tu-key>"
curl -s -H "X-Internal-Key: $INTERNAL_KEY" \
  "https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/admin/verify-tables" \
  | python3 -m json.tool | head -40
```

**Resultado esperado:** `"ok": true` con `total_tables_ok: 18`. Si dice 17 o menos, falta alguna columna o tabla.

### ❌ Si falla

Si verify-tables dice "missing_columns" en alguna tabla:
1. Anotá qué tabla y qué columna falta
2. Andá a esa tabla en Catalyst Console y agregá la columna
3. Re-corré el verify

**No deployes el backend hasta que verify-tables diga ok=true.**

---

## Paso 2 — Generar audios del test de inglés (~10 min)

### 2.1 ElevenLabs API key

1. Andá a https://elevenlabs.io/app/settings/api-keys
2. Si no tenés cuenta, signup (free tier 10K chars/mes — alcanza)
3. Click **Create API Key**
4. Copialo (empieza con `sk_...`)

### 2.2 Correr script de generación

```bash
export ELEVENLABS_API_KEY="sk_xxxxxxxxxxxxx"
./scripts/generate-english-audios.sh
```

**Resultado esperado:** 4 MP3s en `english-listening/` con nombres:
- `english-listening-a2.mp3` (~30 seg, voz Rachel)
- `english-listening-b1.mp3` (~45 seg, voz Adam)
- `english-listening-b2.mp3` (~60 seg, voz Rachel)
- `english-listening-c1.mp3` (~90 seg, voz Adam)

### 2.3 Escuchar para confirmar calidad

```bash
open english-listening
```

Reproducí cada uno. Si alguno suena raro/robótico/cortado:
1. Editá `scripts/generate-english-audios.sh` → cambiá la voz (líneas 38-39)
2. Comentá las llamadas que ya están bien (al final del script)
3. Re-corré

### ❌ Si falla

- "ELEVENLABS_API_KEY not set" → re-exportá la variable
- HTTP 401 → key inválida, regeneralá
- HTTP 429 → llegaste al límite del free tier, esperá hasta el próximo mes o paga $5

---

## Paso 3 — Catalyst File Store: folders + uploads (~10 min)

> **OJO:** los nombres de folder en Catalyst File Store **no pueden tener guiones** (ni espacios). Usar solo letras minúsculas pegadas.

### 3.1 Folder `englishlistening` en File Store

Creé este folder local pero falta el de Catalyst Console:

1. **Catalyst Console** → **Cloud Scale → File Store**
2. Click **Create Folder**
3. Nombre: `englishlistening` (sin guion)
4. Click **Create**
5. Click en el folder recién creado → vas a ver el **Folder ID** (número largo tipo `28606000000xxxxx`) en la barra de la URL o en el panel
6. **Copialo**, lo necesitás en Paso 4

### 3.2 Subir los 4 MP3s

1. Dentro del folder `englishlistening`, click **Upload File**
2. Seleccioná los 4 MP3s de `english-listening/` local (los archivos sí pueden tener guion en el nombre)
3. Confirma upload

### 3.3 Folder `candidatevideos`

1. Volvé al menú **File Store** (root)
2. Click **Create Folder**
3. Nombre: `candidatevideos` (sin guion)
4. Click **Create**
5. Anotá el Folder ID

### 3.4 Folder `largecontent`

1. **Create Folder** → Nombre: `largecontent` (sin guion)
2. Click **Create**
3. Anotá el Folder ID

Para qué sirve: Catalyst Datastore tiene límite de 10K chars por columna Text. El backend usa este folder para transcripts de briefings largos, reportes multi-candidato, drafts grandes. Sin esto, esos features devuelven 503 con mensaje claro.

### 🔍 Verificar Paso 3

En la lista de File Store deberías ver **3 folders** (`englishlistening`, `candidatevideos`, `largecontent`) + los 4 MP3s adentro de englishlistening.

---

## Paso 4 — Env vars en Catalyst Console (~5 min)

**Catalyst Console → Functions → api → Environment Variables**

Click **Add Variable** por cada una:

| Key | Value |
|---|---|
| `FILESTORE_VIDEO_FOLDER_ID` | `28606000000751079` (folder `candidatevideos`) |
| `FILESTORE_ENGLISH_AUDIOS_FOLDER_ID` | `28606000000751088` (folder `englishlistening`) |
| `FILESTORE_LARGE_CONTENT_FOLDER_ID` | `28606000000751097` (folder `largecontent`) |

(Las 7 secrets que ya tenés siguen ahí intactas — ahora que sacamos `env_variables` del catalyst-config.json no se borran más en deploys.)

### 🔍 Verificar Paso 4

Refrescá la pantalla de Environment Variables. Deberías ver tus 7 secrets + las nuevas 3 + las ~21 de config = ~31 vars en total.

---

## Paso 5 — Re-deploy backend con código nuevo (~5 min)

```bash
./scripts/validate-deploy.sh
```

Si dice "✓ Todo en orden — listo para deployar":

```bash
./scripts/deploy-backend.sh
```

### 🔍 Verificar Paso 5

```bash
curl -s "https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/health" | python3 -m json.tool
```

**Resultado esperado:** `"status": "ok"`, todos los checks en verde, `version: "0.1.0"`.

Después corré verify-tables otra vez:

```bash
curl -s -H "X-Internal-Key: $INTERNAL_KEY" \
  "https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/admin/verify-tables" \
  | python3 -m json.tool | head -10
```

**Esperado:** `"ok": true, "total_tables_ok": 18`.

### ❌ Si falla

- "Missing required env var" → alguna secret se borró. Volver a Paso 4.
- "Catalyst deploy failed" → mandame el error completo, no improvises.

---

## Paso 6 — Re-deploy frontend (~5 min)

```bash
./scripts/deploy-frontend.sh
```

Genera el ZIP en `shark/sharktalents-frontend-0.1.0.zip` (~3 MB).

Después:

1. **Catalyst Console** → **Cloud Scale → Web Client Hosting**
2. Click **Upload** → seleccioná el ZIP
3. Confirma → 1-2 min de deploy
4. Abrí el browser: `https://sharktalentsapp-883996440.development.catalystserverless.com/app/`

### 🔍 Verificar Paso 6

Carga el login de Clerk → entrá → ves el dashboard. Si todo OK, ya está vivo el código nuevo.

---

## Paso 7 — ZeptoMail (email transaccional, parte de Zoho One) (~15 min)

### 7.1 Activar ZeptoMail en tu Zoho One

1. Andá a https://www.zoho.com/zeptomail/
2. Click **Sign in** (esquina superior derecha) → ingresá con tu cuenta Zoho One
3. Si te pide "Try Free" o "Add to my plan", confirma — está incluido en Enterprise (verifica en tu panel de admin Zoho)

### 7.2 Verificar dominio `sharktalents.ai`

1. ZeptoMail → **Mail Agents** → **Setup Mail Agent**
2. Nombre: `SharkTalents transactional`
3. **Domain to send from:** `sharktalents.ai`
4. Click **Add Domain**
5. ZeptoMail te muestra **3 registros DNS para agregar:**
   - SPF record (TXT)
   - DKIM record (TXT)
   - Domain Verification record (TXT)
6. Andá a tu proveedor DNS (donde administrás `sharktalents.ai`) y agregá los 3 registros
7. Volvé a ZeptoMail → click **Verify** (puede tardar 5-30 min en propagar)

### 7.3 Crear Mail Agent + obtener API token

1. Una vez verificado el dominio, ZeptoMail → **Mail Agents** → click en el que creaste
2. Sección **Send Mail API** → **Generate Token** o ya viene generado
3. Copialo (empieza con `Zoho-enczapikey ...`)
4. Anotá también el **From Email** que vas a usar (ej: `noreply@sharktalents.ai`)

### 7.4 Pegá en Catalyst Console env vars

| Key | Value |
|---|---|
| `ZEPTOMAIL_API_TOKEN` | El token de 7.3 |
| `ZEPTOMAIL_FROM_EMAIL` | `noreply@sharktalents.ai` |
| `ZEPTOMAIL_FROM_NAME` | `SharkTalents` |

### 🔍 Verificar Paso 7

Test desde la propia UI de ZeptoMail: Mail Agent → **Send Test Mail** → poné tu email. Si te llega, el dominio + token están ok.

(El wire-up del backend con esto lo hago yo en código en paralelo — listo para cuando deploys.)

---

## Paso 8 — Sentry (error tracking, opcional pero recomendado) (~5 min)

1. https://sentry.io/signup
2. Project type: **Node.js** (para backend)
3. Project name: `sharktalents-backend`
4. Te muestra el **DSN** (URL larga con `@sentry.io`)
5. Copiá el DSN

### Pegá en Catalyst Console:

| Key | Value |
|---|---|
| `SENTRY_DSN` | El DSN |
| `SENTRY_ENV` | `development` |

(Para el frontend, repetí pero project type **Browser Javascript** y guardá `VITE_SENTRY_DSN` en `shark/.env.production`. Opcional para Fase 1.)

---

## Paso 9 — Cron job Catalyst para outbox processor (~10 min)

Sin esto, los eventos `email.send_pending`, `mindset_test_completed`, `english_test_completed` quedan colgados en la tabla `OutboxEvents` y nunca se procesan.

### 9.1 Catalyst Console → Cron Jobs

1. **Catalyst Console** → **Cloud Scale → Cron Jobs**
2. Click **Create Cron Job**
3. Configurá:
   - **Name:** `outbox-processor`
   - **Frequency:** custom → cada 5 minutos
     - Cron expression: `*/5 * * * *`
   - **Job Type:** **Function**
   - **Function:** `api`
   - **Method:** `POST`
   - **Path:** `/admin/outbox/process`
   - **Headers:** agregar `X-Internal-Key: <tu INTERNAL_API_KEY>`
4. Click **Create**

### 9.2 Cron job para video purge (GDPR retention)

Repetir con:
- **Name:** `video-purge`
- **Frequency:** diario a las 3 AM (`0 3 * * *`)
- **Path:** `/admin/gdpr/purge-old-videos`
- **Headers:** `X-Internal-Key: <tu key>`

### 🔍 Verificar Paso 9

En Cron Jobs deberías ver 2 jobs activos. Click en cada uno → revisar el **Run History** después de 5 min para ver que ejecutaron sin error.

---

## Paso 10 — Smoke test final (~5 min)

```bash
INTERNAL_API_KEY="<tu-key>" \
CATALYST_API_URL="https://sharktalentsapp-883996440.development.catalystserverless.com/server/api" \
./scripts/smoke-test.sh
```

**Esperado:** ~22-25 tests pasan, los webhooks externos siguen en 503 (correcto, no están configurados todavía).

---

## ✅ Checklist final

Cuando termines, marcá todo:

- [ ] 18 tablas verificadas (verify-tables ok=true)
- [ ] 4 audios MP3 escuchados y aprobados
- [ ] 2 folders creados en File Store con env vars
- [ ] 7 secrets + ~24 config vars en Catalyst Console
- [ ] Backend re-deployado (health ok)
- [ ] Frontend re-deployado (login funciona)
- [ ] ZeptoMail con dominio verificado + token + test email recibido
- [ ] Sentry DSN configurado
- [ ] 2 cron jobs activos (outbox + video purge)
- [ ] Smoke test verde

---

## 📋 Después del viernes

Avisame que terminaste y yo:
1. Verifico todo via APIs admin
2. Le mando a Cristian su brief con todo el contexto que necesite
3. Definimos qué se hace primera semana de Cristian

Si algo te confunde o queda raro, **PARÁ y avisame** — el costo de pausar es bajo, el de improvisar y romper es alto.
