# 📱 Twilio Sandbox — Tracker de activación

Este archivo lleva el registro de cuándo se activó el join al Sandbox de Twilio (`join officer-proper` al `+14155238886`).

**Por qué importa:** el join al Sandbox de Twilio expira a las **72h sin actividad**. Si Cris pasa 3 días sin recibir ni mandar mensajes al Sandbox, los alertas de leads dejan de llegarle.

**Mitigación real:** este sistema se vuelve robusto cuando se apruebe el WhatsApp Business Sender de producción (WABA) en Twilio. Mientras tanto, hay que renovar el join cuando expire.

---

## 🕐 Último activado

| Fecha | Hora (Panamá UTC-5) | Quién hizo el join | Notas |
|---|---|---|---|
| **2026-06-19** | **19:26** | Cris (+50763333870) | **Último activado**. Pauta Meta corriendo. Volumen esperado ≤3 leads/día. |
| 2026-06-19 | ~15:00 | Cris (+50763333870) | Refrescado durante setup. |
| 2026-06-10 | 09:55 | Cris (+50763333870) | Setup inicial del Sandbox. Probamos E2E. |

---

## ⏰ Expiración exacta

**2026-06-22 (lunes) a las 19:26 (Panamá)** — exactamente 72h desde el último mensaje que VOS enviaste al Sandbox.

⚠️ **Importante**: el timer solo se resetea cuando vos mandás algo al `+14155238886`. Recibir mensajes (los lead alerts) **NO** cuenta.

---

## ♻️ Estrategia para mantener el join vivo

Cada vez que llegue un lead alert al WhatsApp, **respondé al chat de Twilio con cualquier cosa** (un "ok", un punto, una palabra). Esa respuesta resetea las 72h desde esa hora.

Si vas a recibir ≥1 lead cada 2-3 días (lo esperable con pauta corriendo), nunca debería expirar mientras hagas esto.

Si pasaste 72h sin mandar nada al Sandbox → reactivá manualmente con `join officer-proper` al `+14155238886`.

---

## 🚨 Cómo reactivar cuando expire

1. Desde tu WhatsApp (`+50763333870`), mandá al `+1 415 523 8886`:
   ```
   join officer-proper
   ```
2. Twilio responde: `✅ You are all set!`
3. Actualizá este archivo con la nueva fecha + commit
4. (Opcional) Hacé un curl al `_diag-send-whatsapp` para confirmar end-to-end

---

## 🔄 Cómo nos enteramos si expiró

Sin mucha ciencia: si pasan 24h sin ver un lead alert en tu WhatsApp Y vos sabés que entró por lo menos 1 lead (revisaste Zoho CRM), entonces probablemente el join expiró. Reactivá.

**Idea futura (~30 min de código):** un cron que cada 48h le manda un mensaje "ping" al `OPS_ALERT_PHONE` desde el Sandbox para mantener el join vivo. Pero esto AMPLIFICA el uso del Sandbox y aumenta el riesgo Twilio (ver más abajo).

---

## ⚠️ Riesgo con Twilio — análisis honesto

### Caso real de Cris (al 2026-06-19)
- Volumen esperado: **≤3 mensajes/día** (alertas de leads)
- Único receptor: Cris (vos misma, hiciste el join voluntario)
- Caso de uso: alertas operativas internas, no envío a terceros
- Recipiente: 1 número fijo, no cambia, no spam

### Veredicto
**Riesgo prácticamente cero a este volumen.** Los límites del Sandbox de Twilio que pueden disparar alertas son:
- >50 msg/día — Cris está en ≤3
- Patrones de spam (cambiar destino, contenido auto-generado masivo) — no aplica
- Múltiples sandbox participants — solo 1

Twilio podría mandar un email tipo "consideramos upgradeo a producción" si detectan uso productivo, pero:
- No te van a banear
- No te van a cobrar fees ocultos
- No tenés exposición legal

### Plan de salida
Activar el WhatsApp Business Sender (WABA) con tu número virtual cuanto antes para liberarnos del Sandbox. Apenas tengas el sender aprobado:
1. Setear `TWILIO_WHATSAPP_FROM` al número real en Catalyst Console
2. Acabar el workaround del join cada 72h
3. Habilitar templates aprobadas para mandar a leads directamente (no solo alertas a Cris)
