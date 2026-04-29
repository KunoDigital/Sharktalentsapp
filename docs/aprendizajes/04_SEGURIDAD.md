# 04 — Seguridad

Seguridad no se agrega después. O está desde día 1 o se olvida para siempre.

Este documento cubre los patrones que toda app serverless seria debe implementar. Están basados en vulnerabilidades reales detectadas en revisiones de seguridad — cada sección te dice qué riesgo mitiga.

---

## Autenticación de usuarios

### Passwords con scrypt + salt

**Siempre:** hash en el servidor, salt aleatorio por usuario.

```js
const crypto = require('crypto');

async function hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, hash) => {
            if (err) reject(err);
            else resolve(hash.toString('hex'));
        });
    });
}

async function createUser(app, { username, password, display_name, role }) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    return await app.datastore().table('Users').insertRow({
        username,
        password_hash: hash,
        salt,
        display_name,
        role,
        is_active: true
    });
}

async function verifyPassword(app, username, password) {
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Users WHERE username = '${escapeSql(username)}'`
    );
    if (rows.length === 0) return null;
    const user = rows[0].Users || rows[0];
    if (!user.is_active) return null;

    const hash = await hashPassword(password, user.salt);
    if (hash !== user.password_hash) return null;
    return user;
}
```

**Nota sobre scrypt vs bcrypt:** scrypt viene nativo en Node.js (`crypto`). bcrypt requiere package externo con bindings nativos. Para Catalyst, scrypt es más simple.

### Comparación segura (timing-safe)

**Nunca compares hashes/tokens con `===`.** Abre timing attacks:

```js
// ❌ Mal
if (providedHash === expectedHash) { /* ... */ }

// ✅ Bien
if (crypto.timingSafeEqual(
    Buffer.from(providedHash, 'hex'),
    Buffer.from(expectedHash, 'hex')
)) { /* ... */ }
```

Aplica para: passwords, HMAC signatures, tokens de acceso.

---

## Autenticación vs Autorización

**Error común: confundir ambos.** El proyecto actual tiene una función llamada `validateAdminAuth` que **solo valida autenticación**, no rol. El nombre miente.

### Patrón correcto: middleware compuestos

```js
// middleware/auth.js

exports.authenticate = async (ctx) => {
    const authHeader = ctx.req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        throw new UnauthorizedError('Missing or invalid Authorization header');
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) throw new UnauthorizedError('Malformed Authorization');
    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);

    const user = await verifyPassword(ctx.app, username, password);
    if (!user) throw new UnauthorizedError('Invalid credentials');

    return user;  // retorna el user, NO valida rol
};

exports.requireRole = (allowedRoles) => async (ctx) => {
    const user = await exports.authenticate(ctx);
    if (!allowedRoles.includes(user.role)) {
        throw new ForbiddenError(`Role ${user.role} cannot perform this action`);
    }
    ctx.user = user;
    return user;
};

// Shortcuts legibles
exports.requireAuth = exports.requireRole(['admin', 'cumplimiento', 'supervisor']);
exports.requireAdmin = exports.requireRole(['admin']);
exports.requireSupervisorOrAdmin = exports.requireRole(['admin', 'supervisor']);
```

### Uso en handlers

```js
// handlers/orders.js
const auth = require('../middleware/auth');

exports.list = async (ctx) => {
    await auth.requireAuth(ctx);
    // ... cualquiera autenticado puede listar
};

exports.delete = async (ctx) => {
    await auth.requireAdmin(ctx);
    // ... solo admin puede eliminar
};
```

### Errores custom con status HTTP

```js
// lib/errors.js

class AppError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}
class UnauthorizedError extends AppError { constructor(msg) { super(msg, 401); } }
class ForbiddenError extends AppError { constructor(msg) { super(msg, 403); } }
class NotFoundError extends AppError { constructor(msg) { super(msg, 404); } }
class ValidationError extends AppError { constructor(msg) { super(msg, 400); } }

module.exports = { AppError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError };

// En el router raíz
try {
    // ... handlers ...
} catch (err) {
    if (err instanceof AppError) {
        sendJson(res, err.status, { error: err.message });
    } else {
        console.error('[ROUTER] Error no esperado:', err.message, err.stack);
        sendJson(res, 500, { error: 'Internal Server Error' });
    }
}
```

---

## HMAC para webhooks entrantes

**Regla:** todo webhook de un tercero DEBE validar firma HMAC. No importa cuán "improbable" sea que alguien adivine la URL.

### Patrón

```js
// lib/hmac.js
const crypto = require('crypto');

exports.verifyWebhookSignature = (req, rawBody, secret) => {
    const signature = req.headers['x-signature-v2']
        || req.headers['x-signature']
        || req.headers['x-hub-signature-256'];

    if (!signature || !secret) return false;

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const provided = signature.startsWith('sha256=')
        ? signature.slice(7)
        : signature;

    try {
        return crypto.timingSafeEqual(
            Buffer.from(provided, 'hex'),
            Buffer.from(expected, 'hex')
        );
    } catch {
        return false;  // tamaños distintos → timingSafeEqual lanza
    }
};
```

### Uso en handler de webhook

```js
// handlers/webhooks.js
const { verifyWebhookSignature } = require('../lib/hmac');

exports.handleStripe = async (ctx) => {
    const rawBody = await readRawBody(ctx.req);  // leerlo antes de parsear!

    if (!verifyWebhookSignature(ctx.req, rawBody, process.env.STRIPE_WEBHOOK_SECRET)) {
        throw new UnauthorizedError('Invalid webhook signature');
    }

    const event = JSON.parse(rawBody);
    // ... procesar
};
```

**⚠️ Importante:** leer `rawBody` antes de parsearlo. Si reconstruís el JSON después, los espacios/orden pueden diferir y la firma falla.

### Soportar múltiples versiones de firma

Los proveedores cambian el formato con el tiempo. Soportá legacy + nuevo:

```js
// Ejemplo: provider con múltiples versiones de firma (común con proveedores que evolucionan su API)
exports.verifyProviderSignature = (req, rawBody) => {
    const secret = process.env.PROVIDER_WEBHOOK_SECRET;

    // V2: signature sobre timestamp + body (formato nuevo, previene replay attacks)
    const sigV2 = req.headers['x-signature-v2'];
    const timestamp = req.headers['x-timestamp'];
    if (sigV2 && timestamp) {
        const expected = crypto.createHmac('sha256', secret)
            .update(timestamp + '.' + rawBody)
            .digest('hex');
        if (timingSafeCompare(sigV2, expected)) return true;
    }

    // V1 (legacy): signature solo sobre body
    const sigV1 = req.headers['x-signature'];
    if (sigV1) {
        const expected = crypto.createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
        if (timingSafeCompare(sigV1, expected)) return true;
    }

    return false;
};
```

---

## HMAC para URLs firmadas

Cuando exponés un proxy público para archivos privados, **firmá las URLs** con HMAC + expiración.

### Generar

```js
function generateSignedUrl(baseUrl, fileId, ttlSec = 14400) {  // 4 horas
    const secret = process.env.URL_SIGNING_SECRET;
    const expires = Math.floor(Date.now() / 1000) + ttlSec;
    const token = crypto.createHmac('sha256', secret)
        .update(`${fileId}:${expires}`)
        .digest('hex');
    return `${baseUrl}?fileId=${fileId}&expires=${expires}&token=${token}`;
}
```

### Validar en el proxy

```js
// handlers/proxy.js

exports.serveFile = async (ctx) => {
    const { fileId, expires, token } = ctx.parsed.query;

    if (!fileId || !expires || !token) {
        throw new ValidationError('Missing fileId, expires, or token');
    }

    if (Date.now() / 1000 > parseInt(expires, 10)) {
        throw new AppError('URL expired', 410);
    }

    const secret = process.env.URL_SIGNING_SECRET;
    const expected = crypto.createHmac('sha256', secret)
        .update(`${fileId}:${expires}`)
        .digest('hex');

    if (!timingSafeCompare(token, expected)) {
        throw new ForbiddenError('Invalid token');
    }

    // ... servir archivo
};
```

**Nota sobre expires=0:** algunos casos requieren URLs sin expiración (ej. links en mensajes que el usuario guarda). Podés usar `expires=0` como convención "nunca expira":

```js
if (parseInt(expires) !== 0 && Date.now() / 1000 > parseInt(expires)) {
    throw new AppError('URL expired', 410);
}
```

Pero `expires=0` sin expiración significa que **si filtrás el secret, los atacantes tienen acceso forever**. Usalo con cuidado.

---

## Endpoints internos (function-to-function)

Cuando una function llama a otra function del mismo proyecto, **no uses auth de usuario** — usá un **API key interno**:

### Setup

```
env: INTERNAL_API_KEY=<64-char-hex-random>
```

Generás el key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Validación

```js
// middleware/internalAuth.js

exports.requireInternalKey = (ctx) => {
    const provided = ctx.req.headers['x-api-key'];
    const expected = process.env.INTERNAL_API_KEY;

    if (!provided || !expected) {
        throw new UnauthorizedError('Internal API key required');
    }

    try {
        if (!crypto.timingSafeEqual(
            Buffer.from(provided, 'utf-8'),
            Buffer.from(expected, 'utf-8')
        )) {
            throw new UnauthorizedError('Invalid internal API key');
        }
    } catch {
        throw new UnauthorizedError('Invalid internal API key');
    }
};
```

### Uso

```js
// cron_function/index.js calling api_function (ambos dentro del mismo proyecto Catalyst)
await axios.post(
    `${process.env.APP_BASE_URL}/server/api_function/internal/close-timeout/${rowId}`,
    {},
    {
        headers: { 'x-api-key': process.env.INTERNAL_API_KEY },
        timeout: 20000
    }
);

// api_function handler
exports.closeTimeout = async (ctx) => {
    requireInternalKey(ctx);  // no user auth, no role check, solo API key interno
    // ... procesar timeout de flow
};
```

**Regla:** NO expongas `INTERNAL_API_KEY` al frontend. Solo server-to-server.

---

## Tokens de acceso por recurso

Para endpoints públicos que manejan datos sensibles, generá un **token por registro**.

**Caso real observado:** endpoints del tipo `/flow-data/:flowId`, `/sign-url/:flowId` eran consumidos desde el navegador del cliente. Los IDs eran secuenciales (4558, 4559, 4560...). Cualquiera podía enumerar y leer datos personales de otros usuarios.

### Patrón

Al crear el registro, generá `access_token`:

```js
async function createFlow(app, payload) {
    const accessToken = crypto.randomBytes(32).toString('hex');
    const result = await app.datastore().table('Flows').insertRow({
        ...payload,
        access_token: accessToken
    });
    return { ...result, access_token: accessToken };
}
```

El cliente recibe el token y lo incluye en cada request:
```
GET /verificacion-data/4558?token=abc123...
```

Validación:

```js
async function validateAccessToken(app, flowId, providedToken) {
    if (!providedToken || providedToken.length !== 64) return false;
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT access_token FROM Flows WHERE ROWID = '${escapeSql(flowId)}'`
    );
    if (rows.length === 0) return false;
    const row = rows[0].Flows || rows[0];
    return timingSafeCompare(row.access_token, providedToken);
}
```

Así:
- Nadie puede enumerar IDs
- Solo el cliente con su token puede acceder a su registro
- El token es largo (256 bits) → no adivinable
- No requiere sesión ni login

---

## Validación de inputs

**Toda entrada externa es sospechosa.** Validá rangos, formatos, longitudes.

```js
// lib/validation.js

exports.validateNumericId = (id) =>
    typeof id === 'string' && /^\d{3,20}$/.test(id);

exports.validateOrderId = exports.validateNumericId;

exports.validateUUID = (id) =>
    typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

exports.validateEmail = (email) =>
    typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

exports.validatePhone = (phone) =>
    typeof phone === 'string' && /^\d{7,15}$/.test(phone);

exports.validateEnum = (value, allowed) => allowed.includes(value);

// Uso
const orderId = ctx.params.orderId;
if (!validateOrderId(orderId)) {
    throw new ValidationError('orderId must be 3-20 digits');
}
```

---

## SQL injection en ZCQL

ZCQL parece "SQL-like" pero es vulnerable a injection como cualquier otro. **Siempre escapá:**

```js
exports.escapeSql = (value) => {
    if (value == null) return '';
    return String(value).replace(/'/g, "''");
};

// ❌ Mal
const q = `SELECT * FROM Users WHERE username = '${username}'`;

// ✅ Bien
const q = `SELECT * FROM Users WHERE username = '${escapeSql(username)}'`;
```

**Mejor aún:** para values que deberían ser de un set conocido (status, role), validá contra whitelist:

```js
const VALID_STATUSES = ['pending', 'active', 'completed', 'failed'];
if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError('Invalid status');
}
const q = `SELECT * FROM Orders WHERE status = '${status}'`;  // seguro porque validaste whitelist
```

---

## CORS

Si tu frontend y backend están en dominios distintos, necesitás CORS. Configurá **explícitamente** los dominios permitidos, nunca `*` en producción con credentials.

```js
function setCorsHeaders(res, origin) {
    const allowedOrigins = [
        'https://myapp.com',
        'https://staging.myapp.com'
    ];
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Key');
}

// En el router
if (req.method === 'OPTIONS') {
    setCorsHeaders(res, req.headers.origin);
    res.writeHead(204);
    return res.end();
}
setCorsHeaders(res, req.headers.origin);
// ... procesar
```

---

## Rate limiting

Para endpoints públicos o caros, implementá rate limiting. Catalyst no tiene nativo — usá DataStore:

```js
// middleware/rateLimit.js

const WINDOW_MS = 60_000;  // 1 min
const MAX_PER_WINDOW = 10;

exports.rateLimit = async (ctx, key) => {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Cleanup viejo + count en ventana actual
    const rows = await ctx.app.zcql().executeZCQLQuery(
        `SELECT ROWID, ts FROM RateLimitEvents WHERE key = '${escapeSql(key)}' AND ts > ${windowStart}`
    );

    if (rows.length >= MAX_PER_WINDOW) {
        throw new AppError('Rate limit exceeded', 429);
    }

    await ctx.app.datastore().table('RateLimitEvents').insertRow({
        key,
        ts: now
    });
};

// Uso
await rateLimit(ctx, `createOrder:${ctx.user.id}`);
```

(Para volumen alto, esto es caro — considerar Redis externo o Catalyst Cache.)

---

## Nunca commitear secrets

`.gitignore`:
```
.env*
*.pem
*.key
credentials.json
```

**catalyst-config.json se commitea**, pero con valores de **dev**, no prod. En prod configurás las env vars desde Catalyst Console.

**Si se filtra un secret, rotá inmediatamente.** Tener un plan de rotation:
1. Generar nuevo secret
2. Deployar con nuevo secret (los endpoints aceptan VIEJO + NUEVO temporalmente)
3. Cambiar el secret en clientes/webhooks externos
4. Remover el VIEJO después de 24-48h

---

## Logs sin secrets

```js
// ❌ Mal
console.log(`Auth fail: user=${username} password=${password}`);

// ✅ Bien
console.log(`Auth fail: user=${username}`);

// Para debugging de secrets, usar fragmentos
const frag = apiKey
    ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (len=${apiKey.length})`
    : 'null';
console.log(`[AUTH] Using key: ${frag}`);
```

---

## Headers de seguridad en responses

```js
function sendJson(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    });
    res.end(JSON.stringify(body));
}
```

---

## Checklist de seguridad

Antes de deploy a producción:

- [ ] Passwords con scrypt + salt, nunca plaintext
- [ ] Autenticación y autorización en funciones distintas (no mezcladas)
- [ ] Nombres de funciones que NO mienten sobre qué hacen
- [ ] Todos los endpoints admin validan auth
- [ ] Todos los endpoints de rol validan rol
- [ ] Todos los webhooks validan HMAC antes de procesar
- [ ] URLs firmadas con HMAC + expiración
- [ ] Internal API key para function-to-function
- [ ] Tokens de acceso por recurso para endpoints públicos sensibles
- [ ] Todas las inputs externas validadas (formato, longitud, whitelist)
- [ ] SQL escapado en todo query ZCQL
- [ ] CORS configurado con whitelist (no `*` en prod)
- [ ] Rate limiting en endpoints caros
- [ ] Secrets en env vars, nunca hardcodeados
- [ ] Logs no incluyen passwords/tokens/PII
- [ ] Comparaciones de hashes/tokens usan `timingSafeEqual`
- [ ] Headers de seguridad en responses (X-Frame-Options, CSP, etc.)
- [ ] Plan de rotation de secrets documentado
