# 05 — Reliability: idempotencia, retry, fallback, circuit breaker

Las apps de negocio reales tienen APIs externas que fallan, timeouts, cron jobs que se cuelgan, y clientes que hacen click dos veces. Si no diseñás para esos escenarios, pagás el costo en incidents nocturnos.

---

## Idempotencia: la piedra angular

**Definición operativa:** una operación es idempotente si correrla 2 veces produce el mismo resultado que correrla 1 vez.

**Por qué importa:**
- Webhooks se reciben duplicados (los proveedores reintentan si no respondés 2xx rápido)
- Usuarios hacen click en "Enviar" 3 veces
- Procesos fallan a la mitad y se relanzan
- Crons se solapan en ejecuciones lentas

### Patrón 1: idempotencia por external event_id

Cuando recibís un webhook, guardá una fila en una tabla de "eventos procesados":

```js
// db/processedEvents.js

exports.markProcessed = async (app, eventId, provider) => {
    const existing = await app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(eventId)}'`
    );
    if (existing.length > 0) return false;  // ya procesado

    await app.datastore().table('ProcessedEvents').insertRow({
        event_id: eventId,
        provider,
        received_at: new Date().toISOString()
    });
    return true;
};

// handlers/webhooks.js
exports.handleStripe = async (ctx) => {
    const event = await parseVerifiedWebhook(ctx);

    const isNew = await processedEvents.markProcessed(ctx.app, event.id, 'stripe');
    if (!isNew) {
        console.log(`[WEBHOOK-STRIPE] ${event.id} already processed, skip`);
        return sendJson(ctx.res, 200, { received: true, duplicate: true });
    }

    // ... procesar
};
```

**Importante:** inserción a `ProcessedEvents` debe ser **antes** de procesar. Si procesás primero y luego marcás, en un fallo a la mitad vas a re-procesar.

### Patrón 2: idempotencia por negocio

Para operaciones de API salientes, usá un check de estado propio:

```js
// services/payments.js

exports.triggerChargeIfReady = async (app, orderId) => {
    const order = await ordersDb.getById(app, orderId);

    // Idempotencia: si ya se cobró exitosamente, skip
    if (order.payment_status === 'success') {
        console.log(`[PAYMENT] Order ${orderId} already charged, skip`);
        return { skipped: true, reason: 'already_success' };
    }

    // Precondition: el estado permite cobrar
    if (order.status !== 'confirmed') {
        console.warn(`[PAYMENT] Order ${orderId} not ready (status=${order.status})`);
        return { skipped: true, reason: 'not_ready' };
    }

    try {
        const result = await stripe.charges.create({ /* ... */ });
        await ordersDb.updatePayment(app, orderId, {
            payment_status: 'success',
            external_charge_id: result.id
        });
        return { success: true, charge_id: result.id };
    } catch (err) {
        await ordersDb.updatePayment(app, orderId, {
            payment_status: 'failed',
            payment_error: err.message
        });
        throw err;
    }
};
```

Llamalo 100 veces: cobra 1. Perfect.

### Patrón 3: idempotency keys

Para operaciones creadas desde el cliente (ej. "crear pedido"), incluí un `Idempotency-Key` header:

```js
exports.createOrder = async (ctx) => {
    const key = ctx.req.headers['idempotency-key'];
    if (!key) {
        throw new ValidationError('Idempotency-Key header required');
    }

    const existing = await app.zcql().executeZCQLQuery(
        `SELECT * FROM IdempotencyKeys WHERE key = '${escapeSql(key)}'`
    );
    if (existing.length > 0) {
        const cached = (existing[0].IdempotencyKeys || existing[0]);
        return sendJson(ctx.res, cached.status, JSON.parse(cached.response));
    }

    // ... procesar crear orden ...
    const response = { id: order.id, status: 'created' };

    await app.datastore().table('IdempotencyKeys').insertRow({
        key,
        status: 201,
        response: JSON.stringify(response),
        created_at: new Date().toISOString()
    });

    sendJson(ctx.res, 201, response);
};
```

Stripe, Braintree, y otros usan este patrón.

---

## Retry con límite y backoff

**Nunca retries infinitos.** Siempre con límite y tiempo creciente entre intentos.

### Backoff exponencial

```js
// lib/retry.js

async function withRetry(fn, opts = {}) {
    const maxRetries = opts.maxRetries || 3;
    const baseDelayMs = opts.baseDelayMs || 1000;
    const retryIf = opts.retryIf || isTransientError;

    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!retryIf(err)) throw err;  // error permanente, no retry

            const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;  // jitter
            console.warn(`[RETRY] attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

function isTransientError(err) {
    // Solo retry en errores temporales
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
    if (err.response && err.response.status >= 500) return true;
    if (err.response && err.response.status === 429) return true;  // rate limit
    return false;
}

module.exports = { withRetry };
```

### No retries en errores 4xx

400/401/403/404 significa "el request está mal" — retry no va a arreglarlo. Solo retry en 5xx y errores de red.

### Retry counter persistente

Para operaciones críticas (procesamiento de pago, envío de notificación), guardá el count de retries en la DB:

```js
async function processWithRetry(app, orderId) {
    const order = await ordersDb.getById(app, orderId);

    if (order.retry_count >= MAX_RETRIES) {
        console.error(`[PAYMENT] Max retries reached for ${orderId}`);
        await markAsFailed(app, orderId, 'max_retries_reached');
        return;
    }

    await ordersDb.update(app, orderId, {
        retry_count: (order.retry_count || 0) + 1,
        last_attempt_at: new Date().toISOString()
    });

    // ... intentar procesar
}
```

Si el proceso se cae a la mitad y se relanza, el contador ya está actualizado — no hay riesgo de retry infinito.

---

## Fallback explícito con razón

**Regla:** cuando algo falla, la app debe seguir funcionando con un estado **conocido**, no un estado indefinido.

### Anti-pattern: silent failure

```js
// ❌ Mal — ignoramos el error, no sabemos qué pasó
try {
    await sendEmail(user);
} catch (err) {
    // nada
}
// Seguimos como si hubiera funcionado → cliente nunca recibe el email, nadie se entera
```

### Pattern: fallback explícito

```js
// ✅ Bien
try {
    await sendEmail(user);
    await logNotification(app, user.id, 'email', 'sent');
} catch (err) {
    console.error(`[NOTIFY] Email failed for ${user.id}:`, err.message);
    await logNotification(app, user.id, 'email', 'failed', err.message);

    // Fallback: SMS
    try {
        await sendSms(user);
        await logNotification(app, user.id, 'sms', 'sent', 'email_fallback');
    } catch (err2) {
        console.error(`[NOTIFY] SMS fallback failed for ${user.id}:`, err2.message);
        await logNotification(app, user.id, 'sms', 'failed', err2.message);

        // Último recurso: marcar para gestión manual
        await markUserForManualContact(app, user.id, 'all_channels_failed');
    }
}
```

Cada rama deja rastro en logs + DB. Si 10 usuarios quedan sin contactar, tenés trazabilidad completa de por qué y qué acción tomar.

### Feature flags con fallback

```js
// Feature flag para habilitar/deshabilitar una integración flakey
const FLOW_X_ENABLED = process.env.FLOW_X_ENABLED !== 'false';

if (FLOW_X_ENABLED) {
    try {
        await integrationX.send(data);
    } catch (err) {
        console.error(`[FLOW-X] Error:`, err.message);
        await fallbackMethod(data);  // usar método legacy/manual
    }
} else {
    console.log('[FLOW-X] Disabled by env var');
    await fallbackMethod(data);
}
```

Cuando la integración falla masivamente, deshabilitás con 1 env var sin deploy.

---

## Circuit breaker

**Problema:** si una API externa está caída, seguir llamándola:
- Tira errores en cascada a tus usuarios
- Consume recursos tuyos esperando timeouts
- Puede hacer que la caída dure más (los retries los saturan)

**Solución:** circuit breaker. Si detectás que está caída, dejá de llamarla temporalmente.

### Implementación simple

```js
// lib/circuitBreaker.js
// Usa una tabla en DataStore para que múltiples instances compartan estado

async function callWithBreaker(app, serviceName, fn, opts = {}) {
    const threshold = opts.threshold || 5;
    const coolDownMs = opts.coolDownMs || 60_000;

    // Check breaker state
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT * FROM CircuitBreakers WHERE service = '${escapeSql(serviceName)}'`
    );
    const breaker = rows.length > 0 ? (rows[0].CircuitBreakers || rows[0]) : null;

    if (breaker && breaker.open_until > Date.now()) {
        throw new AppError(
            `Circuit open for ${serviceName} until ${new Date(breaker.open_until).toISOString()}`,
            503
        );
    }

    try {
        const result = await fn();
        // Reset failure count on success
        if (breaker && breaker.failure_count > 0) {
            await app.datastore().table('CircuitBreakers').updateRow({
                ROWID: breaker.ROWID,
                failure_count: 0,
                last_success_at: Date.now()
            });
        }
        return result;
    } catch (err) {
        const newCount = (breaker?.failure_count || 0) + 1;
        const openUntil = newCount >= threshold ? Date.now() + coolDownMs : 0;

        if (breaker) {
            await app.datastore().table('CircuitBreakers').updateRow({
                ROWID: breaker.ROWID,
                failure_count: newCount,
                open_until: openUntil,
                last_failure_at: Date.now(),
                last_error: truncate(err.message)
            });
        } else {
            await app.datastore().table('CircuitBreakers').insertRow({
                service: serviceName,
                failure_count: newCount,
                open_until: openUntil,
                last_failure_at: Date.now(),
                last_error: truncate(err.message)
            });
        }

        if (newCount >= threshold) {
            console.error(`[CIRCUIT] ${serviceName} OPEN for ${coolDownMs}ms after ${newCount} failures`);
        }
        throw err;
    }
}
```

### Uso

```js
// services/externalApi.js

exports.sendToPartner = async (app, payload) => {
    return await callWithBreaker(app, 'partner_api', async () => {
        const res = await axios.post(process.env.PARTNER_URL, payload, {
            timeout: 15000
        });
        return res.data;
    }, {
        threshold: 5,      // abre después de 5 fallos
        coolDownMs: 60_000 // se queda cerrado por 1 min
    });
};
```

Si la API del partner está caída 1 minuto, el circuit breaker evita hacer N*30=30 requests inútiles durante esa ventana.

---

## Timeouts en todas las llamadas HTTP

**Catalyst corta tu function a los 30 seg**. Si un HTTP call se queda colgado sin timeout, mata tu función entera.

```js
// ❌ Mal — sin timeout
const res = await axios.post(url, payload);

// ✅ Bien — timeout explícito
const res = await axios.post(url, payload, {
    timeout: 15000,  // 15 seg
    validateStatus: () => true  // no lanzar por status ≥ 400
});

// Manejo explícito del resultado
if (res.status >= 500) {
    throw new TransientError('Server error', res.status);
} else if (res.status >= 400) {
    throw new PermanentError('Client error', res.status);
}
```

**Rule of thumb para timeouts:**
- API RESTful simple: 10-15 seg
- Upload de archivos: 30 seg
- Consulta que puede ser lenta (reports): aumentar proporcionalmente

Nunca superés el timeout de la function misma (30s para Advanced I/O, 15 min para Cron).

---

## Outbox pattern

**Problema:** necesitás "guardar en DB Y enviar email" atómicamente. Pero no hay transactions distribuidas (DB + SMTP).

**Escenarios que rompen:**
- DB commit OK → email falla → usuario no se entera
- DB commit OK → email OK → tu response falla → cliente reintenta → email doble

**Solución:** Outbox pattern.

### Implementación

1. En la MISMA transaction/operación de DB, guardás un "evento pendiente" en tabla `Outbox`:

```js
async function createOrder(app, payload) {
    // Transaction: insertar orden + outbox event
    const order = await app.datastore().table('Orders').insertRow({
        ...payload,
        status: 'created'
    });

    await app.datastore().table('Outbox').insertRow({
        event_type: 'order.created',
        payload: JSON.stringify({ order_id: order.ROWID, email: payload.email }),
        status: 'pending',
        created_at: new Date().toISOString()
    });

    return order;
}
```

2. Un worker (cron o event) procesa el outbox:

```js
// cron_function/jobs/processOutbox.js

exports.run = async (app) => {
    const events = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Outbox WHERE status = 'pending' AND retry_count < 5 ORDER BY created_at ASC LIMIT 50`
    );

    for (const row of events) {
        const event = row.Outbox || row;
        try {
            await dispatchEvent(event);
            await app.datastore().table('Outbox').updateRow({
                ROWID: event.ROWID,
                status: 'sent',
                sent_at: new Date().toISOString()
            });
        } catch (err) {
            await app.datastore().table('Outbox').updateRow({
                ROWID: event.ROWID,
                retry_count: (event.retry_count || 0) + 1,
                last_error: truncate(err.message),
                last_attempt_at: new Date().toISOString()
            });
        }
    }
};
```

### Ventajas

- Si el proceso falla después del DB commit pero antes de mandar el email, el worker lo reintenta
- Garantía "al menos una vez" (at-least-once) para los eventos externos
- Audit trail completo (qué eventos se mandaron, cuándo, cuántos fallos)

### Trade-off

- Latencia extra (los emails se mandan cada N minutos, no en tiempo real)
- Mitigación: cron frecuente (cada 1 min) o worker permanente

---

## Saga pattern para flujos largos

Para flujos que cruzan múltiples sistemas externos (ej: reservar inventario → cobrar → despachar → notificar), ningún sistema tiene transaction distribuida. Si uno falla a la mitad, otros quedan inconsistentes.

**Saga:** cada paso tiene una **compensación** (cómo deshacer).

```
crear orden → reservar inventario → cobrar → enviar notificación

Si "cobrar" falla:
- compensar "reservar inventario" (liberar)
- marcar orden como failed
```

Catalyst no tiene runtime de sagas nativo. Implementá a mano:

```js
const steps = [
    {
        name: 'reserve_inventory',
        do: () => inventory.reserve(orderId),
        compensate: () => inventory.release(orderId)
    },
    {
        name: 'charge_payment',
        do: () => payments.charge(orderId),
        compensate: () => payments.refund(orderId)
    },
    {
        name: 'send_notification',
        do: () => notifications.send(orderId),
        compensate: () => {}  // idempotente, no necesita compensar
    }
];

async function runSaga(app, orderId) {
    const done = [];
    for (const step of steps) {
        try {
            await step.do();
            done.push(step);
            await markStepCompleted(app, orderId, step.name);
        } catch (err) {
            console.error(`[SAGA] ${step.name} failed:`, err.message);
            // Compensar en orden inverso
            for (const s of done.reverse()) {
                try {
                    await s.compensate();
                } catch (compErr) {
                    console.error(`[SAGA] Compensation ${s.name} failed:`, compErr.message);
                    // Estado inconsistente — requiere gestión manual
                    await markOrderInconsistent(app, orderId);
                }
            }
            throw err;
        }
    }
}
```

---

## Anti-patterns a evitar

### ❌ "Fire and forget" sin trazabilidad

```js
// Mal
(async () => {
    await sendEmail(user);
})();  // sin await, sin log
// Sigue el flujo principal
```

Si falla, nadie se entera. Usá outbox pattern en su lugar.

### ❌ Retry con delay de 0

```js
// Mal
for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (e) {}
}
```

Sin delay, si la API está caída, mandás 3 requests en 10ms. No ayuda, solo la saturas.

### ❌ Manejar todos los errores igual

```js
// Mal — retry a un 404
try {
    await fetchOrder(orderId);
} catch (err) {
    await retry();  // 404 no se arregla retryando
}
```

Distingo errores transitorios (5xx, timeout, network) de permanentes (4xx).

### ❌ Dejar procesos colgados

```js
// Mal — si axios se cuelga sin timeout, tu function muere a los 30s
await axios.post(url, payload);  // sin timeout
```

### ❌ State "probablemente OK"

```js
// Mal — no sabés si llegó el pago
try {
    await chargeCard();
    order.payment_status = 'success';
} catch (err) {
    // mmm, falló la call pero capaz ya cobró antes del timeout
    order.payment_status = 'unknown';
}
```

Hacé una segunda call de "status" al proveedor para confirmar. O diseñá con idempotency key así podés reintentar sin doble cobro.

---

## Cron jobs: hay que blindarlos

**Peligro:** si un cron tira excepción al runtime, Catalyst lo **apaga silenciosamente**. No manda alerta. Solo dejás de ver resultados.

### Patrón defensivo

```js
// cron_function/index.js

module.exports = async (req, res) => {
    let app = null;
    try {
        app = catalyst.initialize(req);
        await runAllJobs(app);
    } catch (err) {
        // CRÍTICO: capturar TODO y loguear, pero NO lanzar
        console.error('[CRON] Error crítico:', err.message, err.stack);
    } finally {
        // Siempre respondemos 200 para que Catalyst no apague el cron
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    }
};

async function runAllJobs(app) {
    // Cada job en su try/catch individual para que el fallo de uno no afecte a los otros
    try { await sendReminders(app); }
    catch (err) { console.error('[JOB-REMINDERS]', err.message); }

    try { await cleanupOldData(app); }
    catch (err) { console.error('[JOB-CLEANUP]', err.message); }

    try { await checkTimeouts(app); }
    catch (err) { console.error('[JOB-TIMEOUTS]', err.message); }
}
```

**Regla:** el handler raíz del cron NUNCA debe lanzar excepción.

### Monitoreo externo

Aunque el cron siempre devuelva 200, puede estar corriendo sin efectos. Un monitor externo que corrobora "¿esta métrica X avanzó hoy?":

```js
// Ejemplo: verificar que el cron de cleanup efectivamente borró algo en las últimas 24h
async function healthCheck(app) {
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT COUNT(*) as count FROM CleanupLog WHERE executed_at > ${Date.now() - 86400_000}`
    );
    const count = rows[0]['CASE'].count;  // ZCQL agg weirdness
    return count > 0;
}
```

Expuesto en endpoint `/health/detailed`, consumido por tu monitoring externo.

---

## Checklist de reliability

Al diseñar cada operación crítica:

- [ ] ¿Es idempotente? (correrla 2 veces da el mismo resultado)
- [ ] ¿Tiene timeout explícito en toda HTTP call?
- [ ] ¿Retry con límite y backoff exponencial?
- [ ] ¿Distingue errores transitorios de permanentes?
- [ ] ¿Tiene fallback conocido cuando falla?
- [ ] ¿Deja trazabilidad (logs + DB) en cada rama de error?
- [ ] ¿El estado post-error es conocido, no "indefinido"?
- [ ] ¿Los crons tienen try/catch raíz que nunca lanza?
- [ ] ¿Hay circuit breaker para servicios flakey?
- [ ] ¿Los eventos externos críticos van por outbox pattern?
- [ ] ¿Los flujos multi-paso tienen compensación (saga) o son idempotentes?
