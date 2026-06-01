# Changelog

Cambios relevantes del proyecto. Sigue el formato [Keep a Changelog](https://keepachangelog.com/) y SemVer.

## [Unreleased]

### 2026-05-12 — CORS gateway fix + Zoho CRM auth unificada

**Fix CORS duplicado (bloqueaba landing en browsers):**
- El gateway de Catalyst Functions duplicaba `Access-Control-Allow-Origin` + `Allow-Credentials` cuando los seteábamos manualmente. El navegador rechazaba con error "header contains multiple values".
- Fix en `lib/cors.ts`: dejamos que Catalyst inyecte Allow-Origin/Allow-Credentials automáticamente. Nosotros sólo seteamos Vary + Methods + Headers + Max-Age.
- Verificado con curl: POST y OPTIONS responses devuelven headers únicos (sin duplicar).

**Zoho CRM client unificado al OAuth helper compartido:**
- `lib/zohoCrmClient.ts` antes usaba `ZOHO_CRM_OAUTH_TOKEN` como access_token estático (caduca a la hora).
- Refactor: ahora usa `getZohoAuthHeader()` de `lib/zohoOAuth.ts` igual que Recruit/Sign/Bookings.
- Eliminada env var `ZOHO_CRM_OAUTH_TOKEN`. Cris regenera el `ZOHO_OAUTH_REFRESH_TOKEN` compartido con scope CRM adicional (`ZohoRecruit.modules.ALL,ZohoCRM.modules.ALL`).
- Sólo queda `ZOHO_CRM_API_URL` como env var específica de CRM (default `https://www.zohoapis.com/crm/v6`).
- Updated CRISTIAN_HANDOFF.md §1 + master-plan/23 + master-plan/24.

### 2026-05-11 (tarde) — Sign + Bookings esqueleto + admin actions completas

**Marketing admin actions (3 endpoints + UI completa):**
- `POST /api/marketing/lead-manual` — Cris carga lead manual desde WhatsApp (auth tenant)
- `POST /api/marketing/lead/:id/send-demo` — mandar test gratis al colaborador del cliente (admin, sin captcha)
- `POST /api/marketing/lead/:id/send-contract` — disparar contrato a firmar vía Zoho Sign (con pre-fill desde lead)
- `POST /api/marketing/lead/:id/convert-to-tenant` — convertir lead → Tenant manualmente (cuando firma contrato sin Sign integrado)
- Frontend Settings → Leads: botones "+ Nuevo lead manual" + "📧 Mandar demo" + "📝 Convertir a cliente"

**Zoho Sign — wiring completo (esperando solo el template_id de Cris):**
- `sendContract()` helper en `lib/zohoSignClient.ts` con pre-fill de 13 merge fields
- Webhook handler ampliado: si detecta evento 'completed' de Sign con `signer_email` que matchea un MarketingLead → **auto-crea Tenant** (lead → Tenant sin pasos manuales)
- Nueva env var `ZOHO_SIGN_CONTRACT_TEMPLATE_ID` (Cris carga template a Sign Console + setea)
- Documentación: `docs/contracts/contrato_sharktalents_TEMPLATE.md` (texto con espacios en blanco) + `zoho_sign_setup_guide.md` (guía paso a paso para subir a Sign)

**Eval-request auto-bootstrap:**
- `ensureMarketingDemoSetup()` crea automáticamente Tenant interno + Job demo en la primera llamada a `/eval-request` o `/send-demo`. Sin setup manual ni env vars adicionales.

**Bookings preliminar:**
- `GET /api/briefings` — lista briefings del tenant (gracioso fallback si la tabla no existe)
- Wire del scheduler existente sigue OK; queda pendiente subir docs de configuración de Zoho Bookings.

**Frontend admin:**
- Dashboard: nuevo widget "📥 Funnel marketing" (counts new/eval_requested/eval_completed/call_booked/won/lost + conversion rate)
- Settings → ⚙️ Operacional: nuevo bloque "📋 Eventos outbox recientes" — timeline de los últimos 20 eventos con status / retry_count / errors
- Settings → 📥 Leads: detail modal con `LeadDetailModal` ahora tiene botones "📧 Mandar demo" + "📝 Convertir a cliente"
- Marketing Leads admin UI ahora incluye `NewLeadModal` para creación manual

**Health endpoint refactor:**
- Separación clara entre OAuth compartido (`zoho_oauth`), Recruit, Sign, Bookings, CRM
- Nueva entry `zoho_sign_contract` para reflejar si el template está cargado
- Las env vars viejas (`ZOHO_RECRUIT_OAUTH_TOKEN`, `ZOHO_SIGN_OAUTH_TOKEN`) reemplazadas por el flow compartido `ZOHO_OAUTH_*`

**Docs:**
- Nueva carpeta `docs/TablasDeCatalyst/` con 7 docs + 4 templates para que el equipo de Kuno (u otros agentes Claude) puedan crear tablas de Catalyst vía API en otros proyectos
- CRISTIAN_HANDOFF.md actualizado: Recruit/Tenant/templates eliminados de su lista (ya hechos)

**Testing:**
- 813/813 backend tests pasan
- Frontend build limpio

### 2026-05-11 (cont.) — Marketing landing integration end-to-end

**Marketing landing (Slate) ↔ Backend (Catalyst Functions):**
- 5 endpoints listos para consumo público: `POST /api/marketing/lead`, `POST /eval-request`, `GET /lead-status`, `POST /lead/request-deletion`, `DELETE /lead`
- CORS headers expandidos: `X-Marketing-Site-Key`, `X-Visit-Id`, `X-Meta-Event-Id`
- `MarketingLeads` schema ampliado: 11 columnas nuevas (status, eval_*, deletion_*, visit_id, meta_event_id, etc.) agregadas via Catalyst columns API en vivo
- `MARKETING_SITE_KEY` generada con `scripts/generate-secret.sh` (64 chars hex) y validada en cada request via `verifySiteKey`
- Honeypot anti-bot (`website` field) — devuelve 200 silencioso si tiene contenido
- UPSERT por email en POST /lead (no duplicados)
- Outbox event `lead.captured` enquead automáticamente al crear lead → dispara sync a Zoho CRM (pendiente OAuth de CRM, lo arma Cristian)
- Tag `SharkTalents` automático en lead pusheado al CRM compartido de Kuno (visible en CRM UI, filtrable, sobrevive Lead→Contact→Deal conversion)

**Cloudflare Turnstile (anti-bot en eval-request):**
- `lib/turnstile.ts` con `verifyTurnstileToken` + `isDevBypass`
- Wired en `POST /api/marketing/eval-request` antes de cualquier procesamiento
- `TURNSTILE_SECRET_KEY` seteada y validada contra Cloudflare real (token falso → 403 invalid_captcha ✓)
- NO se aplica a POST /lead (decisión por conversion rate)

**GDPR / Ley 81 Panamá:**
- `POST /api/marketing/lead/request-deletion` — genera token (32 bytes random, hash sha256 persistido), expira 24h, enquea email `marketing_deletion_request`
- `DELETE /api/marketing/lead` — confirma con `{email, deletion_token}`, borra el row físico
- Respuesta genérica para evitar email enumeration attacks

**Email templates nuevos:**
- `marketing_deletion_request` (ES + EN) — link confirmación de baja
- `marketing_demo_test_link` (ES + EN) — invitación al test gratuito para member evaluado

**Frontend admin (Settings):**
- Tab "📥 Leads" rebuilt: stats cards + filtros (status/urgency/min_score/email) + tabla con score badges + detail modal con UTM tracking completo
- Tab "⚙️ Operacional" (ronda anterior, mejorado con preview del email setup)

**Tests:**
- +14 tests (Turnstile helper + email templates marketing) → 813/813 pass

### 2026-05-11 — Catalyst Schema API: 7 tablas Block 2 creadas vía REST

**Discovery:** Zoho soporte confirmó que Catalyst Datastore expone API para crear tablas + columnas. Antes había que crear todo a mano en Console UI.

**Infra nueva:**
- `docs/master-plan/SCHEMA_MANIFEST.json` (26 tablas, 303 columnas) — extraído del EXPECTED array de admin.ts y mapeado a tipos de la API (`Text→text`, `Var Char→varchar`, `Integer→int`, etc.)
- `scripts/create-catalyst-tables.ts` — script principal (dry-run + execute, --only filter, OAuth refresh automático)
- `scripts/create-stubborn-table.ts` — fallback para tablas que tardan >45s en propagarse: polea cada 15s hasta 5 min con una probe column antes de agregar las reales

**Tablas creadas via API (7 nuevas Block 2):**
- EnglishTestSessions (18 cols)
- JobTrackingSnapshots (8 cols)
- TokenUsage (10 cols)
- MarketingLeads (16 cols)
- PrefilterAnswers (5 cols)
- MindsetScores (21 cols)
- PrefQuestions (8 cols) — renombrada de `PrefilterQuestions`

**Quirks de Catalyst descubiertos (anotados en memoria):**
1. **Eventual consistency 5-60s** entre POST /table y poder POSTear /column. Si no esperás suficiente, la tabla queda huérfana permanente (table_id roto, name reservado).
2. **Nombres envenenados:** después de un orphan, ese name de tabla queda **permanentemente roto** en columns API aunque aparezca en UI. Caso real: PrefilterQuestions quedó envenenado tras 5+ intentos fallidos. Renombrada a `PrefQuestions` en código (admin.ts EXPECTED + features/prefilter.ts).

**Aprendizajes operacionales:**
- Mejor delay para create→column es 60s+ (no 5-15s).
- Si una tabla falla, Cris debe borrar el orphan en UI antes de reintentar.
- Si un name queda envenenado, renombrar y actualizar referencias en código.

### 2026-05-08 — Setup operativo de Cris + Catalyst Text 10K + Email cliente

**Operativo (Cris):**
- 3 folders en Catalyst File Store creados (sin guion, Catalyst los rechaza): `candidatevideos`, `englishlistening`, `largecontent`
- 4 MP3s del listening (CEFR A2/B1/B2/C1) subidos a `englishlistening`
- Mail Agent "Shark" en ZeptoMail + dominio `sharktalents.ai` verificado
- Test email vía ZeptoMail: ✅ entregado correctamente
- Decisión email strategy: candidatos vía Recruit; ZeptoMail solo para 2 emails al cliente

**Catalyst Text limit refactor:**
- Discovery: límite real es 10K chars (no 64KB como asumíamos). `lib/dbLimits.ts` reescrito: TODOS los `FIELD_LIMITS` ≤ 9_500 chars.
- Nuevo `lib/largeContentStore.ts` — helper que decide automáticamente entre inline (<9.5K) y File Store overflow (>9.5K, guarda `file:<id>` en la columna).
- Refactor de 4 fields que exceden el límite: `ClientReports.bundle_payload`, `JobProfileDrafts.transcript`, `JobProfileDrafts.draft_payload`, `Jobs.tech_questions_cache`.
- Zia webhook: transcript ahora va a File Store antes del outbox (evita truncado silencioso del 50K transcript en OutboxEvents.payload de 8K).
- Doc reescrito: `docs/CATALYST_TEXT_LIMITS.md`.

**Env vars:**
- Renombrado prefijo `CATALYST_*_FOLDER_ID` → `FILESTORE_*_FOLDER_ID` (Catalyst reserva el prefijo `CATALYST_`).
- Nuevos defaults: `ZEPTOMAIL_FROM_EMAIL=reportes@sharktalents.ai`, `ZEPTOMAIL_FROM_NAME=SharkTalents`, `ZEPTOMAIL_REPLY_TO=proyectos@kunodigital.com`.
- Email templates de candidato eliminados (Recruit los maneja). Quedan solo: `client_portal_access`, `client_report_ready`, `recovery_link`.

**Email wiring:**
- Outbox dispatcher: header `Reply-To` automático en todos los emails ZeptoMail.
- `clientPortal.issuePortalForTenant` ahora dispara `email.send_pending` con template `client_portal_access` cuando se emite un portal token.
- Nuevo endpoint `POST /api/jobs/:id/notify-client-report-ready` (auth tenant) — Cris dispara desde JobDetail con botón "📤 Avisar cliente reporte listo".
- Nuevo endpoint `POST /api/outbox/process-now` (auth tenant) — trigger manual del outbox processor mientras no haya cron.

**Frontend:**
- Fix Dashboard.tsx (duplicate identifier `config`) y CandidateMindsetTest.tsx (Mentalidad type) — frontend build estaba roto.
- Nueva página `CandidateRecovery` en `/apply/:tenantSlug/:jobSlug/recover` para que candidatos pidan reenvío de su link.
- Nuevo componente reusable `TableNotReadyBanner` para mensajes 503 de tablas Block 2 ausentes.
- Nuevo método `api.jobs.notifyClientReportReady()` en lib/api.ts.

**Operacional:**
- Nuevo `functions/api/cron-config.json` — fuente de verdad para los 3 cron jobs (outbox processor cada 5min, video purge 3am, recruit sync cada 10min). Documentación de setup en Catalyst Console.

**Testing:**
- 799/799 backend tests pasan; frontend build limpio.

### Cross-cutting features (2026-05-08, ronda autónoma 10)

- **Backend libs nuevas:**
  - `lib/slackClient.ts` — webhook client + helpers `notifyFinalist` y `notifyAutoRejected`
  - `lib/zohoRecruitClient.ts` — sync de Candidates/stages con Zoho Recruit usando `zohoOAuth.ts`
  - `lib/zohoOAuth.ts` — token refresh con cache 50min, helper compartido para todos los Zoho clients
  - `lib/branding.ts` — parse + serialize de Tenants.branding_config con validación
  - `lib/continueTokens.ts` — Save & Continue para tests del candidato
  - `lib/tokenUsage.ts` — tracking de costos Anthropic con cost estimation
  - `data/whatsappTemplates.ts` — definiciones de 6 templates (candidate invite, reminder, offer, rejected, finalist ready, briefing scheduled)

- **Anthropic wrapper integrado con TokenUsage** — `anthropicMessage()` ahora acepta `{traceId, feature, tenantId, req}` opcional; si feature presente, registra el costo automáticamente (best-effort).

- **PublicReport con branding del tenant** — el bundle del reporte cliente ahora incluye `branding` (logo_url, colors, legal_name, etc.) cargado desde `Tenants.branding_config`.

- **Dashboard widget de costs IA** — banner con total USD últimos 30 días + link a `/settings?tab=costs` en Dashboard. Solo aparece si hay data.

- **Settings tabs nuevos:**
  - 📥 Leads — lista MarketingLeads
  - 💰 Costos IA — dashboard de TokenUsage por feature

- **JobsList badges** — columna "Tests" con icons coloreados (🔧 técnica, 🇺🇸 inglés, 🧠 mindset, ⚡ auto-rejection rules activas).

- **Auto-rejection rules expandido:**
  - Backend: `require_english_passed` + `mindset_min_adaptability` + validación
  - Frontend: UI completo en JobForm con conditional show
  - Engine: evaluación + razones humanas legibles

- **Bot decisor** ahora recibe mindset + english scores como input al prompt de Claude (decisiones más informadas).

- **Notifications types nuevos** (5): auto_rejected, mindset_flag, english_failed, cheating_flag, lead_captured con defaults razonables.

- **Health check extendido** — incluye status de integraciones opcionales (zeptomail, sentry, zoho_oauth, whatsapp, heyreach, slack).

- **Custom domain runbook** — `docs/RUNBOOKS/custom-domain-setup.md` con 8 pasos completos (DNS + SSL + Clerk + smoke test).

- **Tablas nuevas con schemas en verifyTables**:
  - `ContinueTokens` (Save & Continue)
  - `TokenUsage` (cost attribution)
  - `JobTrackingSnapshots`, `MarketingLeads`, `PrefilterQuestions`, `PrefilterAnswers`, `BotTrainingExamples`, `Briefings` (rondas anteriores)

- **CSVs migration:** `MIGRATIONS_BLOCK2_REMAINING.csv` actualizado con 8 tablas nuevas listas para crear en Catalyst Console.

**Tests:** 799 backend + 185 frontend = **984 todos verdes**.

**Deploy status:** code-complete a la espera de que Cris cree tablas + configure ZeptoMail + audios ElevenLabs + Sentry.

---

### Tests nuevos en diseño (2026-05-05 / 2026-05-06)

**Hito:** se diseñaron y armaron 2 tests nuevos del candidato — **Test de inglés** (multiple-choice + listening + writing IA + speaking video) y **Test de Mentalidades** (basado en marco McKinsey Forward — Adaptabilidad y Resiliencia). Ambos están code-complete a nivel scoring + endpoints + bancos. Falta tablas en Catalyst Console + UI candidato + deploy.

**Test de inglés (4 niveles CEFR):**
- 4 niveles ofrecidos al cliente: A2 / B1 / B2 / C1 con thresholds 60/65/70/75%
- 160 preguntas multiple-choice curadas en repo (40 por nivel × 4 niveles)
- 4 listening scripts + 8 preguntas + script para generar audios con ElevenLabs (`scripts/generate-english-audios.sh`)
- 4 writing prompts calibrados al CEFR
- IA writing analyzer con prompts CEFR + types tipados ([englishWritingAnalyzer.ts](functions/api/src/lib/englishWritingAnalyzer.ts))
- Endpoint `POST /test/<token>/english/submit` con scoring ponderado (50% MC + 25% listening + 25% writing)
- Anti-cheat: hook `useAntiPaste` para el textarea (paste/copy/contextmenu blocked + tracking de focus loss)
- Costo IA: ~$0.05/candidato que llegue al writing

**Test de Mentalidades (McKinsey Forward):**
- 10 preguntas situacionales con 6 opciones cada una (3 ejes × 2 polos por pregunta)
- Banco curado en `shark/src/data/questions/mindset.json` con 10 preguntas validadas
- Posicionamiento en flow del candidato: entre DISC y VELNA, sin nombre que alerte
- Output principal binario: adaptable / mixto / limitante
- Output secundario: perfil de los 14 polos (7 ejes × 2 polos)
- Endpoint `POST /test/<token>/mindset/submit` con scoring + persistencia
- Sin costo IA recurrente

**Schema (pendiente de crear en Catalyst Console):**
- 2 tablas nuevas: `EnglishTestSessions` (18 cols) + `MindsetScores` (20 cols) — ver `docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv`
- 3 columnas nuevas en Jobs: `english_required`, `english_min_level`, `mindset_test_enabled`

**Backend nuevo (code-complete):**
- `lib/mindsetScoring.ts` — pure function, 23 unit tests
- `lib/englishScoring.ts` — pure function con thresholds CEFR
- `lib/englishWritingAnalyzer.ts` — wrapper Claude + parsing
- `lib/englishWritingPrompts.ts` — 4 rubrics CEFR + types
- `features/mindsetTest.ts` — endpoint con persistencia
- `features/englishTest.ts` — endpoint con persistencia
- `verifyTables` extendido con las 2 tablas nuevas
- Truncate defensivo en JSON outputs (Catalyst row 32KB limit)

**Frontend nuevo:**
- Hook reusable `useAntiPaste.ts`
- JobForm modificado con sección "Tests opcionales del candidato": checkbox inglés + dropdown nivel + checkbox mentalidades
- Bank validator vitest tests (46 assertions sobre los 5 bancos)

**Tooling:**
- `scripts/generate-english-audios.sh` — genera 4 MP3s con ElevenLabs API
- `scripts/print-migrations-checklist.sh` — convierte CSV → checklist amigable para Catalyst Console
- `docs/MEJORAS.md` — doc de exploración con todo el diseño detallado
- `docs/master-plan/25_TEST_INGLES.md` + `26_TEST_MENTALIDADES.md`
- `docs/PUNCH_LIST.md` — checklist de pendientes para Cris

**Tests:** 716 backend (was 693, +23 scoring) + 46 nuevos frontend (bank validator).

**Pendiente para activar:**
1. Cris crea las 2 tablas + 3 columnas en Catalyst Console (~30 min con `print-migrations-checklist.sh`)
2. Cris genera los 4 audios con ElevenLabs + sube a Catalyst File Store
3. UI candidato (CandidateMindsetTest.tsx + CandidateEnglishTest.tsx) — diseño en sesión conjunta
4. Re-deploy backend + frontend
5. Validar bancos de preguntas leyendo el contenido

---

### Deployed (2026-05-04 — primer deploy v2 a Catalyst Development)

**Hito:** SharkTalents v2 deployado por primera vez a Catalyst Development environment. Backend operacional con 21 tablas Catalyst creadas + frontend wireado con Clerk auth.

**Resumen del deploy:**
- ✅ Backend deployado a `https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/`
- ✅ Frontend deployado en `/app/` (Catalyst Web Client Hosting)
- ✅ Health check OK: process + database + env_vars + anthropic_breaker todo en verde
- ✅ Anthropic Claude Haiku 4.5 conectado y respondiendo
- ✅ Clerk auth configurado y login funcional

**21 tablas Catalyst creadas en esta sesión:**
- Block 1 (existían antes): Tenants, ProcessedEvents, Scores, OutboxEvents
- Bloque nuevo: Jobs, Candidates, Results, PipelineTransitions, IntegrityDimensions, AuditLog (con columnas extra), ApiKeys, ClientReports, Config, AntiCheatEvents, BotDecisions, BotTrainingExamples, CandidatePool, ContinueTokens, ClientNotifications, ClientNotificationTemplates, Briefings

**Bugs corregidos durante el deploy:**

1. **`vite.config.ts` sin base path** — los assets se pedían a `/assets/...` (root) pero Catalyst Web Hosting sirve la app bajo `/app/`. Agregamos `base: '/app/'` en el config. Sin esto, todos los JS/CSS daban 404 después del primer deploy.

2. **`.env.production` con placeholder `pk_live_replace`** — el bundle JS se construía con la string literal `pk_live_replace` adentro, Clerk fallaba al inicializar y la app quedaba en blanco. Lección: validar env vars **antes** de buildear.

3. **Falta `client-package.json` en el ZIP del frontend** — Catalyst Web Hosting requiere ese archivo en la raíz para identificar la app. Lo agregamos al `shark/` y al script de deploy lo copia al `dist/` antes de zip-ear.

4. **`Config.key` es palabra reservada SQL** — Catalyst no permite columnas con nombres reservados. Renombrada a `config_key` en código + CSV.

5. **`ClientReports.token` con Var Char 500** — Var Char en Catalyst tiene máx 255. Refactorizado: ahora usa `cache_key` (Var Char 64, hash SHA-256 del input) que también es semánticamente más correcto.

6. **`Catalyst CLI 1.25.x` deprecó `--env`** — el deploy script usaba `catalyst deploy --env production` que ya no existe. Simplificado a `catalyst deploy --only functions:api` (la versión actual solo deploya a Development env).

7. **Várias env vars en Catalyst Console quedaron con placeholder `set-in-catalyst-console`** — Cris las cambió manualmente al detectarlas. Ahora tenemos `validate-deploy.sh` para detectar esto automáticamente en futuros deploys.

8. **Anthropic API key con saldo $0** — la cuenta requería recarga. $1.93 USD de crédito alcanzó para que Claude responda al ping (modelo Haiku consume ~$0.000020 por request).

9. **Clerk Fallback development host vacío** — después del login Clerk redirigía a `/app` (sin `/` final) y Catalyst respondía `INVALID_URL_PATTERN`. Configurado el host correcto en Clerk Dashboard.

**Nuevas herramientas operacionales:**
- `scripts/validate-deploy.sh` — corré antes de cada deploy. Chequea: archivos requeridos, placeholders en `.env.production`, build artifacts actualizados, tests pasando, type check OK. Detecta los bugs típicos antes de tiempo.
- `scripts/smoke-test.sh` — corré después de cada deploy. Pega ~25 endpoints públicos + admin, reporta pass/fail.

**Documentación actualizada:**
- `MIGRATIONS_AGREGAR_COLUMNAS.csv` — 5 columnas a agregar a tablas existentes
- `MIGRATIONS_NUEVAS.csv` — 35 tablas nuevas pendientes
- `MIGRATIONS_PENDIENTES.csv` — schema completo de todas las tablas
- `README.md` raíz — sección "Estado actual (2026-05-04)" con tabla de 15 integraciones, features end-to-end, diagrama ASCII del flujo
- `API_CLIENT_GUIDE.md` — todos los métodos del cliente (drafts, briefings, prefilter, marketing, integrations, etc.)
- `ENV_VARS.md` — ~30 env vars documentadas en 8 secciones
- `23_INTEGRACIONES_ZOHO.md` — sección "Status de implementación (al 2026-05-03)" con quick reference por integración

**Tests al final del día:** Backend **693/693**. Frontend **109/109**. Builds limpios.

**Pendiente para próxima sesión:**
- Crear las 24 tablas restantes (Notifications, JobProfileDrafts, ReviewQueue, Videos, Outreach, Recruit sync, etc.)
- Configurar credenciales reales de integraciones opcionales (Zoho Sign, Bookings, HeyReach, WhatsApp)
- Re-deploy frontend cuando se quieran activar features que dependen de tablas nuevas

### Added (2026-05-03 — tanda 5 items: WhatsApp webhook + frontend tests + doc 23 + mobile)

Décimoprimera tanda. 5 items:

1. **WhatsApp Cloud API webhook entrante** — `features/whatsappWebhook.ts` dual-mode (GET verification + POST event). HMAC `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`. Persiste inbound a `OutreachInbox` con `channel='whatsapp'`. Idempotencia via `ProcessedEvents`. **6 webhooks completos:** clerk, heyreach, zia, zoho-sign, zoho-recruit, whatsapp.

2. **Frontend tests** — 11 tests nuevos:
   - `portalTracker.test.ts` (5): no llama si token vacío, dedupe con keys distintas, fallback fetch keepalive
   - `errorTracker.test.ts` (6): no-op sin DSN, wrappea non-Error, idempotente

3. **Settings bot_config validado** — Tab ya wired (BOT_MODE selector, threshold slider, tecnica_default_min, auto_purge_videos_days). Confirmación funcional.

4. **Doc 23 INTEGRACIONES_ZOHO update** — sección "Status de implementación (al 2026-05-03)" con quick reference por integración + tabla de webhooks completos.

5. **Mobile responsive improvements** — media queries expandidas: filters/phase-tabs/settings stack vertical, kanban con scroll-snap, forms 1-col en mobile, breakpoint <380px para iPhone SE.

**Env vars nuevas:** `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.

**Tests: backend 693/693. Frontend 98 → 109 (+11). Builds limpios.**

### Added (2026-05-03 — tanda 5 items: WhatsApp + Zoho CRM real + metrics + más tests + Reportes UX)

Décima tanda. 5 items:

1. **WhatsApp Business client** — `lib/whatsappClient.ts` con `sendTemplate()` y `sendText()`. Default Meta Cloud API. Pasa por circuit breaker `whatsapp` (threshold 5, cooldown 60s). Normaliza phone a digits-only (E.164 sin '+'). No-op si env vars vacías.

2. **Zoho CRM sync para marketing leads** — `lib/zohoCrmClient.ts` con `createLead()` + `updateLeadStatus()`. Outbox dispatcher `lead.captured` y `lead.eval_completed` ahora hacen sync REAL al CRM (antes era no-op). Si CRM no está configurado, marca ok (lead vive en MarketingLeads igual). Helper `splitName` para nombre completo.

3. **Performance metrics endpoint** — `lib/metrics.ts` con counters + histograms in-memory. `GET /admin/metrics` (auth admin) snapshot con counters por labels + histograms con count/sum/min/max/mean/p50/p95/p99. Reservoir sampling (max 1000 muestras por histogram). Cada request incrementa `http_requests_total` + observe `http_request_duration_ms`.

4. **Tests adicionales** — 18 tests: normalizePhone, splitName, metrics counters/histograms/labelKey con edge cases (orden-independiente, custom values, reset).

5. **Reportes page improvements** — botón refresh + 4 stat cards (Total/Con finalistas/Cacheados/Aperturas) + filtros (todos/with_finalists/cached/opened) + sort (recent/finalists/opens).

**Env vars nuevas:** `WHATSAPP_API_URL/ACCESS_TOKEN/PHONE_NUMBER_ID`, `ZOHO_CRM_API_URL/OAUTH_TOKEN/LEADS_MODULE`.

**Tests: backend 675 → 693 (+18). Frontend 98/98. Builds limpios.**

### Added (2026-05-03 — tanda 5 items: Recruit webhook + tests outbox/webhooks + integrations panel + OnboardingTour)

Novena tanda. 5 items:

1. **Zoho Recruit webhook entrante** — `features/zohoRecruitWebhook.ts` cierra el cycle bidireccional. Acepta `candidate.hired/rejected/status_changed` con HMAC + idempotencia. `mapRecruitStatusToStage` traduce status de Recruit (Hired/Rejected/Offer Made/Withdrew/Interview/Shortlisted) a nuestro state machine. Si la transición no está allowed en nuestro pipeline, loggea + 200 con `reason: transition_not_allowed`. Endpoint: `POST /api/webhooks/zoho-recruit`. Env var: `ZOHO_RECRUIT_WEBHOOK_SECRET`.

2. **Tests outbox dispatchers** — 18 tests en `outboxDispatchClassification.test.ts`: clasificación de 9 event types (6 dispatch + 3 no-op success), invariantes (formato resource.action, no duplicados, total exacto), validación de payloads por dispatcher.

3. **Tests webhooks flow** — 20 tests en `zohoRecruitWebhookLogic.test.ts`: signature válida/inválida, mapRecruitStatusToStage con 8 variantes (case-insensitive + spaces→underscore), eventToTargetStage con las 3 reglas + casos null.

4. **Settings: integration status panel** — endpoint `GET /api/integrations/status` (auth tenant) que devuelve 12 integraciones con flag `configured` + `required` + `desc`. Resumen agregado: required_configured/total, optional_configured/total, health (ok|incomplete). UI Settings → tab "Integraciones" reemplaza mock hardcoded por datos reales. Sin exponer valores de env vars.

5. **OnboardingTour expandido** — agregados 5 steps nuevos: Briefings con IA, Prefilter opcional, Mandar oferta a 1 click, Marketing leads, Estado integraciones. Total ~10 steps que cubren los features del día anterior + hoy.

**Webhooks completos:** clerk, heyreach, zia, zoho-sign, zoho-recruit. 5 webhooks con HMAC + idempotencia.

**Tests: backend 637 → 675 (+38). Frontend 98/98. Builds limpios.**

### Added (2026-05-03 — tanda 5 items: Zoho Sign webhook + PortalTracker + tests int + ENV docs + auto-draft Zia)

Octava tanda. 5 items:

1. **Zoho Sign webhook entrante + OfferForm** — `features/zohoSignWebhook.ts` con HMAC-SHA256 + idempotencia. `POST /api/webhooks/zoho-sign` recibe eventos: `completed` → transición a `hired`, `declined` → `offer_declined`, otros (sent/expired/recalled) son no-op success. Lookup del result_id via AuditLog (cuando exista columna `Results.sign_request_id` reemplazar). Frontend: `OfferForm.tsx` component embedded en CandidateDetail (visible cuando `state === 'finalist'`). Form con asunto/mensaje/template_id o document_url. Llama `api.applications.sendOffer()`.

2. **PortalTracker frontend** — `lib/portalTracker.ts` con `trackPortalEvent()` fire-and-forget usando sendBeacon (sobrevive navigation) o fetch keepalive como fallback. Dedupe en sesión via Set local. Wired a:
   - `ClientPortalLanding` → trackea `portal.opened` una vez por token
   - `ClientPortalJob` → trackea `portal.job_viewed` por (token, jobId)
   No rompe la UI si el endpoint falla.

3. **Tests integraciones** — 13 tests nuevos en `integrationClients.test.ts`:
   - 3 tests para isConfigured() function existence (Bookings/Whisper/Sign)
   - 4 tests para `zohoSignWebhook.verifySignature` (válida, secret distinto, body modificado, vacía)
   - 6 tests para `eventToTargetStage` (completed→hired, declined→offer_declined, expired/sent/recalled/random→null)

4. **ENV_VARS.md actualizado** — agregadas 8 secciones nuevas con tabla completa: Catalyst File Store, Zoho Recruit, Zoho Bookings, Zoho Sign, Zia webhook, Whisper, HeyReach, Sentry, Marketing funnel. Total ~30 env vars documentadas con tipo + default + descripción + flag de sensitive.

5. **Auto-draft cuando llega transcript Zia** — `outbox.dispatchBriefingAutoDraft` ahora maneja el evento `briefing.transcript_received`. Llama Anthropic con el system prompt de drafts replicado (no podemos importar el handler porque requiere ctx HTTP), parsea el JSON, intenta persistir en `JobProfileDrafts`. Si la tabla no existe, loggea draft_title + draft_company y marca como sent (Cris recupera de logs si necesita). Antes era un TODO no-op.

**Webhooks ahora completos:** `/api/webhooks/clerk`, `/api/webhooks/heyreach`, `/api/webhooks/zia`, `/api/webhooks/zoho-sign`. Todos con HMAC verification + idempotencia via ProcessedEvents.

**Tests: backend 624 → 637 (+13). Frontend 98/98. Builds limpios.**

### Added (2026-05-03 — tanda 5 items: tests t6 + Zoho Sign + Zia webhook + BriefingForm + BotReviewQueue UX)

Séptima tanda. 5 items:

1. **Tests para tanda 6** — 29 tests nuevos:
   - `briefingsValidation` (12 tests): email regex, name required, ISO 8601 start_time, duration boundary 15/180, NaN rejection
   - `jobTrackingLogic` (17 tests): 6 event types whitelist, hashPortalToken determinístico SHA-256 truncado a 32, maskIp para IPv4/IPv6 (verificación de privacy: nunca expone últimos 3 octetos), path parsing

2. **Zoho Sign integration** — `lib/zohoSignClient.ts` con `createSignRequest`/`getSignRequest`/`cancelSignRequest`. Circuit breaker `zoho_sign` (threshold 5, cooldown 60s), timeout 20s. Endpoint `POST /api/applications/:id/send-offer` (auth tenant) que valida ownership + stage (debe ser finalist o interview_scheduled), datos del candidato, manda oferta firmable. Idempotencia futura via sign_request_id en Application. Env vars: `ZOHO_SIGN_API_URL`, `ZOHO_SIGN_OAUTH_TOKEN`, `ZOHO_SIGN_WEBHOOK_SECRET`.

3. **Zia webhook entrante** — `features/ziaWebhook.ts` con HMAC-SHA256 + timing-safe + idempotencia via ProcessedEvents (provider='zia_webhook'). `POST /api/webhooks/zia` recibe `{meeting_id, transcript, language?, duration_seconds?}`, valida transcript >=100 chars, enquea evento `briefing.transcript_received` al outbox. Outbox dispatcher maneja el evento (TODO marca como sent hasta JobProfileDrafts table esté lista — Cris puede usar `drafts.generateDraft` manualmente). Env var: `ZIA_WEBHOOK_SECRET`.

4. **BriefingForm component** — formulario embedded en DraftsList (sección colapsable "Agendar nuevo briefing"). Acepta email/name/company/phone/start_time/duration. Llama `api.briefings.schedule()`. Default time: mañana 10:00 AM. UI de éxito muestra booking_id + link al meeting + nota de que el transcript de Zia llega automático.

5. **BotReviewQueue UX wired** — La page ya estaba wired al backend pero usaba `prompt()` browser nativo para override. Reemplazado con:
   - **Modal de override** con dropdown de stages predefinidos (finalist / rejected_by_admin / volver a tecnica/conductual/integridad)
   - **Filtro por priority** (all / high / normal)
   - **Botón refresh** explícito
   - Counter dinámico que muestra "filtrado de N total"

**Audit logs:** sin nuevos types — `application.transition` se reusa para sign request.

**Env vars nuevas:**
- `ZOHO_SIGN_API_URL`, `ZOHO_SIGN_OAUTH_TOKEN`, `ZOHO_SIGN_WEBHOOK_SECRET`
- `ZIA_WEBHOOK_SECRET`

**Tablas Catalyst pendientes:** sin nuevas. Las features integran con tablas ya pendientes (Briefings opcional + ProcessedEvents para idempotencia).

**Tests: backend 595 → 624 (+29). Frontend 98/98. Builds limpios.**

### Added (2026-05-03 — tanda 5 items: Zoho Bookings + Whisper + prefilter answers UI + JobTracking + Marketing leads admin)

Sexta tanda. 5 items:

1. **Zoho Bookings client + endpoint scheduleBriefing** — `lib/zohoBookingsClient.ts` con `createBooking/getBooking/cancelBooking`, fetchWithTimeout 15s + circuit breaker `zoho_bookings`. Endpoint `POST /api/briefings/schedule` (auth tenant) crea reunión con cliente para briefing inicial. Si Zoho Bookings no está configurado (ZOHO_BOOKINGS_API_URL + token + workspace_id + service_id), devuelve 503 con mensaje claro. El flow completo: Cris agenda → Zoho Bookings manda invite → meeting sucede → Zia transcribe → webhook entrante (TODO) → drafts.generateDraft con transcript → Cris confirma → Job real.

2. **Whisper transcription wrapper** — `lib/whisperClient.ts` con `transcribeAudio()` que acepta Buffer + mime_type + language hint. Construye multipart form-data manual (sin polyfills), pasa por circuit breaker `whisper`, timeout 2 min para archivos largos. Default usa OpenAI Whisper API; configurable via `WHISPER_API_URL`. Use cases: transcripción del briefing (fallback de Zia), transcripción de videos del candidato. No-op si `WHISPER_API_KEY` vacío.

3. **Prefilter answers admin UI en CandidateDetail** — endpoint nuevo `GET /api/applications/:id/prefilter-answers` que JOIN-ea PrefilterAnswers + PrefilterQuestions para devolver respuestas con expected_answer y is_disqualifier. Componente `PrefilterAnswersPanel.tsx` muestra cada pregunta + respuesta con badge MATCH/DESCALIFICADO + warning si hay descalificadores fallados. Wired al CandidateDetail debajo del resumen ejecutivo. Se oculta automático si no hay tabla / no hay respuestas.

4. **JobTrackingSnapshots feature (audit del portal cliente)** — `features/jobTracking.ts` con:
   - `POST /portal/<token>/track` (público, registra eventos: `portal.opened`, `portal.job_viewed`, `portal.report_viewed`, `portal.draft_approved/rejected`, `portal.feedback`)
   - `GET /api/jobs/:id/tracking` (admin, lista snapshots filtrados por job + tenant)
   Privacy: token va hasheado SHA-256 (nunca el token raw), IP enmascarada (192.xx.xx.xx para IPv4, primer hextet + xxxx::xxxx para IPv6). Si tabla no existe, POST devuelve 200 silencioso para no romper UI cliente.

5. **Frontend Marketing leads admin view** — endpoint nuevo `GET /api/marketing/leads` con filtros (status, urgency, min_score) + stats agregados (total + counts por status). Page nueva `/marketing/leads` con tabla + filtros + 7 stat cards (Total/Nuevos/Eval pedida/Eval completa/Llamada/Ganados/Perdidos). Score color-coded (≥80 verde, ≥60 amarillo, ≥40 normal). Lazy loaded. Item nav agregado al sidebar.

**Env vars nuevas:**
- `ZOHO_BOOKINGS_API_URL`, `ZOHO_BOOKINGS_OAUTH_TOKEN`, `ZOHO_BOOKINGS_WORKSPACE_ID`, `ZOHO_BOOKINGS_BRIEFING_SERVICE_ID`
- `WHISPER_API_URL` (default OpenAI), `WHISPER_API_KEY`

**Tablas Catalyst pendientes nuevas:** `JobTrackingSnapshots` (con tabla en backup workflow). `Briefings` (opcional — si querés local tracking del flow, sino solo booking_id de Zoho).

**Builds:** backend limpio, frontend limpio (bundle sin cambios — page lazy-loaded). Tests: backend 595/595, frontend 98/98.

### Added (2026-05-02 — tanda 5 items: 4 features tests + prefilter UI + consents + backup + frontend tests)

Quinta tanda del día. 5 items:

1. **Tests notifications + reviewQueue + integrity + videos** — 78 tests nuevos en 4 archivos:
   - `notificationsLogic` (16 tests): 6 tipos whitelist, message truncation 500 chars, path parsing, status filter
   - `reviewQueueLogic` (15 tests): actions whitelist (confirm/override), final stage resolution, audit log mapping (confirm→application.transition, override→bot.review_only)
   - `integrityLogic` (16 tests): classifyIntegrityPct con boundary 30/31 y 55/56, computeOverall que excluye buena_impresion del promedio, invariantes de seguridad
   - `videosLogic` (16 tests): MAX_BYTES=25MB, 6 categories whitelist, tryParseArray helper tolerante, path parsers

2. **PrefilterQuestions admin UI** — `PrefilterQuestionsPanel.tsx` componente reutilizable. Lista, agrega y borra preguntas del prefilter de un job. UI por tipo (yes_no, multi_choice, number, text) + flag is_disqualifier + expected_answer. Wired al JobForm en modo edit (necesita jobId existente). Fallback graceful si tabla `PrefilterQuestions` no existe ("Tabla aún no creada en Catalyst"). API client en `api.prefilter.list/create/patch/remove`.

3. **VideoConsents feature** — Ley Panamá + GDPR compliance para grabación de video:
   - `features/videoConsents.ts` con `GET/POST /test/:token/consent` y `POST /test/:token/consent/withdraw`
   - Append-only para audit (una fila por aceptación, más reciente sin withdrawn_at = activa)
   - Captura IP + User Agent + privacy_notice_version (`2026-05-02` actual)
   - `hasActiveConsent()` helper que `videos.uploadTestVideo` ahora chequea ANTES de aceptar uploads → 403 si no hay consent
   - Graceful: si tabla `VideoConsents` no existe, hasActiveConsent devuelve true (no bloquea producción durante setup); en cuanto la tabla se cree, el bloqueo se activa automático
   - Tabla pendiente memorizada

4. **Backup GitHub Actions workflow** — `.github/workflows/backup-tables.yml`:
   - Schedule: domingos 04:00 UTC (medianoche Panamá), workflow_dispatch manual
   - Exporta 10 tablas Block 1 (críticas) + 19 tablas Block 2/3/5/6 opcionales (skip si no existen)
   - Genera SUMMARY.txt con sizes + log
   - Upload as GitHub artifact con retención 90 días
   - Falla el workflow si alguna tabla crítica falla, warnings para opcionales
   - No requiere infra externa — todo gratis con plan free de GitHub

5. **Frontend page tests** — 14 tests nuevos en `inboxAdapter.test.ts`:
   - `adaptCampaigns`: campos básicos, counters preservados, NO expone tenant_id
   - `adaptMessages`: filtro direction=in, lookup campaign_name, fallback a undefined si campaign_id null o no matchea, preserva flags read/needs_response, NO expone tenant_id ni contact_linkedin
   - Filter logic: all/unread/needs_response combinations

**Wiring upstream:**
- `videos.uploadTestVideo` ahora invoca `hasActiveConsent()` antes de aceptar bytes → 403 con mensaje claro si no aceptó
- `JobForm` en edit mode muestra sección "Prefilter (preguntas iniciales — opcional)" debajo de auto-rejection rules

**Tablas Catalyst pendientes nuevas:** `VideoConsents` (append-only, una fila por aceptación con audit completo). Tabla agregada al script `backup-tables.yml`.

**Total tanda: 92 tests nuevos. Backend 517 → 595 (+15%). Frontend 84 → 98 (+17%). Total tests del día: +304 (de 305 inicial a 595 backend + 98 frontend).**

### Added (2026-05-02 — tanda 8 items: tests deep + Sentry + prefilter + marketing skeleton)

Cuarta tanda del día. 8 items:

1. **Tests `drafts.ts`** — 16 tests: validación de transcript bounds (100-50k chars), schema completo de JobProfileDraft (DISC ranges, VELNA all-fields, cognitive_level whitelist, tecnica_minimo_pct ranges, competencias array). Highlight types whitelist estable.

2. **Tests `scores.ts`** — 25 tests de los parsers internos: parseDiscPayload (raw_d/d aliases, default total_questions=24), parseCognitivePayload (5 sub-tests VELNA), parseEmotionalPayload (boundary 34/35 espontaneo→mesura y 69/70 mesura→reflexivo), parseTechnicalPayload (clamp total_correct, total_questions=0 → null), num helper (NaN/Infinity/non-number → fallback).

3. **Tests `tenants.ts`** — 23 tests: slugify (acentos, emojis, multi-separator collapse, truncate 100), 12 event types Clerk handled, defaults free tier (5 jobs, 50 cand/mes, features off), status transitions con deleted como terminal manual.

4. **Tests `gdpr.ts`** — 19 tests: email regex (mismo patrón que publicRecovery, force sync), purge eligible stages = TERMINAL_STAGES exactamente (assertion estructural), retention period 30d (boundary tests), composición `eligibleForPurge` con 5 escenarios (terminal+old+file_id, activo, reciente, ya purgado, todavía activo).

5. **Sentry integration backend + frontend** — sin SDK pesado (`@sentry/node` y `@sentry/react` no), via fetch directo al envelope endpoint. Backend: `lib/errorTracker.ts` con `reportError()` + DSN parser + stack frame parser. Wired al catch del router con tags traceId/tenant/user. Fire-and-forget. Frontend: `lib/errorTracker.ts` con sendBeacon fallback a fetch keepalive, `initErrorTracker()` engancha window.onerror + unhandledrejection, ErrorBoundary llama reportError. Env vars `SENTRY_DSN` / `VITE_SENTRY_DSN` opcionales (vacío = no-op).

6. **HelpCenter.tsx con contenido real** — 4 secciones nuevas: "Crear y configurar un puesto" (4 FAQs sobre flow de creación, Briefing IA, boss profile, auto-rejection rules), "Pool interno y matching" (3 FAQs), "Outreach LinkedIn" (3 FAQs sobre HeyReach + inbox unificado), "API y integraciones" (3 FAQs API keys + MCP server + Settings/Equipo). Total 32 FAQs en 10 secciones.

7. **PrefilterQuestions feature** — cuestionario inicial OPCIONAL antes del test. Endpoints admin: list/create/patch/delete por job. Endpoints públicos: GET (sanitiza expected_answer + is_disqualifier al candidato), POST (escribe respuestas + auto-transition a `prefilter_passed` o `auto_rejected_low_score` según `is_disqualifier` + match con `expected_answer`). Tablas pendientes: PrefilterQuestions + PrefilterAnswers (Block 3 deferred).

8. **Marketing feature backend skeleton** — `features/marketing.ts` con 3 endpoints públicos:
   - `POST /api/marketing/lead` (captura del quiz + calculadora con UPSERT por email, validación de enums estricta, honeypot, score_quality auto-calculado, outbox event `lead.captured`)
   - `POST /api/marketing/eval-request` (placeholder por ahora — devuelve 503 hasta que tenant interno + Job demo estén configurados)
   - `GET /api/marketing/lead-status` (privacy-safe, no enumera emails)
   `verifySiteKey()` valida `X-Marketing-Site-Key` header. `computeLeadScore()` heurística 0-100 (urgencia + historial_error + proceso_actual + salary). Outbox dispatcher acepta `lead.captured` y `lead.eval_completed` como no-op success hasta integración Zoho CRM.

**Tests adicionales:** 11 tests para `computeLeadScore` (clamp 100, ordering por urgencia/historial/proceso/salario, enums whitelist).

**Env vars nuevas:**
- `SENTRY_DSN` + `SENTRY_ENV` (backend, opcional)
- `VITE_SENTRY_DSN` + `VITE_SENTRY_ENV` (frontend, opcional)
- `MARKETING_SITE_KEY` (opcional, lo necesitás cuando arranque la landing)
- `TURNSTILE_SECRET_KEY` (opcional, para captcha de eval-request)

**Tablas Catalyst pendientes nuevas:** `PrefilterQuestions`, `PrefilterAnswers`, `MarketingLeads`. Todas memorizadas.

**Total tanda: 96 tests nuevos. Backend 421 → 517 tests (+23%). Frontend 84/84. Builds limpios. Total tests del día: +212 (de 305 inicial a 517).**

### Added (2026-05-02 — tanda 8 items: tests core + HeyReach + observability + perf)

Tercera tanda del día. 8 items completados:

1. **Tests `applications.ts`** — 29 tests estructurales: extractIdFromPath (7 sub-tests con todos los sub-paths del API), reglas de pool auto-populate, notification trigger en finalist, outbox event whitelist, invariantes del state machine (terminal stages, transitions desde activos a rejected/withdrew, happy path completo, gating técnico para auto_rejected_low_score).

2. **Tests `bot.ts`** — 25 tests del decisor: modos cold/warm/hot (cold nunca aplica auto, warm requiere autoApplyFlag + threshold + transition válida, hot solo requiere transition válida), validación de stage recomendado (rechaza saltos inválidos como prefilter→finalist), whitelist de stages que el bot puede recomendar (no incluye hired/offered/withdrew), priority de review queue (high si confidence < 0.5).

3. **HeyReach client + webhook entrante** — `lib/heyreachClient.ts` con `sendDM()` y `getCampaignStats()`, integrado con `fetchWithTimeout` + circuit breaker (threshold 5, cooldown 60s). Si env vars no están seteadas, devuelve error claro sin tirar excepción. Webhook entrante en `features/heyreachWebhook.ts` con verificación HMAC timing-safe + idempotencia via ProcessedEvents. Maneja 5 event types: message.received (persiste a OutreachInbox), invitation.sent/accepted/meeting.booked (incrementa contadores en OutreachCampaigns), message.sent (audit). `outbox.dispatchOutreachSendDM` cablea `outreach.send_dm` a HeyReach. `outreach.reply()` enquea `outreach.send_dm` cuando channel=linkedin_dm + contact_linkedin presente.

4. **`/admin/health-check`** — endpoint detallado con auth interna que retorna: state de los 4 circuit breakers (anthropic, zoho_recruit, heyreach, whisper), outbox pending/failed/sent_24h counts + recent_failures (últimos 5 con error truncado), DB latency probe, rate_limiter stats, env_summary (qué integraciones están configuradas). Status auto-derivado: `ok` | `degraded` (>100 pending o failed > 0 o breaker open) | `critical` (DB unreachable). 503 si critical.

5. **Frontend lazy loading per-route** — Convertí 13 admin pages + 11 public pages a `lazy()`. Bundle main: **656KB → 362KB** unzipped (-45%). Gzip: **192KB → 112KB** (-42%). Las heavy deps (jspdf 390KB, xlsx 429KB, html2canvas 201KB, recharts/Dashboard 382KB) ahora se cargan solo en su page específica. JobsList queda eager (primera página post-login).

6. **Tests `outreach.ts` + `applicationAdapter.ts`** — Backend: 14 tests (provider/status whitelist, path parsers, HeyReach event types, verificación HMAC con tampering + signature de longitud incorrecta + caracteres no-hex). Frontend: 16 tests del adapter (scores null → DISC/VELNA/etc undefined, mapeo de tec_passed → estado Aprobado/No aprobado, integrity dimensions con nivel != bajo se incluyen en observations, emo_perfil mapping a labels Spanish).

7. **EmailPreviews.tsx wired** — nuevo endpoint `GET /api/email-templates?locale=es|en` (auth tenant) que devuelve los templates reales del backend renderizados con sample vars + variables detectadas. La page muestra ahora una sección expandible con los 6 templates reales del backend (candidate_tecnica_invite, candidate_next_stage, candidate_rejection, client_report_ready, client_portal_access, recovery_link) en es/en. Mantiene los templates de diseño como referencia.

8. **Smoke test post-deploy** — Mejorado `deploy.yml`: retry exponencial (5 intentos x 3-15s) en /health, valida campo `status` en response, chequea `/api/openapi.json` reachable (verifica que rutas están registradas), si `INTERNAL_API_KEY` secret está presente llama a `/admin/health-check` y falla si retorna `critical` o warning si `degraded`. Antes era un single-shot con warning silencioso.

**Audit logs:** sin cambios.

**Env vars nuevas:** `HEYREACH_WEBHOOK_SECRET` (vacío = webhook deshabilitado, devuelve 503).

**Tablas Catalyst:** sin cambios — todo lo nuevo usa tablas que ya estaban listadas como pendientes.

**Total tanda: 84 tests nuevos (29 applications + 25 bot + 14 outreach + 16 adapter). Backend 305 → 421 tests (+116 vs inicio del día). Frontend 68 → 84 tests. Builds limpios. Bundle frontend reducido 45%.**

### Added (2026-05-02 — tanda 7 items: outbound + integraciones reales)

Segunda tanda en el día. 7 items completados (item 8 absorbido en final build):

1. **Outreach feature backend + frontend wired** — Nuevo `features/outreach.ts` con endpoints campañas + inbox unificado:
   - `GET /api/outreach/campaigns?status=&job_id=`, `POST /api/outreach/campaigns`
   - `GET /api/outreach/inbox?filter=needs_response|unread|all`
   - `PATCH /api/outreach/inbox/:id`, `POST /api/outreach/inbox/:id/reply`
   Tablas pendientes: `OutreachCampaigns` + `OutreachInbox`. Fallback graceful: GET → []; POST → 503 con mensaje claro.
   `InboxOutbound.tsx` ahora hace fetch real con fallback a mock cuando tabla no existe / backend cae.

2. **CandidateDetail.tsx wired al backend** — Fetch real de application + candidate + scores + integrity. Adapter compartido `lib/applicationAdapter.ts` (extraído del Comparativo) reusable en cualquier page que necesite la shape mock. Banner amarillo si fallback a mock.

3. **JobDetail.tsx wired al backend** — Carga `applications` reales del job + scores en paralelo + adapta. Mantiene la UI Kanban del v1 sin tocar.

4. **Tests +47** — `outboxDispatch.test.ts` (14 tests: clasificación de event types + retry policy), `clerkWebhookEvents.test.ts` (10 tests: tipos soportados + idempotencia), `publicRecoveryValidation.test.ts` (12 tests: email regex, terminal stages, path parsing, enumeration safety), `publicApplyValidation.test.ts` (11 tests: validación body apply). Backend de 305 → 353 tests.

5. **GitHub Actions cron workflows** — `cron-outbox.yml` (cada 5 min) y `cron-purge-videos.yml` (diario 3:30 UTC) que llaman los endpoints de admin con secrets. Skipean automáticamente si secrets no están configurados. Alternativa al setup manual en Catalyst Console (ver `docs/RUNBOOKS/cron-setup.md`).

6. **Anthropic translation flow** — `lib/reportNarratives.ts` ahora exporta `translateNarrativeBundle(bundle, targetLang, traceId)` que traduce narrativas es↔en preservando estructura JSON via prompt cacheable. `outbox.ts` cablea `report.translate_en` y `report.translate_es` a este dispatcher. Antes era `NOT_IMPLEMENTED`.

7. **Zoho Recruit sync producer real** — `outbox.ts.dispatchRecruitSync()` reemplaza el `NOT_IMPLEMENTED` con cliente HTTP real (`fetchWithTimeout` extraído a `lib/fetchWithTimeout.ts` para reuso) + circuit breaker (threshold 5, cooldown 60s). Si `ZOHO_RECRUIT_API_URL` o `ZOHO_RECRUIT_OAUTH_TOKEN` no están seteadas, devuelve error claro y el evento se reintenta hasta MAX_RETRIES. Env vars agregadas a `EnvShape`: `ZOHO_RECRUIT_API_URL`, `ZOHO_RECRUIT_OAUTH_TOKEN`, `HEYREACH_API_URL`, `HEYREACH_API_KEY` (todas opcionales, default vacío = integración off).

**Audit logs nuevos:** `outreach.campaign_create`, `outreach.reply`.

**Tablas Catalyst pendientes (acumuladas en memoria):**
- `OutreachCampaigns`, `OutreachInbox`, `OutreachContacts` (opcional), `OutreachTemplates` (opcional)
- Las anteriores: `Notifications`, `AntiCheatEvents`, `JobProfileDrafts`, `ClientReports + ReportCandidates`, `ApiKeys`, `BotDecisions/ReviewQueue/BotTrainingExamples`, `VideoQuestions/VideoResponses`, `CandidatePool`, `Config`.

**Total tanda: 47 tests nuevos. Backend 353/353 pasando, frontend 68/68 pasando. Build limpio backend + frontend.**

### Added (2026-05-01 — tanda 8 items: hardening + integraciones)

Sesión de cierre de gaps del master plan. 8 items end-to-end:

1. **AntiCheatEvents persistidos** — `publicTest.ts` ahora inserta cada evento (paste_blocked, devtools_opened, tab_blur, focus_lost, etc.) a tabla `AntiCheatEvents` con fallback graceful (logs) si la tabla no existe. Endpoint admin `GET /admin/anti-cheat?result_id=...&phase=...` con agregados `counts_by_type` para review post-mortem.

2. **Webhook Clerk completo** — `tenants.ts` maneja ahora `user.created/updated/deleted`, `organizationMembership.created/updated/deleted`, `organizationInvitation.created/accepted/revoked`. Cada evento crea audit log entry. Esto cierra el gap de sync user-tenant cuando el admin del tenant invita o quita gente desde Clerk.

3. **Notifications backend** — Nueva tabla `Notifications` (Block 2 deferred). Helper `enqueueNotification()` integrado con `bot.ts` (tipo `bot_review` cuando un candidato cae a manual review) y `applications.ts` (tipo `finalist_ready` cuando llega a stage finalist). Endpoints: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/mark-all-read`. Fallback silencioso a lista vacía si tabla no existe todavía.

4. **Email consumer del outbox** — `outbox.ts.dispatch()` ahora rutea `email.send_pending` a `dispatchEmail()`, que renderiza desde `emailTemplates.ts` (es/en) y manda via Catalyst Email Service SDK. Eventos `application.transitioned` quedan como no-op success (placeholder para integración Recruit). Esto cierra el loop: cuando bot.ts o applications.ts hacen enqueue, el cron del outbox efectivamente los manda.

5. **Recovery flow candidato** — `POST /apply/<tenantSlug>/<jobIdentifier>/resend` permite al candidato pedir un nuevo link si perdió el original. Email-enumeration-safe: responde 200 con mensaje genérico aunque el email/job no existan. Genera token nuevo `kind=test` con TTL 7 días, enquea email vía outbox con template `recovery_link` (es/en). Skipea candidatos en stage terminal (hired, rejected, withdrew, etc.). Template `RECOVERY_LINK` agregado en `emailTemplates.ts`.

6. **Comparativo.tsx wired al backend** — La page de comparación side-by-side de finalistas ahora hace `api.applications.list({jobId, limit:100})` + `api.candidates.list({limit:500})` + per-app `api.applications.readScores`. Adapter `adaptToMockApplication()` convierte ApiApplication+scores al shape del mock para que la UI rica de v1 funcione sin reescribir. Fallback a mock si `useApi=false`.

7. **Tests nuevos (25)** — 12 sobre `validateDoubleAxisQuestion` + `buildDoubleAxisPrompt` (technical/situational, axis matching, distribución count par/impar). 10 sobre funnel computation del client portal (videos_pending cuenta como tecnica_done, awaiting_client_review como finalist, etc.). 3 misc reviewQueue + adapter videos.

8. **i18n EN reportes (Anthropic narrativas)** — Nuevo field `IdealProfile.report_lang: 'es' | 'en'` con default 'es'. `reportNarratives.ts` con sistema prompts EN/ES separados (`SYSTEM_CANDIDATE_EN/ES`, `SYSTEM_CONCLUSION_EN/ES`) — Anthropic genera narrativas en el idioma elegido. Cache key incluye `lang` para no contaminar entre idiomas. Frontend: `JobForm.tsx` con dropdown "Idioma del reporte cliente" (es/en); `mockJobs.ts` Job type extendido. Cliente USA-based ahora puede recibir reportes en inglés sin tocar el backend.

**Tablas Catalyst pendientes (acumuladas para sesión de creación batch):**
- `AntiCheatEvents` (cols: result_id, phase, event_type, question_id, duration_ms, created_at)
- `Notifications` (cols: tenant_id, type, message, status [unread/read], resource_type, resource_id, link, created_at, read_at)

**Total tanda: 25 tests nuevos. Backend 305/305 pasando, frontend 68/68 pasando. Build limpio en backend + frontend.**

### Added (2026-05-01 — portal del cliente externo conectado al backend)

**Backend — portal del cliente:**
- `lib/clientPortalTokens.ts` — sign/verify de tokens `kind=portal` con claims (company, client_name, client_email, agency_name) embebidos. Token autocontenido, sin tabla.
- `features/clientPortal.ts` — `GET /portal/<token>` devuelve listado de jobs + funnel stats; `GET /portal/<token>/jobs/<jobId>` devuelve un job con milestones, funnel y report_token cuando hay finalistas.
- `features/admin.ts` — `POST /admin/portals/issue` para generar links firmados (Cris invita clientes).
- 4 tests para clientPortalTokens (roundtrip, secret distinto, cross-kind, missing claims).

**Funnel logic:**
- Stage detection: `closed` (job inactivo) | `finalists_ready` (≥1 finalist) | `funnel_active` (hay applied) | `search_started` (sin candidatos).
- ETA: heurística por stage del candidato más avanzado.
- Milestones derivados de `Jobs.CREATEDTIME` + primera `Result.CREATEDTIME`.

**Frontend — wired al backend con fallback a mock:**
- `lib/publicApi.ts` — `getClientPortal(token)` y `getClientPortalJob(token, jobId)`.
- `pages/public/ClientPortalLanding.tsx` — fetch async, fallback a mock si `useApi=false` o backend devuelve 5xx (errores transitorios no rompen UI).
- `pages/public/ClientPortalJob.tsx` — mismo patrón. Mantiene UI completa de tracking, funnel, draft approval, finalists CTA.

**Limitaciones conocidas:**
- `profile_pending` stage requiere tabla `JobProfileDrafts` (deferred Block 2). Mientras tanto, los jobs nacen en `search_started`.
- `PublicReport` (reporte multi-candidato con narrativas IA) sigue en mock — necesita tablas `ClientReports + ReportCandidates` (deferred Block 2) + generación IA de narrativas.
- Revocar un portal puntual hoy implica rotar `URL_SIGNING_SECRET` (afecta todos los tokens).

**Backend — schema + narrativas IA del reporte:**

- `Jobs.ideal_profile` — nueva columna Text/JSON con `{disc, disc_b?, velna, competencias, tecnica_minimo_pct, context_summary}`. Validación full en backend (rangos 0-100, max 30 competencias, etc.). Migración suave: `omitIdealIfNull` no envía la clave si es null, así que jobs viejos no rompen aunque la columna no exista todavía en Catalyst.
- `MIGRATIONS_BLOCK1.md` actualizado con la nueva columna y ejemplo de payload.
- `verifyTables` espera la columna nueva (flag amarillo hasta que se cree manualmente en Catalyst).
- `lib/reportNarratives.ts` — generación IA paralela:
  - Por candidato: `paragraph_intro` (80-150 palabras), `fortalezas` (3-5), `a_tomar_en_cuenta` (2-4), 4 estilos (decisiones/equipo/presión/comunicación), `perfil_emocional_text`. ~1.5K tokens out por candidato.
  - Conclusión global: `si_priorizas_autonomia`, `si_priorizas_crecimiento`, `menor_riesgo`, `mayor_potencial`, `recomendacion_final`. ~1.5K tokens out.
  - Cache in-memory keyed por sha256(jobId + sorted result_ids + ideal_profile_hash), TTL 1h, eviction LRU al pasar 100 entradas. Cuando exista `ClientReports`, se reemplaza por persistencia.
  - Fallback graceful: si Anthropic falla o no hay API key, devuelve narrativas vacías con `status: 'failed'` o `'partial'` — el endpoint sigue respondiendo 200 con scores reales y la UI puede degradar.
  - Prompt caching de Anthropic (cache_control ephemeral en system prompts) reduce costo ~80% en repeticiones.
- `publicReportBundle` ahora llama narrativas en cada GET (con cache). Devuelve `narratives: { candidates, conclusion, status }` + `job.ideal_profile` parsed.
- Tests: 17 nuevos (validación de ideal_profile + parseIdealProfile roundtrip + cache key determinismo + describeCandidate prompt building).

**Total: 32 tests nuevos en esta tanda. Backend 101 tests pasando, frontend 50.**

**Frontend wired al reporte real:**
- `lib/publicApi.ts` agregado `getReportBundle()` con tipos completos (`BundleReport`, `BundleCandidate`, `BundleCandidateNarrative`, etc.).
- `lib/reportAdapter.ts` — convierte el response del bundle al shape de mock que espera la UI (Job, Application, Report). Permite que la UI rica del v1 funcione sin reescribir, leyendo de scores reales + narrativas IA reales.
- `pages/public/PublicReport.tsx` ahora hace fetch a `/report/bundle/<token>` con fallback a mock si `useApi=false` o el backend cae. Banner amarillo si `narratives.status` es 'partial' o 'failed' (Cris + el cliente saben que la IA no enriquecó todo).
- `pages/JobForm.tsx` ahora envía `ideal_profile` (DISC, VELNA, competencias, contexto) al backend en create/update. El form ya capturaba estos campos en local; ahora se persisten.
- `lib/api.ts` agregado tipo `ApiIdealProfile` + campo opcional en `ApiJobInput`.

**Lo que falta:**
- **Crear la columna `ideal_profile` en Catalyst Console** (Text 8000) antes de hacer PATCH con perfil ideal real. Sin la columna, el endpoint no falla pero pierde el dato.
- **Tabla `ClientReports`** (Block 2) — hoy el cache es in-memory por instancia (TTL 1h, eviction a 100 entries). Cuando se cree, persistencia real + tracking quién abrió.
- **Tests E2E del flujo completo** — manual hasta que tengamos un setup de testing con Catalyst real.

### Added (2026-05-02 — JobForm auto-rejection UI + cron declarations + video upload real)

**JobForm UI auto-rejection rules:**
- Sección nueva con 4 sliders activables: DISC similitud, VELNA mínimo, integridad máxima, emocional mínimo.
- Cada regla empieza inactiva (undefined). Click "Activar" → slider con default 50%. Click "Desactivar" → vuelve a undefined.
- `buildIdealProfilePayload` ahora envía `auto_rejection_rules` al backend.
- Backend ya validaba el shape; ahora la UI lo expone sin necesidad de curl manual.

**Cron declarations:**
- `scripts/cron-purge-videos.sh` y `scripts/cron-process-outbox.sh` — scripts ejecutables.
- `docs/RUNBOOKS/cron-setup.md` — runbook con 3 paths de setup (Catalyst Cron Service, Linux cron, GitHub Actions) + verificación + troubleshooting.

**Video upload real al Catalyst File Store:**
- `lib/db.ts.filestore(req)` helper. Env nueva `CATALYST_VIDEO_FOLDER_ID`.
- `features/videos.ts.uploadTestVideo` — `POST /test/<token>/videos/<qid>/upload` recibe blob raw (max 25MB), sube al File Store, devuelve `catalyst_file_id`.
- `lib/publicApi.ts.uploadTestVideoBlob` — cliente bypass del JSON wrapper para mandar blob raw.
- `CandidateVideoTest.tsx` ahora al avanzar pregunta: upload blob → submit con file_id. Si upload falla, el flow del candidato sigue (submit registra el attempt sin file_id, transcript_status='pending').

### Added (2026-05-02 — Reportes wired + Drafts wired + Bot config + Outbox admin + PII hardening + ADR-004 + 2 runbooks)

**Reportes.tsx wired:**
- `features/reports.ts` — `GET /api/reports` deriva del estado actual: por cada Job del tenant cuenta finalists + total apps. Si tabla `ClientReports` existe, agrega `opened_count`, `last_opened_at`. Sin tabla, devuelve cache_status='missing'.
- `pages/Reportes.tsx` ahora carga lista del backend (con fallback al mock) — muestra puestos con finalistas + indicador de cache + métricas.

**DraftsList.tsx wired:**
- `lib/api.ts` agregado `api.drafts.{list, get, save, patch, convert}` con tipo `JobDraft`.
- `pages/DraftsList.tsx` consume `api.drafts.list()` con fallback gracioso al mock. Banner "tabla no creada" cuando JobProfileDrafts deferred. Adapter convierte schema backend a shape mock para reusar UI.

**Tenant config runtime (Bot threshold + más):**
- `features/tenantConfig.ts` — `GET /api/tenant/config` lee tabla `Config` (Block 2 §9) con override por tenant_id sobre values globales. Si la tabla no existe, devuelve defaults de env vars.
- `PATCH /api/tenant/config` con validators por key: `bot_threshold` (0-1), `bot_mode` (cold|warm|hot), `tecnica_default_min` (0-100), `auto_purge_videos_days` (1-365). Auditado.
- Settings.tsx tab nuevo "🤖 Bot decisor" con sliders + radio buttons para los 4 keys. Persistencia real cuando la tabla exista, banner "tabla no creada" mientras tanto.

**Outbox admin:**
- `features/outbox.ts.listOutbox` — `GET /admin/outbox?status=pending&limit=50` lista eventos del outbox con counts_by_status agregado. Para visibilidad: ver qué quedó pending, fallido, etc.

**PII redaction más agresiva en logger:**
- `lib/logger.ts` — agregadas keys sensibles: `dni`, `passport`, `address`, `birth_date`, `first_name`, `last_name`, `full_name`, `cv`, `resume`, `transcript`, `cookie`.
- Names: redact parcial (primer letra + `***`).
- CV/resume/transcript/address: redact completo con length (`<redacted N chars>`).
- Inline regex en TODOS los string values: detecta y redacta emails, JWT, Bearer headers, API keys (st_live_) embebidos en mensajes (no solo en keys conocidos).
- 17 tests nuevos en `test/loggerRedaction.test.ts` cubriendo cada caso.

**Documentación:**
- `docs/ADR/004-tokens-firmados-vs-jwt.md` — por qué tokens HMAC propios en lugar de JWT estándar.
- `docs/RUNBOOKS/incidente-cross-tenant-leak.md` — runbook crítico para sospecha de leak (detección, contención, notificación 72h GDPR-style, prevención post-incidente).
- `docs/RUNBOOKS/ratelimit-hit.md` — diagnóstico + acciones cuando rate limit golpea legítimo.
- `CLAUDE.md` actualizado con sección "estado actual" para que agentes IA en sesiones nuevas tengan contexto sin re-leer todo.

**Backend total: 280 tests (+16). Frontend: 68 tests.**

### Added (2026-05-02 — Multi-tenant isolation tests + Apply público end-to-end)

**Multi-tenant isolation tests (37 tests):**
- `test/multiTenantIsolation.test.ts` — verificaciones structurales contra cross-tenant leak:
  - Cada feature tenant-scoped llama `requireTenant()` o `fetchOwnership()`.
  - Cada SELECT contra tablas tenant-data (`Jobs`, `Candidates`, `JobProfileDrafts`, `CandidatePool`, `ApiKeys`, `AuditLog`) tiene `tenant_id` en el WHERE — o usa `ROWID =` (que después valida ownership).
  - Handlers que toman ID en path validan ownership con helpers (`getByIdScoped`, `fetchOwnership`, `fetchPoolEntry`, `fetchDraft`, `fetchReviewQueueItem`).
  - Helpers internos como `listByTenant`, `listByJob` requieren `tenantId: string` (no opcional).
  - Endpoints públicos verifican token (`verifyToken`) ANTES de cualquier read a tablas data.
  - `verifyToken` requiere `expectedKind` (no opcional) — previene token confusion attacks.
  - `apiKeyAuth` chequea `is_active`/`revoked`/`expires` antes de aceptar y solo setea `ctx.tenantId` si la key es válida.

**Apply público end-to-end:**
- `features/publicApply.ts` — 2 endpoints nuevos:
  - `GET /apply/:tenantSlug/:jobIdentifier` — info pública del puesto (sin scores, sin perfil ideal). Acepta ROWID o slug.
  - `POST /apply/:tenantSlug/:jobIdentifier` — crea Candidate (upsert por email) + Application en `prefilter_pending`. Idempotente — si ya existe Application del mismo email al mismo job, devuelve 200 con la existente.
- Validaciones: tenant activo, job activo, email válido, consent obligatorio.
- `lib/publicApi.ts` — `getPublicJobInfo()` y `submitPublicApplication()` con retry.
- `pages/public/CandidateApply.tsx` ahora carga info pública del job desde backend con fallback a mock. Submit real vía POST. Mensaje de error inline si falla; loader durante submit.

**Backend total: 264 tests (+37). Frontend: 68 tests.**

### Added (2026-05-02 — Cierre de gaps del audit: video frontend wired, pool autopopulate, outbox producer, auto-rejection multidim, bot RAG, GDPR retention, ADRs, runbooks)

**Frontend wire — `CandidateVideoTest`:**
- `pages/public/CandidateVideoTest.tsx` ahora carga preguntas reales del backend via `publicApi.getTestVideos(token)`. Si backend devuelve 0 preguntas, muestra mensaje "Las preguntas todavía no fueron generadas — pedile a tu reclutadora que las dispare".
- En cada `nextQuestion`, llama `publicApi.submitTestVideo()` con el transcript (si modality=text) y duración. La grabación física (audio/video blob) sigue siendo local — el upload a Catalyst File Store se agrega cuando esa integración exista.
- Fallback transparente al mock si `useApi=false` o si la API falla — el candidato puede completar igual.
- `lib/publicApi.ts` agregado `getTestVideos` y `submitTestVideo`.

**Pool auto-populate (Doc 22 capa 2):**
- `lib/poolAutoPopulate.ts` — `upsertPoolFromApplication(req, applicationId)`. Lee Result + Job + Scores, hace upsert al `CandidatePool` con snapshot de DISC + VELNA + cognitive_level + tags derivados.
- Hookeado en `publicTest.transitResult` cuando stage llega a `integridad_completed`, `videos_completed` o `finalist`.
- Hookeado en `applications.transitionApplication` cuando admin transiciona manualmente a esos mismos stages.
- Si la tabla `CandidatePool` no existe, no-op silencioso. Cuando se cree, el pool se llena solo a medida que candidatos completan pruebas.

**Outbox producer + Auto-rejection multidim (Doc 18):**
- `applications.transitionApplication` ahora enqueue `OutboxEvents` con `event_type='application.transitioned'` en cada cambio de stage. El consumer `sync.recruit` ya existe; ahora finalmente recibe eventos.
- `Jobs.ideal_profile.auto_rejection_rules` — sub-objeto opcional con umbrales: `disc_min_similarity`, `velna_min_indice`, `integridad_max_riesgo`, `emo_min_score`. Validado en `validateIdealProfile`.
- `lib/autoRejection.ts` — `evaluateAutoRejection(scores, ideal)` corre las 4 reglas, devuelve `{reject, reasons[]}`. DISC similarity se calcula con `calculateDiscSimilarity` (existente).
- `publicTest.submitTest` evalúa al final del submit; si reject, transiciona a `auto_rejected_low_score` y devuelve `auto_rejected: { reasons }` en el response.
- 10 tests nuevos en `test/autoRejection.test.ts`.

**Bot RAG (Doc 21 capa 2):**
- `lib/botRAG.ts` — `findSimilarCases(req, currentCase, limit)` busca en `BotTrainingExamples` casos pasados similares al actual. Score: from_stage match (+30), cognitive_level match (+30), DISC similarity (+30), technical pct ±15 (+20), quality='high' (+20). Filtra `quality='noise'`. Threshold mínimo de similitud: 30.
- `buildFewShotBlock(cases)` formatea texto para inyectar al prompt.
- `features/bot.ts` ahora consulta similar cases ANTES de llamar Anthropic. Si hay matches, los inyecta en el user message como "=== CASOS SIMILARES PASADOS (referencia) ===". El bot calibra confidence con histórico de Cris.
- Sin tabla, retorna [] silencioso (modo cold/warm sin RAG funciona igual).

**GDPR retention 30d videos (Doc 20):**
- `features/gdpr.ts` — `purgeOldVideos` endpoint admin. Busca VideoResponses con `catalyst_file_id != null` cuyo Result tenga `completed_at < 30d ago` Y stage en hired/rejected/withdrew/declined.
- Marca `catalyst_file_id=null` (placeholder hasta que exista integración Catalyst File Store que haga DELETE físico). Transcript + analysis quedan en BD para auditoría.
- `POST /admin/gdpr/purge-old-videos` (auth admin). Pensado para llamarse desde cron diario externo o a demanda.

**ADRs (Doc 11 checklist) — 3 docs nuevos:**
- `docs/ADR/001-estructura-plana-features-vs-carpetas.md` — por qué `features/` + `lib/` en lugar de 8 carpetas.
- `docs/ADR/002-block1-vs-block2-tablas-deferidas.md` — patrón de tolerancia con table-not-ready 503.
- `docs/ADR/003-tokens-portal-autocontenidos.md` — por qué portal tokens son autocontenidos vs tabla `ClientPortals`.

**Runbooks — 3 docs nuevos:**
- `docs/RUNBOOKS/anthropic-caido.md` — diagnóstico + mitigación (circuit breaker, key inválida, rate limit, timeout).
- `docs/RUNBOOKS/migracion-tabla-nueva.md` — paso a paso para crear una tabla deferred en Catalyst Console.
- `docs/RUNBOOKS/rotar-secret.md` — cómo rotar `INTERNAL_API_KEY`, `URL_SIGNING_SECRET`, `CLERK_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CATALYST_TOKEN` con sus implicaciones.

**Backend total: 227 tests (+10). Frontend: 68 tests.**

### Added (2026-05-02 — Multi-tenant frontend (guard + invitations))

**RequireOrganization guard:**
- `components/RequireOrganization.tsx` — wrap component que verifica si el user de Clerk tiene una organización activa. Si no:
  - Si el user pertenece a 1+ orgs: muestra `<OrganizationSwitcher>` para que elija una.
  - Si no tiene ninguna: muestra `<CreateOrganization>` de Clerk para crear la primera.
  - Texto explicativo: "La organización mapea a tu tenant_id en el backend. Cada org tiene data aislada."
- Integrado en `layouts/AdminLayout.tsx` envolviendo `<Outlet />` — ningún page admin se renderiza sin org activa, evitando 403s en cascada en el backend.
- Estado de loading mientras Clerk hidrata.

**Equipo tab con OrganizationProfile:**
- `pages/Settings.tsx` `EquipoTab` reemplazado: ahora embebe `<OrganizationProfile>` de Clerk con appearance custom (transparente para integrarse con el tema dark). Eso da:
  - Lista de miembros + roles
  - Invitar miembros por email (Clerk maneja el flujo: invitation → email → accept)
  - Cambiar roles (admin/member)
  - Remover miembros
- Eliminado el placeholder mock de "Cris Aguilera + Admin + 2026-04-10".
- Conserva los items de "Tour de bienvenida" + "Checklist de setup" (utilities locales).

**Tablas Memberships/Invitations no necesarias en Block 1** — Clerk las maneja nativamente. Backend solo necesita el webhook (ya existe en `tenants.ts`) que sincroniza Clerk orgs → tabla `Tenants`.

### Added (2026-05-02 — UI Pool + UI Videos en CandidateDetail/JobDetail)

**Pool UI:**
- `components/PoolMatchPanel.tsx` — panel expand/colapse en JobDetail con botón "Buscar matches en el pool". Llama `api.pool.match()` con tags del job + flags. Muestra cada candidato del pool con score 0-100, reasoning textual, y breakdown del score (DISC similitud, cognitive, área, idiomas, recency, penalty contactos). Banners diferenciados para `useApi=false` (demo) y `table_not_ready`.
- Integrado en `pages/JobDetail.tsx` — visible arriba del kanban del pipeline.

**Videos UI en CandidateDetail:**
- `components/CandidateVideosPanel.tsx` — panel expand/colapse en CandidateDetail con:
  - Lista las 7 preguntas IA generadas con categoría (🔧 Técnica, ⚠️ Debilidad, 🎬 Situacional, 📄 Validar CV, 🛡 Integridad, 🇺🇸 Inglés) + max_duration.
  - Muestra rationale interno de cada pregunta (oculto por default, expandible — "💭 Rationale interno (Cris solo)").
  - Si hay respuesta del candidato: muestra estado del transcript (pending/ok/failed) y el texto si existe (collapsible).
  - Botón "🤖 Analizar con IA" cuando hay transcript pero no hay análisis. Llama `api.videos.analyze()`.
  - Si hay análisis IA: score, signals_matched%, riesgo integridad/nivel inglés según categoría, observaciones IA, flags (🚩 evasiva, incoherente, etc.).
  - Botón "🪄 Generar preguntas" si no hay (con confirm de costo en tokens) o "🔄 Regenerar" si ya hay.
  - Banners para `useApi=false` y `table_not_ready` (VideoQuestions/VideoResponses).
- `lib/api.ts` agregado `api.videos.{generate, list, analyze}` + tipos `VideoQuestionAdmin`, `VideoResponse`, `VideoAnalysis`.
- Integrado en `pages/CandidateDetail.tsx` arriba del Timeline.

### Added (2026-05-02 — Frontend wires + pool API client)

**Dashboard counts en vivo:**
- `pages/Dashboard.tsx` ahora carga `api.jobs.list()` + `api.applications.list({ limit: 500 })` cuando `useApi=true` y deriva los counts de `activeJobs`, `totalApps`, `inProgress`, `finalists` de los datos reales.
- `inProgress` actualizado al state machine ampliado (`hired`, `rejected_by_admin`, `auto_rejected_low_score`, `offer_declined`, `withdrew` cuentan como terminales).
- `finalists` ahora incluye los 5 stages avanzados (`finalist`, `awaiting_client_review`, `interview_scheduled`, `offered`, `hired`).
- Badge "Counts en vivo del backend" cuando hay datos reales.
- Fallback a mock cuando `useApi=false` (o backend cae) — el dashboard sigue mostrando algo coherente.

**`api.pool.*` cliente nuevo:**
- `lib/api.ts` agregado `api.pool.{list, add, patch, remove, match}` + tipos `PoolEntry` y `PoolMatchResult`.
- UI del pool (sourcing screen) pendiente — el cliente API ya está listo para que cualquier componente lo consuma.

**JobsList + CandidatesList:** ya estaban wired al backend desde tandas anteriores. Verificado: `useApiData(api.jobs.list())` y `useApiData(api.applications.list())` con fallback a mock + indicador "Datos en vivo del backend".

### Added (2026-05-02 — Pool interno de candidatos (doc 22 capa 1))

**Algoritmo de matching candidato↔puesto:**
- `lib/candidatePoolMatcher.ts` — funciones puras (sin BD). Pesos: DISC (30), cognitive level (20), área tags (25), idiomas (10), recency last_active (15), penalty por overcontact (hasta −10).
- `calculateMatch()` devuelve `{match_score 0-100, breakdown, reasoning, available}`. Reasoning textual humano-legible.
- `calculateMatchWithJobLevel()` extiende con cognitive_level del job (que la versión base no conoce).
- 28 tests nuevos (cada función de score por separado + integración).

**Persistencia + endpoints (Block 2 deferred):**
- Tabla `CandidatePool` documentada en `MIGRATIONS_BLOCK2.md §15` con snapshot fields (disc_d/i/s/c, velna_indice, cognitive_level) para evitar JOIN en cada match.
- `features/candidatePool.ts` — 5 endpoints:
  - `GET /api/pool` (filtros: tag, available_only, limit)
  - `POST /api/pool` (manual add con candidate_id existente, valida ownership)
  - `PATCH /api/pool/:id` (actualiza tags / disponibilidad / notes)
  - `DELETE /api/pool/:id` (soft-remove: disponible_para_outreach=false)
  - `POST /api/pool/match` body `{ job_id, area_tags, requires_english, limit }` → top N matches ordenados, excluyendo candidatos que ya aplicaron al job
- Si la tabla no existe, todos los endpoints devuelven 503 con mensaje claro.

**Auto-populate del pool desde Applications:** documentado pero NO implementado todavía. Hoy el `POST /api/pool` es manual.

**Backend total: 217 tests (+29). Frontend: 68 tests.**

### Added (2026-05-02 — MCP Server (doc 16))

**Paquete `mcp/` nuevo en el root del repo:**
- Package npm `@sharktalents/mcp` (no publicado todavía) con binario `sharktalents-mcp`.
- Stdio transport para que Claude Desktop lo lance como subproceso.
- Auth: env var `SHARKTALENTS_API_KEY` (key generada en Settings → API keys del tenant).
- Base URL configurable via `SHARKTALENTS_API_BASE` (default Development de Catalyst).

**12 tools expuestos:**
- Jobs: `jobs_list`, `jobs_get`, `jobs_create`, `jobs_archive`
- Candidates: `candidates_list`, `candidates_get`
- Applications: `applications_list`, `applications_get`, `applications_get_with_scores` (combina endpoint + scores en una llamada), `applications_transition`
- Bot review queue: `bot_review_queue_list`, `bot_review_queue_decide`

**Cumplen permisos:** los tools respetan los permisos asignados a la API key (jobs:read/write, candidates:read/write, etc.). Si la key tiene scope limitado, los tools de write fallan con 403.

**Tests:** 10 nuevos en `mcp/test/tools.test.ts` con stub del client — verifican uniqueness de names, descripciones no vacías, dispatch a métodos correctos, manejo de tool desconocida.

**README** con instrucciones step-by-step para Claude Desktop (`claude_desktop_config.json`) + troubleshooting.

**Limitaciones:**
- Las URLs son `/api/v1/...` — depende del versionado API que ya implementamos.
- `bot_review_queue_*` requiere las tablas Block 2 creadas; si no, devuelve 503 con mensaje claro.
- Tool de `videos_*` no incluida en esta tanda — se agrega después si Cris la quiere desde Claude Desktop.

**MCP totals: 1 paquete nuevo, 10 tests propios, 12 tools.**

### Added (2026-05-02 — Videos dinámicos backend (doc 20))

**Generador IA de preguntas de video personalizadas:**
- `lib/videoQuestionsGenerator.ts` — `generateVideoQuestions()` toma scores + perfil del puesto + (opcional) CV claims y devuelve 7-8 preguntas custom con categorías: `technical`, `weakness_followup`, `situational`, `cv_claim_check`, `integrity_check`, `english_check`. Validación post-generación rechaza shapes malformados.
- `analyzeWeaknesses()` — helper que detecta debilidades en scores (técnica < 70, VELNA < 60, DISC polos extremos < 25). Solo flag si el campo existe en scores (no asume 0 si está ausente).

**Análisis IA por respuesta:**
- `lib/videoAnalysis.ts` — `analyzeVideoAnswer()` toma `{category, question, transcript, expected_signals}` y devuelve `{overall_pct, signals_matched_pct, observations[], flags[]}` + campos por categoría (`claim_corroborated`, `integrity_concern_pct`, `english_level_pct`).
- Whisper/Zia NO se hace en este lib — el transcript llega como input. Cuando integres transcripción, el flujo es: `pending` → worker llena `transcript` → Cris dispara analyze.

**Persistencia (Block 2 deferred):**
- `lib/videoPersistence.ts` — `persistVideoQuestions()`, `recordVideoResponse()`, `updateResponseTranscript()`, `updateResponseAnalysis()`, `listVideoQuestionsForApplication()`. Si las tablas no existen, no-op silencioso.
- Tablas documentadas: `VideoQuestions` (§12) y `VideoResponses` (§13). Estados `transcript_status` y `analysis_status` con `pending|ok|failed`.

**Endpoints nuevos (5):**
- `POST /api/applications/:id/videos/generate` (tenant) — Cris dispara IA. Persiste preguntas + devuelve preview con rationale_internal.
- `GET /api/applications/:id/videos` (tenant) — lista preguntas + responses para Cris.
- `POST /api/applications/:id/videos/:responseId/analyze` (tenant) — dispara análisis IA de un transcript existente.
- `GET /test/:token/videos` (público) — candidato lista preguntas. NO incluye `rationale_internal` (eso es solo para Cris).
- `POST /test/:token/videos/:questionId/submit` (público) — candidato submitea respuesta (transcript opcional, catalyst_file_id opcional). Máximo 2 attempts por pregunta.

**Feature gating:** todos los endpoints de tenant requieren feature flag `video_questions` habilitado en `Tenants.features_enabled`.

**Tests:** 19 nuevos en `test/videoQuestions.test.ts` — buildUserPrompt con scores + integrity flags, validateQuestion (rechaza categoría inválida, clamp duration), validateAnalysis (clamp 0-100, preserva campos opcionales), analyzeWeaknesses (no flag DISC si campo ausente).

**Backend total: 188 tests (+19). Frontend: 68 tests.**

### Added (2026-05-02 — Pipeline state machine ampliado + ReviewQueue UI + feature flags + situational hint)

**Pipeline state machine — 4 estados nuevos (doc 18):**
- `awaiting_client_review` (post-finalist, antes de que el cliente decida entrevistarlo)
- `interview_scheduled` (cliente agendó entrevista)
- `offer_declined` (terminal — candidato rechazó la oferta)
- `withdrew` (terminal — candidato se retiró del proceso, válido desde casi cualquier estado activo)
- `lib/pipelineStateMachine.ts` — exports nuevos `ACTIVE_STAGES` y `TERMINAL_STAGES`. Transiciones de `finalist` ahora incluyen `awaiting_client_review`; `offered` puede ir a `offer_declined`; cualquier estado activo puede ir a `withdrew`.
- `clientPortal.ts` y `publicReportBundle.ts` actualizados para considerar los nuevos estados como finalists/in-progress.
- `applications.ts.completed_at` ahora se setea también en `offer_declined` y `withdrew`.

**Frontend ReviewQueue page wired al backend:**
- `pages/BotReviewQueue.tsx` reemplazó la lectura de mock con `api.bot.listReviewQueue()` + `api.bot.decide()`.
- UI muestra confidence, rationale del bot, prioridad (high si confidence < 0.5).
- Botones "Confirmar" y "Override" piden razón (queda como BotTrainingExample).
- Banner "tabla no creada" cuando faltan tablas Block 2.
- Banner "demo · sin backend" cuando `useApi=false`.
- `lib/api.ts` agregado `api.bot.{listReviewQueue, decide}` + tipo `ReviewQueueItem`.

**UI candidato — hint para preguntas situacionales:**
- `pages/public/CandidateTecnicaTest.tsx` muestra banner violeta cuando la pregunta es `kind=situational`: "No hay una respuesta única correcta — marcá lo que realmente harías. Lo que evaluamos es tu estilo de trabajo." Esto evita que el candidato adivine al estilo "qué espera el evaluador" en preguntas de doble eje.

**Feature flags por tenant:**
- `lib/featureFlags.ts` — `parseFeatureFlags()`, `hasFeature()`, `getFeatureFlags(ctx)` (memoizado en ctx para evitar duplicados en una request), `requireFeature(ctx, flag)` que tira 403 si no habilitado.
- Flags definidos: `api` (default true), `mcp`, `custom_branding`, `video_questions`, `bot_warm`, `bot_hot`.
- Aplicado en `apiKeys.createApiKey` — sin flag `api`, no se pueden crear keys.
- 11 tests (parsing edge cases, hasFeature, isValidFlag, ALL_FLAGS coverage).

**Backend total: 169 tests (+11). Frontend: 68 tests.**

### Added (2026-05-02 — Bot decisor warm/hot + ReviewQueue + BotTrainingExamples)

**Bot decisor — modos warm/hot con persistencia:**
- `lib/botPersistence.ts` — `persistBotDecision()`, `enqueueForReview()`, `recordTrainingExample()`, `markBotDecisionOverridden()`. Cache in-process del check de tabla; si las tablas no existen (deferred Block 2), no-op silencioso (cold mode sigue funcionando).
- `features/bot.ts` refactor:
  - Modo `cold` (default): solo recomienda, no aplica.
  - Modo `warm`: aplica auto si confidence ≥ threshold (BOT_CONFIDENCE_THRESHOLD_DEFAULT=0.75) Y `auto_apply=true` en body.
  - Modo `hot` (nuevo): aplica auto si pasa threshold, sin requerir `auto_apply`.
  - Si NO se aplica auto en warm/hot, agrega a `ReviewQueue` con priority `high` si confidence < 0.5, sino `normal`.
  - Persiste cada decisión a `BotDecisions` (audit + base para % de overrides).
- `features/reviewQueue.ts` — endpoints nuevos:
  - `GET /api/bot/review-queue?limit=50` lista pendientes del tenant con join a `BotDecisions` (rationale, confidence, stage propuesto).
  - `POST /api/bot/review-queue/:id/decide` con body `{ action: 'confirm'|'override', override_stage?, rationale }` — valida transición state machine, aplica al pipeline (insert PipelineTransition + update Result), marca queue item resuelto, si fue override marca BotDecisions.overridden=true, registra `BotTrainingExample` con candidate scores + rationale humano.

**Tablas nuevas (deferred Block 2, documentadas en `MIGRATIONS_BLOCK2.md §10/§11/§12`):**
- `BotDecisions` — log de cada decisión IA (confidence guardado como Int 0-100).
- `ReviewQueue` — cola humana, con priority y resolution.
- `BotTrainingExamples` — dataset de decisiones humanas para RAG/few-shot futuro. Campo `quality` (`standard`/`high`/`noise`).

**Migración suave en todo:** sin tablas, el bot sigue recomendando como antes; agregar las tablas en cualquier momento activa la persistencia + cola.

### Added (2026-05-02 — Prueba técnica doble eje + boss profile + match candidato↔jefe)

**Scoring doble eje (doc 19):**
- `lib/scoring.ts` — agregados tipos `TechnicalQuestionDoubleAxis`, `StyleAxis`, `StyleValue` y funciones:
  - `scoreTechnicalDoubleAxis()` — separa preguntas técnicas (1 correcta) de situacionales (2 válidas + 2 inválidas, las 2 válidas con estilos distintos en eje `autonomy_vs_consult`). Devuelve 3 outputs: técnico %, situational validity %, style 0..1.
  - `matchStyleWithBoss(candidateStyle, bossStyle)` — distancia inversa 0..100, con interpretación textual (match natural / parcial / riesgo de fricción / parálisis).
  - `validateSituationalQuestion()` — valida shape (4 opciones, exactly 2 válidas, las 2 válidas con axis idéntico pero values distintos).
- `lib/techQuestions.ts` — nueva función `generateDoubleAxisQuestions()` con system prompt actualizado que pide a Claude generar mix `~50% technical / ~50% situational`. Validación post-generación rechaza preguntas malformadas.

**Boss profile en perfil del puesto:**
- `Jobs.ideal_profile.boss` — sub-objeto con `name`, `role`, `style_autonomy_consult` (0-1), `evidence_quote` opcional. Validación full backend.
- `pages/JobForm.tsx` — sección nueva "Estilo del jefe directo" con nombre/cargo/slider 0-100/textarea de cita. Etiqueta dinámica del slider ("controlador" → "neutral" → "da autonomía"). Sin esto, match candidato↔jefe queda neutral (no penaliza).

**Submit + scoring server-side:**
- `publicTest.submitTest` — acepta dos shapes: legacy (`total_correct` precomputado) y nuevo (`answers: { qid: idx }`). Si llega `answers`, backend lee `Jobs.tech_questions_cache`, recomputa con `scoreTechnicalDoubleAxis`, calcula match con `Jobs.ideal_profile.boss.style_autonomy_consult`, persiste 3 columnas adicionales en Scores.
- `Scores` schema — 3 columnas nuevas: `tec_situational_validity_pct`, `tec_style_autonomy_consult` (0-100 entero, no Decimal), `tec_style_match_with_boss_pct`. Documentadas en `MIGRATIONS_BLOCK1.md §12` y agregadas a `verifyTables`.
- `GET /test/:token/tech-questions` — expone `kind` (technical|situational) para que el frontend muestre instrucciones distintas, pero NUNCA `correct`, `option_validity` ni `option_style` (eso lo delataría).

**Tests:** 25 nuevos en `test/scoringDoubleAxis.test.ts`:
- scoreTechnicalDoubleAxis con mix técnicas + situacionales, edge cases (sin situacionales, todas inválidas, todas autonomy)
- matchStyleWithBoss con polos opuestos, match perfecto, riesgo fricción/parálisis, null handling, clamp out-of-range
- validateSituationalQuestion rechaza ambos válidos con mismo style, validity con 3 trues, style asignado en inválida, axis distinto

**Backend total: 158 tests (+25). Frontend: 68 tests.**

### Added (2026-05-02 — API pública + ApiKeys + versionado + OpenAPI)

**API keys del tenant:**
- `lib/apiKeysService.ts` — generación de keys formato `st_live_<32 chars>`, hashing sha256, comparación timing-safe, validación de permisos. Permisos: `jobs:read|write`, `candidates:read|write`, `applications:read|write`, `reports:read`, `*` (full access).
- `lib/apiKeyAuth.ts` — middleware `requireApiKey` que valida `Authorization: Bearer st_live_...` contra la tabla `ApiKeys`. Si la tabla no existe (deferred Block 2), 503 con mensaje claro.
- `features/apiKeys.ts` — CRUD endpoints (auth Clerk del admin):
  - `POST /api/api-keys` — crea, devuelve plain key UNA vez con warning
  - `GET /api/api-keys` — lista (sin hashes)
  - `PATCH /api/api-keys/:id` — actualiza nombre/permisos/rate_limit
  - `DELETE /api/api-keys/:id` — soft revoke (`revoked_at`, `is_active=false`)
- 23 tests nuevos para apiKeysService (generación única, hash determinismo, isActive con expiry/revoked, permisos parsing y validación, hasPermission con wildcard).

**API versioning:**
- Rutas existentes ahora aceptan `/api/v1/<path>` Y `/api/<path>` (alias backwards-compat).
- Header `X-API-Version: v1` en todas las respuestas.
- `normalizeApiVersion()` rewrites `ctx.req.url` para que handlers no necesiten cambios.

**OpenAPI spec + docs:**
- `features/openApiSpec.ts` — `GET /api/openapi.json` devuelve spec OpenAPI 3.1 con security `Bearer apiKey`, schemas Job/Candidate/Application/Error, paths principales documentados.
- `GET /docs` sirve HTML con Scalar API Reference (CDN) — UI interactiva para probar endpoints.

**Frontend — API keys tab real:**
- `pages/Settings.tsx` `ApiKeysTab` reemplaza el mock con UI real: crear con nombre + multiselect de permisos, ver el plain key UNA vez con botón Copiar, listar con prefix/permisos/última-vez/estado, revocar con confirmación.
- Banner "tabla no creada" cuando ApiKeys deferred Block 2 falta.
- Banner "modo demo" cuando `useApi=false`.
- `lib/api.ts` — agregado `api.apiKeys.{list,create,patch,revoke}` + tipo `ApiKey` + constante `ALL_API_PERMISSIONS`.

**Backend total: 156 tests (+23). Frontend: 68 tests.**

### Added (2026-05-02 — preguntas técnicas IA + drafts persistidos + cache de reportes)

**Tech questions IA por puesto:**
- `lib/techQuestions.ts` — generador IA que toma `Jobs.tech_prompt` + título + nivel cognitivo y devuelve 8-20 preguntas opción múltiple con 4 opciones, índice correcto y rationale. Validación full (rechaza opciones != 4, correct fuera de rango, text vacío).
- Nueva columna `Jobs.tech_questions_cache` (Text 20000) con JSON array de preguntas. Persistencia inline para evitar tabla extra.
- Endpoint `POST /api/jobs/:id/tech-questions/generate` (tenant) — Cris dispara generación, persiste cache.
- Endpoint público `GET /test/:token/tech-questions` — el candidato pide preguntas (sin respuestas correctas).
- 7 tests de validación + prompt building.
- `verifyTables` actualizado, `MIGRATIONS_BLOCK1.md` con la columna.

**JobProfileDrafts (persistencia + endpoints):**
- `features/jobDrafts.ts` — handlers nuevos (no toca `features/drafts.ts` que sigue generando IA stateless):
  - `POST /api/drafts/jobs/save` — persiste el draft generado por IA con transcript + status + version
  - `GET /api/drafts/jobs?status=...` — lista del tenant
  - `GET /api/drafts/jobs/:id` — uno
  - `PATCH /api/drafts/jobs/:id` — update status/payload (refinamientos manuales)
  - `POST /api/drafts/jobs/:id/convert` — crea Job real con ideal_profile derivado del draft, marca draft como `converted_to_job` y le linkea job_id
- Si la tabla `JobProfileDrafts` no existe (deferred Block 2), endpoints devuelven 503 con mensaje claro de qué crear.
- Tabla en `MIGRATIONS_BLOCK2.md §4` (sin cambios — schema ya estaba documentado).

**ClientReports cache persistido:**
- `lib/clientReportsCache.ts` — read-through cache con la tabla `ClientReports`. Si la tabla no existe, no-op silencioso (el cache in-memory sigue siendo el primary).
- `cache_key` = sha256(jobId + sorted result_ids + ideal_profile) — agregar un finalist invalida automáticamente.
- TTL 7 días por entrada (en cache de in-memory es 1h).
- `opened_count` y `last_opened_at` se incrementan en cada read (best-effort, fire-and-forget).
- `invalidateForJob()` para revocación manual cuando se sepa que el reporte está stale.
- `publicReportBundle.ts` ahora hace lookup en `ClientReports` ANTES de generar narrativas; cache hit = 0 ms y 0 tokens; cache miss = genera + persiste.
- Schema actualizada en `MIGRATIONS_BLOCK2.md §2` (reescrita con columnas reales: cache_key, bundle_payload, opened_count, etc.).

**Total backend: 110 tests (+9). Frontend: 68 tests.**

**Hardening adicional:**
- 18 tests nuevos en `test/reportAdapter.test.ts` (mapeo de job, candidates, narratives, edge cases sin scores/ideal_profile, classify thresholds de afinidad).
- Banner "📺 Demo · datos ficticios" en `PublicReport.tsx` cuando no hay backend (para que sea claro que está mostrando mock).
- `scripts/check-ideal-profile-column.sh` — verifica si la columna existe en Catalyst, da instrucciones step-by-step para crearla manualmente si falta.

**Backend — reporte multi-candidato (data layer real, sin narrativas IA todavía):**
- `urlSigning.ts` — agregado `kind: 'report_bundle'` (Job-referenced, distinto de `kind: 'report'` que es Result-referenced).
- `features/publicReportBundle.ts` — `GET /report/bundle/<token>` agrega Job + todos los Results en stages finalist/offered/hired + sus Candidates + Scores + IntegrityDimensions. 4 queries paralelas con IN clauses (no N+1).
- `computeSummaryScore()` — score 0-100 promediando velna_indice + tec_score_pct + integridad invertida + emo_score, ignorando dimensiones faltantes. Devuelve `null` si no hay nada medible.
- Ordenamiento descendente por summary_score (mejor candidato primero) + `summary.best_application_id` para que la UI marque al ganador.
- `clientPortal.ts` — `report_token` emitido por el portal ahora apunta al Job con kind=report_bundle (antes era kind=report al primer finalist).
- 7 tests nuevos (computeSummaryScore con varios inputs + token kind validation).
- **Pendiente:** narrativas IA por candidato (campo `narratives: null`), comparación contra perfil ideal del puesto (Jobs no tiene disc_ideal/velna_ideal todavía), persistencia (sin tabla ClientReports re-agrega cada GET).
- Frontend `PublicReport.tsx` no consume el bundle aún — sigue en mock; el wiring requiere o adaptar la UI rica al shape sin narrativas, o esperar las narrativas IA.

**UI nueva — Cris emite portales sin curl:**
- `POST /api/portals/issue` (tenant-scoped, Clerk JWT) — usa `ctx.tenantId` automáticamente.
- `POST /admin/portals/issue` (X-Internal-Key) — versión admin para scripts.
- `Settings → Portales cliente` tab — formulario (empresa, contacto, email, vigencia) que genera link firmado, lo muestra con botón Copiar y warning sobre revocación.
- AuditLog persiste cada emisión (`portal.issued`).
- Cuando un puesto tiene finalists, el portal embebe un `report_token` kind=report apuntando al primer finalist (single-candidate report). Mientras no exista report bundle multi-candidato, esto es lo más cercano que tenemos a "ver el reporte" desde el portal.

### Added (2026-05-01 — sesión QA + tests reales + integración end-to-end)

**Backend — fixes QA (24 issues):**
- 4 BLOCKERS: ProcessedEvents schema mismatch, webhook fire-and-forget, candidates cross-tenant leak, outbox stubs marcando sent
- 5 IMPORTANTES: bot/publicTest bypass state machine, rate limiter ordering, verifyToken authorizedParties, idempotency_key, CLAUDE.md path
- 5 Tier 1 follow-up: race en Scores upsert, publicTest transition con bloques separados, Bot/Drafts log raw IA response, Bot 502 vs 400, verifyToken kind required
- 5 Tier 2: listByJob tenant scoping, bot transition order, circuit breaker reset, rate limiter cleanup, Anthropic lastErr null
- 5 Tier 3: timingSafeEqual INTERNAL_API_KEY, admin stats sin sentinels, urlSigning JSON parse log, extractIdFromPath estricto, CORS skip webhook

**Backend — features nuevos:**
- `lib/pipelineStateMachine.ts` — state machine compartido (extraído)
- `lib/internalAuth.ts` — requireInternalKey con timingSafeEqual
- `lib/auditLog.ts` — fire-and-forget logging para acciones admin
- `features/admin.ts` — anthropicPing endpoint (sanity check IA)
- `features/publicTest.ts` — soporta `body.integridad` + `body.anti_cheat`
- `features/jobs.ts` + `candidates.ts` + `applications.ts` — auditLog wired

**Backend — preguntas reales del v1:**
- 475 preguntas migradas de v1 (DISC 40, VELNA 100/100/125, Emotional 20, Integrity 90)
- Scoring ported con thresholds calibrados v1 (diferenciados por dimensión integridad)
- 13 dimensiones integridad (eliminadas etica_profesional + personalidad por ser "mezcla")

**Frontend — preguntas reales + UX:**
- `lib/scoring.ts` — scoreDisc/scoreCognitive/scoreEmotional/scoreIntegrity con fórmulas v1
- `lib/shuffle.ts` — Fisher-Yates con seed reproducible (anti-bias de posición)
- `lib/publicApi.ts` — cliente para `/test/<token>/submit` con retry exponencial
- `lib/logger.ts` — logger con redacción PII (espejo del backend)
- `data/questionLoader.ts` — lazy load de cognitive (-433KB del bundle inicial)
- `data/realQuestionsAdapter.ts` — adapta preguntas v1 al formato UI mock
- `hooks/useApiData.ts` — hook genérico para fetch con loading/error
- `pages/public/Candidate{Disc,Velna,Tecnica,Integridad}Test.tsx` — usan preguntas reales + shuffle + submit al backend
- `pages/JobForm.tsx` — submit a api real con USE_API toggle

**Tests:**
- Backend: 65/65 tests (scoring, circuitBreaker, rateLimiter, urlSigning, logger, emailTemplates, processedEvents, pipelineStateMachine)
- Frontend: 50/50 tests (scoring, useApiData, logger, shuffle, realQuestionsAdapter, publicApi)

**Refactor URLs:**
- `.env.development` y `.env.production` apiBase = función root (sin `/api` suffix)
- `api.ts` paths con `/api/` prefix explícito
- `publicApi.ts` paths sin `/api/` (endpoints públicos)

**Deploy:**
- Backend deployado 2 veces a Catalyst Development
- 10 tablas verificadas via `/admin/verify-tables`
- 9 env vars seteadas en Catalyst Console

### Added (2026-04-30 — sesión long-running de auto mode)

**Frontend:**
- Drag & drop kanban en JobDetail (state machine validado, persiste en localStorage)
- Undo/redo en JobForm (`⌘Z` / `⌘⇧Z`, history 60 entradas, coalescing al typing)
- Setup checklist en Dashboard (5 pasos guía tenant nuevo, dismissible)
- Modo demo mejorado con 4 presets (Showcase 60, Chico 15, Mediano 40, Grande 100)
- Cliente API tipado [shark/src/lib/api.ts](shark/src/lib/api.ts) con `useApi()` hook (auth Clerk automática)
- Hook genérico [shark/src/hooks/useApiData.ts](shark/src/hooks/useApiData.ts) (`useApiData`, `useApiMutation`)
- Toggle `VITE_USE_API` para alternar entre mock y backend real
- JobsList y CandidatesList wired al API con fallback a mock
- Vitest setup + 13 tests para `lib/scoring`

**Backend — features:**
- `features/jobs.ts` — CRUD con tenant scoping
- `features/candidates.ts` — CRUD upsert por email
- `features/applications.ts` — CRUD Results + state machine + transitions append-only
- `features/scores.ts` — write/read DiscScores, CognitiveScores, EmotionalScores, TechnicalScores
- `features/integrity.ts` — IntegrityScores + 15 dimensiones
- `features/admin.ts` — `/admin/verify-tables`
- `features/drafts.ts` — IA arma Job Profile desde transcript (con prompt caching)
- `features/bot.ts` — bot decisor con confidence + rationale (modos cold/warm)
- `features/publicTest.ts` — endpoints candidate-facing (signed URL token)
- `features/publicReport.ts` — reporte público para cliente externo

**Backend — lib:**
- `lib/anthropic.ts` — cliente Claude con timeout, retries exponenciales, circuit breaker
- `lib/circuitBreaker.ts` — closed/open/half_open per servicio externo
- `lib/rateLimiter.ts` — token bucket per-IP (anon) y per-tenant (auth)
- `lib/cors.ts` — origin allowlist
- `lib/urlSigning.ts` — HMAC-SHA256 firma + verifica tokens
- `lib/scoring.ts` — porteo del scoring frontend para uso server-side
- `lib/emailTemplates.ts` — 5 templates es/en
- Logger con redacción automática de PII y secrets
- Rate limit aplicado globalmente (excepto `/health`)
- 51 tests Vitest

**Tooling:**
- GitHub Actions CI (type check + build + tests para backend y frontend)
- Script `scripts/verify-tables.sh`

**Docs:**
- [MIGRATIONS_BLOCK1.md](docs/master-plan/MIGRATIONS_BLOCK1.md) + [MIGRATIONS_BLOCK1.csv](docs/master-plan/MIGRATIONS_BLOCK1.csv)
- [CAMBIOS_MIGRATION.md](docs/master-plan/CAMBIOS_MIGRATION.md)
- [DEPLOYMENT.md](docs/master-plan/DEPLOYMENT.md)
- [ENV_VARS.md](docs/master-plan/ENV_VARS.md)
- [API_CLIENT_GUIDE.md](docs/master-plan/API_CLIENT_GUIDE.md)

**27 endpoints HTTP totales** disponibles cuando tablas + deploy estén listos.

### Added (sesiones previas)
- Master plan completo en `docs/master-plan/` (24 docs).
- Skeleton del backend `functions/api/` con TypeScript estricto, logger con prefijos, env loader, error classes y `/health` endpoint.
- Frontend migrado a Vite 5 + React 18 + TypeScript 5.6 (en `shark/`).
- `.env.example` raíz + `shark/.env.{example,development,production}`.
- Scripts base en `scripts/`: `generate-secret.sh`, `deploy-backend.sh`, `deploy-frontend.sh`, `rotate-secret.sh`.
- `CLAUDE.md` con convenciones para agentes IA.
- Skeleton `docs/ADR/`, `docs/INTEGRATIONS/`, `docs/RUNBOOKS/` con templates.
- **Fase 2 (parte 1) — multi-tenancy + Clerk:**
  - Backend `RequestContext` pattern con `traceId`, user/tenant scoping.
  - `lib/{context,http,db,slugify}.ts` helpers; `db/{helpers,tenants,processedEvents}.ts`.
  - `middleware/auth.ts` (verifyToken Clerk JWT) + `middleware/tenant.ts` (lookup `Tenants` por `clerk_org_id`).
  - `handlers/clerkWebhooks.ts` con verificación HMAC vía Svix + idempotencia vía `ProcessedEvents`.
  - Router refactoreado a pattern de `ctx`; `traceId` propagado en headers + logs.
  - Frontend integrado con `@clerk/clerk-react@5`: `<ClerkProvider>`, `<SignedIn/Out>`, `<UserButton>`, `<OrganizationSwitcher>`.
  - Docs `docs/INTEGRATIONS/clerk.md` + `docs/RUNBOOKS/clerk-caido.md`.
- **Frontend admin shell con mock data (Path A — desarrollo en paralelo a creación de tablas Catalyst):**
  - HashRouter + react-router-dom 7 con rutas `/`, `/jobs`, `/jobs/:id`, `/candidates`, `/reports`, `/inbox`, `/settings`.
  - `AdminLayout` con sidebar nav + branded header con `<OrganizationSwitcher>` + `<UserButton>`.
  - Mock data layer en `shark/src/data/mock{Jobs,Applications}.ts` con tipos derivados del master plan (states del pipeline operativo, sources, scores).
  - Páginas: Dashboard (stats + cards), JobsList (tabla), JobDetail (kanban + tabla por estado), CandidatesList (cross-job).
  - Stubs para Reportes, Inbox outbound, Settings con referencias a docs del master plan.
  - CSS limpio post-CRA, design system básico (status tags, kanban, data tables, stat cards).
- **Refactor backend a estructura plana feature-first** (rectifica error en master plan inicial):
  - Backend pasa de 8 carpetas (handlers/services/integrations/db/middleware/lib/data/seeds) a 2 carpetas (`features/` + `lib/`).
  - Cada feature en 1 archivo: handler HTTP + lógica + queries DB inline. Ej: `features/tenants.ts` consolida lo que antes era `handlers/clerkWebhooks.ts` + `db/tenants.ts` + `middleware/tenant.ts` + `db/processedEvents.ts`.
  - `lib/` queda solo con infrastructure compartida (env, logger, errors, http, db, dbHelpers, auth, processedEvents, slugify, context).
  - Master plan doc 02 actualizado con la decisión + tabla "antes vs después".
  - Master plan doc 03 actualizado: 54 tablas → 25 core + 29 deferred (crear cuando la feature lo necesita). Colapsos: 7 score tables → 2, 4 outreach → 2, 3 bot → 1, 2 notif → 1.
  - Razón del cambio: contexto real es 1 humano + agentes IA (no team de ingenieros). La estructura plana optimiza para "AI puede leer/modificar feature en 1 archivo + Cris puede spot-check sin perderse entre carpetas".

### Changed
- `catalyst.json` ahora apunta a `shark/dist` (Vite build output).
- `.gitignore` actualizado para coexistencia de `functions/api/` (nuevo) y `functions/sharktalents/` (legacy).

### Deprecated
- `frontend/` — código del prototipo single-tenant. Reemplazado por `shark/`.
- `functions/sharktalents/` — backend del prototipo. Reemplazado por `functions/api/`.

### Removed
- (sin remociones aún)

### Fixed
- (sin fixes aún)

### Security
- (sin items de seguridad aún)
