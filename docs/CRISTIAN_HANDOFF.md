# Brief para Cristian — SharkTalents v2

**De:** Cris (PM/Designer/QA)
**Para:** Cristian (Engineer)
**Última actualización:** 2026-05-06

## Qué hago yo (Cris) vs qué hacés vos

| Yo (Cris) | Vos (Cristian) |
|---|---|
| Diseño UX + accesibilidad | Implementación frontend + backend |
| Testing manual end-to-end | Tests unitarios + de integración |
| Setup de servicios externos (Zoho, ElevenLabs, Sentry, etc.) | Code de integración + manejo de errores |
| Verificación DNS / dominio | Wire-up del custom domain en Catalyst |
| Decisiones de producto + diseño tests psicométricos | Implementación técnica |

## Qué tenés que leer primero (1-2 hrs de lectura)

**Orden recomendado:**

1. [CLAUDE.md](../CLAUDE.md) — convenciones del repo + prohibiciones explícitas
2. [docs/aprendizajes/00_INDEX.md](aprendizajes/00_INDEX.md) — manual de patrones (15 docs cortos)
3. [docs/master-plan/00_INDEX.md](master-plan/00_INDEX.md) — plan general
4. [docs/master-plan/25_TEST_INGLES.md](master-plan/25_TEST_INGLES.md) + [26_TEST_MENTALIDADES.md](master-plan/26_TEST_MENTALIDADES.md) — los 2 tests nuevos que vas a implementar UI
5. [docs/master-plan/18_PIPELINE_OPERATIVO.md](master-plan/18_PIPELINE_OPERATIVO.md) — state machine del pipeline
6. [docs/master-plan/23_INTEGRACIONES_ZOHO.md](master-plan/23_INTEGRACIONES_ZOHO.md) — Recruit/Sign que vas a integrar

## Stack técnico

- Backend: Zoho Catalyst Advanced I/O (Node 20) + TypeScript strict, commonjs, ES2022
- Frontend: React 18 + Vite + TypeScript strict, ESM, HashRouter
- Auth: Clerk (multi-tenant via organizations)
- IA: Anthropic Claude Haiku 4.5 con prompt caching
- Tests: Vitest (backend 752 tests, frontend 185 tests, todo verde)

## Cómo correr local

```bash
# Backend
cd functions/api
npm install
npm run build
npm test
npm run watch  # rebuild on save

# Frontend
cd shark
npm install
npm run dev    # localhost:3000
npm test
npm run build  # output a shark/dist
```

## Convenciones que NO podés romper

- `strict: true` en TS (no `any` sin justificar)
- TODO query ZCQL pasa por `escapeSql()` ([lib/dbHelpers.ts](../functions/api/src/lib/dbHelpers.ts))
- Nunca `await fetch(...)` sin timeout — usar `fetchWithTimeout` o el SDK con timeout
- Nunca loguear secrets/PII (truncar con primeros 4 + últimos 4 chars)
- Tablas Catalyst: PascalCase plural (Jobs, Candidates)
- Columnas: snake_case (created_at, tenant_id)
- FKs: `<entity>_id`
- Booleans: `is_*` o `has_*`
- Logs: prefijo `[MODULE]` con `logger('MODULE')`
- Frontend español neutral: usar **tú**, no **vos** ([memory](../.claude/projects/-Users-usuario-sharktalentsapp/memory/feedback_usar_tu_no_vos.md))

## Tu Fase 1 (primera semana, ~22-30 hrs)

### 1. UI candidato — Test de Mentalidades (4-6 hrs)

**Spec:** [docs/master-plan/26_TEST_MENTALIDADES.md](master-plan/26_TEST_MENTALIDADES.md)

**Mockups de Cris:** te los pasa por separado

**Lo que ya está hecho:**
- Banco: [shark/src/data/questions/mindset.json](../shark/src/data/questions/mindset.json) — 10 preguntas
- Config: [shark/src/data/mindset-config.json](../shark/src/data/mindset-config.json) — mapeo + thresholds
- Backend endpoint: `POST /test/<token>/mindset/submit` ([features/mindsetTest.ts](../functions/api/src/features/mindsetTest.ts))
- API client tipado: [shark/src/lib/testApi.ts](../shark/src/lib/testApi.ts) → `submitMindsetTest()`
- Recruiter view: [components/CandidateMindsetPanel.tsx](../shark/src/components/CandidateMindsetPanel.tsx)

**Tu tarea:**
- Crear `shark/src/pages/CandidateMindsetTest.tsx`
- Renderizar las 10 preguntas con 6 opciones cada una
- Randomizar el orden de las opciones por candidato (evita position bias)
- Barra de progreso (1/10, 2/10, ...)
- Estado: índice de pregunta actual + answers acumulados
- Al terminar, llamar `submitMindsetTest(token, answers)`
- Después del submit: silencio total (no mostrar score al candidato), avanzar al siguiente bloque del flow

**Ojo importante:** el candidato NO debe ver "Test de Mentalidades" como título. Usar el framing de "Sección 2 — Preguntas extras" según el spec.

### 2. UI candidato — Test de Inglés (8-12 hrs)

**Spec:** [docs/master-plan/25_TEST_INGLES.md](master-plan/25_TEST_INGLES.md)

**Lo que ya está hecho:**
- Bancos: `shark/src/data/questions/english-{a2,b1,b2,c1}.json` — 40 preguntas por nivel
- Config: [shark/src/data/english-config.json](../shark/src/data/english-config.json) — listening scripts + writing prompts + thresholds
- Audios MP3 en Catalyst File Store, folder `english-listening`
- Hook anti-paste: [hooks/useAntiPaste.ts](../shark/src/hooks/useAntiPaste.ts) — listo para spread en textarea
- Selector de preguntas: [lib/questionSelector.ts](../functions/api/src/lib/questionSelector.ts) (backend, podés reusar la lógica en frontend)
- Backend endpoint: `POST /test/<token>/english/submit` ([features/englishTest.ts](../functions/api/src/features/englishTest.ts))
- API client tipado: `submitEnglishTest()`
- Writing analyzer (Claude): [lib/englishWritingAnalyzer.ts](../functions/api/src/lib/englishWritingAnalyzer.ts) (lo llama el endpoint, no vos directo)

**Tu tarea:**
Crear `shark/src/pages/CandidateEnglishTest.tsx` con 4 sub-secciones secuenciales:

1. **Multiple-choice (18 preguntas):**
   - Cargar el banco del nivel (`english-{level}.json`)
   - Seleccionar 18 al azar (8 vocab + 8 grammar + 4 reading) usando lógica de `pickStratified`
   - Renderizar una a la vez con 4 opciones radio
   - Barra de progreso

2. **Listening (1 audio + 2 preguntas):**
   - Audio player con play/pause/replay (max 2 reproducciones — trackear)
   - Audio source: fetchear del File Store via API helper (Catalyst SDK signed URL)
   - Después del audio, mostrar las 2 preguntas

3. **Writing (1 prompt + textarea):**
   - Mostrar prompt del nivel (de `english-config.json`)
   - `<textarea>` con `useAntiPaste` hook spread como props
   - Word counter en vivo
   - Timer countdown del nivel (5/8/10/15 min según A2/B1/B2/C1)
   - Al terminar timer: auto-submit (no permitir editar más)
   - Mensaje al pegar: "El paste está deshabilitado en esta sección"

4. **Submit + resultado:**
   - Llamar `submitEnglishTest(token, { ... })` con todo el bundle
   - Si `passed=true` → siguiente bloque es **video speaking**
   - Si `passed=false` → fin del bloque, sigue con el resto del flow (sin mostrar resultado)

**Anti-cheat — qué pasar al backend:**
```typescript
{
  writing_paste_attempts: stats.paste_attempts,
  writing_focus_lost_count: stats.focus_lost_count,
  writing_word_count: text.split(/\s+/).filter(Boolean).length,
  writing_time_seconds: timeElapsedAtSubmit,
  // ... resto
}
```

### 3. Email dispatcher con ZeptoMail (2-3 hrs)

**Lo que ya está hecho (lo escribí yo, listo para que reviuses + ajustes):**
- [lib/zeptomailClient.ts](../functions/api/src/lib/zeptomailClient.ts) — wrapper API tipado *(escribiéndolo en paralelo)*
- Wire-up en [features/outbox.ts](../functions/api/src/features/outbox.ts) → `dispatchEmailSendPending` *(escribiéndolo)*

**Tu tarea:**
- Revisar el code del wrapper
- Agregar templates en ZeptoMail UI (candidato invitation, candidate rejected, client report ready, etc.)
- Mapear cada template name a su template_key de ZeptoMail
- Test end-to-end: publicar un evento `email.send_pending` desde un endpoint admin y verificar que llega a tu inbox

### 4. Auto-rejection rules engine (4-6 hrs)

**Lo que ya está hecho (escribiéndolo en paralelo):**
- [lib/autoRejectionEngine.ts](../functions/api/src/lib/autoRejectionEngine.ts) — pure function que evalúa rules contra scores
- Tests unitarios

**Tu tarea:**
- Wire al pipeline state machine: cuando un candidato termina su evaluación, evaluar `auto_rejection_rules` del Job
- Si alguna regla falla → marcar `pipeline_stage = 'rejected'` + razón en `PipelineTransitions.reason`
- Disparar evento outbox `email.send_pending` con template `candidate_rejected`

### 5. Sync.recruit producer (3-4 hrs)

**Lo que ya está hecho (escribiéndolo en paralelo):**
- [lib/recruitSyncPublisher.ts](../functions/api/src/lib/recruitSyncPublisher.ts) — publica eventos cuando candidato cambia de stage
- Tests

**Tu tarea:**
- Wire al `transitionApplication` en [features/applications.ts](../functions/api/src/features/applications.ts)
- Asegurar idempotencia (no publicar 2x para el mismo transition)

## Tu Fase 2 (segunda semana, ~22-30 hrs)

### 6. Zoho Recruit OAuth + sync consumer (8-12 hrs)
Spec: [23_INTEGRACIONES_ZOHO.md](master-plan/23_INTEGRACIONES_ZOHO.md). Necesitás:
- Registrar app en Zoho Developer Console
- OAuth dance: client_credentials flow o authorization code (Cris te ayuda con esto)
- Token refresh automático
- Mapear nuestros stages → stages de Recruit
- Wire al consumer en outbox.ts (ya hay stub `dispatchRecruitSync`)

### 7. Zoho Sign integration (6-8 hrs)
Spec: [23_INTEGRACIONES_ZOHO.md](master-plan/23_INTEGRACIONES_ZOHO.md#zoho-sign). Webhook entrante en [features/zohoSignWebhook.ts](../functions/api/src/features/zohoSignWebhook.ts) ya tiene scaffolding.

## Comandos útiles

```bash
# Verify all tables in Catalyst
INTERNAL_KEY="..." curl -s -H "X-Internal-Key: $INTERNAL_KEY" \
  "$BACKEND_URL/admin/verify-tables" | python3 -m json.tool

# Run smoke tests
INTERNAL_API_KEY="..." CATALYST_API_URL="$BACKEND_URL" ./scripts/smoke-test.sh

# Generate audios (ElevenLabs)
ELEVENLABS_API_KEY="..." ./scripts/generate-english-audios.sh

# Create migration checklist
./scripts/print-migrations-checklist.sh docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv

# Build + test backend
cd functions/api && npm run build && npm test

# Build + test frontend
cd shark && npm run build && npm test

# Validate before deploy (tests + build + env vars)
./scripts/validate-deploy.sh
```

## Reglas de oro

1. **NO deployes si los tests no pasan** — incluso si el lint dice que está todo bien
2. **NO commitees `.env`** con valores reales
3. **NO uses `--no-verify` ni `--force`** sin confirmación de Cris
4. **Si una tabla en Catalyst no tiene una columna que el código espera** — mejor fallback graceful (ej: 503 con mensaje claro) que crash. Patrón: `if (!await isTableReady(req)) throw TABLE_NOT_READY;`
5. **Truncar JSON antes de insertar** en columnas Text — usar `stringifyAndTruncate` de [lib/dbLimits.ts](../functions/api/src/lib/dbLimits.ts). Catalyst tiene límite de 32KB por fila total.
6. **Errores de Anthropic NO deben tirar la function** — usar circuit breaker en [lib/circuitBreaker.ts](../functions/api/src/lib/circuitBreaker.ts) (ya integrado en `anthropicMessage`)

## Cómo nos comunicamos

- **Cris** te pasa: mockups, criterios de aceptación, casos de uso
- **Vos** le pasás: PRs cortos (1 feature por PR), preguntas técnicas claras
- **Claude** (yo) genero: code, tests, tutoriales, docs

Si tenés dudas técnicas, podés:
1. Preguntar a Cris (ella decide UX, prioridad, scope)
2. Preguntar a Claude (yo respondo arquitectura, debug, mejores prácticas)
3. Leer los docs de [aprendizajes/](aprendizajes/) — ahí está el "por qué" de las decisiones

Bienvenido al proyecto.

---

## 🆕 Tareas pendientes asignadas a vos (al 2026-05-11 — actualizado tarde noche)

Cosas que Cris no puede hacer (faltan permisos OAuth de Zoho One de Kuno + tarea de engineer).
Ordenadas por prioridad: lo de arriba bloquea features activas, lo de abajo es nice-to-have.

### ✅ Completadas durante el día por Cris (no las hacés):

- ✅ Zoho Recruit OAuth + webhook (Cris lo activó, código wireado, deployado y probado end-to-end)
- ✅ Tenant interno + Job demo (auto-bootstrap implementado en `marketing.ts:ensureMarketingDemoSetup` — se crea automático en primera llamada a `/eval-request` o `/send-demo`)
- ✅ Template email `marketing_deletion_request` (ya en `lib/emailTemplates.ts`)
- ✅ Template email `marketing_demo_test_link` (idem)
- ✅ Zoho Sign — código wireado completo (cliente + endpoint + webhook handler para auto-crear Tenant al firmar). Solo falta que Cris cargue el template del contrato a Sign Console + setee `ZOHO_SIGN_CONTRACT_TEMPLATE_ID` env var.

### 🟡 1. Activar bridge Zoho CRM (CRM compartido con Kuno)

**Por qué importa:** los leads del funnel de marketing se guardan en `MarketingLeads` table del backend pero NO se pushean al CRM de Kuno. Código wireado (refactor 2026-05-12 a OAuth helper compartido). Falta sólo el setup de la env var + scope CRM en refresh_token.

**Contexto del CRM compartido:**
- Cada lead se crea con `Tag: ['SharkTalents']` automáticamente → CRM compartido de Kuno los distingue del resto
- Lead_Source: `SharkTalents Funnel`
- Description: incluye Score + Urgency + Status
- Auth: usa el **mismo `ZOHO_OAUTH_REFRESH_TOKEN` compartido** que Recruit/Sign/Bookings — refactor 2026-05-12 unifica todo

**Lo que tiene que hacer Cris:**

1. **Regenerar refresh_token con scope CRM agregado.** El refresh_token actual sólo tiene `ZohoRecruit.modules.ALL`. Hay que regenerarlo en api-console.zoho.com con scopes combinados:
   ```
   ZohoRecruit.modules.ALL,ZohoCRM.modules.ALL,ZohoSign.documents.ALL,ZohoBookings.data.ALL
   ```
   (Si no querés todos juntos, mínimo: `ZohoRecruit.modules.ALL,ZohoCRM.modules.ALL`)

2. Pegá el nuevo refresh_token reemplazando el actual en Catalyst Console:
   ```
   ZOHO_OAUTH_REFRESH_TOKEN=<nuevo refresh_token con scope combinado>
   ```

3. Seteá la URL del API de CRM (única env var nueva):
   ```
   ZOHO_CRM_API_URL=https://www.zohoapis.com/crm/v6
   ```

4. **(Opcional)** Layout dedicado en Zoho CRM:
   - Setup → Modules → Leads → Layouts → Clone Layout → "SharkTalents Leads"
   - Copiar Layout ID de la URL del edit
   - Setear `ZOHO_CRM_LEAD_LAYOUT_ID=<id>`

5. Re-deploy backend (`./scripts/deploy-backend.sh`)
6. Verificar disparando un lead test desde la landing y checkeando que aparece en CRM con el tag SharkTalents

**Archivos relevantes:**
- `functions/api/src/lib/zohoCrmClient.ts` — client + createLead (usa `getZohoAuthHeader()`)
- `functions/api/src/lib/zohoOAuth.ts` — token refresh compartido
- `functions/api/src/features/outbox.ts:430` — `dispatchLeadToCrm` handler

---

### 🟢 2. Custom domain `api.sharktalents.ai` (opcional)

**Por qué importa:** actualmente el backend está en `https://sharktalentsapp-883996440.development.catalystserverless.com/server/api` — feo y largo. Con custom domain queda `https://api.sharktalents.ai`.

**Lo que tenés que hacer:**

1. DNS: agregar CNAME `api.sharktalents.ai` → `sharktalentsapp-883996440.development.catalystserverless.com` (o el Production domain cuando salgamos de Development)
2. Catalyst Console → Settings → **Custom Domain** → Add Domain → `api.sharktalents.ai`
3. Catalyst gestiona el SSL automático (Let's Encrypt)
4. Una vez activo: actualizar env var `NEXT_PUBLIC_API_BASE` en Slate de la landing
5. (Importante) Catalyst tiene un toggle "Force HTTPS" — activarlo

Documentado en [docs/RUNBOOKS/custom-domain-setup.md](RUNBOOKS/custom-domain-setup.md) si existe; sino, runbook genérico en docs de Catalyst.

---

### 🟢 3. Cron jobs en Catalyst Console

**Por qué importa:** sin cron, los outbox events (emails, syncs) se acumulan pending y nunca salen. Cris implementó un botón manual en Settings → Operacional para procesar a demanda, pero queremos automatizarlo.

**Config completa en:** `functions/api/cron-config.json` (revisalo, ahí están los 2 jobs que se necesitan con su schedule y URL exacta).

**Lo que tenés que hacer:** crear 2 cron jobs en Catalyst Console → Cloud Scale → Cron Jobs:
1. `outbox_processor` — cada 5 min — POST a `/server/api/admin/outbox/process` con header `X-Internal-Key: $INTERNAL_API_KEY`
2. `video_purge` — todos los días 3am — POST a `/server/api/admin/gdpr/purge-old-videos` con el mismo header

---

### 🟢 4. Bonus: revisar PrefilterQuestions → PrefQuestions rename

**Por qué importa:** descubrimos un bug intermitente en Catalyst donde el nombre `PrefilterQuestions` quedó "envenenado" tras varios intentos de creación. Renombré la tabla a `PrefQuestions` en código (`admin.ts` + `features/prefilter.ts`).

**Lo que tenés que verificar:**
- Que la tabla `PrefQuestions` exista en Catalyst Console (sí, la creó el script)
- Que ningún otro pedazo de código use el string literal `PrefilterQuestions` para queries DB

Documentado en memoria: `project_catalyst_schema_api_2026-05-11.md`.

---

## Cómo agregar nuevas tablas en el futuro

Catalyst soporta crear tablas vía API (lo descubrimos el 2026-05-11):

```bash
# 1. Agregar la nueva tabla al EXPECTED array en functions/api/src/features/admin.ts
# 2. Regenerar el manifest:
python3 << 'EOF'
# (ver scripts/create-catalyst-tables.ts docstring para el script de extracción)
EOF
# 3. Setear env vars (te las pasa Cris) y correr:
./scripts/create-catalyst-tables.ts --only=NombreTablaNueva --execute
```

Quirks importantes:
- Eventual consistency 5-60s entre crear tabla y poder agregar columnas
- Si una creación falla por timeout, la tabla queda **huérfana permanente** (table_id roto, name reservado) — hay que borrar manual en Console y reintentar
- Si un name queda envenenado, renombrar en código + retry
- Usar el script `scripts/create-stubborn-table.ts` para tablas problemáticas (polea hasta 5 min)

Más detalles en `project_catalyst_schema_api_2026-05-11.md` (memoria).
