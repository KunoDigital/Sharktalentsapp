# Roadmap visual SharkTalents v2

**Última actualización:** 2026-05-11 (tarde)
**Leyenda:** 🟢 Listo · 🟡 En proceso · 🔴 No iniciado

---

## Resumen ejecutivo

| Hito | 🟢 Listo | 🟡 En proceso | 🔴 No iniciado | Total |
|---|---|---|---|---|
| **Tablas** | 34 | 0 | 5 | 39 |
| **UX** | 30 | 1 | 0 | 31 |
| **Cliente** | 20 | 0 | 1 | 21 |
| **Pruebas** | 12 | 0 | 0 | 12 |
| **Integraciones** | 12 | 2 | 2 | 16 |
| **TOTAL** | **108** | **3** | **8** | **119** |

> **Nota sobre las 5 tablas pendientes:** 4 son del módulo Outreach (post-MVP, para HeyReach LinkedIn outbound) + 1 es ZohoMeetings (nice-to-have). Otras 7 tablas que figuraban como "pendientes" en versiones anteriores del mapa son **obsoletas o redundantes** en el diseño actual (RecruitSync×3 reemplazadas por outbox events, JobBossProfiles ya es columna en Jobs, ReportCandidates ya está en ClientReports, IntegrationSecrets/Health/TechLibrary no aplican al diseño single-agencia). Auditado 2026-05-11.

**Avance global:** ~91% listo · ~3% en proceso · ~7% sin iniciar (de lo que realmente necesitamos).

**Cambios desde 2026-05-11 (mañana):**
- 🆕 Zoho Sign — wiring completo (send-contract + webhook auto-Tenant). Solo falta template_id de Sign Console.
- 🆕 Marketing admin actions: 3 endpoints (lead-manual, send-demo, send-contract, convert-to-tenant) + UI completa en Settings → Leads
- 🆕 Auto-bootstrap del tenant interno + Job demo (sin setup manual)
- 🆕 Dashboard widget "📥 Funnel marketing" + Settings → Operacional con timeline outbox
- 🆕 Bookings: endpoint listBriefings + graceful fallback si tabla no existe
- 🆕 Health endpoint refactor — env vars compartidas Zoho OAuth
- 🆕 docs/TablasDeCatalyst/ — guía completa para crear tablas vía Catalyst API (replicable en otros proyectos Kuno)

**Cambios desde 2026-05-08 (2 sesiones de trabajo del 11 mayo):**

### 🆕 Catalyst Schema API descubierta (2026-05-11)
- Catalyst soporta crear tablas + columnas vía REST API
- Script `scripts/create-catalyst-tables.ts` + `SCHEMA_MANIFEST.json` (26 tablas, 314 columnas)
- 7 tablas nuevas creadas en una mañana: EnglishTestSessions, JobTrackingSnapshots, TokenUsage, MarketingLeads, PrefilterAnswers, MindsetScores, PrefQuestions
- Quirks documentados: eventual consistency 5-60s; nombres orphans quedan permanentemente rotos
- **PrefilterQuestions** renombrada a **PrefQuestions** (Catalyst envenenó el name original)
- ✅ Resultado: **34 tablas activas** en Catalyst Datastore + 3 folders File Store

### 🆕 Marketing landing integrada end-to-end (2026-05-11)
- 5 endpoints públicos: `POST /lead`, `POST /eval-request`, `GET /lead-status`, `POST /lead/request-deletion`, `DELETE /lead`
- CORS expandido (X-Marketing-Site-Key, X-Visit-Id, X-Meta-Event-Id)
- Cloudflare Turnstile wired + validado con Cloudflare real
- GDPR endpoints (request-deletion + DELETE)
- MarketingLeads schema con 27 columnas (incluyendo attribution: visit_id, meta_event_id, UTMs, deletion_token_hash)
- 2 email templates nuevos: `marketing_deletion_request`, `marketing_demo_test_link`
- Tag automático `SharkTalents` en CRM compartido de Kuno
- Settings → 📥 Leads UI completo (stats cards + filtros + detail modal)
- Probado end-to-end: lead test creado, CORS preflight OK, Turnstile rechaza tokens falsos

### 🆕 ZeptoMail wireado (2026-05-08)
- Mail Agent "Shark" en ZeptoMail + dominio sharktalents.ai verificado
- 3 templates wireados: client_portal_access, client_report_ready, recovery_link
- From: `reportes@sharktalents.ai`, Reply-To: `proyectos@kunodigital.com`
- Test email entregado OK

### 🆕 Catalyst Text 10K refactor (2026-05-08)
- Discovery: límite real 10K chars (no 64KB)
- `lib/largeContentStore.ts` para File Store overflow (>9.5K chars)
- 3 folders File Store creados (candidatevideos, englishlistening, largecontent)
- 4 MP3 listening subidos

### 🆕 Frontend admin
- Settings → ⚙️ Operacional tab (botón procesar outbox + preview email setup)
- Settings → 📥 Leads tab rebuilt (stats, filtros, detail modal)
- JobDetail: botón "📤 Avisar cliente reporte listo"
- CandidateRecovery page (`/apply/:tenant/:job/recover`)
- TableNotReadyBanner reusable
- OnboardingTour ampliado (mindset + english)
- ⚠️ **Pendiente:** re-deploy a Catalyst Web Hosting

---

## Visualización del mindmap

```bash
open docs/roadmap-visual.html
```

Renderiza un mind map radial con [markmap.js](https://markmap.js.org/). El doc HTML lee este mismo markdown y lo transforma a SVG interactivo.

---

## Vista detallada por hito

### 🗂️ Tablas (34 listas / ~5 pendientes)

```
Tablas
├── 🟢 Block 1 — core del sistema (10 tablas)
│   ├── 🟢 Tenants
│   ├── 🟢 ProcessedEvents
│   ├── 🟢 Jobs
│   ├── 🟢 Candidates
│   ├── 🟢 Results
│   ├── 🟢 PipelineTransitions
│   ├── 🟢 Scores (con 3 columnas doble eje)
│   ├── 🟢 IntegrityDimensions
│   ├── 🟢 AuditLog
│   └── 🟢 OutboxEvents
│
├── 🟢 Block 2 — features avanzadas (creadas vía API o manual)
│   ├── 🟢 Config
│   ├── 🟢 BotDecisions
│   ├── 🟢 ReviewQueue
│   ├── 🟢 ApiKeys
│   ├── 🟢 ClientReports
│   ├── 🟢 CandidatePool
│   ├── 🟢 JobProfileDrafts
│   ├── 🟢 Notifications
│   ├── 🟢 VideoQuestions
│   ├── 🟢 VideoResponses
│   ├── 🟢 VideoConsents
│   ├── 🟢 AntiCheatEvents
│   ├── 🟢 BotTrainingExamples
│   ├── 🟢 Briefings
│   ├── 🟢 ContinueTokens
│   └── 🟢 ClientNotifications + ClientNotificationTemplates
│
├── 🟢 Tests nuevos (creadas vía API el 11-mayo)
│   ├── 🟢 EnglishTestSessions (18 columnas)
│   └── 🟢 MindsetScores (21 columnas)
│
├── 🟢 Marketing funnel (creada vía API el 11-mayo)
│   ├── 🟢 MarketingLeads (27 columnas con attribution + GDPR)
│   ├── 🟢 PrefQuestions (ex-PrefilterQuestions)
│   ├── 🟢 PrefilterAnswers
│   ├── 🟢 JobTrackingSnapshots
│   └── 🟢 TokenUsage
│
└── 🔴 Pendientes lower priority (5 tablas reales, fallback graceful)
    ├── 🔴 OutreachCampaigns / Contacts / Inbox / Templates (4) — solo si activás HeyReach
    └── 🔴 ZohoMeetings — tracking transcripts de meetings
    
    Antes figuraban como "pendientes" 7 más que ya no aplican:
    ❌ RecruitJobMappings / StageMappings / SyncQueue → reemplazadas por outbox sync.recruit events
    ❌ JobBossProfiles → ya es columna ideal_profile.boss en Jobs
    ❌ ReportCandidates → cubierta por ClientReports.bundle_payload
    ❌ IntegrationSecrets / IntegrationHealth → no aplican (single-agencia)
    ❌ TechLibrary → nice-to-have, no en scope
```

### 🎨 UX (28 listas / 1 en proceso / 1 pendiente)

```
UX
├── 🟢 Recruiter admin views (live + deployed)
│   ├── 🟢 Dashboard + cost widget
│   ├── 🟢 Jobs list (con badges 🔧🇺🇸🧠⚡)
│   ├── 🟢 Candidates list
│   ├── 🟢 JobForm con perfil ideal + boss profile + auto-rejection rules + toggles tests
│   ├── 🟢 JobDetail con botón "📤 Avisar cliente reporte listo"
│   ├── 🟢 Settings con 12 tabs (Integraciones, Notif, Portales, API keys, Bot, Equipo, Branding, 📥 Leads, 💰 Costos, ⚙️ Operacional, Plan, Demo)
│   ├── 🟢 BotReviewQueue
│   ├── 🟢 DraftsList + DraftReview + BriefingForm
│   ├── 🟢 Reportes wired
│   ├── 🟢 Comparativo 4 candidatos
│   ├── 🟢 HelpCenter + Email templates UI
│   ├── 🟢 Tooltips inline (DISC, VELNA, PK, etc.)
│   ├── 🟢 OnboardingTour 7 pasos (con mindset + english)
│   ├── 🟢 TableNotReadyBanner reusable
│   ├── 🟢 Accessibility (focus rings, skip link, aria labels)
│   └── 🟢 ErrorBoundary
│
├── 🟢 Candidato (público)
│   ├── 🟢 CandidateApply (con link "perdiste tu link?")
│   ├── 🟢 CandidateRecovery (reenvío de link)
│   ├── 🟢 CandidateDiscTest
│   ├── 🟢 CandidateVelnaTest
│   ├── 🟢 CandidateTecnicaTest
│   ├── 🟢 CandidateIntegridadTest
│   ├── 🟢 CandidateMindsetTest
│   ├── 🟢 CandidateEnglishTest
│   ├── 🟢 CandidateVideoTest
│   └── 🟢 CandidatePrefilter
│
├── 🟢 Portal cliente
│   ├── 🟢 ClientPortalLanding (lista jobs + stages)
│   └── 🟢 ClientPortalJob (funnel en vivo + milestones + reporte cuando finalists ready)
│
├── 🟡 Pendiente re-deploy (los cambios del 11-mayo en admin no están live)
│   └── 🟡 deploy-frontend.sh (Cris cuando quiera)
│
└── 🔴 Marketing landing
    └── 🔴 Landing en Slate (la maneja Cris fuera de este repo)
```

### 👥 Cliente — features para cliente final (18 listas / 2 pendientes)

```
Cliente
├── 🟢 Funcionalidades live
│   ├── 🟢 Multi-tenant guard
│   ├── 🟢 Reporte multi-candidato con narrativas IA + cache (ClientReports)
│   ├── 🟢 Comparativo 4 candidatos
│   ├── 🟢 Bot decisor (cold/warm/hot)
│   ├── 🟢 Email templates editables
│   ├── 🟢 JobBossProfile
│   ├── 🟢 HelpCenter
│   ├── 🟢 Branding por tenant (logo + colores + legal_name)
│   ├── 🟢 Portal cliente con embudo en vivo (funnel counts + milestones + ETA)
│   ├── 🟢 Tracking server-side de portal apertura
│   ├── 🟢 Aprobación draft por cliente (approve / request-changes)
│   ├── 🟢 Reporte con tests nuevos integrados (mindset + english)
│   ├── 🟢 Email client_portal_access (cuando se emite token)
│   ├── 🟢 Email client_report_ready (botón manual en JobDetail)
│   ├── 🟢 ZeptoMail wired
│   ├── 🟢 Reply-To = proyectos@kunodigital.com
│   ├── 🟢 Marketing landing wire-up backend (5 endpoints + Turnstile + CORS)
│   └── 🟢 Settings → 📥 Leads admin UI con stats + filtros + detail
│
└── 🔴 Pendientes
    ├── 🔴 Notificaciones WhatsApp al cliente (templates listos, falta Meta API)
    └── 🔴 Auto-creación tenant interno + Job demo para eval-request (Cristian)
```

### 🧪 Pruebas — tests del candidato (11 listas / 1 en proceso)

```
Pruebas
├── 🟢 Listas en producción
│   ├── 🟢 DISC
│   ├── 🟢 VELNA cognitiva (3 niveles)
│   ├── 🟢 Integridad (RIASEC-style)
│   ├── 🟢 Emocional
│   ├── 🟢 Técnica con doble eje
│   ├── 🟢 Videos dinámicos (IA genera 5-7 preguntas, IA analiza)
│   ├── 🟢 Test de Mentalidades (McKinsey Forward)
│   │   ├── 🟢 Banco 10 preguntas + scoring + endpoint + UI candidato + recruiter panel + reporte cliente
│   ├── 🟢 Test de Inglés CEFR (A2/B1/B2/C1)
│   │   ├── 🟢 Banco 160 multiple-choice + listening + writing + speaking
│   │   ├── 🟢 4 MP3s subidos a Catalyst File Store
│   │   ├── 🟢 Scoring + writing analyzer + endpoint + UI candidato + recruiter panel
│   │   ├── 🟢 useAntiPaste hook integrado
│   ├── 🟢 PrefQuestions del candidato
│   └── 🟢 Auto-rejection rules (6 reglas: DISC, VELNA, Integridad, Emocional, Adaptabilidad, English)
│
└── 🟢 Audios listening subidos (Cris confirmó 11-mayo)
```

### 🔌 Integraciones (9 listas / 3 en proceso / 4 pendientes)

```
Integraciones
├── 🟢 Activas + validadas
│   ├── 🟢 Anthropic Claude Haiku 4.5 (con prompt caching + TokenUsage tracking)
│   ├── 🟢 Clerk auth multi-tenant + organizations
│   ├── 🟢 Catalyst Datastore + File Store (3 folders)
│   ├── 🟢 ZeptoMail (transactional email — test enviado OK)
│   ├── 🟢 Cloudflare Turnstile (anti-bot — validado con Cloudflare real)
│   ├── 🟢 Circuit breakers + fetchWithTimeout para todas las externals
│   ├── 🟢 Catalyst Schema REST API (script para crear tablas)
│   ├── 🟢 OAuth Self-Client en api-console.zoho.com (para Schema API)
│   ├── 🟢 Marketing landing ↔ Backend (CORS + site key + 5 endpoints)
│   └── 🟢 Zoho Recruit OAuth + sync bidireccional (outbound + webhook entrante)
│
├── 🟡 Código completo, esperando OAuth/setup
│   ├── 🟡 Zoho CRM (código + tag SharkTalents automático listo — Cristian configura OAuth)
│   ├── 🟡 Catalyst Cron jobs (config en cron-config.json — Cristian crea en Console)
│   └── 🟡 Sentry (env var pendiente)
│
└── 🔴 Pendientes (Cristian — ver CRISTIAN_HANDOFF.md)
    ├── 🔴 Zoho Sign / Bookings / Meeting
    ├── 🔴 HeyReach LinkedIn outbound
    ├── 🔴 WhatsApp Business (Meta API)
    └── 🔴 Custom domain api.sharktalents.ai (DNS + Catalyst domain mapping)
```

---

## Vista por urgencia

### 🔥 Bloqueo activo (en vos)

1. **Re-deploy frontend** — `./scripts/deploy-frontend.sh` (los cambios del 11-mayo no están live en el admin)
2. **Probar end-to-end** los emails de cliente que armamos hoy (crear portal, recibir email, etc.)

### 🟡 Tareas asignadas a Cristian (ver `docs/CRISTIAN_HANDOFF.md`)

1. 🔴 Bridge Zoho CRM (OAuth + 3 env vars)
2. 🟡 Tenant interno + Job demo para `/eval-request`
3. 🟢 Cron jobs Catalyst (outbox + video purge)
4. 🟢 Custom domain `api.sharktalents.ai`

### 🟢 Nice-to-have post-MVP

- WhatsApp Business + HeyReach (cuando lo necesites en producción real)
- Sentry para alertas de errores
- Audios listening mejorados con ElevenLabs

---

## Cómo actualizar este doc

Cuando completes algo, cambiá el emoji:
- 🔴 → 🟡 cuando arrancás a trabajar
- 🟡 → 🟢 cuando está merge/deploy

**Para ver el mapa interactivo:** `open docs/roadmap-visual.html`
