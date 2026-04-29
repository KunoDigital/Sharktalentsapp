# 02 — Modularización: por qué index.js no debe crecer

## El problema

En Catalyst Functions, cada function tiene un `index.js` que es el entry point. La tentación es meter todo ahí. **No lo hagas.**

Un `index.js` de 3000 líneas tiene consecuencias concretas:

- Al cargar en VS Code, el IDE se lagguea
- Los agentes IA (Claude, Copilot) pierden contexto de lo que hay arriba
- Buscar "dónde se valida X" toma 5 minutos
- Un bug en el handler A puede afectar al handler B (estado compartido accidental)
- Los PRs son enormes y no se pueden revisar bien
- Testing es casi imposible

---

## La regla dura

**`index.js` solo contiene 3 cosas:**

1. `require()` de dependencias
2. El `module.exports = async (req, res) => { ... }` con el router
3. Logs de errores de nivel raíz

**Todo lo demás vive en módulos separados.**

---

## Anti-pattern: el mega-index.js

```js
// ❌ MAL — todo inline en index.js

module.exports = async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const app = catalyst.initialize(req);

    if (req.method === 'POST' && parsedUrl.pathname === '/orders') {
        // Validar auth
        // ... 30 líneas de auth ...

        // Validar payload
        // ... 40 líneas de validación ...

        // Lógica de creación
        // ... 80 líneas ...

        // Enviar notificación
        // ... 40 líneas ...

        // Response
        // ...
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/orders') {
        // Auth otra vez (copy-paste)
        // ... 30 líneas ...

        // Paginación, filtros
        // ... 60 líneas ...
    }

    // ... 20 endpoints más = 2500 líneas
};
```

**Síntomas que aparecen:**
- Variables declaradas con `var` que se filtran entre bloques
- El mismo helper definido 3 veces en lugares distintos
- Patrón copy-paste obvio
- Tests imposibles sin levantar todo

---

## Patrón correcto: router minimal + handlers modulares

### Estructura de archivos

```
my_function/
├── index.js                    ← 100 líneas, solo router
├── catalyst-config.json
├── handlers/                   ← un archivo por recurso
│   ├── orders.js
│   ├── users.js
│   ├── payments.js
│   └── webhooks.js
├── services/                   ← lógica de negocio (no tocar HTTP)
│   ├── ordersService.js
│   ├── notificationsService.js
│   └── paymentsService.js
├── integrations/               ← wrappers de APIs externas
│   ├── stripe.js
│   ├── sendgrid.js
│   └── twilio.js
├── db/                         ← queries y helpers de DataStore
│   ├── orders.js
│   ├── users.js
│   └── helpers.js              ← normalizeRow, escapeSql, toCatalystDateTime
├── middleware/
│   ├── auth.js
│   ├── validation.js
│   └── rateLimit.js
└── lib/                        ← utils genéricos
    ├── hmac.js
    ├── errors.js
    └── retry.js
```

### Ejemplo: index.js minimal

```js
// index.js
const url = require('url');
const catalyst = require('zcatalyst-sdk-node');

const orders = require('./handlers/orders');
const users = require('./handlers/users');
const webhooks = require('./handlers/webhooks');
const health = require('./handlers/health');
const auth = require('./middleware/auth');

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
    const parsed = url.parse(req.url, true);
    const app = catalyst.initialize(req);
    const ctx = { req, res, app, parsed, params: {} };

    try {
        const method = req.method;
        const path = parsed.pathname;

        // Health check (público)
        if (method === 'GET' && path === '/health') {
            return await health.check(ctx);
        }

        // Orders CRUD
        if (method === 'POST' && path === '/orders') {
            return await auth.withAuth(ctx, orders.create);
        }
        if (method === 'GET' && path === '/orders') {
            return await auth.withAuth(ctx, orders.list);
        }
        const orderMatch = path.match(/^\/orders\/(\d+)$/);
        if (orderMatch) {
            ctx.params.orderId = orderMatch[1];
            if (method === 'GET') return await auth.withAuth(ctx, orders.get);
            if (method === 'PUT') return await auth.withAuth(ctx, orders.update);
            if (method === 'DELETE') return await auth.withAdminAuth(ctx, orders.remove);
        }

        // Users admin
        if (method === 'POST' && path === '/users') {
            return await auth.withAdminAuth(ctx, users.create);
        }

        // Webhooks (con HMAC, no auth de usuario)
        const webhookMatch = path.match(/^\/webhook\/([a-z]+)$/);
        if (method === 'POST' && webhookMatch) {
            ctx.params.provider = webhookMatch[1];
            return await webhooks.handle(ctx);
        }

        sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
        if (err.status) {
            // Error de aplicación esperado
            return sendJson(res, err.status, { error: err.message });
        }
        console.error('[ROUTER] Error no manejado:', err.message, err.stack);
        sendJson(res, 500, { error: 'Internal Server Error' });
    }
};
```

Total: ~60 líneas. Cada ruta delega al handler correspondiente.

### Ejemplo: un handler

```js
// handlers/orders.js
const ordersService = require('../services/ordersService');
const { validateOrderPayload } = require('../middleware/validation');
const { readJsonBody, sendJson } = require('../lib/http');

exports.create = async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const { valid, errors } = validateOrderPayload(body);
    if (!valid) {
        return sendJson(ctx.res, 400, { error: 'Invalid payload', details: errors });
    }

    const order = await ordersService.createOrder(ctx.app, ctx.user, body);
    sendJson(ctx.res, 201, order);
};

exports.list = async (ctx) => {
    const filters = parseFilters(ctx.parsed.query);
    const orders = await ordersService.listOrders(ctx.app, ctx.user, filters);
    sendJson(ctx.res, 200, { orders });
};

exports.get = async (ctx) => {
    const order = await ordersService.getOrder(ctx.app, ctx.params.orderId);
    if (!order) return sendJson(ctx.res, 404, { error: 'Order not found' });
    sendJson(ctx.res, 200, order);
};

exports.update = async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const order = await ordersService.updateOrder(ctx.app, ctx.params.orderId, body, ctx.user);
    sendJson(ctx.res, 200, order);
};

exports.remove = async (ctx) => {
    await ordersService.deleteOrder(ctx.app, ctx.params.orderId, ctx.user);
    sendJson(ctx.res, 204, {});
};
```

Cada handler es corto. Su responsabilidad: parsear request, validar, delegar al service, responder.

### Ejemplo: un service

```js
// services/ordersService.js
const ordersDb = require('../db/orders');
const stripeIntegration = require('../integrations/stripe');
const { NotFoundError, ForbiddenError } = require('../lib/errors');

exports.createOrder = async (app, user, payload) => {
    const order = await ordersDb.create(app, {
        customer_id: user.id,
        items: payload.items,
        total: calculateTotal(payload.items),
        current_state: 'PAYMENT_PENDING'
    });

    const payment = await stripeIntegration.createPaymentIntent({
        amount: order.total,
        customer_id: user.stripe_customer_id,
        metadata: { order_id: order.id }
    });

    await ordersDb.update(app, order.id, {
        stripe_payment_intent_id: payment.id
    });

    return { ...order, client_secret: payment.client_secret };
};

exports.getOrder = async (app, orderId) => {
    return await ordersDb.getById(app, orderId);
};

exports.deleteOrder = async (app, orderId, user) => {
    const order = await ordersDb.getById(app, orderId);
    if (!order) throw new NotFoundError('Order not found');
    if (order.customer_id !== user.id && user.role !== 'admin') {
        throw new ForbiddenError('Cannot delete this order');
    }
    await ordersDb.delete(app, orderId);
};

function calculateTotal(items) {
    return items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
}
```

El service:
- No conoce HTTP (no `req`/`res`)
- Tiene la lógica de negocio
- Delega a `db/` para persistencia y a `integrations/` para terceros
- Tira errores tipados, no manda responses

---

## El patrón "context object"

En vez de pasar muchos argumentos repetidos, pasá un objeto `ctx`:

```js
// ❌ Firma larga, difícil de mantener
async function handleOrder(req, res, app, user, orderId, params, db, logger) { }

// ✅ Context object
async function handleOrder(ctx) {
    const { req, res, app, user, params, db, logger } = ctx;
    // ...
}
```

**Ventajas:**
- Firmas estables (agregás `user` al ctx sin tocar todas las funciones)
- Middleware puede agregar cosas al ctx (`ctx.user` después de auth)
- Más fácil de mockear en tests

---

## Middleware reutilizable

### Auth como middleware

```js
// middleware/auth.js
const crypto = require('crypto');
const { UnauthorizedError, ForbiddenError } = require('../lib/errors');
const usersDb = require('../db/users');

async function authenticate(ctx) {
    const authHeader = ctx.req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        throw new UnauthorizedError('Missing Authorization header');
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) throw new UnauthorizedError('Malformed auth');
    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);

    const user = await usersDb.verifyPassword(ctx.app, username, password);
    if (!user) throw new UnauthorizedError('Invalid credentials');
    return user;
}

exports.withAuth = async (ctx, handler) => {
    ctx.user = await authenticate(ctx);
    return await handler(ctx);
};

exports.withAdminAuth = async (ctx, handler) => {
    ctx.user = await authenticate(ctx);
    if (ctx.user.role !== 'admin') {
        throw new ForbiddenError('Admin only');
    }
    return await handler(ctx);
};

exports.withRole = (allowedRoles) => async (ctx, handler) => {
    ctx.user = await authenticate(ctx);
    if (!allowedRoles.includes(ctx.user.role)) {
        throw new ForbiddenError(`Role ${ctx.user.role} not allowed`);
    }
    return await handler(ctx);
};
```

Uso en el router:

```js
if (method === 'POST' && path === '/orders') {
    return await auth.withAuth(ctx, orders.create);
}
if (method === 'DELETE' && path.startsWith('/orders/')) {
    return await auth.withAdminAuth(ctx, orders.remove);
}
```

### Validación como middleware

```js
// middleware/validation.js
const { ValidationError } = require('../lib/errors');

exports.validateBody = (schema) => async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const { valid, errors } = schema.validate(body);
    if (!valid) throw new ValidationError(errors);
    ctx.body = body;
};

exports.validatePayload = (payload, rules) => {
    const errors = [];
    for (const [field, rule] of Object.entries(rules)) {
        const value = payload[field];
        if (rule.required && (value == null || value === '')) {
            errors.push(`${field} is required`);
            continue;
        }
        if (rule.type && value != null && typeof value !== rule.type) {
            errors.push(`${field} must be ${rule.type}`);
        }
        if (rule.pattern && value && !rule.pattern.test(value)) {
            errors.push(`${field} has invalid format`);
        }
        if (rule.maxLength && value && String(value).length > rule.maxLength) {
            errors.push(`${field} exceeds max length ${rule.maxLength}`);
        }
    }
    return { valid: errors.length === 0, errors };
};
```

---

## Cuándo crear un módulo nuevo

Creá un archivo nuevo si cumple **al menos una** condición:

### 1. Nuevo recurso/entidad
Endpoints para una entidad nueva (`/invoices`, `/reports`) → `handlers/invoices.js`.

### 2. Nueva integración externa
Sistema nuevo (Stripe, Twilio) → `integrations/stripe.js`.

### 3. Más de 50 líneas relacionadas
Código nuevo > 50 líneas con responsabilidad clara → extralo.

### 4. Reutilizable
Usable desde 2+ lugares → `lib/` o `services/`.

---

## Refactor progresivo de un mega-index.js

Si heredás un `index.js` gigante, no intentes refactorizarlo de una. Estrategia gradual:

### Paso 1: extraer handlers sin cambiar lógica

```js
// ANTES en index.js
if (path === '/orders' && method === 'POST') {
    // 80 líneas inline
}

// DESPUÉS en index.js (pegás las 80 líneas en handlers/orders.js sin tocarlas)
if (path === '/orders' && method === 'POST') {
    return await require('./handlers/orders').create(req, res, app);
}
```

Sin refactor interno, solo mover.

### Paso 2: unificar firmas

Cuando todos los handlers estén extraídos, refactor para usar `ctx` uniforme.

### Paso 3: separar db / services / integrations

Los handlers probablemente mezclan todo. Extraer:
- Queries ZCQL → `db/`
- Reglas de negocio → `services/`
- Calls a APIs externas → `integrations/`

### Paso 4: middleware

Extraer validación, auth, rate limiting.

### Paso 5: tests

Con la estructura limpia, agregar tests. Services son lo que más cambia — tests ahí primero.

---

## Targets de tamaño

| Archivo | Tamaño objetivo |
|---|---|
| `index.js` | 50-200 líneas |
| Handler file | 50-300 líneas |
| Service file | 50-200 líneas |
| DB file | 30-150 líneas |
| Integration file | 50-250 líneas |
| Lib/util file | 30-100 líneas |

**Si un archivo pasa de 400 líneas, evaluar split.**

---

## Feature folder (alternativa)

Para apps grandes, agrupá por **feature** en vez de por **tipo**:

```
my_function/
├── index.js
└── features/
    ├── orders/
    │   ├── handlers.js
    │   ├── service.js
    │   ├── db.js
    │   └── validation.js
    ├── users/
    │   ├── handlers.js
    │   ├── service.js
    │   └── db.js
    └── webhooks/
        ├── stripe.js
        └── verify.js
```

**Cuándo elegir feature folder:** apps con 10+ entidades, equipos grandes, cambios frecuentes toca una feature completa.

---

## Señales que necesitás refactorizar

🚨 Red flags:

- `index.js` > 500 líneas
- Variables globales con `var`
- Funciones con 10+ parámetros
- Mismo snippet repetido 3+ veces
- Para agregar un endpoint nuevo, temés romper otros
- Al abrir el archivo, VS Code lagguea
- Tests no se pueden mockear (todo acoplado)

---

## Test: "el nuevo developer"

Si un dev nuevo se suma y le decís: _"Agregá `POST /invoices/:id/cancel`"_, ¿sabe inmediatamente dónde ponerlo?

Con estructura bien modularizada:
> "Agregalo en `handlers/invoices.js` exportando `cancel`, la ruta la wireas en `index.js`."

Si la respuesta es "depende, mostrame el código" → problema de arquitectura.

---

## Checklist

- [ ] `index.js` es solo router
- [ ] Handlers en archivos por recurso
- [ ] Services sin conocimiento de HTTP
- [ ] DB queries en archivos propios
- [ ] Integraciones externas en archivos propios
- [ ] Middleware reutilizable para auth/validation
- [ ] Ningún archivo > 400 líneas sin razón
- [ ] Context object (`ctx`) en lugar de muchos argumentos
- [ ] Errores tipados (clases de error) en vez de strings
- [ ] Tests en services (lo que más cambia)
