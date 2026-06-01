# Punch list — pendientes de Cris

Lista de todo lo que necesita hacer Cris (no AI). Organizada por urgencia + dependencias.

**Última actualización:** 2026-05-11

---

## ✅ Hecho 2026-05-08

- [x] Folders Catalyst File Store creados: `candidatevideos`, `englishlistening`, `largecontent`
- [x] 4 MP3 del listening (CEFR A2/B1/B2/C1) subidos a `englishlistening`
- [x] Env vars `FILESTORE_*` seteadas en Catalyst Console
- [x] Dominio `sharktalents.ai` verificado en Slate (landing gamificada)
- [x] Decidido: emails al candidato via **Recruit**; ZeptoMail solo para 2 emails al cliente
- [x] ZeptoMail Mail Agent "Shark" creado + verificado + test email enviado OK
- [x] `MARKETING_SITE_KEY` + `ALLOWED_ORIGINS` + `ZEPTOMAIL_API_TOKEN` seteados en Catalyst Console

## ✅ Hecho 2026-05-11

- [x] **Catalyst Schema API descubierto + script `scripts/create-catalyst-tables.ts`**: 7 tablas nuevas creadas via REST (EnglishTestSessions, JobTrackingSnapshots, TokenUsage, MarketingLeads, PrefilterAnswers, MindsetScores, PrefQuestions)
- [x] **`PrefilterQuestions` renombrado a `PrefQuestions`** en código (Catalyst envenenó el nombre original tras múltiples orphans)
- [x] **Backend re-deployado** con rename + nuevos endpoints + 11 columnas extra en MarketingLeads
- [x] **Marketing landing integration** completa: 5 endpoints, CORS configurado, Turnstile wired y validado con Cloudflare real
- [x] **OAuth Self-Client de Zoho** generado por Cris para Catalyst API (refresh token guardado en env vars)
- [x] **TURNSTILE_SECRET_KEY** seteada y testeada (Cloudflare rechaza tokens inválidos correctamente)
- [x] **Marketing Leads admin UI** completa con stats + filtros + detail modal en Settings → Leads
- [x] **2 email templates nuevos**: `marketing_deletion_request`, `marketing_demo_test_link`

---

## 🔴 Bloqueos activos

Estos te bloquean activar features puntuales. Resto está OK.

### ⚠️ Responder email de ZeptoMail (activación cuenta)
- [ ] Buscar email pendiente de ZeptoMail que pide info para terminar de activar la cuenta. **Sin esto, los emails reales no salen** (aunque el test estuvo OK, la cuenta puede estar en modo sandbox).


### Activar test de inglés con audios reales
- [ ] (Opcional) Generar audios de listening con voces reales — ya están los 4 MP3 placeholders subidos. Si querés audios mejores hay que conseguir ElevenLabs API key + correr `scripts/generate-english-audios.sh`.

### Validar bancos de preguntas (sanity check antes de prod)
- [ ] `shark/src/data/questions/mindset.json` — 10 preguntas, ~10 min
- [ ] `shark/src/data/questions/english-a2.json` — 40 preguntas, ~10 min
- [ ] `shark/src/data/questions/english-b1.json` — 40 preguntas, ~15 min
- [ ] `shark/src/data/questions/english-b2.json` — 40 preguntas, ~20 min
- [ ] `shark/src/data/questions/english-c1.json` — 40 preguntas, ~25 min
- [ ] `shark/src/data/english-config.json` — listening scripts + writing prompts

Si encontrás alguna mal calibrada, marcamela y la ajusto.

### Probar live el flow del cliente (post re-deploy)
- [ ] **Re-deploy frontend** (`./scripts/deploy-frontend.sh`) — los cambios del admin de hoy no están live
- [ ] Crear un portal de cliente con tu email real → confirmar que el email `client_portal_access` llega via ZeptoMail
- [ ] Crear un Job y darle al botón "📤 Avisar cliente reporte listo" → confirmar que `client_report_ready` llega
- [ ] Probar manual outbox processor desde Settings → ⚙️ Operacional

---

## 🟡 Tareas asignadas a **Cristian** (engineer, en docs/CRISTIAN_HANDOFF.md)

Ya documentadas en su brief — no las hago yo ni vos:

1. 🔴 Activar bridge Zoho CRM (OAuth + env vars + opcional Layout SharkTalents en CRM)
2. 🟡 Tenant interno + Job demo para `/api/marketing/eval-request`
3. 🟢 Custom domain `api.sharktalents.ai`
4. 🟢 Cron jobs en Catalyst Console (outbox processor + video purge)

---

## 🟢 Operacional (mejoras post-MVP)

### WhatsApp Business (opcional, cuando quieras)
- [ ] Setup Meta WhatsApp Business API
- [ ] Verificar número
- [ ] Env vars: `WHATSAPP_*`

### Sentry (error tracking, opcional)
- [ ] Cuenta en Sentry → proyecto SharkTalents
- [ ] Env var: `SENTRY_DSN`

Sin esto: errores solo se ven en Catalyst logs (no agregados, no alertas).

---

## ✅ Estado actual del sistema (2026-05-11)

**Backend (Catalyst Development):**
- 34 tablas creadas en Datastore (todas las que la app necesita)
- 813 tests pasando (backend)
- ~95 endpoints HTTP
- Catalyst Text 10K refactor terminado (File Store overflow para fields >9.5K)
- ZeptoMail: 3 templates wireados (client_portal_access, client_report_ready, recovery_link) + 2 nuevos (marketing_deletion_request, marketing_demo_test_link)
- Marketing landing 100% integrada (5 endpoints + Turnstile + CORS)

**Frontend (admin app):**
- Build limpio
- Settings con tabs: Integraciones, Notificaciones, Portales, API keys, Bot decisor, Equipo, Branding, Leads (nuevo full UI), Costos IA, ⚙️ Operacional (nuevo), Plan, Demo
- Botón "📤 Avisar cliente reporte listo" en JobDetail
- Página CandidateRecovery en `/apply/:tenant/:job/recover`
- TableNotReadyBanner reusable en 4 componentes
- OnboardingTour ampliado con tests nuevos (mindset + english)
- **Pendiente:** re-deploy a Catalyst Web Hosting

**Catalyst File Store:**
- `candidatevideos` (28606000000751079) — videos del candidato
- `englishlistening` (28606000000751088) — 4 MP3s del listening
- `largecontent` (28606000000751097) — overflow >9.5K

**Integraciones activas:**
- ✅ Clerk (auth multi-tenant)
- ✅ Anthropic (Haiku 4.5)
- ✅ ZeptoMail (transactional email)
- ✅ Cloudflare Turnstile (anti-bot)
- ⏳ Zoho CRM (esperando que Cristian configure OAuth)
- ⏳ HeyReach (env vars vacías, código listo)
- ⏳ WhatsApp (env vars vacías, código listo)
- ⏳ Sentry (env vars vacías, código listo)
- ⏳ Zoho Recruit/Bookings/Sign (env vars vacías, código listo)

---

## Cuando vuelvas, qué leer primero

1. Este doc (PUNCH_LIST.md) — sabés qué falta
2. [docs/CRISTIAN_HANDOFF.md](CRISTIAN_HANDOFF.md) — qué le toca a Cristian
3. CHANGELOG.md — qué se hizo hoy
4. Esperar mi resumen de la tanda autónoma que hago mientras almorzás
