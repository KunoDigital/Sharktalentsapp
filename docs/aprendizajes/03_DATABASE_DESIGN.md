# 03 — Diseño de Base de Datos en Catalyst

Reglas prácticas para diseñar tablas en Catalyst DataStore, con ejemplos que aplican a cualquier proyecto.

---

## El anti-pattern de la tabla god-object

**Definición:** una tabla única que mezcla múltiples dominios de responsabilidad.

### Ejemplo concreto del anti-pattern

Imaginá una app de e-commerce con checkout. Tentación: meter todo en una tabla:

```
Orders
├── id
├── customer_name, customer_email, customer_phone, customer_address_...
├── product_1_name, product_1_price, product_1_qty
├── product_2_name, product_2_price, product_2_qty
├── product_3_name, product_3_price, product_3_qty    ← y si hay 4?
├── payment_method, payment_card_last4, payment_status, payment_error
├── shipping_status, shipping_tracking, shipping_carrier
├── notification_email_sent, notification_sms_sent
├── notes_from_customer, notes_internal
├── coupon_code, coupon_amount
├── retry_count, last_error_message, last_error_at
├── ... (40+ columnas)
```

**Problemas:**
- No escala: 4 productos no cabe, hay que agregar columnas o usar JSON
- Estados mezclados: `payment_status = 'success'` pero `shipping_status = null` → ¿enviado o no?
- Cada feature nueva agrega columnas → 60 columnas en 6 meses
- Queries difíciles: "ordenes con pago OK pero sin shipping" requiere combinar múltiples columnas
- Un cambio en `Products` requiere ALTER TABLE en `Orders`

---

## El diseño relacional correcto

Separá por dominio conceptual:

```
Customers (identidad del cliente)
├── id
├── name
├── email
├── phone
└── default_address_id

Addresses (direcciones, N por cliente)
├── id
├── customer_id
├── street, city, country, postal_code
└── label (home/work/...)

Orders (una orden)
├── id
├── customer_id
├── shipping_address_id
├── current_state           ← state machine
├── coupon_id (nullable)
├── total_amount
└── created_at

OrderItems (productos dentro de la orden, N por orden)
├── id
├── order_id
├── product_id
├── quantity
├── unit_price
└── total_price

Payments (1+ intentos de pago por orden)
├── id
├── order_id
├── method
├── status            ← enum
├── external_id       ← ID del gateway (Stripe, etc.)
├── amount
├── error_code
├── error_message
├── attempted_at
└── completed_at

Shipments (tracking)
├── id
├── order_id
├── carrier
├── tracking_number
├── status
└── updated_at

Notifications (emails/SMS enviados)
├── id
├── order_id
├── channel           ← 'email', 'sms'
├── template_key      ← 'order_confirmed', 'shipment_shipped'
├── status            ← 'sent', 'failed'
├── sent_at
└── error (nullable)
```

**Ventajas:**
- Un customer puede tener N orders
- Una order puede tener N items, N payment attempts, N shipments, N notifications
- Estados por dominio, no mezclados
- Agregar features (ej. `GiftWrapping`) no toca `Orders`
- Queries naturales: `WHERE status = 'pending'` en la tabla relevante
- Auditabilidad: todo attempt de payment queda registrado

---

## Cuándo NO normalizar

La teoría dice "siempre normaliza". La práctica tiene matices.

### ✅ Guardar como JSON en columna si:

- El objeto se lee/escribe **siempre junto** con el registro padre
- Nunca filtrás/agrupás por sus campos internos
- El tamaño es pequeño (< 500 bytes)
- El dato es "raw", sirve solo para debugging/audit

**Ejemplo válido:** guardar el payload completo del request que creó un pedido:

```
Orders
├── ...
└── raw_request (JSON string, truncado)   ← solo para debug, nunca se queryea por contenido
```

### ❌ NO guardar como JSON si:

- Necesitás filtrar o agrupar por sus campos
- El contenido crece (N items dentro del JSON)
- Queries del tipo "¿cuántos registros tienen X?" requerirían parsear todo

**Ejemplo MAL:** `notifications_sent` como JSON `{"email_confirmed":true,"sms_shipped":true}`.

Para saber "¿cuántos shipments notificaron por SMS este mes?" tenés que scanear toda la tabla y parsear JSON. Queries lentas y caras.

**Fix:** tabla `Notifications` normalizada (ver diseño arriba). Query natural:

```sql
SELECT COUNT(*) FROM Notifications
WHERE channel = 'sms'
  AND template_key = 'shipment_shipped'
  AND sent_at > '2026-04-01'
```

---

## Quirks específicos de Catalyst DataStore

Estas son particularidades de Catalyst que tenés que conocer.

### 1. Row wrapping en ZCQL

Cuando hacés una query ZCQL, Catalyst devuelve las filas envueltas en un objeto con el nombre de la tabla:

```js
const rows = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
// rows = [
//   { Orders: { ROWID: '123', status: 'pending' } },
//   { Orders: { ROWID: '124', status: 'completed' } }
// ]
```

**Siempre normalizá** con un helper:

```js
// lib/dbHelpers.js
exports.normalizeRow = (raw, tableName) => raw[tableName] || raw;
exports.normalizeRows = (raws, tableName) => raws.map(r => r[tableName] || r);

// Uso
const raws = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
const orders = normalizeRows(raws, 'Orders');
// orders = [{ ROWID, status }, { ROWID, status }]
```

### 2. Límite 5000 caracteres en campos Text

Los campos de tipo `Text` en Catalyst se truncan silenciosamente si superan 5000 chars. **Siempre truncá al escribir:**

```js
function truncate(str, max = 4800) {  // margen de seguridad
    if (!str) return str;
    return String(str).length > max ? String(str).substring(0, max) : str;
}

await app.datastore().table('Payments').updateRow({
    ROWID: paymentId,
    error_message: truncate(err.message),
    gateway_response: truncate(JSON.stringify(response))
});
```

### 3. ROWID es la primary key automática

Catalyst asigna `ROWID` (BigInt) automáticamente. **No creés una columna `id` custom** — redundante.

```js
// ✅ Usá ROWID directamente
await table.getRow(rowId);  // rowId es ROWID
```

### 4. CREATEDTIME / MODIFIEDTIME son automáticas

Cada row tiene estos dos timestamps automáticamente. **No los mantengas a mano.**

Si necesitás un `updated_at` operacional **diferente** del `MODIFIEDTIME` (ej. "última vez que el usuario interactuó"), usá otro nombre:

```
Orders
├── last_user_interaction_at   ← operacional, vos lo manejás
├── ...
└── (MODIFIEDTIME es automático, último update técnico)
```

### 5. DateTime custom necesita helpers

Catalyst tiene tipo `DateTime` pero con formato específico. No siempre es compatible con JS directo:

```js
// lib/date.js

// Escribir en Catalyst: formato "YYYY-MM-DD HH:mm:ss"
exports.toCatalystDateTime = (date = new Date()) =>
    date.toISOString().replace('T', ' ').substring(0, 19);

// Leer de Catalyst: formato "YYYY-MM-DD HH:mm:ss:SSS" (con ':' antes de ms, no '.')
exports.parseCatalystDateTime = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date) return raw.getTime();
    let s = String(raw).trim();
    s = s.replace(/(\d{2}:\d{2}:\d{2}):(\d{3})/, '$1.$2');
    if (!/[TZ+]/.test(s)) s = s.replace(' ', 'T') + 'Z';
    const t = new Date(s).getTime();
    return isNaN(t) ? null : t;
};
```

### 6. No hay JOINs reales en ZCQL

Las queries cross-tabla no existen. Opciones:

**Opción A — doble query + merge en memoria:**

```js
const orders = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Orders WHERE status = 'pending'`
);
const customerIds = [...new Set(orders.map(o => o.Orders.customer_id))];
const customers = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Customers WHERE ROWID IN (${customerIds.join(',')})`
);
const customersById = Object.fromEntries(
    customers.map(c => [c.Customers.ROWID, c.Customers])
);
const enriched = orders.map(o => ({
    ...o.Orders,
    customer: customersById[o.Orders.customer_id]
}));
```

**Opción B — desnormalizar campos clave:**

Si frecuentemente necesitás `customer_name` junto con `order`, guardalo como snapshot en `Orders`:

```
Orders
├── customer_id         ← FK para la verdad canónica
├── customer_name       ← snapshot al crear la orden (legible sin join)
└── ...
```

Trade-off: performance vs consistencia eventual si el nombre cambia.

### 7. Idempotencia a nivel aplicación

ZCQL **no tiene UNIQUE constraint real**. Si necesitás que `external_event_id` sea único, el check se hace en código:

```js
async function createOrUpdateByExternalId(app, externalId, data) {
    const existing = await app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM Events WHERE external_id = '${escapeSql(externalId)}'`
    );
    if (existing.length > 0) {
        const id = existing[0].Events.ROWID;
        await app.datastore().table('Events').updateRow({ ROWID: id, ...data });
        return { id, created: false };
    }
    const inserted = await app.datastore().table('Events').insertRow({
        external_id: externalId,
        ...data
    });
    return { id: inserted.ROWID, created: true };
}
```

**⚠️ Race condition:** si dos requests llegan al mismo tiempo con el mismo `external_id`, ambos pueden pasar el check `existing.length === 0` y hacer dos inserts. Para mitigar:
- Asumir que puede pasar y tener un cleanup cron que merge duplicados
- O usar una tabla `IdempotencyLocks` con un lock pessimista

### 8. No hay transactions multi-row

Catalyst no soporta transactions tradicionales. Si necesitás "actualizar A y B atómicamente", diseñá para idempotencia (cada paso se puede re-ejecutar sin daño) en lugar de confiar en transactions.

Ver [05_RELIABILITY.md](05_RELIABILITY.md) sobre saga pattern para flujos multi-paso.

### 9. Paginación obligatoria

ZCQL soporta `LIMIT` y `OFFSET`. Usalos en toda lista grande:

```js
const page = parseInt(ctx.query.page || '1', 10);
const pageSize = Math.min(parseInt(ctx.query.size || '50', 10), 200);  // cap máximo
const offset = (page - 1) * pageSize;

const rows = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Orders ORDER BY CREATEDTIME DESC LIMIT ${pageSize} OFFSET ${offset}`
);
```

### 10. Búsqueda full-text es lenta

`WHERE text_field LIKE '%foo%'` funciona pero escanea toda la tabla. Para búsqueda frecuente:
- Desnormalizá campos derivados (ej. `search_text` con el nombre + email + tags concatenados y en lowercase)
- Considerá índice externo (Algolia, Meilisearch) si el volumen lo justifica (>100k rows con búsqueda frecuente)

---

## Patrón: State machine explícita

En vez de múltiples columnas de status independientes, diseñá **un estado canónico**.

### ❌ Anti-pattern: estados mezclados

```
Orders
├── status            ('inicio', 'pending', 'success', 'failed')
├── payment_status    ('pending', 'charged', 'refunded')
├── shipping_status   (null, 'preparing', 'shipped', 'delivered')
├── notification_status (null, 'sent', 'failed')
└── ...
```

El "estado real" es función compleja de 4+ columnas. Combinaciones inválidas posibles:
- `payment_status = 'charged'` pero `status = 'failed'` → inconsistente
- `shipping_status = 'shipped'` sin `payment_status = 'charged'` → enviamos sin cobrar?

### ✅ Patrón: estado canónico + historial

```
Orders
├── id
├── current_state     ← una sola columna canónica
└── ...

Estados posibles (enum):
- CART           (usuario armando el carrito)
- CHECKOUT       (ingresando datos)
- PAYMENT_PENDING
- PAYMENT_FAILED
- PAID
- PREPARING
- SHIPPED
- DELIVERED
- CANCELLED
- REFUNDED

OrderStateTransitions (append-only, historial)
├── id
├── order_id
├── from_state
├── to_state
├── transitioned_at
├── actor          (user/system/webhook)
└── metadata (JSON — razón, datos asociados)
```

Y en código defininá transiciones válidas:

```js
const TRANSITIONS = {
    CART: ['CHECKOUT', 'CANCELLED'],
    CHECKOUT: ['PAYMENT_PENDING', 'CART', 'CANCELLED'],
    PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED'],
    PAYMENT_FAILED: ['PAYMENT_PENDING', 'CANCELLED'],
    PAID: ['PREPARING', 'REFUNDED'],
    PREPARING: ['SHIPPED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: ['REFUNDED'],
    CANCELLED: [],
    REFUNDED: []
};

async function transitionTo(app, orderId, newState, actor, metadata = {}) {
    const order = await ordersDb.getById(app, orderId);
    const allowed = TRANSITIONS[order.current_state] || [];
    if (!allowed.includes(newState)) {
        throw new Error(`Invalid transition: ${order.current_state} → ${newState}`);
    }

    await app.datastore().table('Orders').updateRow({
        ROWID: orderId,
        current_state: newState
    });
    await app.datastore().table('OrderStateTransitions').insertRow({
        order_id: orderId,
        from_state: order.current_state,
        to_state: newState,
        transitioned_at: toCatalystDateTime(),
        actor,
        metadata: JSON.stringify(metadata)
    });
}
```

**Ventajas:**
- Imposible estar en estado inconsistente
- Historia completa ("¿cómo llegó a CANCELLED?") en `OrderStateTransitions`
- Queries triviales: `WHERE current_state = 'PAID'`
- Agregar un estado nuevo solo requiere updatear el enum y las transitions

Ver [09_ESTADO_Y_FLUJOS.md](09_ESTADO_Y_FLUJOS.md) para más profundo.

---

## Patrón: tablas históricas append-only

Para tracking de actividad, usá una tabla separada **append-only** (solo INSERTs, nunca UPDATEs):

```
PaymentAttempts (append-only)
├── id
├── order_id
├── attempted_at
├── amount
├── status
├── gateway_response (JSON truncated)
└── error_code (nullable)
```

Cada intento de pago es una fila nueva. El "último estado" se deriva:

```sql
SELECT * FROM PaymentAttempts WHERE order_id = 'X' ORDER BY attempted_at DESC LIMIT 1
```

**Ventajas:**
- Historia completa: podés ver cuántos intentos hubo, cuándo, qué falló
- Append-only es más simple (sin race conditions en updates)
- Auditoría natural

---

## Índices implícitos

Catalyst no expone índices como SQL tradicional, pero sí optimiza ciertos patterns:

- Columnas frecuentemente usadas en `WHERE =` → considerá hacerlas `Text (short)` en vez de `Text (long)`
- Rangos por fecha → usá tipo `DateTime`, no string (permite comparaciones nativas)
- Múltiples valores → usá `IN (...)` en vez de múltiples `OR`

---

## Naming conventions

### Tablas en PascalCase plural

```
Users, Orders, Payments, OrderItems, Notifications
```

### Columnas en snake_case

```
created_at, updated_at, user_id, external_event_id, is_active
```

### Foreign keys como `<entidad>_id`

```
order_id     (no "orders_id", no "orderId")
customer_id  (no "customer", solo el ID)
```

### Booleans como `is_` o `has_`

```
is_active
is_primary
has_subscription
has_agreed_to_terms
```

### Timestamps terminan en `_at`

```
created_at, updated_at, shipped_at, cancelled_at, deleted_at
```

### Enums en SCREAMING_SNAKE

```
current_state: 'PAYMENT_PENDING'
channel: 'EMAIL' / 'SMS'
```

---

## Checklist de diseño de tabla nueva

Antes de crear una tabla, respondé:

- [ ] ¿Cuál es la entidad que representa? (UNA sola)
- [ ] ¿Qué operaciones va a recibir? (leer por PK, filtrar por X, agregación)
- [ ] ¿Hay columnas que son JSON de cosas que van a crecer? → tabla aparte
- [ ] ¿Hay columnas que son "estado derivado"? → calculable al vuelo, no guardar
- [ ] ¿Hay columnas de historia/tracking? → tabla aparte append-only
- [ ] ¿Los nombres son claros y consistentes?
- [ ] ¿Los tipos son los mínimos necesarios? (no Text si son 20 chars)
- [ ] ¿Se va a necesitar paginar? → columna de ordering estable (`CREATEDTIME`)
- [ ] ¿Hay idempotencia natural? → columna dedicada con check en código
- [ ] ¿Va a crecer >10k rows/mes? → pensar archival strategy
- [ ] ¿Hay state machine implícita? → hacela explícita con `current_state` + transitions

---

## Migrar de god-object a relacional

Si heredás una tabla god-object, refactor progresivo:

### Fase 1 — nuevas features van a tablas nuevas
Al agregar feature X, crearla en tabla separada. La vieja se mantiene para features viejas.

### Fase 2 — migrar features viejas una por una
- Crear tabla nueva con data relevante
- Script de migración que copia de vieja a nueva
- Código dual-read (lee de la nueva si existe, cae en la vieja si no)
- Eventualmente todos los reads van a la nueva

### Fase 3 — stop writing a columnas viejas
No se pueden borrar columnas fácil en Catalyst, pero sí dejar de escribirlas y renombrarlas a `deprecated_<nombre>` como advertencia para futuros devs.

---

## Reglas de oro

1. **Una tabla = una entidad.**
2. **Estado complejo = state machine explícita + historial append-only.**
3. **JSON solo para raw data no queryeable.**
4. **Idempotencia con columna + check en código.**
5. **Fechas como DateTime, no string ISO.**
6. **Normalizá primero, desnormalizá solo por performance medida.**
7. **Cap en row size — Text truncado al escribir.**
8. **Paginación obligatoria en listas.**
9. **Nombres descriptivos, consistentes, en el idioma del negocio.**
10. **Archival strategy para tablas que crecen lineal.**
