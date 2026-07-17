# Inventario de API Keys / Secrets

**Política:** los valores reales viven SOLO en Catalyst Console (Environment Variables). Nunca en repo, nunca en logs, nunca en chat directo. Este archivo lista QUÉ key existe, dónde, quién la creó y cuándo se rotó. **NUNCA agregar valores reales acá.**

## Si una key se filtra (chat, log, commit, foto)
1. **Revocarla inmediatamente** en el portal del proveedor.
2. **Crear nueva** con el mismo nombre.
3. **Actualizar en Catalyst Console** sin pasar por chat (copy-paste directo desde portal del proveedor a Catalyst).
4. **Actualizar la columna "Última rotación"** en la tabla de abajo.

---

## Keys activas

| Key (env var) | Proveedor | Para qué | Dónde se generó | Quién la creó | Última rotación | Notas |
|---|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | Claude Haiku (scoring, prompts, mensajes sugeridos) | console.anthropic.com | Cris | (registrar) | Si todo falla con HTTP 400 → chequear billing primero |
| `OPENAI_API_KEY` | OpenAI | Whisper (transcripción video) | platform.openai.com | Cris | 2026-06-24 (creada inicial) | Asociada a Kuno. **Key project (sk-proj-...) mide 164 chars → guardada en tabla Datastore `Config` (tenant_id='GLOBAL', config_key='OPENAI_API_KEY', value_type='secret'). Tabla existe desde 2026-06-25.** Backend la lee con `getOpenAIKey(req)` de `lib/secretsCache.ts`. Budget cap mensual pendiente. **Key se compartió por chat el 2026-06-24 — Cris decidió asumir riesgo y NO regenerar.** |
| `INTERNAL_API_KEY` | (interna) | Endpoints `_diag-*` admin | scripts/generate-secret.sh | Cris | (registrar) | Rotable con `scripts/rotate-secret.sh INTERNAL_API_KEY` |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Twilio | WhatsApp Business (Sandbox + WABA virtual `+5078338754`) | console.twilio.com | Cris | (registrar) | Cuenta global Twilio — misma DEV y PROD |
| `ZOHO_CRM_CLIENT_ID` + `ZOHO_CRM_CLIENT_SECRET` + `ZOHO_CRM_REFRESH_TOKEN` | Zoho | CRM API (leads de Meta) | api-console.zoho.com | Cris | (registrar) | Refresh token NO expira si se usa regularmente |
| `ZOHO_RECRUIT_*` | Zoho | Recruit API (candidatos + jobs) | api-console.zoho.com | Cris | (registrar) | Webhook secret en query string |
| `ZEPTOMAIL_API_KEY` | Zoho ZeptoMail | Email transaccional (cliente + recovery) | zeptomail.zoho.com | Cris | (registrar) | Pendiente activación formal del equipo ZeptoMail |
| `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` | Clerk | Auth multi-tenant | dashboard.clerk.com | Cris | (registrar) | Pub key va al frontend (VITE_) |

---

## Reglas operativas

1. **Generar key:** en el portal del proveedor, nombre descriptivo (`SharkTalents Video Whisper`, no `Untitled Key`).
2. **Pegar SOLO en Catalyst Console:**
   - **Keys cortas (< 50 chars):** Settings → Environment Variables. La gran mayoría caben.
   - **Keys largas (> 50 chars):** Cloud Scale → Data Store → tabla `SystemSecrets` → Insert Row. Cap 10,000 chars en columna value. Backend lee con `getSecret(name, req)` de `lib/secretsCache.ts`.
   - ❌ **NO usar Catalyst Cache** para secrets permanentes — TTL máximo es 48 horas.
   - **NUNCA en archivo del repo.**
3. **Verificar deploy lee la nueva key:** `curl https://<env>.../server/api/admin/anthropic-ping` u otro endpoint diag del proveedor.
4. **Budget caps por proveedor:**
   - Anthropic: setear monthly limit en console.anthropic.com → Settings → Limits
   - OpenAI: platform.openai.com → Settings → Limits → Set monthly budget
   - Twilio: console.twilio.com → Billing → Set spending limit
5. **Rotación periódica recomendada:** cada 90 días (anotar fecha en la tabla).
6. **Key fragment para logs:** si necesitás ver una key en log (debug), mostrar solo primeros 6 + últimos 4 chars. Helper en `lib/anthropic.ts:fragmentSecret()`.

---

## Incidentes registrados

| Fecha | Key afectada | Qué pasó | Resolución |
|---|---|---|---|
| 2026-06-24 | `OPENAI_API_KEY` | Pegada en chat directo en lugar de Catalyst Console | Cris decidió asumir riesgo. NO se regeneró. Monitorear consumo en platform.openai.com/usage para detectar uso anómalo. |
