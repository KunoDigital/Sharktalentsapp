# 08 — Integraciones Externas

Todo sistema no trivial habla con terceros. Cada integración es una superficie de falla, una cuenta que pagar, un SDK que puede cambiar.

Este documento es una guía táctica para integrarse bien.

---

## Principio fundamental: nunca confiar en sistemas externos

Cada API externa es:
- Lenta (hasta que no lo es)
- Flakey (hasta que no lo es)
- Potencialmente hostil (devuelve data inesperada)
- Cambiante (break changes sin avisar)

Diseñá asumiendo todo esto.

---

## Webhooks entrantes

### Checklist al recibir un webhook

1. **Validar firma HMAC** — siempre, siempre, siempre
2. **Guardar evento RAW** antes de procesar (para debugging)
3. **Responder 200 rápido** (antes de 5 seg típicamente — los proveedores reintentan si tardás)
4. **Procesar async** si el procesamiento es largo
5. **Idempotencia por `event_id`** — los proveedores duplican
6. **Validar formato/payload** — no confiar en estructura

### Ejemplo completo

```js
// handlers/webhooks/stripe.js

const { verifyWebhookSignature } = require('../../lib/hmac');
const { markProcessed } = require('../../db/processedEvents');
const { logWebhook } = require('../../db/webhookLog');

exports.handle = async (ctx) => {
    const rawBody = await readRawBody(ctx.req);

    // 1. Verificar firma ANTES de procesar
    if (!verifyWebhookSignature(ctx.req, rawBody, process.env.STRIPE_WEBHOOK_SECRET)) {
        console.error('[WEBHOOK-STRIPE] Invalid signature');
        throw new UnauthorizedError('Invalid signature');
    }

    // 2. Parsear
    let event;
    try {
        event = JSON.parse(rawBody);
    } catch (err) {
        throw new ValidationError('Invalid JSON');
    }

    // 3. Log RAW antes de procesar
    await logWebhook(ctx.app, {
        provider: 'stripe',
        event_id: event.id,
        event_type: event.type,
        raw_body: rawBody.slice(0, 5000)  // truncate
    });

    // 4. Idempotencia
    const isNew = await markProcessed(ctx.app, event.id, 'stripe');
    if (!isNew) {
        console.log(`[WEBHOOK-STRIPE] ${event.id} already processed`);
        return sendJson(ctx.res, 200, { received: true, duplicate: true });
    }

    // 5. Responder 200 rápido (antes de procesar lento)
    sendJson(ctx.res, 200, { received: true });

    // 6. Procesar async (no bloquea la response)
    processEventAsync(ctx.app, event).catch(err => {
        console.error(`[WEBHOOK-STRIPE] Async error ${event.id}:`, err.message);
    });
};

async function processEventAsync(app, event) {
    switch (event.type) {
        case 'payment_intent.succeeded':
            await handlePaymentSucceeded(app, event.data.object);
            break;
        case 'payment_intent.payment_failed':
            await handlePaymentFailed(app, event.data.object);
            break;
        default:
            console.log(`[WEBHOOK-STRIPE] Unhandled event type: ${event.type}`);
    }
}
```

### Leer raw body

Para verificar HMAC necesitás el body TAL CUAL vino, no parseado:

```js
// lib/http.js

exports.readRawBody = (req) => {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
};
```

**Crítico:** si parseás el body con body-parser antes de llegar a tu handler, perdés bytes originales. Leé raw antes.

---

## Callbacks (redirects post-acción)

Cuando el usuario vuelve de un flow externo (OAuth, post-pago, post-firma):

### Patrón GET + state

```js
// Redirect URL: https://myapp.com/callback?state=abc123&code=xyz

exports.oauthCallback = async (ctx) => {
    const { state, code, error } = ctx.parsed.query;

    // Validar state para prevenir CSRF
    if (!state || !isValidState(state, ctx.session)) {
        throw new ForbiddenError('Invalid state');
    }

    if (error) {
        // Usuario canceló o rechazó
        redirectTo(ctx.res, '/login?error=oauth_denied');
        return;
    }

    // Intercambiar code por token
    const token = await exchangeCodeForToken(code);
    // ... store token, create session ...
    redirectTo(ctx.res, '/dashboard');
};
```

### Idempotencia en callbacks

Los users pueden hacer F5 en una URL de callback. Si tu callback modifica estado (crear un registro, cobrar), **tenés que ser idempotente**.

```js
exports.paymentCallback = async (ctx) => {
    const { session_id } = ctx.parsed.query;

    // Chequeá si ya procesaste este session_id
    const existing = await db.getPaymentBySessionId(ctx.app, session_id);
    if (existing && existing.status === 'completed') {
        redirectTo(ctx.res, `/orders/${existing.order_id}?already=true`);
        return;
    }

    // Procesar solo si es primera vez
    const payment = await processPayment(ctx.app, session_id);
    redirectTo(ctx.res, `/orders/${payment.order_id}`);
};
```

---

## APIs salientes

### Timeout + retry + circuit breaker

```js
// integrations/stripe.js
const axios = require('axios');
const { withRetry } = require('../lib/retry');
const { callWithBreaker } = require('../lib/circuitBreaker');

exports.createCharge = async (app, payload) => {
    return await callWithBreaker(app, 'stripe', async () => {
        return await withRetry(async () => {
            const res = await axios.post(
                'https://api.stripe.com/v1/charges',
                payload,
                {
                    auth: { username: process.env.STRIPE_SECRET_KEY, password: '' },
                    timeout: 15000
                }
            );
            return res.data;
        }, { maxRetries: 3 });
    });
};
```

### Log request + response (sin secrets)

```js
async function callExternalApi(payload) {
    const startTime = Date.now();
    console.log(`[EXT-PARTNER] POST payload=${JSON.stringify(payload).slice(0, 200)}`);

    try {
        const res = await axios.post(url, payload, { timeout: 15000 });
        console.log(`[EXT-PARTNER] OK status=${res.status} duration=${Date.now() - startTime}ms`);
        return res.data;
    } catch (err) {
        console.error(`[EXT-PARTNER] FAIL status=${err.response?.status} duration=${Date.now() - startTime}ms error=${err.message}`);
        throw err;
    }
}
```

### Rate limiting del lado tuyo

Si el proveedor cobra por uso, protegé contra abuse:

```js
// middleware/providerRateLimit.js

const WINDOW = 60_000;
const MAX_PER_WINDOW = 100;

async function rateLimitProvider(app, provider, userId) {
    const key = `${provider}:${userId || 'global'}`;
    const windowStart = Date.now() - WINDOW;

    const rows = await app.zcql().executeZCQLQuery(
        `SELECT COUNT(*) as count FROM ProviderCallLog
         WHERE key = '${escapeSql(key)}' AND ts > ${windowStart}`
    );
    const count = parseInt(rows[0]['CASE'].count);

    if (count >= MAX_PER_WINDOW) {
        throw new AppError(`Rate limit exceeded for ${provider}`, 429);
    }

    await app.datastore().table('ProviderCallLog').insertRow({
        key,
        ts: Date.now()
    });
}
```

---

## OAuth con refresh tokens

Muchas APIs (Zoho, Google, Microsoft) usan OAuth. Access tokens duran 1h, refresh tokens son de larga vida.

### Patrón: cache + refresh on 401

```js
// integrations/zoho.js

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
        // Margen de 60s antes de expiración
        return cachedToken;
    }

    const res = await axios.post(
        'https://accounts.zoho.com/oauth/v2/token',
        null,
        {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        }
    );

    cachedToken = res.data.access_token;
    tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
    return cachedToken;
}

async function callZohoApi(endpoint, options = {}) {
    const token = await getAccessToken();
    try {
        return await axios({
            url: `https://www.zohoapis.com${endpoint}`,
            ...options,
            headers: {
                ...options.headers,
                Authorization: `Zoho-oauthtoken ${token}`
            }
        });
    } catch (err) {
        if (err.response?.status === 401) {
            // Token expiró antes de lo esperado. Invalidar cache y retry.
            cachedToken = null;
            tokenExpiresAt = 0;
            const freshToken = await getAccessToken();
            return await axios({
                url: `https://www.zohoapis.com${endpoint}`,
                ...options,
                headers: {
                    ...options.headers,
                    Authorization: `Zoho-oauthtoken ${freshToken}`
                }
            });
        }
        throw err;
    }
}
```

### Mutex para evitar refreshes concurrentes

Si 10 requests simultáneas detectan token vencido, todas intentan refresh:

```js
let refreshingPromise = null;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

    // Si ya hay un refresh en curso, esperar
    if (refreshingPromise) return refreshingPromise;

    refreshingPromise = (async () => {
        try {
            const res = await axios.post(/* ... */);
            cachedToken = res.data.access_token;
            tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
            return cachedToken;
        } finally {
            refreshingPromise = null;
        }
    })();

    return refreshingPromise;
}
```

---

## File upload a terceros (WorkDrive, S3, etc.)

### Streaming vs buffer completo

Para archivos pequeños (<10 MB), buffer en memoria está bien:

```js
const pdf = await axios.get(sourceUrl, { responseType: 'arraybuffer' });
const buffer = Buffer.from(pdf.data);

await axios.post(uploadUrl, buffer, {
    headers: { 'Content-Type': 'application/pdf' }
});
```

Para archivos grandes (>10 MB), streaming (pero el timeout de Catalyst de 30s sigue aplicando). Pensar alternativa: subir el cliente directo al proveedor (S3 pre-signed URLs).

### Find-or-create folder

Al subir a servicios con folders (WorkDrive, Google Drive):

```js
async function findOrCreateFolder(token, parentId, folderName) {
    // 1. Buscar por nombre exacto
    const folders = await listFolders(token, parentId);
    const existing = folders.find(f => f.name === folderName);
    if (existing) return existing.id;

    // 2. Crear si no existe
    const created = await createFolder(token, parentId, folderName);
    return created.id;
}
```

### Paginación al listar

Los APIs de file storage paginan. Iterar:

```js
async function listAllFolders(token, parentId) {
    const all = [];
    let offset = 0;
    const pageSize = 50;

    while (true) {
        const res = await axios.get(
            `${API}/files/${parentId}/files?limit=${pageSize}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const items = res.data.data || [];
        all.push(...items);
        if (items.length < pageSize) break;
        offset += pageSize;
    }

    return all;
}
```

---

## Mapeo idempotente (match-by-name vs match-by-id)

Cuando el tercero no te da IDs estables, usa match por alguna property única.

**Caso real observado:** un sistema buscaba carpetas en un file-storage externo por nombre con regex laxo. A veces matcheaba carpetas que tenían timestamp duplicado (creadas por automations externas que agregaban sufijos al detectar colisión).

❌ **Mal:**
```js
const existing = folders.find(f => f.name.includes(customerId));
// "Cliente - 12345" y "Cliente - 12345 (2026-04-23 15:30)" ambos matchean
```

✅ **Bien:**
```js
const regex = new RegExp(`-\\s*${customerId}\\s*$`);
const existing = folders.find(f => regex.test(f.name));
// Solo matcha si termina exactamente con "- 12345"
```

Siempre: pattern exact o con anchor `$` / `^`.

---

## Manejo de APIs PHP legacy (y similares)

Algunas APIs corporativas mandan responses raros. Del caso real:

```
"<br />\n<b>Notice</b>: Undefined property: stdClass::$efectivo in /code/api/v2/crear_cliente.php on line 206<br />\n{\"status\":1,\"message\":\"Success.\"}"
```

El response tiene **warnings de PHP mezclados con el JSON**. Tu parser simple se rompe.

Manejar:

```js
async function parseMessyResponse(response) {
    let body = response.data;

    // Si es string con warnings PHP antes del JSON, extraer el JSON
    if (typeof body === 'string') {
        const jsonMatch = body.match(/\{.*\}$/s);  // último {..} del string
        if (jsonMatch) {
            try {
                body = JSON.parse(jsonMatch[0]);
            } catch (err) {
                console.warn('[EXT] Could not parse embedded JSON, treating as raw string');
            }
        }
    }

    return body;
}
```

Y siempre **guardar el response raw** completo en la DB por si necesitás debuggear después.

---

## Feature flags para integraciones

Para integraciones flakey, tené un flag para desactivarlas rápido:

```js
// env: ENRICHMENT_FLOW_ENABLED=true/false

async function sendToEnrichmentService(app, payload) {
    if (process.env.ENRICHMENT_FLOW_ENABLED === 'false') {
        console.log('[ENRICHMENT] Disabled by flag, skipping');
        return { skipped: true, reason: 'disabled' };
    }
    // ... proceso normal
}
```

Si la integración empieza a fallar masivamente, apagás con 1 cambio de env var sin deploy.

---

## Retry exponencial del lado de los proveedores

Los proveedores reintentan webhooks si no respondés 2xx. Tené en cuenta:

- **Si respondés 500 por error transient:** el provider reintenta, probablemente recuperamos
- **Si respondés 400 por validación:** el provider (normalmente) NO reintenta, porque es error permanente
- **Si respondés 200 antes de procesar:** asumen que OK. Si tu procesamiento async falla, no lo saben

**Regla:** responde 200 SOLO cuando estás seguro de poder procesar (idempotencia + outbox guardan la responsabilidad).

---

## Testing de integraciones

### Mocks vs sandbox

- **Mocks (tests unitarios):** rápidos pero no detectan problemas reales del API
- **Sandbox (tests de integración):** lentos pero verifican comportamiento real

Usar mocks para ejecutar la mayor parte del tiempo, sandbox para verificación periódica.

### Fixtures actualizadas

Capturar responses reales del sandbox en JSON files:

```
tests/fixtures/stripe/payment_intent_succeeded.json
tests/fixtures/stripe/payment_intent_failed.json
```

Cuando el API cambia, actualizar fixtures. Así los tests reflejan el comportamiento actual.

### Record-replay

Librerías como `nock` permiten grabar una interacción real y replayarla después:

```js
// En modo record
nock.recorder.rec({ output_objects: true });
await callStripe();
// Guarda los recordings a disco

// En modo replay
nock.load('./recordings/stripe-charge.json');
await callStripe();  // usa los recordings
```

---

## Documentar cada integración

`docs/INTEGRATIONS/<provider>.md` con:

```markdown
# Integración Stripe

## Base URL
https://api.stripe.com/v1

## Autenticación
Basic Auth: `STRIPE_SECRET_KEY:`

## Endpoints usados
- POST /charges (crear cobro)
- GET /charges/:id (consultar cobro)
- POST /refunds (devolver)

## Webhook
- URL: `/server/api_function/webhook/stripe`
- Secret: env var `STRIPE_WEBHOOK_SECRET`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

## Límites
- 100 req/sec en prod
- 25 req/sec en test mode

## Errores comunes
| Código | Causa | Qué hacemos |
|---|---|---|
| card_declined | Tarjeta rechazada | Marcar payment como failed, notificar al user |
| insufficient_funds | Fondos insuficientes | Igual que card_declined |
| rate_limit | Excedimos rate | Retry con backoff |

## SDK / librería
- Usamos axios directo, no el SDK oficial

## Links
- Docs: https://stripe.com/docs/api
- Dashboard: https://dashboard.stripe.com
- Testing: https://stripe.com/docs/testing
```

Cuando el próximo dev llegue, sabe exactamente cómo funciona sin leer el código.

---

## Checklist de integración nueva

Antes de conectar un servicio externo nuevo:

- [ ] Leí la doc oficial completa
- [ ] Identifiqué los rate limits
- [ ] Configuré env vars para credentials (nunca hardcoded)
- [ ] Implementé HMAC en webhooks (si existen)
- [ ] Tengo timeouts explícitos en todas las calls
- [ ] Tengo retry con backoff en calls salientes
- [ ] Idempotencia verificada en webhooks entrantes
- [ ] Log de request + response sin secrets
- [ ] Feature flag para desactivar rápido si falla
- [ ] Documentación en `docs/INTEGRATIONS/<provider>.md`
- [ ] Runbook en `docs/RUNBOOKS/` para fallas comunes
- [ ] Monitoreo de éxito vs falla para tomar decisión (circuit breaker)
- [ ] Tests con fixtures de ejemplos reales
