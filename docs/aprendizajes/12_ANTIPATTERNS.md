# 12 — Anti-patterns con ejemplos concretos

Patrones que parecen razonables pero causan dolor. Para cada uno: síntoma observable, por qué pasa, y cómo arreglarlo.

---

## 🚨 1. Mega-index.js

### Síntoma
Function con `index.js` de 2000-3000+ líneas con todos los handlers inline.

### Por qué pasa
Es más rápido agregar un handler inline que crear un archivo nuevo. Cada agregado individual parece justificable. El problema es acumulativo.

### Consecuencias
- IDE lagguea al abrir el archivo
- Agentes IA (Claude, Copilot) pierden contexto de lo que hay arriba
- Buscar "dónde se valida X" toma 5 min
- Variables con `var` se filtran entre bloques
- Imposible de testear

### Fix
Modularizar: `handlers/` + `services/` + `db/` + `integrations/` + `middleware/`.

Ver [02_MODULARIZACION.md](02_MODULARIZACION.md) para el plan de refactor.

---

## 🚨 2. Nombres de función que mienten

### Síntoma
Función `validateAdminAuth` que solo valida credenciales, no rol.

```js
async function validateAdminAuth(req, app) {
    // ... valida username/password ...
    // ... valida is_active ...
    return true;  // ← NO valida rol "admin"
}
```

El nombre dice "Admin" pero solo valida auth básica. **Cualquier user autenticado pasa**, incluyendo roles no-admin.

### Consecuencia
Endpoints marcados como "admin" accesibles a roles sin privilegios.

### Fix
- Nombres precisos según lo que realmente hacen
- Separar autenticación (verify credentials) de autorización (check permissions)

```js
async function authenticate(ctx) { /* verify password, return user */ }
async function requireAdmin(ctx) {
    const user = await authenticate(ctx);
    if (user.role !== 'admin') throw new ForbiddenError();
    return user;
}
```

---

## 🚨 3. God object en DataStore

### Síntoma
Una tabla con 30+ columnas que mezclan dominios:

```
Orders tiene:
- customer_name, customer_email  (identidad del cliente)
- product_1_*, product_2_*      (items del pedido)
- payment_*                     (info de pago)
- shipping_*                    (info de envío)
- notification_*                (tracking de emails)
- retry_count, last_error       (operacional)
```

### Consecuencia
- Agregar una feature = agregar 3-5 columnas
- Estados inconsistentes entre columnas
- Schema crece sin control
- Queries complejas

### Fix
Normalizar en tablas por concepto:

```
Customers, Orders, OrderItems, Payments, Shipments, Notifications
```

Ver [03_DATABASE_DESIGN.md](03_DATABASE_DESIGN.md).

---

## 🚨 4. Múltiples columnas de status independientes

### Síntoma
```
Orders
├── status           ('pending', 'success', 'failed')
├── payment_status   ('pending', 'charged')
├── shipping_status  (null, 'shipped', 'delivered')
└── notification_status (null, 'sent', 'failed')
```

El "estado real" es función de 4 columnas. Posibles combinaciones inválidas:
- `status = 'failed'` pero `payment_status = 'charged'` → ¿cobramos pero fallamos?
- `shipping_status = 'shipped'` sin `payment_status = 'charged'` → ¿enviamos sin cobrar?

### Fix
State machine canónica con un solo `current_state`:

```
Orders
├── current_state    ('CART', 'PAYMENT_PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED')

OrderStateTransitions (historial append-only)
├── from_state, to_state, transitioned_at, actor
```

Ver [09_ESTADO_Y_FLUJOS.md](09_ESTADO_Y_FLUJOS.md).

---

## 🚨 5. API_BASE hardcoded en múltiples archivos frontend

### Síntoma
```ts
// App.tsx
const API_BASE = '/server/api_function'

// OrdersPage.tsx
const API_BASE = '/server/api_function'

// UsersPage.tsx
const API_BASE = '/server/api_function'
```

### Consecuencia
Al cambiar (ej. servir desde otro dominio), hay que encontrar y reemplazar en N archivos. Alguien se olvida de uno.

### Fix
```ts
// client/src/config.ts
export const API_BASE = import.meta.env.VITE_API_BASE || '/server/api_function';

// Todos los demás archivos
import { API_BASE } from '@/config';
```

---

## 🚨 6. Polling agresivo sin tolerancia

### Síntoma
Dashboard de admin que hace polling cada 30 seg. 2 usuarios concurrentes 8h/día generan ~200k queries/mes.

### Consecuencia
- Factura de Catalyst alta
- Carga innecesaria en DB
- Sin beneficio real (los datos no cambian cada 30 seg)

### Fix
- Polling cada 60-120 seg (suficiente para dashboards)
- Pausar polling cuando tab no visible (`document.visibilityState`)
- Si necesitás "casi real-time", considerar SSE o webhooks push

---

## 🚨 7. Queries N+1

### Síntoma
```js
const orders = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
for (const order of orders) {
    const customer = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Customers WHERE ROWID = '${order.Orders.customer_id}'`
    );
    order.customer = customer[0].Customers;
}
```

Para 100 orders: **101 queries**.

### Fix
Batch con `IN`:

```js
const orders = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
const customerIds = [...new Set(orders.map(o => o.Orders.customer_id))];
const customers = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Customers WHERE ROWID IN (${customerIds.map(escapeSql).join(',')})`
);
const byId = Object.fromEntries(customers.map(c => [c.Customers.ROWID, c.Customers]));
orders.forEach(o => o.customer = byId[o.Orders.customer_id]);
```

Para 100 orders: **2 queries**. 50× menos.

---

## 🚨 8. Cron que rethrow

### Síntoma peligroso
```js
module.exports = async (req, res) => {
    const app = catalyst.initialize(req);
    await runJobs(app);  // si tira, Catalyst apaga el cron silenciosamente
    res.end(JSON.stringify({ success: true }));
};
```

### Consecuencia
Si una corrida del cron lanza excepción, Catalyst **lo apaga automáticamente**, sin alerta. El cron deja de ejecutarse y vos ni te enterás.

### Fix
Try/catch raíz que NUNCA rethrow:

```js
module.exports = async (req, res) => {
    try {
        const app = catalyst.initialize(req);
        await runJobs(app);
    } catch (err) {
        console.error('[CRON] Error crítico:', err.message, err.stack);
        // NO rethrow, NO process.exit
    } finally {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
    }
};
```

Y monitoreo externo que verifique que el cron sigue corriendo.

Ver [05_RELIABILITY.md](05_RELIABILITY.md).

---

## 🚨 9. Trigger manual sin precondition check

### Síntoma
Un botón en el panel admin dispara una acción irreversible (cobrar, enviar notificación, integrar con tercero) sin validar el estado:

```js
async function handleManualCharge(req, res, app, orderId) {
    await validateAuth(req);
    const order = await getOrder(app, orderId);
    // FALTA: chequear que la orden esté en estado cobrable
    await charge(order);
}
```

### Consecuencia
Un operador hace click por error o en el momento inadecuado → cobro duplicado, notificación enviada cuando no correspondía, etc.

### Fix
Validar precondiciones antes de ejecutar:

```js
if (order.current_state !== 'PAYMENT_PENDING') {
    throw new ValidationError(
        `Cannot charge: current state is ${order.current_state}, expected PAYMENT_PENDING`
    );
}
if (order.charged_at) {
    throw new ValidationError('Order already charged');
}
```

Y en el frontend, deshabilitar el botón si la precondición no se cumple.

---

## 🚨 10. URLs hardcoded de dev

### Síntoma
```js
// integrations/pdfProxy.js
const PROXY_BASE = 'https://myapp-123456.development.catalystserverless.com/server/proxy';
```

Cuando se deploy a producción, sigue apuntando a dev.

### Consecuencia
Archivos se generan en dev desde prod, o viceversa. Data mezclada entre ambientes.

### Fix
Env var con fallback razonable:

```js
function getProxyBase() {
    const base = process.env.APP_BASE_URL
        || 'https://myapp-123456.development.catalystserverless.com';
    return `${base}/server/proxy`;
}
```

En producción, `APP_BASE_URL` se configura a la URL de prod.

---

## 🚨 11. Match laxo en búsqueda externa

### Síntoma
Buscar un folder/registro en un sistema externo por `includes`:

```js
const existing = folders.find(f => f.name.includes(customerId));
```

Si existen:
- `Cliente 12345` ✓ match
- `Cliente 12345 (duplicado)` ✓ match
- `Cliente 123456` ✓ match (substring false positive)

Se elige inconsistentemente.

### Fix
Regex con anchor o match exacto:

```js
const regex = new RegExp(`-\\s*${escapeRegex(customerId)}\\s*$`);
const existing = folders.find(f => regex.test(f.name));
```

O mejor: buscar por ID único (no nombre).

---

## 🚨 12. Retry sin distinguir errores

### Síntoma
```js
async function fetchUser(id) {
    for (let i = 0; i < 3; i++) {
        try { return await api.getUser(id); }
        catch (e) { /* retry no matter what */ }
    }
}
```

Reintenta un 404 (user no existe) tres veces. No arregla nada, solo atrasa el error.

### Fix
Distinguir transitorios (5xx, timeout, network) de permanentes (4xx):

```js
async function fetchWithRetry(fn, maxRetries = 3) {
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); }
        catch (err) {
            lastErr = err;
            if (err.response?.status >= 400 && err.response?.status < 500) {
                throw err;  // error de cliente, no retry
            }
            await sleep(1000 * Math.pow(2, i));  // backoff exponencial
        }
    }
    throw lastErr;
}
```

---

## 🚨 13. HMAC solo con una versión

### Síntoma
Validás webhook con una sola versión de firma:

```js
const signature = req.headers['x-signature'];
const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
if (signature !== expected) return reject();
```

### Consecuencia
El proveedor actualiza a v2 (con timestamp o formato distinto). Todos los webhooks llegan con 401. Enteras 3 días después.

### Fix
Soportar múltiples versiones durante transición:

```js
function verifySignature(req, body) {
    const sigV2 = req.headers['x-signature-v2'];
    const timestamp = req.headers['x-timestamp'];
    if (sigV2 && timestamp) {
        const expected = crypto.createHmac('sha256', secret)
            .update(`${timestamp}.${body}`).digest('hex');
        if (timingSafeEqual(sigV2, expected)) return true;
    }

    const sigV1 = req.headers['x-signature'];
    if (sigV1) {
        const expected = crypto.createHmac('sha256', secret)
            .update(body).digest('hex');
        if (timingSafeEqual(sigV1, expected)) return true;
    }

    return false;
}
```

---

## 🚨 14. Tracking con JSON en columna

### Síntoma
```
Users.notifications_sent = {"welcome":true,"password_reset":true,"upgrade":false}
```

### Consecuencia
Para saber "¿cuántos users recibieron welcome email este mes?" tenés que scanear toda la tabla y parsear JSON. Queries lentas y caras.

### Fix
Tabla normalizada `NotificationsSent`:

```
NotificationsSent
├── id
├── user_id
├── template_key
├── sent_at
└── channel
```

Query natural y rápida:

```sql
SELECT COUNT(*) FROM NotificationsSent
WHERE template_key = 'welcome'
  AND sent_at > '2026-04-01'
```

---

## 🚨 15. Fallback silencioso

### Síntoma
```js
try {
    await sendEmail(user);
} catch (err) {
    // nada
}
// continúa como si nada pasó
```

### Consecuencia
Emails no llegan, nadie se entera. Descubrís el problema cuando el usuario reclama 3 semanas después.

### Fix
Log + alternative + registro en DB:

```js
try {
    await sendEmail(user);
    await logNotification(app, user.id, 'email', 'sent');
} catch (err) {
    console.error(`[NOTIFY] Email failed for ${user.id}:`, err.message);
    await logNotification(app, user.id, 'email', 'failed', err.message);

    try {
        await sendSms(user);  // fallback
        await logNotification(app, user.id, 'sms', 'sent_as_fallback');
    } catch (err2) {
        console.error(`[NOTIFY] SMS fallback failed:`, err2.message);
        await markForManualReview(app, user.id, 'all_channels_failed');
    }
}
```

---

## 🚨 16. Fire-and-forget sin tracking

### Síntoma
```js
(async () => {
    await sendWelcomeEmail(user);
})();  // sin await, sin log
proceedWithMainFlow();
```

### Consecuencia
Si falla, no hay forma de saber. Si el runtime termina mientras ejecuta, queda truncado.

### Fix
Outbox pattern: guardar el evento pendiente en DB, un worker async lo procesa con retry.

Ver [05_RELIABILITY.md](05_RELIABILITY.md) sección Outbox.

---

## 🚨 17. Timeout ausente en HTTP calls

### Síntoma
```js
const res = await axios.post(url, payload);  // sin timeout
```

### Consecuencia
Si el endpoint externo cuelga, tu function sigue esperando. Catalyst la mata a los 30 seg. Perdés la ejecución entera.

### Fix
Timeout explícito siempre:

```js
const res = await axios.post(url, payload, {
    timeout: 15000,
    validateStatus: () => true  // no throw por status >= 400
});
```

Timeout máximo < 30 seg (el límite de Catalyst Advanced I/O). Para Cron Functions podés ir hasta 15 min.

---

## 🚨 18. SQL injection via concatenación

### Síntoma
```js
const query = `SELECT * FROM Users WHERE username = '${username}'`;
```

Si `username = "admin' OR '1'='1"`:
```
SELECT * FROM Users WHERE username = 'admin' OR '1'='1'
```
→ devuelve todos los users.

### Fix
Escape siempre:

```js
function escapeSql(v) {
    if (v == null) return '';
    return String(v).replace(/'/g, "''");
}
const query = `SELECT * FROM Users WHERE username = '${escapeSql(username)}'`;
```

Y validar inputs con regex antes (whitelist):
```js
if (!/^[a-z0-9_.]+$/i.test(username)) throw new ValidationError('Invalid username');
```

---

## 🚨 19. Secrets en código o logs

### Síntoma
```js
const API_KEY = 'sk_live_abc123xyz789...';  // hardcoded

console.log(`Calling API with key ${process.env.API_KEY}`);  // loguea completo
```

### Consecuencia
- Secret commiteado en git (historia forever)
- Logs de Catalyst exponen secret a cualquiera con acceso

### Fix
Env vars + nunca logear completo:

```js
// env: STRIPE_SECRET_KEY=sk_live_...
const apiKey = process.env.STRIPE_SECRET_KEY;

// Para debug, solo fragmento
const frag = apiKey ? `${apiKey.slice(0,4)}…${apiKey.slice(-4)}` : 'null';
console.log(`[AUTH] key=${frag}`);
```

---

## 🚨 20. Sin validación de input

### Síntoma
```js
async function handleGetOrder(req, res, app, orderId) {
    // orderId viene de la URL, nunca validado
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Orders WHERE ROWID = '${orderId}'`
    );
}
```

### Consecuencia
SQL injection si `orderId` tiene comillas. Queries malformadas. Errores cripticos.

### Fix
Validar whitelist antes de usar:

```js
function validateRowId(id) {
    return typeof id === 'string' && /^\d{1,20}$/.test(id);
}

if (!validateRowId(orderId)) {
    return sendJson(res, 400, { error: 'Invalid order ID' });
}
```

---

## 🚨 21. Enumeración de IDs secuenciales públicos

### Síntoma
URL pública con ID secuencial:
```
GET /public/order/123
GET /public/order/124
GET /public/order/125
```

Cualquiera puede enumerar todos los registros.

### Fix
Token aleatorio por registro (256 bits):

```js
// Al crear el recurso
const accessToken = crypto.randomBytes(32).toString('hex');
await db.orders.create({ ...payload, access_token: accessToken });
// Devolver el token al cliente en la response

// En el endpoint público
GET /public/order/123?token=abc123...

async function handlePublicOrder(ctx) {
    if (!await validateToken(ctx.app, orderId, providedToken)) {
        throw new ForbiddenError('Invalid token');
    }
    // ...
}
```

---

## 🚨 22. Response 200 antes de procesar sin idempotencia

### Síntoma
```js
exports.handleWebhook = async (ctx) => {
    sendJson(ctx.res, 200, { received: true });  // rápido
    await processEvent(event);  // si falla, el proveedor no lo sabe
};
```

### Consecuencia
- Si el processing async falla, el proveedor cree que OK (ya devolvió 200)
- El proveedor puede mandar duplicados (reintentos de su lado) y procesás dos veces

### Fix
Idempotencia por `event_id` + outbox:

```js
exports.handleWebhook = async (ctx) => {
    const event = await verifyAndParse(ctx);

    const isNew = await markProcessed(ctx.app, event.id, 'stripe');
    if (!isNew) {
        return sendJson(ctx.res, 200, { received: true, duplicate: true });
    }

    sendJson(ctx.res, 200, { received: true });  // responder

    // Procesar async, con retry si falla
    processEventAsync(event).catch(err => {
        console.error(`[WEBHOOK] Async error:`, err.message);
    });
};
```

---

## 🚨 23. CORS permisivo en producción

### Síntoma
```js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

### Consecuencia
Cualquier sitio puede hacer requests con las cookies de tus usuarios. CSRF.

### Fix
Whitelist explícita:

```js
const allowedOrigins = [
    'https://myapp.com',
    'https://staging.myapp.com'
];

const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
}
```

---

## 🚨 24. Hardcodear strings de rol

### Síntoma
```js
if (user.role === 'admin') { /* ... */ }
if (user.role === 'cumplimiento' || user.role === 'supervisor') { /* ... */ }
```

Typos posibles: `'Admin'` vs `'admin'` vs `'ADMIN'`. Inconsistencia entre archivos.

### Fix
Constantes centralizadas:

```js
// lib/roles.js
exports.ROLES = Object.freeze({
    ADMIN: 'admin',
    OPERATOR: 'operator',
    VIEWER: 'viewer'
});

// Uso
if (user.role === ROLES.ADMIN) { }
```

---

## 🚨 25. Copy-paste de validación entre handlers

### Síntoma
```js
// handler 1
if (!authHeader || !authHeader.startsWith('Basic ')) { /* ... */ }

// handler 2
if (!authHeader || !authHeader.startsWith('Basic ')) { /* ... */ }

// handler 3 — con bug sutil, olvidaron el check
if (authHeader.startsWith('Basic ')) { /* ... */ }  // falla si undefined
```

### Fix
Middleware reutilizable:

```js
// middleware/auth.js
exports.authenticate = async (ctx) => { /* lógica única */ };

// En cada handler
ctx.user = await auth.authenticate(ctx);
```

---

## 🚨 26. Magic numbers

### Síntoma
```js
if (minutesInState < 2) continue;
if (Date.now() - updatedAt > 60000) markTimeout();
if (rows.length > 500) rows = rows.slice(0, 500);
```

### Fix
Constantes nombradas:

```js
const REMINDER_DELAY_MIN = 2;
const PROCESS_TIMEOUT_MS = 60_000;
const MAX_ROWS_DISPLAY = 500;
```

---

## 🚨 27. `any` en TypeScript sin razón

### Síntoma
```ts
function processData(data: any) { /* ... */ }
```

Perdés type safety. Si el dato cambia, compilador no avisa.

### Fix
Tipar correctamente:

```ts
interface UserData {
    id: string;
    name: string;
    role: 'admin' | 'user';
}
function processData(data: UserData) { }
```

Si realmente no sabés la shape, `unknown` es mejor que `any` (fuerza narrow antes de usar).

---

## 🚨 28. Callback hell

### Síntoma
```js
getData().then(data => {
    processData(data).then(result => {
        save(result).then(() => {
            notify().then(() => {
                // ...
            });
        });
    });
});
```

### Fix
async/await:

```js
const data = await getData();
const result = await processData(data);
await save(result);
await notify();
```

---

## 🚨 29. Mutar state directamente en React

### Síntoma
```tsx
const [orders, setOrders] = useState([]);
orders.push(newOrder);  // mutación directa, no triggerea re-render
setOrders(orders);       // React compara por referencia, cree que no cambió
```

### Fix
Inmutable:

```tsx
setOrders(prev => [...prev, newOrder]);
```

---

## 🚨 30. Sin error boundary en React

### Síntoma
Un bug en un componente hijo explota toda la app, el usuario ve pantalla en blanco.

### Fix
Error Boundaries en rutas principales:

```tsx
class ErrorBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error, info) { console.error(error, info); }
    render() {
        if (this.state.hasError) return <FallbackUI />;
        return this.props.children;
    }
}

<ErrorBoundary>
    <OrdersPage />
</ErrorBoundary>
```

---

## El meta-antipattern: "lo arreglo después"

**La trampa más peligrosa.** Cada línea escrita con "lo mejoro después" es deuda técnica pura:

- "Después voy a modularizar este index.js" → sigue en 3000 líneas 6 meses después
- "Después agrego validación" → bug de seguridad en producción
- "Después pongo logs" → debuggeo ciego en incidente nocturno
- "Después centralizo el API_BASE" → 3 archivos, cambio incompleto

**Regla:** si ya ves el problema, invertí 10 min ahora. 10 min hoy ahorran 10 horas en 3 meses.

---

## Cómo usar este documento

En tus code reviews, usá esta lista como checklist rápido:

- ¿Hay mega-files?
- ¿Nombres mienten?
- ¿Estados combinables?
- ¿URLs hardcoded?
- ¿Crons sin try/catch raíz?
- ¿Validación ausente?
- ¿Fallbacks silenciosos?
- ¿Timeouts ausentes?
- ¿Secrets visibles?
- ¿Match laxo en búsquedas?

Si alguno aplica → refactor antes de mergear.
