# Marketing Funnel — Brief técnico para el dev de la landing

**Audiencia:** desarrollador (humano o agente IA) que va a construir el repo separado de la landing.
**Status:** Brief de integración. La plataforma backend NO está implementada todavía — este doc define el contrato que el dev de la landing puede asumir.
**Última actualización:** 2026-05-02

> **Antes de empezar a leer:** este documento describe cómo se conecta una landing externa
> a la plataforma SharkTalents (Zoho Catalyst Advanced I/O + React + Clerk multi-tenant).
> La landing vive en repo separado, hosting separado (Cloudflare Pages / Vercel / similar),
> codebase separado. La plataforma expone endpoints públicos para que la landing pueda
> capturar leads y disparar evaluaciones gratuitas sin necesitar auth de Clerk.

---

## 1. Resumen del flujo

```
┌─────────────────┐
│  LANDING (Astro)│
│  marketing.com  │
└────────┬────────┘
         │
         │ ① POST /api/marketing/lead
         │    { email, quiz_data, ... }
         │
         ▼
┌────────────────────────────────────────┐
│   PLATAFORMA (Catalyst Advanced I/O)   │
│   api.sharktalents.ai                  │
│                                        │
│   ┌────────────────┐                   │
│   │ MarketingLeads │                   │
│   └────────┬───────┘                   │
│            │                           │
│   ┌────────┴────────┐                  │
│   │ outbox events   │                  │
│   │  • Zoho CRM     │                  │
│   │  • Email lead   │                  │
│   └─────────────────┘                  │
│                                        │
│   ② POST /api/marketing/eval-request   │
│      → crea Candidate + Result         │
│      → firma token                     │
│      → email al miembro a evaluar      │
│                                        │
│   ③ GET  /api/marketing/lead-status    │
│      ← landing puede preguntar estado  │
│                                        │
│   ④ /test/<token>  (ya existe)         │
│      Test público (DISC + Integridad)  │
│                                        │
│   ⑤ /marketing/demo-report/<token>     │
│      Reporte para el lead              │
└────────────────────────────────────────┘
```

---

## 2. Endpoints que la landing va a consumir

### 2.1. `POST /api/marketing/lead`

**Propósito:** capturar el lead al final del quiz. Idempotente por email — si el mismo email manda 2 veces, hace UPSERT.

**Request:**
```http
POST https://api.sharktalents.ai/api/marketing/lead
Content-Type: application/json
X-Marketing-Site-Key: <key pública compartida — anti-spam, NO es secreto>
X-Visit-Id: <UUID generado client-side al cargar la landing>

{
  "email": "juan@empresa.com",
  "contact_name": "Juan Pérez",
  "company": "ACME SRL",
  "whatsapp": "+50760001234",
  "quiz_data": {
    "puesto_tipo": "gerencia_mando_medio",
    "proceso_actual": "intuicion",
    "historial_error": "si_reinicio",
    "urgencia": "less_30d",
    "salario_target": 1500
  },
  "calculator_data": {
    "salario_reclutador": 2000,
    "salario_entrenador": 2500,
    "salario_puesto": 1500,
    "estimado_riesgo_min": 9000,
    "estimado_riesgo_max": 27000,
    "fee_sharktalents": 1800
  },
  "source": "meta_ads",
  "utm_source": "facebook",
  "utm_medium": "cpc",
  "utm_campaign": "lead_magnet_2026q2",
  "utm_content": "video_dolor_v1",
  "utm_term": "contratacion-panama",
  "consent_marketing": true
}
```

**Response 201 (Created):**
```json
{
  "lead_id": "lead_a8f3c2",
  "message": "Lead capturado correctamente",
  "next_action": "show_eval_offer",
  "eval_request_endpoint": "/api/marketing/eval-request",
  "rate_limit": { "remaining": 4, "reset_at": "2026-05-02T15:30:00Z" }
}
```

**Response 200 (Updated — email ya existía):**
```json
{
  "lead_id": "lead_a8f3c2",
  "message": "Lead actualizado",
  "next_action": "resume_funnel",
  "lead_status": "eval_requested"
}
```

**Errores:**
- `400` — email inválido / quiz_data faltante / consent_marketing=false
- `409` — conflicto raro (no debería pasar con UPSERT)
- `429` — rate limit excedido (5 leads/min por IP, 100/día)
- `503` — backend down → la landing **debe** guardar en localStorage y reintentar

**Validaciones backend:**
- `email` — regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- `quiz_data.urgencia` — enum estricto: `less_30d` | `1-3m` | `3m+` | `exploring`
- `quiz_data.salario_target` — número entre 100 y 50000
- `consent_marketing` — debe ser `true` literal (no truthy, no string)
- `company` — sanitizado de XSS, max 255 chars
- `utm_*` — max 255 chars cada uno, alfanumérico + `-_.`

---

### 2.2. `POST /api/marketing/eval-request`

**Propósito:** el lead pidió evaluar gratis a un miembro de su equipo. Crea Candidate + Result + manda email al evaluado.

**Request:**
```http
POST https://api.sharktalents.ai/api/marketing/eval-request
Content-Type: application/json
X-Marketing-Site-Key: <key>
X-Visit-Id: <mismo UUID que el lead>

{
  "lead_email": "juan@empresa.com",
  "member_to_evaluate": {
    "full_name": "Carlos Méndez",
    "email": "carlos@empresa.com",
    "role": "Gerente de operaciones",
    "consent_obtained": true
  },
  "captcha_token": "<Cloudflare Turnstile token>"
}
```

**Response 200:**
```json
{
  "request_id": "evreq_b2d4e1",
  "message": "Le mandamos un email a carlos@empresa.com con el link del test. Cuando termine, te avisamos por email a juan@empresa.com.",
  "estimated_time_minutes": 35,
  "test_expires_at": "2026-05-09T15:00:00Z"
}
```

**Errores:**
- `400` — datos inválidos / consent_obtained=false / mismo email que lead
- `404` — lead_email no existe en MarketingLeads (debe llamar /lead primero)
- `409` — ese miembro ya tiene una eval pendiente para este lead
- `422` — captcha falló
- `429` — rate limit (max 3 eval-requests por lead)

**Importante:**
- El email del miembro NO debe ser el mismo que el del lead (validación obvia para evitar self-eval con info confidencial)
- `consent_obtained` debe venir `true` — la landing es responsable de mostrar texto al lead "confirmo que tengo permiso de mi colaborador para evaluarlo"

---

### 2.3. `GET /api/marketing/lead-status`

**Propósito:** la landing puede preguntar el estado del lead para mostrar UI personalizada en visitas posteriores.

**Request:**
```http
GET https://api.sharktalents.ai/api/marketing/lead-status?email=juan%40empresa.com
X-Marketing-Site-Key: <key>
```

**Response 200 (existe):**
```json
{
  "exists": true,
  "lead_status": "eval_completed",
  "eval_completed_at": "2026-05-02T18:30:00Z",
  "demo_report_url": "https://app.sharktalents.ai/#/marketing/demo-report/<token>",
  "call_booking_url": "https://calendly.com/sharktalents/30min?prefill_email=juan@empresa.com"
}
```

**Response 200 (no existe):**
```json
{
  "exists": false
}
```

**Por qué no devuelvo 404 si no existe:** la landing usa esta info para decidir UI. 404 confunde a Sentry/error monitoring. Mejor 200 con `exists: false`.

**Importante (privacidad):**
- Este endpoint **no** revela datos del lead al que pregunta (no devuelve nombre, empresa, etc.)
- Solo devuelve estado del funnel para que la landing personalice mensajes
- Rate-limited fuerte: 30 requests/min por IP para evitar enumeration de emails

---

### 2.4. `DELETE /api/marketing/lead`

**Propósito:** GDPR / Ley Panamá right to be forgotten.

**Request:**
```http
DELETE https://api.sharktalents.ai/api/marketing/lead
Content-Type: application/json

{
  "email": "juan@empresa.com",
  "deletion_token": "<token recibido por email tras pedir baja>"
}
```

El flujo es 2-step:
1. `POST /api/marketing/lead/request-deletion { email }` → manda email con token
2. `DELETE /api/marketing/lead { email, deletion_token }` → confirma y borra

---

## 3. Auth y seguridad

### 3.1. `X-Marketing-Site-Key`

- **Es público.** Va a estar en el bundle JS de la landing. No lo trates como secreto.
- Sirve para que el backend identifique de dónde viene el request (rate limit por site, no por usuario)
- Si se filtra → rotás la key y redeployás landing
- Generación: `scripts/generate-secret.sh` en el repo plataforma → variable `MARKETING_SITE_KEY` en env

### 3.2. Captcha (Cloudflare Turnstile)

- Recomendado en `eval-request` (es el endpoint más caro — crea Candidate + manda email + dispara Anthropic eventualmente)
- Site key pública en la landing
- Secret key en env del backend (`TURNSTILE_SECRET_KEY`)
- Backend valida llamando a `https://challenges.cloudflare.com/turnstile/v0/siteverify`

### 3.3. CORS

El backend va a tener:

```ts
const ALLOWED_ORIGINS = [
  'https://sharktalents.ai',
  'https://www.sharktalents.ai',
  'https://staging.sharktalents.ai',
  'http://localhost:4321'  // Astro dev
];
```

La landing **debe** mandar `Origin: https://...` válido. No vale `*`.

### 3.4. Honeypot

La landing puede agregar un input invisible `<input name="website" tabindex="-1" autocomplete="off" style="display:none">`. Si llega con valor → bot. Backend chequea ese campo y descarta silenciosamente (200 OK pero no inserta).

### 3.5. Rate limiting

- `POST /api/marketing/lead`: 5/min por IP, 100/día por IP
- `POST /api/marketing/eval-request`: 3/hora por IP, 10/día por lead_email
- `GET /api/marketing/lead-status`: 30/min por IP

Header de respuesta:
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 1714672800
```

---

## 4. Tokens firmados (links de email)

### 4.1. Link al test (para el miembro evaluado)

Cuando se crea el `eval-request`, el backend manda email a `member_to_evaluate.email` con:

```
https://app.sharktalents.ai/#/test/<TOKEN>
```

El token es HMAC-SHA256 con payload:
```json
{
  "kind": "test",
  "ref": "<result_id>",
  "exp": 1715864400,
  "iat": 1714654800
}
```

TTL: 7 días. La landing **NO** genera estos tokens — solo el backend.

### 4.2. Link al reporte demo (para el lead)

Cuando el miembro termina el test, backend manda email al `lead_email` con:

```
https://app.sharktalents.ai/#/marketing/demo-report/<TOKEN>
```

Token HMAC con:
```json
{
  "kind": "marketing_demo_report",
  "ref": "<lead_id>",
  "exp": 1717592400,
  "iat": 1714654800
}
```

TTL: 30 días. Tras expirar, el lead pide otro link a través de `POST /api/marketing/lead/resend-report`.

### 4.3. Esta ruta `/marketing/demo-report/<token>` vive en la PLATAFORMA, no en la landing

Por qué: el reporte tiene que mostrar datos reales (DISC scores, narrativas IA, gráficos) que vienen del backend. La landing es para captación; el reporte es producto. Cuando el lead hace click en el email → sale de la landing, entra a la plataforma.

**El dev de la landing no necesita implementar esta página.** Solo asegurarse que cuando llame a `/eval-request`, el backend devuelve el placeholder de URL para mostrar al lead "te mandamos un email — cuando termine el test recibirás otro con el link al reporte".

---

## 5. Tracking y analytics

### 5.1. IDs que la landing genera y reusa

Al cargar la página, generar UUIDs y persistir en `localStorage`:

```js
const visitId = localStorage.getItem('st_visit_id') || crypto.randomUUID();
const sessionId = sessionStorage.getItem('st_session_id') || crypto.randomUUID();
localStorage.setItem('st_visit_id', visitId);
sessionStorage.setItem('st_session_id', sessionId);
```

Mandar `X-Visit-Id: <visitId>` y `X-Session-Id: <sessionId>` en TODOS los requests al backend. Esto permite reconciliar Pixel/GA4 events con eventos backend.

### 5.2. Meta Pixel + Conversion API

La landing dispara Pixel client-side:
```js
fbq('track', 'Lead', { content_name: 'quiz_completed', value: 1.0, currency: 'USD' });
```

El backend dispara Conversion API server-side (más confiable, no bloqueado por adblockers):
- Cuando crea lead → evento `Lead`
- Cuando crea eval-request → evento `InitiateCheckout`
- Cuando se firma contrato → evento `Purchase`

Para deduplicar, la landing debe mandar `event_id` único en el Pixel y el backend usa el mismo:

```js
const eventId = crypto.randomUUID();
fbq('track', 'Lead', {...}, { eventID: eventId });
fetch('/api/marketing/lead', { ..., headers: { 'X-Meta-Event-Id': eventId } });
```

Backend lo reenvía a Meta Conversion API con `event_id` matching.

**Env vars en plataforma (que el coworker NO setea, las setea Cris):**
- `META_PIXEL_ID`
- `META_CONVERSION_API_TOKEN`
- `META_TEST_EVENT_CODE` (solo para testing)

### 5.3. GA4

La landing dispara GA4 directo. El backend NO necesita conocer GA4. Solo mandá `X-Visit-Id` desde la landing al backend para que cualquier reconciliación posterior pueda hacerse via BigQuery export de GA4.

---

## 6. Schema de respuesta del quiz (formato canónico)

Lo siguiente debe respetarse **exactamente** — el backend valida con enums estrictos:

```typescript
type QuizData = {
  puesto_tipo: 'gerencia_mando_medio' | 'ventas' | 'operaciones' | 'tecnico';
  proceso_actual: 'intuicion' | 'cv_referencias' | 'evaluaciones_propias' | 'sin_proceso';
  historial_error: 'si_reinicio' | 'si_continuamos' | 'no' | 'no_responde';
  urgencia: 'less_30d' | '1-3m' | '3m+' | 'exploring';
  salario_target: number;  // USD/mes, entero, 100-50000
};

type CalculatorData = {
  salario_reclutador: number;        // USD/mes
  salario_entrenador: number;        // USD/mes
  salario_puesto: number;            // USD/mes (puede no coincidir con salario_target — el lead podría refinar)
  estimado_riesgo_min: number;       // USD total (computado client-side)
  estimado_riesgo_max: number;       // USD total
  fee_sharktalents: number;          // USD total = salario_puesto * 1.2
};
```

**Por qué tan estricto:** los enums alimentan campos en Zoho CRM y bifurcaciones server-side. Si la landing manda `urgencia: "muy urgente"` en lugar de `less_30d`, el backend rechaza con 400 y la landing pierde el lead.

---

## 7. Manejo de errores en la landing

### 7.1. Backend down (5xx, timeout, network error)

**No perder el lead.** Guardar en localStorage:
```js
const queue = JSON.parse(localStorage.getItem('st_pending_leads') || '[]');
queue.push({ payload, attempt: 1, queued_at: Date.now() });
localStorage.setItem('st_pending_leads', JSON.stringify(queue));
```

Reintentar en background:
- Cada 30s mientras la pestaña esté abierta
- En `beforeunload` mandar a un endpoint fallback (Mailchimp/ConvertKit/sendgrid via API key directa) como último recurso

Mostrar UX optimista:
- "Te registramos. Te llegará un email en los próximos minutos."
- No mostrar error técnico al usuario

### 7.2. 400 Validation error

Mostrar error inline al usuario en el campo correspondiente. El backend devuelve:
```json
{
  "error": {
    "code": "validation_error",
    "field": "email",
    "message": "El email no es válido"
  }
}
```

### 7.3. 429 Rate limit

Mostrar "demasiadas solicitudes, intentá en X segundos". Usar header `X-RateLimit-Reset`.

---

## 8. Performance requirements (Core Web Vitals)

La plataforma actual tiene bundle de 656KB. La landing **no debe** acercarse a eso.

Targets:
- **LCP** < 1.0s en 4G
- **FID/INP** < 100ms
- **CLS** < 0.05
- **Total JS** < 100KB unzipped (incluye quiz interactivo)
- **Total CSS** < 30KB

Recomendaciones técnicas:
- Astro con islas de React solo donde se necesita interactividad
- Imagenes WebP/AVIF, lazy load below the fold
- Fonts: `font-display: swap`, preload hints
- No usar React Router (Astro routea estático)
- No usar Tailwind/MUI/etc (CSS modules o vanilla CSS)

**Preconnect al backend:**
```html
<link rel="preconnect" href="https://api.sharktalents.ai">
<link rel="dns-prefetch" href="https://api.sharktalents.ai">
```

---

## 9. Privacy / cookies / GDPR

La landing va a recibir tráfico de:
- Panamá (Ley 81 de protección de datos)
- USA (CCPA si hay clientes California)
- EU (GDPR si tracking incluye visitantes EU)

Requerimientos mínimos:
- Banner de cookies con opciones granulares: Essential / Analytics / Marketing
- Política de privacidad linkeable y completa
- Meta Pixel y GA4 NO se cargan hasta que el user acepta (Consent Mode v2 en GA4, opt-in para Pixel)
- En el quiz: checkbox `consent_marketing` explícito antes de enviar (no pre-marcado)
- Mecanismo de opt-out: `/marketing/unsubscribe?token=...`

---

## 10. Email del lead — qué le llega y cuándo

Para que el dev de la landing pueda explicar el flujo al usuario en la UI, esta es la lista exacta de emails que la plataforma envía:

| Trigger | Emails enviados | A quién |
|---|---|---|
| Lead capturado (POST /lead) | "Gracias por completar el quiz" | Lead |
| Eval request creado (POST /eval-request) | "Carlos, alguien te invitó a una evaluación" | Miembro evaluado |
| Eval request creado | "Le mandamos el link a Carlos — te avisamos cuando termine" | Lead |
| Test completado | "El reporte de Carlos está listo" + link al demo report | Lead |
| Tras 48h sin abrir demo report | Recordatorio | Lead |
| Tras 7 días | Email nurturing #1 (insight) | Lead |
| Tras 14 días | Email nurturing #2 (caso real) | Lead |
| Tras 21 días | Email nurturing #3 (urgencia) | Lead |

El dev de la landing **no implementa estos emails** — los manda el backend via `outbox + email.send_pending`. La landing solo informa al usuario que los va a recibir.

---

## 11. Páginas que la landing necesita implementar

```
/                                         Landing principal con hero + CTA al quiz
/quiz                                     5 preguntas + captura email/empresa
/calculadora                              Calculadora de riesgo (con resultados del quiz prefilled)
/lead-magnet                              Pantalla "evaluá gratis a un miembro" + form
/lead-magnet/confirmacion                 Tras submitear eval-request: "te avisaremos por email"
/gracias                                  Pantalla post-quiz si urgencia=exploring
/agendar                                  Embed de Calendly para urgencia=less_30d
/privacy                                  Política de privacidad
/unsubscribe                              Opt-out con token

/api/health                               Endpoint propio de la landing para uptime monitoring
```

**NO implementa:**
- `/test/<token>` — vive en la plataforma
- `/marketing/demo-report/<token>` — vive en la plataforma
- Login / dashboard / portal cliente — todo eso está en la app

---

## 12. Variables de entorno que el coworker necesita

```bash
# .env.local (development)
PUBLIC_API_BASE=http://localhost:3002
PUBLIC_MARKETING_SITE_KEY=dev_marketing_xxxxx
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA  # Cloudflare test key
PUBLIC_META_PIXEL_ID=
PUBLIC_GA4_MEASUREMENT_ID=

# .env.production
PUBLIC_API_BASE=https://api.sharktalents.ai
PUBLIC_MARKETING_SITE_KEY=<lo provee Cris>
PUBLIC_TURNSTILE_SITE_KEY=<lo provee Cris>
PUBLIC_META_PIXEL_ID=<lo provee Cris>
PUBLIC_GA4_MEASUREMENT_ID=<lo provee Cris>
```

Todas son `PUBLIC_` (van en el bundle). Los secrets reales (Meta token, Turnstile secret, etc.) viven en la plataforma backend, no en la landing.

---

## 13. Testing del coworker contra la plataforma

**Setup local sin la plataforma corriendo:**

El coworker puede mockear las respuestas con MSW (Mock Service Worker):

```ts
// landing/src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('*/api/marketing/lead', () => {
    return HttpResponse.json({
      lead_id: 'lead_mock_123',
      message: 'Mock OK',
      next_action: 'show_eval_offer',
    }, { status: 201 });
  }),
  // ...
];
```

**Setup local con plataforma corriendo:**

```bash
cd sharktalentsapp/functions/api
npm run watch  # arranca en :3002

cd landing
PUBLIC_API_BASE=http://localhost:3002 npm run dev  # arranca en :4321
```

CORS local: el backend ya permite `http://localhost:4321` en `ALLOWED_ORIGINS`.

**Testing E2E:**

Recomendado Playwright. El coworker mantiene sus propios tests E2E. La plataforma expone un endpoint `/api/marketing/_test/reset` (solo en development, gated por `INTERNAL_API_KEY`) que limpia los `MarketingLeads` de testing.

---

## 14. Lo que el dev de la landing NO debe hacer

1. **NO copiar lógica de scoring DISC/Cognitivo/Integridad.** El test de evaluación corre en la plataforma. La landing solo dispara el flujo y muestra UI.

2. **NO autenticar con Clerk.** Estos endpoints son públicos. Cualquier persona puede pegarles. Las protecciones son rate limit + captcha + honeypot + email verification.

3. **NO guardar datos del candidato evaluado en la landing.** El miembro a evaluar es PII protegido. La landing solo lo recolecta una vez y lo manda al backend. No lo persistas en localStorage.

4. **NO almacenar tokens HMAC en la landing.** Esos tokens los genera el backend y van directo al email del usuario. La landing nunca los toca.

5. **NO usar la URL de la app (`app.sharktalents.ai`) para nada que no sea el link al test/reporte.** Son dominios separados, productos separados, codebases separadas.

6. **NO hardcodear `https://api.sharktalents.ai`.** Usá `PUBLIC_API_BASE` env var.

7. **NO implementar logout / sessions.** No hay auth. El lead se identifica por email.

---

## 15. Checklist de entrega del coworker

Cuando el coworker entregue la landing, debe verificar:

- [ ] Lighthouse score 95+ en Performance, Accessibility, Best Practices, SEO
- [ ] Bundle JS < 100KB unzipped
- [ ] LCP < 1.0s en 4G simulado
- [ ] CLS < 0.05
- [ ] Captcha funciona en `/lead-magnet`
- [ ] Honeypot agregado en todos los forms
- [ ] LocalStorage queue funciona offline / 5xx del backend
- [ ] Pixel + GA4 + Conversion API integration deduplicada
- [ ] Cookie consent banner funcional con opt-in granular
- [ ] Política de privacidad y términos linkeados
- [ ] Tests E2E con Playwright para los 4 paths del funnel (urgency=less_30d/1-3m/3m+/exploring)
- [ ] Mobile-first responsive verificado en 375px / 768px / 1280px
- [ ] Open Graph + Twitter Cards configurados
- [ ] Sitemap.xml + robots.txt
- [ ] SSL/HTTPS válido en hosting final
- [ ] Backup mailing list (Mailchimp/ConvertKit) configurado como fallback
- [ ] Documentación README en el repo de la landing con cómo correrla local

---

## 16. Cosas que NO están definidas todavía y van a requerir decisión

Cuando el coworker llegue a estas, parar y preguntar:

1. **Texto exacto de cada email que se envía.** Hay 8+ emails (lista en sección 10). Cris define copy.
2. **Diseño visual de la landing.** No hay design system todavía. ¿Reusa colores/fonts de la plataforma actual?
3. **Voice & tone.** Formal vs informal, "tú" vs "vos". Coherente con la plataforma actual.
4. **Política de privacidad y términos.** Necesita revisión legal (Cris).
5. **Si se usa Calendly o sistema propio de booking.** Calendly es lo más rápido.
6. **Imágenes/videos del Acto 1 (Meta Ad).** Diseño + producción separados de dev.
7. **Endpoint de fallback (Mailchimp/ConvertKit) cuando la plataforma cae.** Cris elige proveedor.
8. **Países/idiomas soportados.** ¿Solo es-PA? ¿Agregar es-CO, es-MX? ¿en-US para clientes globales?

---

## Referencias

- [24_MARKETING_FUNNEL.md](24_MARKETING_FUNNEL.md) — propuesta arquitectónica de fondo
- [24_MARKETING_FUNNEL_prototype.html](24_MARKETING_FUNNEL_prototype.html) — prototipo del funnel
- [API_CLIENT_GUIDE.md](API_CLIENT_GUIDE.md) — patrones generales de API en la plataforma
- Pipeline operativo: [18_PIPELINE_OPERATIVO.md](18_PIPELINE_OPERATIVO.md)
