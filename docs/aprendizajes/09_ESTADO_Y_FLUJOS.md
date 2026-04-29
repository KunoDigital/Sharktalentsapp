# 09 — State Machines y Flujos Async Diferidos

Las apps de negocio son máquinas de estado con pasos async. Si no los modelás explícitamente, tu código se llena de `if` encadenados y bugs de "¿cómo llegué a este estado?".

Este documento cubre patrones para flujos multi-paso con estados, transiciones, timeouts, eventos externos y compensación.

---

## El problema del estado implícito

Anti-pattern común: múltiples columnas de status independientes.

Ejemplo: una tabla `Orders` con estos campos:

```
Orders tiene 5 columnas de status independientes:
- status               (inicio, pending, success, failed)
- verification_status  (Not Started, In Progress, Approved, Declined, ...)
- payment_status       (null, pending, charged, refunded)
- shipping_status      (null, preparing, shipped, delivered)
- notification_status  (null, sent, failed)
```

**El "estado global" del flujo es una función compleja de 5 columnas.**

Queries del tipo "dame todos los flujos listos para enviar" requieren:

```sql
WHERE status = 'success'
  AND verification_status = 'Approved'
  AND payment_status = 'charged'
  AND shipping_status IS NULL
  AND archived_at IS NULL
```

Cada combinación es una posible inconsistencia:
- `verification_status = 'Approved'` pero `payment_status = 'charged'` sin haber estado en 'pending' (faltó la transición intermedia)
- `shipping_status = 'shipped'` pero `verification_status = 'Declined'` (¿enviamos sobre verificación rechazada?)
- `notification_status = 'sent'` pero `payment_status = 'pending'` (¿notificamos confirmación sin cobrar?)

En teoría esos son imposibles. En la práctica, un sistema con múltiples paths (webhooks, retries, botones manuales, crons) puede alcanzarlos.

---

## State machine explícita

### Un estado canónico

```
Flows
├── id
├── current_state
└── ...

FlowSteps (histórico append-only)
├── flow_id
├── from_state
├── to_state
├── transitioned_at
├── actor (user/system/webhook)
└── metadata (JSON)
```

`current_state` es un enum con estados válidos:

```
(ejemplo: flujo de checkout con validación externa)

CART
CHECKOUT
AWAITING_VALIDATION         (validación externa, ej: fraud check)
VALIDATION_APPROVED
VALIDATION_REJECTED
AWAITING_PAYMENT
PAYMENT_IN_PROGRESS
PAID
AWAITING_ENRICHMENT          (integración opcional que agrega data, ej: tax info)
ENRICHMENT_DONE
ENRICHMENT_FAILED
SENT_TO_FULFILLMENT
COMPLETED
FAILED   (+ failure_step para saber dónde)
```

### Transiciones válidas

Documentás explícitamente qué transiciones son válidas:

```js
// services/flowStateMachine.js

const TRANSITIONS = {
    CART: ['CHECKOUT', 'FAILED'],
    CHECKOUT: ['AWAITING_VALIDATION', 'CART'],
    AWAITING_VALIDATION: ['VALIDATION_APPROVED', 'VALIDATION_REJECTED'],
    VALIDATION_APPROVED: ['AWAITING_PAYMENT'],
    VALIDATION_REJECTED: ['CHECKOUT', 'FAILED'],  // puede reintentarse
    AWAITING_PAYMENT: ['PAYMENT_IN_PROGRESS', 'FAILED'],
    PAYMENT_IN_PROGRESS: ['PAID'],
    PAID: ['AWAITING_ENRICHMENT', 'SENT_TO_FULFILLMENT'],  // enrichment en paralelo
    AWAITING_ENRICHMENT: ['ENRICHMENT_DONE', 'ENRICHMENT_FAILED'],
    ENRICHMENT_DONE: ['COMPLETED'],
    ENRICHMENT_FAILED: ['COMPLETED'],  // igual completa, enrichment era opcional
    SENT_TO_FULFILLMENT: ['COMPLETED'],
    COMPLETED: [],
    FAILED: []
};

exports.transitionTo = async (app, flowId, newState, actor, metadata = {}) => {
    const flow = await db.flows.getById(app, flowId);
    const allowedTransitions = TRANSITIONS[flow.current_state] || [];

    if (!allowedTransitions.includes(newState)) {
        throw new Error(
            `Invalid transition from ${flow.current_state} to ${newState}`
        );
    }

    await db.flows.update(app, flowId, { current_state: newState });
    await db.flowSteps.insert(app, {
        flow_id: flowId,
        from_state: flow.current_state,
        to_state: newState,
        actor,
        metadata: JSON.stringify(metadata),
        transitioned_at: new Date().toISOString()
    });

    console.log(`[STATE] Flow ${flowId} transitioned ${flow.current_state} → ${newState}`);
};
```

**Ventajas:**
- Imposible estar en estado inconsistente
- Historial completo en `FlowSteps` (cuándo, quién, por qué)
- Queries triviales: `WHERE current_state = 'AWAITING_PAYMENT'`
- Al agregar un step nuevo, solo hay que agregar las transiciones, no romper todo

### Visualización del state machine

```
CART
    │
    ▼
CHECKOUT ─────────────────────────► FAILED
    │
    ▼
AWAITING_VALIDATION
    │
    ├────► VALIDATION_APPROVED ──► AWAITING_PAYMENT
    │
    └────► VALIDATION_REJECTED ──► CHECKOUT (retry)
                              └──► FAILED
    ...
```

Documentar en `docs/ARCHITECTURE/STATE_MACHINE.md` con diagrama.

---

## Flujos async diferidos

**Caso típico:** usuario completa paso A. Sistema dispara paso B async. Sistema espera callback de B. Si B tarda demasiado, fallback a paso C.

Ejemplo: un flujo con step async que debe resolverse en 60 seg.

```
Usuario completa paso A
  │
  ▼
Sistema marca state = STEP_A_DONE
Dispara integración externa B (async)
State pasa a AWAITING_EXTERNAL_RESPONSE
  │
  ├──► Provider B responde OK (<60s, via webhook)
  │    └─► state = STEP_B_APPROVED
  │
  ├──► Provider B responde ERROR (<60s, via webhook)
  │    └─► state = STEP_B_FAILED (continúa con fallback)
  │
  └──► Timeout (>60s sin respuesta)
       └─► Cron detecta, state = STEP_B_FAILED (fallback)
```

### Implementación

```js
// 1. Al disparar el paso async, registrar cuándo empezó
await transitionTo(app, flowId, 'AWAITING_ENRICHMENT', 'system', {
    started_at: Date.now()
});
await sendQesFlow(flow);

// 2. Si llega happy path (webhook del tercero)
exports.handleQesWebhook = async (ctx) => {
    // ... validar webhook ...
    await transitionTo(app, flowId, 'ENRICHMENT_DONE', 'webhook');
};

// 3. Si llega error path
exports.handleQesFailureWebhook = async (ctx) => {
    await transitionTo(app, flowId, 'ENRICHMENT_FAILED', 'webhook');
};

// 4. Timeout: un cron chequea periódicamente
// cron_function/jobs/checkTimeouts.js

exports.run = async (app) => {
    const now = Date.now();
    const timeoutThreshold = now - 60_000;  // 60 seg

    const stuckFlows = await app.zcql().executeZCQLQuery(`
        SELECT ROWID, id, current_state FROM Flows
        WHERE current_state = 'AWAITING_ENRICHMENT'
          AND archived_at IS NULL
    `);

    for (const row of stuckFlows) {
        const flow = row.Flows || row;
        const lastTransition = await getLastTransitionTime(app, flow.id);
        if (lastTransition < timeoutThreshold) {
            console.warn(`[TIMEOUT] Flow ${flow.id} stuck in AWAITING_ENRICHMENT for ${Math.round((now - lastTransition) / 1000)}s`);
            await transitionTo(app, flow.id, 'ENRICHMENT_FAILED', 'timeout', {
                reason: 'no_response_60s'
            });
        }
    }
};
```

### Patrón: `awaiting_since` explícito

Para simplificar el check de timeout, agregá columna dedicada:

```
Flows
├── current_state
├── awaiting_since    -- timestamp cuando entró a estado AWAITING_*
└── ...
```

```js
// Al transitar a AWAITING_*
await db.flows.update(app, flowId, {
    current_state: 'AWAITING_ENRICHMENT',
    awaiting_since: toCatalystDateTime()
});

// Cron check
const rows = await app.zcql().executeZCQLQuery(`
    SELECT ROWID, id FROM Flows
    WHERE current_state LIKE 'AWAITING_%'
      AND awaiting_since < '${timeoutCutoff}'
`);
```

---

## Event-driven vs polling

### Event-driven: reacción inmediata

```
Webhook entrante → cambio de estado inmediato
```

**Ventajas:** tiempo real.
**Desventaja:** si el webhook NO llega (bug del proveedor, red, etc.), el flujo queda colgado.

### Polling: verificación periódica

```
Cron cada X min → chequea todos los flujos en estados "awaiting" y decide
```

**Ventajas:** robusto a fallos de webhooks.
**Desventaja:** latencia = frecuencia del cron.

### Híbrido: event-driven + polling de fallback

Es el patrón correcto para apps serias:

```
Flujo:
1. Disparar API externa (async)
2. Webhook entrante actualiza estado (happy path, segundos)
3. Cron periódico verifica flujos colgados (fallback, minutos)
```

Cada uno tiene su rol:
- Webhook: 95% de los casos, velocidad
- Cron: 5% restante cuando webhook falla, robustez

---

## Sagas: flujos multi-step con compensación

Para flujos donde múltiples pasos pueden fallar a la mitad:

```
Crear orden → Reservar inventario → Cobrar → Enviar notificación
```

Si el cobro falla, hay que liberar el inventario reservado.

### Modelado de saga

```js
// services/orderSaga.js

const STEPS = [
    {
        name: 'reserve_inventory',
        do: async (ctx, order) => {
            const res = await inventory.reserve(order.items);
            return { reservation_id: res.id };
        },
        compensate: async (ctx, step_result) => {
            await inventory.release(step_result.reservation_id);
        }
    },
    {
        name: 'charge_payment',
        do: async (ctx, order) => {
            const charge = await payments.charge(order.total, order.card);
            return { charge_id: charge.id };
        },
        compensate: async (ctx, step_result) => {
            await payments.refund(step_result.charge_id);
        }
    },
    {
        name: 'send_notification',
        do: async (ctx, order) => {
            await notifications.send(order.user_id, 'order_confirmed');
            return {};
        },
        compensate: async () => {
            // Notificaciones son idempotentes, no requiere compensar
        }
    }
];

exports.run = async (app, orderId) => {
    const order = await db.orders.getById(app, orderId);
    const completed = [];

    try {
        for (const step of STEPS) {
            const result = await step.do({ app }, order);
            completed.push({ step, result });
            await db.sagas.markStepDone(app, orderId, step.name, result);
        }
        await db.orders.update(app, orderId, { status: 'completed' });
    } catch (err) {
        console.error(`[SAGA] Order ${orderId} failed at step:`, err.message);
        // Compensar en orden inverso
        for (let i = completed.length - 1; i >= 0; i--) {
            const { step, result } = completed[i];
            try {
                await step.compensate({ app }, result);
                console.log(`[SAGA] Compensated ${step.name}`);
            } catch (compErr) {
                console.error(`[SAGA] Compensation failed for ${step.name}:`, compErr.message);
                await db.orders.markInconsistent(app, orderId, {
                    failed_step: step.name,
                    compensation_error: compErr.message
                });
            }
        }
        await db.orders.update(app, orderId, { status: 'failed' });
        throw err;
    }
};
```

### Sagas idempotentes

Si un saga se re-ejecuta (bug, retry), debe poder resumir desde donde quedó:

```js
exports.run = async (app, orderId) => {
    const order = await db.orders.getById(app, orderId);
    const completedSteps = await db.sagas.getCompletedSteps(app, orderId);

    for (const step of STEPS) {
        if (completedSteps.includes(step.name)) {
            console.log(`[SAGA] Skipping already completed step ${step.name}`);
            continue;
        }
        const result = await step.do({ app }, order);
        await db.sagas.markStepDone(app, orderId, step.name, result);
    }
};
```

---

## Patrón: outbox para eventos de estado

Cuando una transición de estado debe disparar efectos externos (email, webhook a otro sistema), usá outbox pattern:

```js
exports.transitionTo = async (app, flowId, newState, actor, metadata = {}) => {
    // 1. Actualizar state
    await db.flows.update(app, flowId, { current_state: newState });
    await db.flowSteps.insert(app, { flow_id: flowId, to_state: newState, actor });

    // 2. Encolar eventos derivados
    const events = getEventsForTransition(newState, flowId, metadata);
    for (const event of events) {
        await db.outbox.insert(app, event);
    }
};

function getEventsForTransition(state, flowId, metadata) {
    const events = [];
    if (state === 'SIGNED') {
        events.push({ type: 'email.send_signed_confirmation', payload: { flowId } });
        events.push({ type: 'crm.notify_completion', payload: { flowId } });
    }
    if (state === 'VERIFICATION_DECLINED') {
        events.push({ type: 'email.send_retry_instructions', payload: { flowId, reason: metadata.reason } });
    }
    return events;
}
```

Un worker procesa outbox de forma desacoplada del state machine → garantía at-least-once.

---

## Evitar "estado derivado en columna"

❌ **Mal:** guardar flags que se pueden calcular:

```
Orders
├── status
├── is_paid        -- derivable de payment_status
├── is_shipped     -- derivable de shipping_status
├── is_complete    -- derivable de status == 'completed'
└── ...
```

Cada flag es riesgo de inconsistencia.

✅ **Bien:** calcular al vuelo:

```js
function isPaid(order) {
    return order.payment_status === 'success';
}
function isShipped(order) {
    return ['shipped', 'delivered'].includes(order.shipping_status);
}
function isComplete(order) {
    return order.current_state === 'COMPLETED';
}
```

Menos chance de bugs, fuente única de verdad.

---

## Timeline / historial

Para cada flujo, tener un historial completo ayuda enormemente al debugging:

```
FlowSteps (append-only)
├── flow_id
├── from_state
├── to_state
├── transitioned_at
├── actor
└── metadata (JSON)
```

Query: "mostrame el timeline de este flow":

```sql
SELECT * FROM FlowSteps
WHERE flow_id = '123'
ORDER BY transitioned_at ASC
```

Result:
```
2026-04-23 10:00:00  null → FORM_FILLED  (system, {})
2026-04-23 10:00:05  FORM_FILLED → AWAITING_VERIFICATION  (system, {})
2026-04-23 10:05:30  AWAITING_VERIFICATION → VERIFICATION_IN_PROGRESS  (webhook-didit, {session_id: '...'})
2026-04-23 10:08:00  VERIFICATION_IN_PROGRESS → VERIFICATION_APPROVED  (webhook-didit, {})
2026-04-23 10:08:05  VERIFICATION_APPROVED → AWAITING_SIGNATURE  (system, {})
...
```

Exponer esto en el panel admin da visibilidad inmejorable.

---

## Idempotencia en transitions

**Caso:** el webhook de un proveedor externo llega dos veces (duplicado o retry del proveedor). Ambos intentan transitar `IN_PROGRESS → APPROVED`. El segundo falla porque ya está en `APPROVED`.

Opción 1: **lanzar error y loguear**

```js
if (!allowedTransitions.includes(newState)) {
    console.warn(`[STATE] Invalid transition ${flow.current_state} → ${newState}, ignoring duplicate`);
    return;  // no throw si ya estamos en el estado target
}
if (flow.current_state === newState) {
    console.log(`[STATE] Already in ${newState}, skip`);
    return;
}
```

Opción 2: **idempotencia por external event_id**

Ver doc 05 — marcar eventos procesados en tabla aparte.

---

## Locking / concurrencia

Dos webhooks llegan al mismo tiempo y ambos quieren transitar el flow. Race condition.

Catalyst no tiene locks nativos en DataStore. Opciones:

### Optimistic locking

Agregar columna `version`:

```js
const flow = await db.flows.getById(app, flowId);  // version = 3
// ... procesar ...
try {
    await app.datastore().table('Flows').updateRow({
        ROWID: flow.id,
        version: flow.version + 1,
        // condición: WHERE version = flow.version (Catalyst no tiene esto nativo)
    });
} catch (err) {
    // otra actualización se adelantó
    throw new ConflictError('Flow was updated concurrently');
}
```

Problema: Catalyst `updateRow` no tiene WHERE compuesto. Workaround: re-leer y verificar.

### Pessimistic: cola

Para casos complejos, toda transición del flow va por un cron secuencial que procesa un outbox:

```
Webhook entrante → inserta en TransitionQueue
Cron → procesa TransitionQueue uno por uno
```

Garantiza orden y evita races.

---

## Observabilidad del flujo

Para cada flow, poder responder:

1. **¿Dónde está ahora?** (current_state)
2. **¿Cuánto lleva ahí?** (awaiting_since vs now)
3. **¿Cómo llegó ahí?** (FlowSteps completa)
4. **¿Qué hizo en cada step?** (metadata del step)
5. **¿Qué steps le faltan?** (state machine diagram)

Si tu sistema responde esto, estás en buen shape.

---

## Checklist de diseño de flujos

Al diseñar un flujo multi-paso:

- [ ] State machine con estados explícitos enumerables
- [ ] Transiciones válidas documentadas
- [ ] `current_state` es una sola columna, no combinación de flags
- [ ] Tabla append-only para historial
- [ ] Patrón event-driven + polling fallback para eventos externos
- [ ] Idempotencia en cada step (retry-safe)
- [ ] Timeouts explícitos con fallback automático
- [ ] Outbox para efectos externos derivados de transitions
- [ ] Audit trail: quién/cuándo/por qué transicionó
- [ ] Panel admin con timeline visible
- [ ] Tests para cada transición válida
- [ ] Runbook para "flow stuck" con pasos de remediación
