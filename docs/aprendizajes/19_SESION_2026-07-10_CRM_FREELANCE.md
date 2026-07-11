# Sesión 2026-07-10 — CRM Freelance + Integración Zoho CRM real

**Contexto:** día largo de trabajo enfocado en construir el CRM operativo para los vendedores freelance, con integración real a la instancia Zoho CRM productiva de Kuno.

---

## Lo que se construyó

### 1) Fase 2 CRM Freelance completa
- Kanban del freelance con etapas del embudo
- Modal "Convertir a cliente" (empresa + contacto + salario + fecha cierre)
- Modal "Editar lead" (para completar datos que Meta no trae: empresa, cargo, dolor)
- Modal "Enviar cotización" con generación de PDF (jsPDF) + envío por email
- Endpoint `/api/freelance/me/leads/:id/send-eval` — envío manual del email de evaluación
- Endpoint `/api/freelance/me/leads/:id/send-quote` — envío de cotización presupuestal
- Auto-asignación de leads a freelance con menos leads (round-robin básico)
- Fix hardcoded ID de Chris Palma como Owner de Deals/Accounts/Contacts en Zoho
- **Owner Chris Palma: `5710516000002213001`** (env var `OWNER_ID` + fallback hardcoded en código)

### 2) Split arquitectónico: Leads vs Clientes
Decidido usar **Opción B** (dos módulos separados):
- `Mis leads` — pre-venta, 6 columnas (Nuevo → Cotización enviada) + Perdido
- `Mis clientes` — post-venta, 5 columnas (Cotización → Cobrado + Perdido)

### 3) Integración webhook Zoho CRM → SharkTalents
- Descubierto que `zohoCrmWebhook.ts` ya existía y funcionaba
- Le agregamos: **auto-asignación al freelance** al recibir un lead nuevo
- Le quitamos: **email de bienvenida automático** (ahora es manual)

### 4) Endpoint público `/api/marketing/lead` — email condicional
- Antes: siempre disparaba email de evaluación al lead
- Ahora: solo dispara si `body.send_evaluation_email === true`
- La landing "prueba gratis" lo setea; los Meta Ads no

### 5) Configuración Zoho CRM real de Kuno
- Confirmadas las 10 fases reales del pipeline: Contacto inicial, Cotización, Contrato, Perfil ideal, Retrasado, Facturación y cobro, En Ejecución Proyecto, Cobrado / Suscripción activa, Perdido, Cancelado
- Mapeo etapas SharkTalents → Zoho:
  ```
  cotizacion_contrato → 'Cotización'
  contrato_enviado    → 'Contrato'
  contrato_firmado    → 'En Ejecución Proyecto'
  cobrado             → 'Cobrado / Suscripción activa'
  perdido             → 'Perdido'
  ```
- Custom field `Posibles_productos` con opción "Recursos Humanos" — todos los Deals de SharkTalents lo llevan
- Vista Kanban "Sharktalents" en Zoho — filtro por Posibles_productos="Recursos Humanos" + Categorizar por Fase

### 6) Tabla `SalesClients` en Catalyst
- 22 columnas creadas por Cris en Console
- Guarda: lead_id, freelance_user_id, empresa/contacto, montos, pipeline_stage, zoho_account_id, zoho_contact_id, zoho_deal_id, sync status, + 11 columnas para datos legales del contrato (razón social, RUC, dirección, representante nombre/cargo/cédula/email, cargo del puesto, flag datos_legales_completos)

---

## Aprendizajes técnicos

### 🔑 Zoho CRM user_id ≠ ZUID
- El **ZUID** (Zoho User ID global de la plataforma) es corto (~9 dígitos). Sirve para Books, Mail, etc.
- El **CRM user_id** es largo (19 dígitos). Solo sirve para CRM.
- Al setear `Owner: { id: X }` en records de Zoho CRM, usar el CRM user_id, no el ZUID.
- Se obtiene desde Zoho CRM → Setup → Users & Control → Users → click en usuario → URL contiene el ID.

### 🔑 Refresh token OAuth atado a un usuario
- El refresh token de Zoho OAuth pertenece al usuario que lo autorizó (en Kuno es "Cris García", superadmin CEO).
- Todo POST a Zoho queda con `Created_By = Cris García`, **independiente** del Owner que asignemos.
- Para que Chris Palma vea los records en "Mis Tratos", hay que setear **explícito** `Owner: { id: <chris_palma_id> }` en cada request.

### 🔑 Zoho pipeline: Stage vs Forecast Category
- **Stage** (Fase) — el pipeline: Cotización, Contrato, Cerrado Ganado, etc.
- **Forecast Category** — bucket para forecast: Committed, Best Case, Closed, Sin contabilizar
- Un Kanban puede agrupar por CUALQUIERA de los dos. Por default el "STAGEVIEW" de Kuno agrupaba por Forecast Category — de ahí que todos los Deals SharkTalents cayeran en "Sin contabilizar".
- Solución: crear vista Kanban propia agrupando por **Fase**, no por Categoría de pronóstico.

### 🔑 Catalyst boolean serialization inconsistente
- Catalyst devuelve booleans de forma inconsistente: a veces `true`, `"true"`, `1`, `"1"`.
- Necesario helper `isTrueish()` con default permisivo (si viene undefined/null, tratar como true).
- **Reglas normalizadas en el backend**, no delegado al frontend.

### 🔑 pipeline_stage default value en MarketingLeads
- Cuando se agregó la columna en Console, quedó con default `nuevo_lead`.
- Mi CRM freelance espera `nuevo`.
- Fix: normalizar en backend (`normalizeStage` helper) y aceptar ambos en filtros SQL.
- **Todos los leads viejos siguen funcionando** — no requiere migración.

### 🔑 Clerk publicMetadata NO viene en JWT por default
- El JWT de Clerk no incluye `publicMetadata` a menos que se configure un JWT template.
- Solución: fetch al Backend API de Clerk (`clerk().users.getUser(sub)`) cuando el JWT no trae el rol.
- Cache de 60s por usuario (Map en memoria del backend) para no golpear el API en cada request.

### 🔑 Zoho CRM tiene múltiples caminos de creación
- **Vía convertLead API** (`POST /Leads/{id}/actions/convert`) — flujo oficial: mueve el Lead a "converted" (no lo borra) + crea Account+Contact+Deal automáticamente
- **Manual** — crear Account, Contact, Deal por separado con POSTs individuales — más control pero deja el Lead original como "duplicado"
- **Pendiente** implementar convertLead para evitar duplicación en el módulo Posibles Clientes.

### 🔑 Catalyst schema limits
- Tabla puede tener max ~30 columnas antes de que Console empiece a fallar de forma extraña.
- El slot de env vars también se llena — hay que planificar (hardcoded para IDs internos no sensibles como `OWNER_ID`).

### 🔑 ZeptoMail — remitente y reply-to
- Remitente: `reportes@sharktalents.ai` (nombre "SharkTalents")
- Reply-to configurable por email — decisión pendiente si va a Cris o al freelance

### 🔑 Emails que salen del sistema — 4 caminos
1. **captureLead** (`/api/marketing/lead`) — desde landing "prueba gratis", solo si viene `send_evaluation_email: true`
2. **zohoCrmWebhook** (`/api/webhooks/zoho-crm/lead-created`) — SIN email automático (deshabilitado 2026-07-10)
3. **sendEvalToLead** (`/api/freelance/me/leads/:id/send-eval`) — manual desde botón "📧 Enviar evaluación"
4. **sendQuoteToLead** (`/api/freelance/me/leads/:id/send-quote`) — manual desde botón "💰 Enviar cotización"

Fuera de estos, ningún otro handler envía emails al lead/candidato desde SharkTalents.

---

## Decisiones arquitectónicas del día

### Decisión 1: El lead nace en Zoho, no en SharkTalents
Flujo confirmado con Cris:
```
Meta Ads → Zoho CRM (nativo) → webhook → SharkTalents
```
Zoho es el CRM central de Kuno. SharkTalents es el CRM operativo del reclutamiento — solo procesa los leads que Zoho le pasa.

### Decisión 2: Opción B — split Leads/Clientes
Análisis honesto: B es más robusto por 5 razones (modelo de dominio, bounded contexts, escalabilidad, extensibilidad, alineación con datos existentes). No es "hacer como Zoho por copiar" — es que Zoho llega al mismo patrón por las mismas razones. Cualquier CRM maduro (Salesforce, HubSpot, Pipedrive) converge al mismo split.

### Decisión 3: Sync a Zoho solo desde "Convertir a Cliente" en adelante
Etapas 1-6 (Nuevo → Cotización enviada) viven **solo en SharkTalents**. Recién en la conversión se crea Account+Contact+Deal en Zoho. Ventaja: Zoho no se ensucia con leads que nunca cierran.

### Decisión 4: Monto Deal = salario × 1.2 / Comisión freelance = salario × 0.10
Fórmulas fijas, no configurables por deal. El vendedor solo ingresa el salario del puesto.

### Decisión 5: Cotización NO va a Zoho
Es solo un email al cliente (PDF opcional). Sin registro en Zoho. Cris pidió esto explícitamente — Zoho es para deals formales, no para presupuestos preliminares.

### Decisión 6: Auto-asignación round-robin básico (Fase 3 lite)
Al recibir lead nuevo (por webhook Zoho o captureLead directo), buscar `FreelanceUser` con `activo=true` y menor `leads_asignados`. Incrementa contador. Sin WhatsApp aún — eso es Fase 3 completa.

### Decisión 7: Empresa obligatoria antes de convertir
Los leads de Meta no traen empresa. El vendedor la agrega vía botón "✏️ Editar" al primer contacto. El botón "👤 Convertir a cliente" queda deshabilitado hasta que la empresa esté cargada.

### Decisión 8: Rol Talent Operations Manager (siguiente contratación de Kuno)
- Rol consultivo, no operativo
- Descubre el DOLOR real del cargo en la reunión inicial (no solo toma dictado)
- Supervisa contenido generado por IA — cambia solo si detecta error evidente
- NO redacta desde cero, NO mueve cards en el kanban (automático)
- Reporta bugs y comportamientos raros de la IA a Cris
- Brief completo entregado a V1 (asistente de Cris) para redactar oferta LinkedIn

---

## Estado actual del sistema (post-sesión)

### Backend
- Deployado en Dev (Catalyst function `api`)
- 10+ endpoints nuevos del CRM freelance funcionando
- Integración Zoho probada end-to-end (creación de Account + Contact + Deal + Stage update)
- Smoke test aislado passing (`test-zoho-integration.ts` en scratchpad)

### Frontend
- Deployado en Dev
- 4 páginas del freelance: Inicio, Mis leads, Mis clientes, Mi perfil
- 4 modales: EditLead, ConvertToClient, SendQuote, SendEval (confirm inline)
- Layout con fondo blanco (contraste con admin dark)
- Sidebar con 4 items

### Datos
- Tabla `FreelanceUsers` (12 columnas) — 1 registro test: chrismar
- Tabla `SalesClients` (22 columnas) — vacía, esperando conversiones reales
- Tabla `MarketingLeads` — +2 leads test (Juan Pérez Test, María González)
- Zoho CRM: vista Kanban "Sharktalents" creada, mapeada a fases reales de Kuno

### Test end-to-end pendiente completar
- ✅ Auto-asign funciona con captureLead directo
- ⚠ Auto-asign vía webhook Zoho: **no verificado** con lead real
- ⚠ Sync Lead → Zoho Posibles Clientes: María González no aparece en Zoho todavía
- ⚠ Conversión Lead → Cliente: probada pero con **duplicación** en Zoho (Lead original queda + Account/Contact/Deal nuevo)
- ✅ Cotización con PDF: implementada, pendiente test visual del PDF
- ❌ Datos legales antes de contrato: **no implementado aún**
- ❌ Botón "Enviar contrato" (Zoho Sign): **no implementado aún**

---

## Pendientes para próxima sesión

### Alta prioridad
1. **Fix duplicación en conversión** — usar Zoho `POST /Leads/{id}/actions/convert` API oficial en vez de crear Account+Contact+Deal por separado. El Lead original queda como "converted" en Zoho, no duplicado.
2. **Modal "Datos Legales"** — cuando el vendedor mueve un cliente de "Cotización" → "Contrato enviado". Pide: razón social, RUC, dirección, ciudad, país, representante (nombre + cargo + cédula + email), cargo del puesto. Sync a Zoho: `Account.Nombre_de_la_Empresa`, `Account.RUC_NIT`, `Account.Billing_Street/City/Country`, nuevo Contact para el representante (Title = cargo).
3. **Botón "📄 Enviar contrato"** — solo aparece cuando `datos_legales_completos=true`. Dispara Zoho Sign (function Deluge `enviarContratoSharkTalents` ya existente en Zoho CRM).
4. **Decisión reply-to del email cotización** — Cris o el vendedor freelance

### Media prioridad
5. **Testear webhook Zoho end-to-end** — simular POST desde Zoho con lead real y verificar que auto-asigna
6. **Verificar sync MarketingLeads → Zoho Leads** — María González no aparece; puede ser que el cron del outbox no corrió o algo falló
7. **UX del kanban** — labels de urgencia (`less_30d` → "En < 30 días"), formato de salario ($ + /mes)

### Baja prioridad (Fase 3 completa)
8. **WhatsApp al freelance cuando le asignan lead** — usando Twilio (ya configurado con Sandbox `officer-proper`)
9. **Config Catalyst: redirect `/app` → `/app/`** — para evitar INVALID_URL_PATTERN cuando usuarios entran sin `/`

---

## Reglas confirmadas hoy con Cris

1. **Emails al lead solo se disparan explícitamente:**
   - Desde landing "prueba gratis" (auto-servicio del lead)
   - Desde botón "📧 Enviar evaluación" (manual, vendedor)
   - Desde botón "💰 Enviar cotización" (manual, vendedor)
   - **NUNCA** automático desde webhook Zoho ni desde captura de lead

2. **Empresa es obligatoria antes de convertir a cliente** — no permite conversión sin ella

3. **Meta no manda empresa** — el vendedor la pregunta y la agrega vía "Editar lead"

4. **Datos legales del contrato SÍ se piden** — pero al pasar a "Contrato enviado", no al convertir. En el modal separado.

5. **La cédula del representante NO existe en Zoho Contact schema** — se guarda solo local en SalesClients, se usa al armar el contrato Zoho Sign

6. **Chris Palma es Owner de todos los Deals/Accounts/Contacts** creados por el flujo freelance — hardcoded + env var opcional `OWNER_ID`

7. **Zoho es fuente única de verdad para tratos formales** — SharkTalents es fuente única para el proceso de reclutamiento operativo

---

## Riesgos conocidos

1. **Duplicación en Zoho al convertir** — bug pendiente de arreglar (fix en próxima sesión)
2. **María González no llegó a Zoho** — sync outbox puede haber fallado, hay que debuggear
3. **Fase 3 (round-robin real + WhatsApp) es simplista** — con 1 solo vendedor funciona, con múltiples habrá que refinar cooldown y equidad
4. **Zoho refresh_token pertenece a Cris García** — si él se va de Kuno o cambia credenciales, hay que regenerar
5. **Env vars de Catalyst están al cap** — hardcoding IDs internos como workaround; a mediano plazo migrar a tabla Config en Datastore
6. **Bounces de ZeptoMail** — solo se testeó con email real de Cris; cuidado con dominios inexistentes en producción

---

## Referencias

- Spec original CRM freelance: [docs/spec-crm-freelance-2026-07-09.md](../spec-crm-freelance-2026-07-09.md)
- Schema manifest: [docs/master-plan/SCHEMA_MANIFEST.json](../master-plan/SCHEMA_MANIFEST.json) — actualizado con `SalesClients`
- Backend handler CRM freelance: [functions/api/src/features/freelance.ts](../../functions/api/src/features/freelance.ts)
- Backend cliente Zoho CRM: [functions/api/src/lib/zohoCrmClient.ts](../../functions/api/src/lib/zohoCrmClient.ts) — extendido con `createAccount`, `createContact`, `createDeal`, `updateDealStage`
- Backend webhook Zoho → SharkTalents: [functions/api/src/features/zohoCrmWebhook.ts](../../functions/api/src/features/zohoCrmWebhook.ts)
- Frontend kanbans: [shark/src/pages/freelance/](../../shark/src/pages/freelance/)
