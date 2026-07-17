# Handoff: Landing `/evalua-tu-finalista`

**Para:** Cristian / Claude que maneja `sharktalents.ai`
**De:** Chris Palma + Claude backend SharkTalents
**Fecha:** 2026-07-13
**Estado backend:** en desarrollo — endpoint listo para consumir aprox. el 2026-07-14

---

## 1. Contexto de negocio

SharkTalents está haciendo un **pivot de posicionamiento** en su oferta de entrada:

**Antes (`/lead-magnet` — se mantiene intacto):**
> "Evaluá gratis a alguien de tu equipo actual"

Fricción alta: el empleador tiene que convencer a alguien de su equipo actual de hacer 90 minutos de pruebas sin razón clara para esa persona.

**Ahora (`/evalua-tu-finalista` — nuevo):**
> "Antes de firmar a tu finalista, evaluálo gratis"

Fricción baja: el candidato finalista está **motivado** (quiere el puesto), pone los 90 min con gusto. El empleador solo da un nombre + email = 5 min.

**Las dos landings conviven** — son dos puertas de entrada distintas al mismo funnel de SharkTalents.

---

## 2. Qué implementar

### 2.1 Página nueva

Ruta: `/evalua-tu-finalista`
Ruta post-submit: `/evalua-tu-finalista/confirmacion`

### 2.2 Copy central

**Headline:**
> Antes de firmar a tu finalista, evalúalo gratis

**Subtexto:**
> ¿Vas a contratar a alguien para un puesto clave? Mándanos a tu candidato favorito y te entregamos su evaluación de conducta, cognición, integridad, técnica y entrevista IA antes de que hagas la oferta. Si el reporte no te dice nada nuevo, no perdiste nada. Si te revela algo, te acabas de ahorrar una mala contratación.

### 2.3 Formulario — sin fricción, sin quiz previo

| Campo | Tipo | Requerido |
|---|---|---|
| Nombre del candidato finalista | text | Sí |
| Correo del candidato | email | Sí |
| WhatsApp del candidato | tel (E.164) | Sí |
| Puesto al que aplica | text | Sí |
| Correo del empleador | email | Sí |
| WhatsApp del empleador | tel (E.164) | Sí |
| Checkbox de consentimiento | checkbox | Sí (debe marcarse) |

**Texto del checkbox de consentimiento:**
> Confirmo que informaré al candidato que va a recibir una invitación de evaluación como parte del proceso de selección.

### 2.4 Captcha

Turnstile (Cloudflare) — igual que el formulario actual del lead magnet. Reusar el mismo site key.

---

## 3. Contrato del endpoint (API)

### URL

**DEV:**
```
POST https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/api/marketing/eval-request
```

**PROD (cuando promuevan):**
```
POST https://app.sharktalents.ai/server/api/api/marketing/eval-request
```

### Headers

```
Content-Type: application/json
X-Marketing-Site-Key: <MARKETING_SITE_KEY>   ← el mismo que ya usa la landing
```

### Body

```json
{
  "flow": "finalist",
  "create_lead_if_missing": true,
  "captcha_token": "<turnstile-token>",

  "lead_email": "empleador@empresa.com",
  "empleador_whatsapp": "+50761234567",

  "puesto": "Gerente comercial",

  "member_to_evaluate": {
    "full_name": "Juan Pérez Testigo",
    "email": "juan@candidato.com",
    "consent_obtained": true,
    "whatsapp": "+50767889900"
  }
}
```

**Notas sobre el body:**

- `"flow": "finalist"` — obligatorio, distingue este flujo del `/lead-magnet` viejo. Sin este flag el backend asume flujo antiguo.
- `"create_lead_if_missing": true` — obligatorio para `/evalua-tu-finalista`. Le dice al backend que cree el lead sin quiz si no existe (el flujo antiguo pedía quiz previo). Sin este flag y sin lead previo, la request falla con 404.
- `"lead_email"` — el email del empleador (persona que llena el form)
- `"member_to_evaluate.email"` — el email del candidato finalista
- `"consent_obtained"` — debe ser `true` (checkbox marcado). Si no lo mandan, 400.
- Los WhatsApp deben venir en formato **E.164** (`+50761234567`). Validar en frontend.

### Respuesta exitosa (200)

```json
{
  "ok": true,
  "lead_id": "28606000001091456",
  "result_id": "28606000001096488",
  "message": "Invitación enviada al candidato"
}
```

Después de esto, el backend automáticamente:
1. Envía email al **candidato** con link firmado a las pruebas (30-40 min conductual + 20-30 min integridad)
2. Cuando el candidato termina, dispara email al **empleador** con el reporte

### Errores posibles

| Status | Código | Cuando |
|---|---|---|
| 400 | `validation_error` | Falta campo obligatorio, email inválido, consent_obtained no es true |
| 403 | `invalid_captcha` | Turnstile falló o no vino el token |
| 429 | `rate_limit` | Demasiadas requests desde el mismo IP |
| 503 | `table_not_ready` | Tabla MarketingLeads aún no provisionada (no debería pasar en prod) |

**Formato de errores:**
```json
{
  "error": {
    "code": "validation_error",
    "message": "El email del candidato es inválido"
  }
}
```

---

## 4. Página de confirmación `/evalua-tu-finalista/confirmacion`

Sugerido:

> ✅ Listo. Le enviamos las pruebas por email a **{nombre_candidato}**.
>
> Cuando termine (30-40 min conductual + 20-30 min de integridad), vamos a analizarle todo y te enviamos el reporte a **{email_empleador}**.
>
> Normalmente el reporte llega en 24-48 horas después de que el candidato completa las pruebas. Si querés apurarlo, mandale un WhatsApp al candidato recordándole.

Botón: "Volver al home"

---

## 5. Criterios de aceptación

- [ ] Página `/evalua-tu-finalista` responsive (mobile + desktop)
- [ ] Misma identidad visual del sitio (misma tipografía, colores, header, footer)
- [ ] Formulario funciona sin quiz previo
- [ ] Validación cliente: email format, WhatsApp E.164, checkbox obligatorio
- [ ] Captcha Turnstile funciona
- [ ] POST al endpoint con `flow: "finalist"` y `create_lead_if_missing: true`
- [ ] Manejo de errores del backend (mostrar mensaje amigable al usuario)
- [ ] Redirect a `/evalua-tu-finalista/confirmacion` con éxito
- [ ] `/lead-magnet` viejo NO se toca — sigue funcionando igual

---

## 6. Testing manual (antes de anunciar)

**Test 1 — Happy path:**
1. Cargar página nueva
2. Llenar todos los campos correctamente
3. Marcar consentimiento
4. Resolver captcha
5. Submit → debe redirigir a confirmación
6. Verificar en el email del "candidato" que llegó el email de invitación

**Test 2 — Consentimiento:**
1. Llenar formulario pero NO marcar consentimiento
2. Submit → debe mostrar error o botón deshabilitado

**Test 3 — Email inválido:**
1. Poner "no-es-email" en cualquiera de los 2 emails
2. Submit → error inline

**Test 4 — Regresión (`/lead-magnet` viejo):**
1. Ir a `/lead-magnet`
2. Completar el flujo antiguo
3. Debe funcionar exactamente como antes

---

## 7. Coordinación con Chris

- **Chris (backend):** deploy del endpoint modificado ~ 2026-07-14
- **Cristian (frontend/landing):** implementación de la página en paralelo (podés desarrollar contra mock antes del deploy)
- **QA conjunta:** cuando ambas partes estén listas, hacemos el test E2E de los 4 casos de arriba antes de anunciar

Dudas o bloqueos técnicos → contactar a Chris Palma directo.

---

## 8. Fuera de scope de este handoff

- Página `/lead-magnet` viejo (no se toca)
- Dashboard admin de SharkTalents (Chris lo actualiza aparte)
- Playbook de outbound de LinkedIn (SOP separado que ya tiene Cristian)
- Sync a Zoho CRM (automático, sin cambios)
