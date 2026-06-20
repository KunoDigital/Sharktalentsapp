# Roadmap SharkTalents V2 — Cierre 2026-06-19 (viernes)

Snapshot final del día. Reemplaza la versión de la mañana.

---

## 🎯 Meta única: llegar al primer cliente real funcionando

| # | Hito | Estado mañana | Estado fin de día |
|---|---|---|---|
| 1 | **Comparativo funcionando** | 🟡 Construido, sin validar | 🟢 **~95% — validado E2E con datos reales** |
| 2 | **Production en Catalyst** | 🔴 Sin iniciar | 🔴 Pendiente para hoy lunes (Cris) |
| 3 | **WhatsApp candidato/leads** | 🔴 Bloqueado (creía Meta directo) | 🟢 **Sandbox Twilio funcionando E2E real. WABA pendiente para mensajes a leads** |
| 4 | **Videos del candidato** | 🔴 Bloqueado | 🔴 Pendiente decisión servicio |

**Progreso del día:** ~80% del hito 1 (Comparativo) + ~70% del hito 3 (Twilio) cerrados.

---

## ✅ Cerrado HOY (2026-06-19) — 17 commits

### Comparativo (8 piezas grandes)
- **Tooltips en términos técnicos** del reporte cliente (glosario extendido con 9 términos)
- **Endpoint diag `_diag-set-stage`** para mover candidatos a finalist desde spec
- **Spec extendido** con 2 finalists para validar Comparativo con datos reales
- **Fix contraste** — elimina grises claros sobre blanco
- **Desglose detallado:** PK + DISC 4 ejes + VELNA 5 dims + score emocional + 13 dims integridad
- **Integridad dimensions fix** — Comparativo ahora usa las de readScores (antes vacías)
- **DISC realista** en spec (12/4/4/4 = perfil D; antes 14/14/14/14 = 100% absurdo)
- **Refactor estilo V1** completo:
  - Header con pills (verde/rojo) + botón "Preparar reporte para cliente"
  - DISC Perfil Ideal A/B con barras color + arquetipos PK
  - VELNA Perfil Ideal con barras horizontales
  - Emoción slider continuo Espontáneo ↔ Reflexivo
  - Aspiración salarial real
  - Anti-trampa por fase
  - Bloques de decisión con botones (Siguiente etapa / Rechazar / Llamar a entrevista / Rechazo total)

### Backend (4 features grandes)
- **PK profile calculation** on-the-fly en `readScores` (los 27 arquetipos en `lib/pkProfiles.ts`)
- **Salary aspiration** propagado desde Candidates en `readScores`
- **Anti-cheat events por fase** agrupados en `readScores`
- **Endpoint diag `_diag-set-stage`** + extensión `_diag-crm-push` con `lead_source`

### Twilio + Leads (4 piezas)
- **Twilio Sandbox validado E2E** end-to-end real (lead Zoho CRM → webhook → backend → WhatsApp)
- **Env vars `TWILIO_*` + `OPS_ALERT_PHONE`** tipados en `env.ts`
- **Handler WhatsApp alerta** a Cris cuando entra lead (en `zohoCrmWebhook.ts` Y `marketing.ts`)
- **Email `meta_lead_welcome` reescrito** — quita "agenda 30 min", pone "Cris te contacta hoy"

### Docs y tracking
- **`docs/TWILIO_SANDBOX_TRACKER.md`** — registro del join, análisis riesgo, plan de salida
- **Memoria actualizada:** `project_twilio_sandbox_setup.md` con confirmación workflow Zoho

---

## 🎯 Hitos detallados

### 1. 🟢 Comparativo funcionando — ~95%

**Lo que falta:**
- ❌ Score por competencia por candidato (requiere refactor del generador IA de preguntas técnicas para que cada pregunta tenga tag de competencia). ~3-4h cuando se priorice.
- ❌ Botón "Duda CV" en bloques de decisión (no mapea a un stage del state machine; requiere flag `needs_review_reasons` separado). ~1h.

**Decisión:** ambas piezas son nice-to-have; el Comparativo ya es vendible al cliente sin esto.

### 2. 🔴 Production en Catalyst (mañana — agendado)

**Lo que falta:**
- Cris ejecuta en Console (~30 min activos):
  1. Crear Environment Production
  2. Crear cuenta ZeptoMail test
  3. Setear env vars de PROD (los 8 secrets nuevos generados están en commit `644d2db`)
  4. Primer deployment DEV→PROD
  5. Conectar `app.sharktalents.ai` a PROD

**Doc completo:** [docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md](docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md)

### 3. 🟢 WhatsApp Twilio — flujo leads alertas funcionando

**Lo que SÍ funciona hoy:**
- Sandbox Twilio activo (join `officer-proper`, vence lunes 22-jun 19:26 si Cris no manda nada al Sandbox antes)
- Flujo end-to-end validado: lead crea en Zoho → webhook a SharkTalents → email + WhatsApp alerta a Cris
- Cris responde manual al cliente desde su WhatsApp Business

**Lo que falta:**
- 🚧 **Aprobar WhatsApp Business Sender (WABA)** con el número virtual de Cris. Proceso 5-7 días:
  1. Twilio Console → Senders → Create WhatsApp Sender
  2. Conectar Facebook Business Manager
  3. Verificar número virtual
  4. Twilio + Meta lo aprueban
- 🚧 **Submit plantilla `meta_lead_welcome`** a Meta (botón se habilita después del sender aprobado)
- 🚧 **Decisión final** del mensaje que Cris envía manual al cliente (5 opciones de "pregunta importante" propuestas, Cris define después con Cristian)

**Cuando se apruebe WABA, en código son ~30 min:**
- Cambio `TWILIO_WHATSAPP_FROM` al número real
- Activo el envío automatizado a leads (no solo alertas a Cris)

### 4. 🔴 Videos del candidato

**Bloqueador interno:** decisión de servicio. Cris decide entre:

| Servicio | Costo audio | Calidad | Tiempo implementar |
|---|---|---|---|
| OpenAI Whisper + Claude | $0.006/min | Alta | ~15h |
| Deepgram | $0.0043/min | Alta + rápido | ~20h |
| ElevenLabs Scribe | $0.0067/min | Muy alta + voces | ~25h |

Sin decisión, ~25h potenciales mal tirados.

---

## 📋 Pendientes operativos (no código)

| Pendiente | Quién | Cuándo |
|---|---|---|
| Borrar lead `test-meta-lead-2026-06-19@gmail.com` de Zoho CRM | Cris | Cuando puedas |
| Mantener join Twilio Sandbox vivo (responder al chat de Twilio) | Cris | Cada alert que llegue |
| Activar WABA en Twilio Console | Cris | Esta semana |
| Decidir "pregunta importante" del mensaje al cliente | Cris + Cristian | Esta semana |
| Decidir servicio video | Cris | Cuando se priorice video |

---

## 🟢 Cosas que NO bloquean primer cliente (post-meta)

| Pendiente | Tiempo |
|---|---|
| Score por competencia + sección en Comparativo | ~4h |
| Botón "Duda CV" en bloques de decisión | ~1h |
| Bot decisor entrenado con datos reales | ~6h |
| Mindset mismatch alert | ~3h |
| Cleanup wipe-all-test-data | 5 min |

---

## Stats finales del día (ayer + hoy)

- **Commits últimos 2 días:** ~22 (5ee2007 → 63e66cb)
- **Deploys backend hoy:** 8
- **Deploys frontend hoy:** 6
- **Tests pasando:** ~1100+
- **Líneas de código netas:** +2500 / -800 aprox
- **Memorias actualizadas:** twilio sandbox setup, contexto aislamiento, env-related

---

## ¿Cómo leer este documento en sesión nueva?

1. **Si estás retomando:** lee la sección "Meta única" arriba y el estado fin de día. Eso es todo lo que importa.
2. **Si querés avanzar:** el siguiente paso lógico es **PROD setup en Catalyst** (Cris ejecuta) + **WABA en Twilio** (Cris arranca el proceso).
3. **Si dudas si algo es prioritario:** si no está en los 4 hitos, no es prioritario para llegar a cliente.
