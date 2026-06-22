# Roadmap SharkTalents V2 — Snapshot 2026-06-22 (lunes)

Reemplaza a `PENDIENTES_2026-06-19.md`. Cierre del día con lo acumulado del fin de semana + lunes.

---

## 🎯 Meta única: primer cliente real cerrado

| # | Hito | Estado 19-jun | Estado 22-jun |
|---|---|---|---|
| 1 | **Comparativo funcionando** | 🟢 ~95% validado E2E | 🟢 95% (sin cambios) |
| 2 | **Production en Catalyst** | 🔴 Sin iniciar | 🔴 Sin iniciar |
| 3 | **WhatsApp Twilio** | 🟡 Sandbox E2E real | 🟢 **WABA Sender registrado (en revisión Meta)** |
| 4 | **Videos del candidato** | 🔴 Bloqueado decisión | 🔴 Sin cambios |
| 5 | **Mensajes de venta calibrados** (nuevo hito que surgió esta semana) | 🆕 | 🟡 36 mensajes redactados, review con Cristian pendiente |

---

## ✅ Cerrado entre 20-22 jun

### Twilio / WhatsApp
- Bug fixed: webhook Zoho CRM no traía `phone` → ahora acepta `mobile/Mobile/phone/Phone/whatsapp/WhatsApp` con fallback case-insensitive
- Backend setea `Phone` Y `Mobile` en createLead (Cris workflow Zoho mapea Móvil)
- Endpoint `_diag-crm-push` acepta `lead_source` para tests
- Endpoint `_diag-set-stage` agregado para mover candidatos a finalist en specs E2E
- **WABA Sender `+5078338754` registrado** en Twilio (en revisión Meta, status Offline)
- **Plantilla `lead_alerta_cris` creada** en Twilio Content Builder con 6 variables + samples
- Pago configurado en Meta Business Manager (línea de crédito Twilio)

### Flujo de leads completo
- Stack end-to-end validado: Form Meta → Zoho CRM → workflow → SharkTalents → email + WhatsApp alerta
- Workflow Zoho `Enviar PC a shark` con parámetros `dolor` y `puesto` agregados
- Backend acepta `dolor` y `role`/`puesto` en webhook + los guarda en `MarketingLeads`
- Columnas `dolor` y `puesto` creadas en tabla `MarketingLeads` por Cris
- Lead Chain mapea Q3 (desafío) → `Dolor del cliente` y Q4 (rol) → `puesto`
- Email `meta_lead_welcome` reescrito a tono "Cris te contacta hoy" (sin "agenda 15 min")
- Maricela Barba y Francisco Elias contactados manualmente por Cris (recuperados)

### Mensajes calibrados (nuevo)
- 36 mensajes redactados: 3 dolores × 4 roles × 3 variantes filosóficas
  - V1 "Dolor declarado + pregunta de consecuencia" (estilo Cristian)
  - V2 "Empatía + dato"
  - V3 "Pregunta de discriminación con 2 opciones" (aporte de Cris)
- Todos en tuteo neutro LatAm (sin voseo, sin contracciones)
- HTML interactivo `docs/review-mensajes-2026-06-22.html` con:
  - localStorage para persistir decisiones
  - Botones Aprobar/Rechazar/Pendiente por mensaje
  - Comentarios opcionales por mensaje
  - Descarga JSON al final

### Memoria + comunicación
- 4 reglas de comunicación directa guardadas en memoria persistente
- 3 reglas adicionales "asesor no asistente" guardadas
- Tracker Twilio Sandbox documentado (`docs/TWILIO_SANDBOX_TRACKER.md`)

---

## 🎯 Hitos detallados

### 1. 🟢 Comparativo funcionando — ~95% (sin cambios desde 19-jun)

**Pendiente:**
- Score por competencia por candidato (~4h, requiere refactor generador IA)
- Botón "Duda CV" en bloques de decisión (~1h)

**No es bloqueante para primer cliente.**

### 2. 🔴 Production en Catalyst (sigue pendiente — agendado desde el 19-jun)

Mismo plan, Cris ejecuta en Console (~30 min):
1. Crear Environment Production
2. Crear cuenta ZeptoMail test
3. Setear env vars de PROD (secrets generados en commit `644d2db`)
4. Primer deployment DEV→PROD
5. Conectar `app.sharktalents.ai` a PROD

**Doc:** `docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md`

### 3. 🟡 WhatsApp Twilio — esperando aprobaciones Meta

**Lo que falta para mensajes a Cris funcionen vía número virtual:**

| # | Tarea | Tiempo | Quién |
|---|---|---|---|
| 1 | Esperar que Meta termine revisión del Sender (Offline → Online) | 24-72h desde hoy | Meta automático |
| 2 | Submit plantilla `lead_alerta_cris` cuando Sender = Online | 30 seg | Cris (click) |
| 3 | Meta aprueba plantilla | 24-48h post-submit | Meta automático |
| 4 | Cambiar `TWILIO_WHATSAPP_FROM` en Catalyst de Sandbox al virtual | 10 min | Yo |
| 5 | Test E2E con lead falso | 10 min | Yo + Cris |

**Total realista hasta poder mandar desde número virtual:** 2-5 días.

**Lo que falta para mensajes a candidatos/clientes (no a Cris):**
- Plantillas adicionales (UTILITY): `evaluacion_lista_candidato`, `recordatorio_evaluacion`, `reporte_listo_cliente`
- Decisión de auto-respuesta a clientes que respondan al número virtual (Twilio Conversations Inbox vs auto-reply vs ignorar)
- Submit + aprobación Meta de cada plantilla nueva

**Cris dijo: "Twilio NO es para conversación con cliente, solo notificaciones unidireccionales".** Cuando un cliente responda, la opción más simple es auto-reply: "Línea automatizada. Para hablar conmigo escribime al +XXXX (WhatsApp Business)".

### 4. 🔴 Videos del candidato (bloqueado)

Sin cambios desde 19-jun. Cris decide servicio (OpenAI Whisper / Deepgram / ElevenLabs).

### 5. 🟡 Mensajes calibrados (NUEVO hito que surgió esta semana)

**Pendientes:**
- [ ] Cristian revisa los 36 mensajes en `docs/review-mensajes-2026-06-22.html`
- [ ] Cris me manda el JSON con aprobados/rechazados/comentarios
- [ ] Yo refino los mensajes según feedback
- [ ] Integro el prompt al backend (handler `zohoCrmWebhook.ts` llama a Claude Haiku para generar `{{6}}` dinámico)
- [ ] Plantilla `lead_alerta_cris` aprobada → backend la usa con las 6 variables

---

## 📋 Pendientes operativos de Cris (no código)

| Pendiente | Por qué |
|---|---|
| Borrar leads de prueba en Zoho CRM (3-4 acumulados) | Limpieza |
| Mantener join Twilio Sandbox vivo hasta que Sender Online | Para que NO se rompa el flujo actual de alertas mientras esperamos WABA |
| Cristian revisa 36 mensajes y descarga JSON | Para integrar al backend |
| Crear más plantillas en Twilio (candidato/cliente) | Para flujos futuros |
| Decidir servicio video (OpenAI / Deepgram / ElevenLabs) | Para arrancar implementación video |
| PROD setup en Catalyst Console | Salir de "todo en Development" |

---

## 🆕 Aprendizajes del último ciclo (importantes para futuras sesiones)

### Stack lead Meta → Backend funcionando real
- Form Meta tiene 4 preguntas calificadoras + datos básicos
- Lead Chain pasa todo a Zoho CRM (mapeo manual de campos en su UI)
- Workflow Zoho `Enviar PC a shark` dispara webhook con secret en query string
- Backend acepta múltiples nombres de campos vía `pickField()` helper

### Decisiones de producto tomadas esta semana
- **Cris elimina** `has_vacancy` y `had_bad_hire` del modelo (Q1 y Q2 del form). Solo dolor + puesto se persisten.
- **Auto-rechazo** de "Presupuesto limitado" y "Otro" en rol: Cris decidió NO implementarlo en backend ("queda como está") — todos los leads se procesan igual.
- **Twilio = solo emisión**, no conversación. Auto-reply a quien responda.

### Reglas de comunicación de Cris (memoria persistente)
- Discrepar estructurado (razón + alternativa + riesgo)
- Verdad incómoda primero
- Sin párrafos de intro vacíos
- No ceder bajo "pero yo creo que..." sin info nueva
- Etiquetar [Seguro] / [Probable] / [Suposición] en conclusiones clave
- Sin frases prohibidas: "buena pregunta", "tienes toda la razón", "eso tiene mucho sentido", "por supuesto", "definitivamente"

---

## Stats últimos 4 días (19-22 jun)

- **Commits:** ~10 (de `ca53f4f` al actual)
- **Deploys backend:** ~8
- **Deploys frontend:** 0 (todo este ciclo fue backend + config externa)
- **Docs nuevos:** 2 (HTML review mensajes + TWILIO_SANDBOX_TRACKER)
- **Memorias nuevas:** 2 reglas de comunicación + 1 contexto Twilio
- **Leads reales entrantes:** 4-5 (Maricela, Francisco, Larisa, +1-2)
- **Pauta Meta gastada:** ~$340 acumulada en últimos 7 días
- **Plantillas Twilio:** 1 creada, 0 aprobadas todavía

---

## ¿Cómo leer este documento en sesión nueva?

1. **Si retomás:** lee la "Meta única" + estado de 5 hitos. Eso es lo crítico.
2. **El siguiente paso lógico hoy:** esperar aprobaciones Meta (Sender + Plantilla). Mientras tanto:
   - PROD setup en Catalyst (Cris ejecuta)
   - Review de 36 mensajes con Cristian
   - Crear más plantillas en Twilio para flujos futuros
3. **No prioridad ahora:** Video del candidato (bloqueado por decisión servicio), Score por competencia (post-MVP).
