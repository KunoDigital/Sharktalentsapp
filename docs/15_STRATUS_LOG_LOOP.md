# Stratus Log Loop — debugging remoto iterativo de Catalyst Functions

> **Audiencia**: developers que están peleando con logs en Catalyst y quieren un loop "deploy → call → leer log → corregir → re-deploy" que se pueda automatizar (incluso desde un agente IA) sin tener que abrir Catalyst Console web cada vez.
>
> **Plataforma**: Zoho Catalyst Cloud Scale (Functions Advanced I/O / Basic I/O / Cron / Event Listener) + Stratus (object storage) + zcatalyst-sdk-node v3+.
>
> **Tiempo de implementación**: ~30 min la primera vez. Después, refactorizable a una librería interna.

---

## TL;DR

1. Catalyst NO tiene `catalyst logs` CLI — los logs solo viven en la web Console (Console → Function → Logs).
2. Para iterar rápido (sobre todo cuando un agente IA debuggea o cuando tu function falla en producción), querés los logs accesibles via API.
3. La solución: **middleware Express** que captura `console.*` durante el request y, al finalizar, sube un JSON estructurado a un **bucket Stratus**. Tu script local consume ese JSON via un endpoint público en la misma function (más simple que pelearse con la auth pre-signed de Stratus desde fuera).
4. **Resultado**: hacés `curl` con el body de prueba, el response trae `x-request-id`, corrés `node read-log.js <request-id>` en local, ves el log entero. Total: ~5 segundos.

---

## El problema concreto

Catalyst tiene tres formas de ver logs hoy (2026):

| Vía | Para qué sirve | Por qué no es suficiente |
|---|---|---|
| **Console Web** → Function → Logs | Browsing manual | Lento, hay que filtrar manualmente por timestamp, no se puede automatizar |
| **`console.log`** stdout | Default, queda en Console | Mismo problema — solo visible vía UI |
| **`catalyst logs <fn>`** CLI | No existe en CLI 1.25+ | El CLI solo ofrece `deploy`, `init`, `login`, `serve`, etc. No hay `logs`. |

**Cuando esto es un problema crítico**:
- Estás iterando rápido en un endpoint que falla → cada cambio implica deploy + abrir Console + buscar logs → 2-3 min por iteración
- Un agente IA / script de CI necesita leer logs para autocorregir → ninguna API
- Un error solo se reproduce en production → necesitás los logs estructurados, no solo lo que tu propio código `console.log`-ueó

---

## La solución: Stratus como log sink + endpoint local de lectura

```
┌─────────────┐    1. HTTP POST     ┌──────────────────────────────┐
│  curl/test  │ ──────────────────► │  Catalyst Function (api-v1)  │
│             │ ◄────────────────── │  Express + middleware logger │
│             │  x-request-id:      └────────────┬─────────────────┘
└─────────────┘  req_abc                         │ res.on('finish')
       │                                         ▼
       │                            ┌────────────────────────────┐
       │  2. pnpm read-log req_abc  │  Stratus bucket            │
       └──────────────────────────► │  api-v1/2026-06-05/req_abc │
                                    │       .json                │
                                    └────────────────────────────┘
```

**3 piezas**:

1. **Middleware Express** (`lib/stratus-logger.js`): intercepta `console.*` durante el request, asigna un `requestId`, al final del request sube un JSON estructurado a Stratus.
2. **Endpoint de lectura** (`/v1/_dev/logs/:requestId` en la misma function): usa el SDK Catalyst internamente para leer del bucket y devolver el JSON. Esto evita pelearse con la auth pre-signed de Stratus desde scripts locales.
3. **CLI local** (`read-log.ts`): wrapper que hace fetch al endpoint con la API key y formatea el output.

---

## Aprendizajes técnicos críticos (los que te ahorran horas)

### 1. La URL del bucket Stratus tiene un pattern específico

Cuando creás un bucket llamado `mi-bucket` en Catalyst Stratus:

```
Development: https://mi-bucket-development.zohostratus.com/{key}
Production : https://mi-bucket.zohostratus.com/{key}
```

El sufijo `-development` se agrega automáticamente en environment Dev.

**Lo verificás** en el SDK:

```js
// node_modules/zcatalyst-sdk-node/lib/stratus/bucket.js
bucket_url: app.config.environment == 'Development'
    ? `https://${bucket}-development${STRATUS_SUFFIX}`
    : `https://${bucket}${STRATUS_SUFFIX}`
// STRATUS_SUFFIX = '.zohostratus.com'
```

### 2. Leer Stratus directo desde fuera requiere una signature pre-firmada

NO podés simplemente hacer `GET https://mi-bucket-development.zohostratus.com/file.json` con tu `Authorization: Zoho-oauthtoken ...` — devuelve **401 authentication_error**.

Stratus usa un esquema de signatures que el SDK obtiene haciendo `POST /bucket/signature` y después incluye en query string. Replicar eso desde un script local es feo.

**Solución pragmática**: crear un endpoint dentro de la function que use el SDK Catalyst (que ya tiene auth correctamente inicializado en runtime). Tu script local llama a ese endpoint con la API key normal del API. El endpoint hace `app.stratus().bucket(name).getObject(key)` y devuelve el contenido.

```js
// routes/dev-logs.js
router.get('/:requestId', async (req, res) => {
  const key = `${fn}/${day}/${requestId}.json`;
  const bucket = getApp(req).stratus().bucket('mi-bucket');
  const stream = await bucket.getObject(key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  res.set('Content-Type', 'application/json').send(Buffer.concat(chunks).toString('utf8'));
});
```

### 3. El SDK `zcatalyst-sdk-node` v3 cambió la firma de `initialize()`

Si venís del SDK v1, **el patrón viejo no funciona**:

```js
// ❌ v1 — esto rompe en v3 con 'Cannot read properties of undefined'
const app = catalyst.initialize(req.catalyst);
```

v3 espera un objeto con `.headers` (la `req` de Express tiene eso):

```js
// ✅ v3 — pasás req directo, el SDK lee req.headers
const app = catalyst.initialize(req);
```

Internamente el SDK lee `request.headers[PROJECT_HEADER.id]`, `PROJECT_HEADER.key`, `PROJECT_HEADER.environment` etc., que Catalyst Advanced I/O inyecta automáticamente cuando recibís el request.

Helper recomendado:

```js
// lib/catalyst-app.js
'use strict';
const catalyst = require('zcatalyst-sdk-node');

function getApp(req) {
  if (req.app?.locals?.catalystApp) return req.app.locals.catalystApp;
  if (!req || typeof req.headers !== 'object') {
    throw new Error('catalyst context no disponible');
  }
  const app = catalyst.initialize(req);
  if (req.app?.locals) req.app.locals.catalystApp = app;
  return app;
}

module.exports = { getApp };
```

Memoizar en `req.app.locals` evita reinicializar varias veces en el mismo request.

### 4. Catalyst intercepta el header `Authorization`

Si mandás `curl -H "Authorization: Bearer mi-api-key"` a una function, Catalyst infrastructure intercepta el header y valida como **Zoho OAuth token**. Si no es OAuth válido, devuelve:

```json
{"status":"failure","data":{"error_code":"INVALID_TOKEN","message":"invalid oauth token"}}
```

Tu código nunca recibe el request.

**Workaround**: usar `x-api-key` header en lugar de `Authorization`. Catalyst no lo intercepta. Tu middleware lee ambos:

```js
function extractKey(req) {
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const xkey = req.header('x-api-key');
  if (xkey) return xkey.trim();
  return null;
}
```

### 5. El `catalyst.json` v1.25+ es muy estricto con los tipos

Estos errores cuestan horas si no los conocés:

| Síntoma | Causa | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'name')` | `"type": "Cron"` (capitalizado) en catalyst-config.json | `"type": "cron"` (lowercase). Igual con `"advancedio"`, `"event"`, `"basicio"` |
| `No AppSail targets found` | `"app_sail": { "targets": [...] }` en catalyst.json | `"appsail": [...]` directo (sin wrapper `.targets`, key sin underscore) |
| `Config file not present` (AppSail) | AppSail busca `app-config.json`, no `catalyst-config.json` | Crear `app-config.json` con `{ command, build_path, stack, scripts, env_variables, memory }` |
| `Cannot find module 'express'` en runtime | `node_modules` en `ignore` del catalyst.json + monorepo pnpm con symlinks | Quitar `node_modules` del ignore + correr `npm install` (no pnpm) en cada function dir para tener node_modules planos |

Las versiones validan los `type` contra:

```js
// SDK constants/lib/fn-type.js
{ basic: 'bio', event: 'event', cron: 'cron', applogic: 'applogic',
  advanced: 'aio', integration: 'integ', browserLogic: 'browserlogic', job: 'job' }
```

Y el mapeo desde el config:

```js
// ref-mapping.js
{ basicio: 'bio', event: 'event', cron: 'cron', advancedio: 'aio', ... }
```

Si tu `type` no matchea **exactamente** uno de esos lowercase strings, el CLI accede a `undefined.name` y explota con el error genérico.

### 6. La captura de `console.*` es process-wide

El middleware hace monkey-patch de `console.log/info/warn/error` para capturarlos. Esto significa que **si dos requests corren en paralelo en el mismo proceso, sus logs se mezclan**.

Para Catalyst Functions (Advanced I/O) suele estar OK porque cada instancia atiende 1 request a la vez. Para AppSail con concurrencia real, migrar a `AsyncLocalStorage`:

```js
const { AsyncLocalStorage } = require('node:async_hooks');
const requestContext = new AsyncLocalStorage();

// En el middleware:
requestContext.run({ entries: [] }, () => next());

// Reemplaza el monkey-patch global por:
const origLog = console.log;
console.log = (...args) => {
  const ctx = requestContext.getStore();
  if (ctx) ctx.entries.push({ level: 'info', ts: new Date().toISOString(), ... });
  origLog(...args);
};
```

Para el MVP, el monkey-patch process-wide es suficiente.

---

## Setup paso a paso

### Pre-requisitos

- Catalyst CLI ≥ 1.25
- `zcatalyst-sdk-node` ≥ 3.4 en cada function
- Node 20+

### Paso 1 — Crear el bucket Stratus

En Catalyst Console:
1. Tu proyecto → **Stratus**
2. **Create Bucket**
3. Name: `mi-app-logs` (lowercase, sin espacios)
4. Versioning: off (no necesario)
5. Public: **NO** (privado, accesible solo via SDK con auth)

Catalyst genera la URL automáticamente: `https://mi-app-logs-development.zohostratus.com`.

### Paso 2 — Asegurar el SDK + helper de inicialización

En tu function que va a hacer logging (ej `functions/api-v1/`):

```bash
# El SDK debería ya estar en deps; si no:
cd functions/api-v1 && npm install zcatalyst-sdk-node@latest
```

Creá `functions/api-v1/lib/catalyst-app.js` con el helper de arriba (sección 3).

### Paso 3 — Crear el middleware logger

Creá `functions/api-v1/lib/stratus-logger.js` (código completo abajo en sección "Código").

### Paso 4 — Crear el endpoint de lectura

Creá `functions/api-v1/routes/dev-logs.js` (código completo abajo).

### Paso 5 — Wire en `index.js`

```js
const express = require('express');
const { requireApiKey } = require('./lib/auth');
const { stratusLogger } = require('./lib/stratus-logger');

const app = express();
app.use(express.json({ limit: '1mb' }));

// PRIMERO el logger, así captura todo (incluyendo errores de otros middlewares)
app.use(stratusLogger({ functionName: 'api-v1', bucketName: 'mi-app-logs' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/v1', requireApiKey());
app.use('/v1/users', require('./routes/users'));
app.use('/v1/_dev/logs', require('./routes/dev-logs')); // ← endpoint de lectura

module.exports = app;
```

### Paso 6 — Crear el CLI local

`scripts/read-log.ts` (código completo abajo).

### Paso 7 — Deploy + test del loop

```bash
catalyst deploy --only functions:api-v1

# Hacé una call cualquiera
curl -i -X POST https://<tu-proyecto>.development.catalystserverless.com/server/api-v1/v1/users \
  -H "x-api-key: <tu-key>" \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'

# Copiá el header `x-request-id: req_xxx` del response
# Esperá ~3 segundos (subida a Stratus es async)
pnpm read-log req_xxx
```

Si todo está bien, deberías ver algo así:

```
══════════════════════════════════════════════════════════════════════════════
  POST /v1/users  →  HTTP 500  (977ms)
  requestId: req_abc  startedAt: 2026-06-05T13:10:38.896Z
══════════════════════════════════════════════════════════════════════════════
[ERROR] 2026-06-05T13:10:39.725Z  [users.create] db_insert_failed
        TypeError: Cannot read properties of undefined (reading 'company_id')
        at routes/users.js:34:18
[INFO]  2026-06-05T13:10:39.872Z  [audit] {...}
══════════════════════════════════════════════════════════════════════════════
```

---

## Código completo (copy-paste)

### `lib/stratus-logger.js`

```js
/**
 * Stratus Logger — captura console.* del request y al finalizar sube
 * un JSON estructurado a Stratus para inspección remota.
 */
'use strict';

const { getApp } = require('./catalyst-app');

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'cookie', 'x-internal-api-key']);

function newRequestId() {
  const tsHex = Date.now().toString(16).padStart(12, '0');
  const rand = Math.random().toString(16).slice(2, 10);
  return `req_${tsHex}_${rand}`;
}

function todayUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : headers[k];
  }
  return out;
}

function safeStringify(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return '[unserializable]'; }
}

function stratusLogger(opts) {
  if (!opts || !opts.functionName) throw new Error('functionName requerido');
  const bucketName = opts.bucketName || 'logs';

  return function (req, res, next) {
    const requestId = req.headers['x-request-id'] || newRequestId();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = Date.now();
    const entries = [];

    // Monkey-patch console.* — captura process-wide (ver gotcha en doc)
    const origLog = console.log.bind(console);
    const origInfo = console.info.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    const capture = (level, originalFn) => (...args) => {
      try {
        entries.push({
          level,
          ts: new Date().toISOString(),
          msg: typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]),
          args: args.slice(1).map(safeStringify),
        });
      } catch { /* nunca bloqueamos captura */ }
      originalFn(...args);
    };

    console.log = capture('info', origLog);
    console.info = capture('info', origInfo);
    console.warn = capture('warn', origWarn);
    console.error = capture('error', origError);

    res.on('finish', () => {
      // Restaurar console
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;

      const payload = {
        requestId,
        functionName: opts.functionName,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        headers: sanitizeHeaders(req.headers),
        entries,
      };

      uploadLog(req, bucketName, opts.functionName, requestId, payload).catch((err) => {
        origError('[stratus-logger] upload failed:', err.message);
      });
    });

    next();
  };
}

async function uploadLog(req, bucketName, functionName, requestId, payload) {
  let app;
  try { app = getApp(req); } catch (err) {
    process.stderr.write(`[stratus-logger] no catalyst context: ${err.message}\n`);
    return;
  }

  const key = `${functionName}/${todayUtc()}/${requestId}.json`;
  const body = JSON.stringify(payload, null, 2);

  try {
    const bucket = app.stratus().bucket(bucketName);
    await bucket.putObject(key, body, { contentType: 'application/json', overwrite: true });
  } catch (err) {
    process.stderr.write(`[stratus-logger] bucket=${bucketName} key=${key} putObject failed: ${err.message}\n`);
  }
}

module.exports = { stratusLogger };
```

### `routes/dev-logs.js`

```js
/**
 * GET /v1/_dev/logs/:requestId — lee logs de Stratus para el CLI local.
 *
 * Path: ?fn=<function-name>&day=<YYYY-MM-DD>
 * Resolve key: ${fn}/${day}/${requestId}.json en bucket configurado.
 */
'use strict';

const express = require('express');
const { getApp } = require('../lib/catalyst-app');

const router = express.Router();
const BUCKET_NAME = process.env.STRATUS_LOG_BUCKET || 'mi-app-logs';

function todayUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

router.get('/:requestId', async (req, res) => {
  if (!req.companyId) return res.status(401).json({ error: 'unauthorized' });

  const requestId = req.params.requestId;
  if (!/^req_[a-z0-9_]{8,}$/i.test(requestId)) {
    return res.status(400).json({ error: 'invalid_request_id' });
  }

  const day = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
    ? req.query.day
    : todayUtc();
  const fn = typeof req.query.fn === 'string' && /^[a-z0-9-]{1,40}$/.test(req.query.fn)
    ? req.query.fn
    : 'api-v1';

  const key = `${fn}/${day}/${requestId}.json`;

  try {
    const app = getApp(req);
    const bucket = app.stratus().bucket(BUCKET_NAME);
    const stream = await bucket.getObject(key);

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');

    res.set('Content-Type', 'application/json');
    res.send(text);
  } catch (err) {
    if (/not.?found|404/i.test(err.message || '')) {
      return res.status(404).json({ error: 'log_not_found', key });
    }
    console.error('[dev-logs.get]', err.message);
    return res.status(500).json({ error: 'internal', detail: err.message });
  }
});

module.exports = router;
```

### `scripts/read-log.ts` (CLI local)

```ts
/**
 * pnpm read-log <request-id> [function-name] [yyyy-mm-dd]
 *
 * Env vars:
 *   KUMPLA_API_BASE — URL base de tu function api-v1
 *   KUMPLA_API_KEY  — API key plaintext (debe estar seedeada en tu tabla ApiKeys)
 */
'use strict';

const API_BASE = process.env.KUMPLA_API_BASE || 'https://YOUR-PROJECT.development.catalystserverless.com/server/api-v1';
const API_KEY = process.env.KUMPLA_API_KEY || '';

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requestId = args[0];
  const functionName = args[1] || 'api-v1';
  const day = args[2] || todayUtc();

  if (!requestId || !API_KEY) {
    console.error('Uso: pnpm read-log <request-id> [function-name] [yyyy-mm-dd]');
    console.error('Env: KUMPLA_API_KEY required');
    process.exit(1);
  }

  const url = `${API_BASE}/v1/_dev/logs/${encodeURIComponent(requestId)}?fn=${functionName}&day=${day}`;
  console.log(`[read-log] GET ${url}`);

  const res = await fetch(url, { method: 'GET', headers: { 'x-api-key': API_KEY } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[read-log] failed (${res.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }

  try {
    const log = JSON.parse(text);
    console.log('═'.repeat(78));
    console.log(`  ${log.method} ${log.path}  →  HTTP ${log.status}  (${log.durationMs}ms)`);
    console.log(`  requestId: ${log.requestId}  startedAt: ${log.startedAt}`);
    console.log('═'.repeat(78));
    for (const e of log.entries || []) {
      const tag = `[${e.level.toUpperCase()}]`.padEnd(7);
      console.log(`${tag} ${e.ts}  ${e.msg}`);
      if (Array.isArray(e.args)) for (const a of e.args) console.log(`        ${a}`);
    }
    console.log('═'.repeat(78));
  } catch {
    console.log(text);
  }
}

main().catch((err: unknown) => {
  console.error('[read-log] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Y en tu `package.json` raíz:

```json
{
  "scripts": {
    "read-log": "tsx scripts/read-log.ts"
  }
}
```

---

## Workflow día a día (loop cerrado)

Cuando estás debugueando un endpoint:

```bash
# 1. Cambio en el código
vim functions/api-v1/routes/users.js

# 2. Deploy (~60s)
catalyst deploy --only functions:api-v1

# 3. Call de prueba
curl -i -X POST https://<proyecto>.development.catalystserverless.com/server/api-v1/v1/users \
  -H "x-api-key: $KUMPLA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'
# → x-request-id: req_019e97e83830_781851b3
# → {"error":"internal"}

# 4. Leer el log entero
pnpm read-log req_019e97e83830_781851b3
# → Te muestra el stack trace exacto, queries ZCQL que tronaron,
#    payloads de adapters externos, todo.

# 5. Corregir, volver al paso 2.
```

**Total por iteración**: ~90s (60s deploy + ~30s diagnosis). Sin esto: 2-4 minutos abriendo Console + filtrando manualmente.

---

## Gotchas y limitaciones

| Limitación | Workaround |
|---|---|
| Process-wide console capture mezcla logs si hay concurrencia | Migrar a `AsyncLocalStorage` (ver sección 6 arriba). Para Catalyst Functions el problema es teórico (1 req/instancia); para AppSail con concurrencia es real. |
| El bucket Stratus se llena con el tiempo | Configurar TTL en `putObject({ ttl: '7d' })` o crear un cron de cleanup |
| Si tu function `throw` antes del `res.on('finish')`, el log no se sube | Wrappear el handler en try/catch que llame `res.end()` explícitamente |
| Stratus storage cuesta plata a escala | En dev sin tráfico real es casi gratis. En prod, considerar samplear (loggear 1 de cada N requests) o solo los `res.statusCode >= 400` |
| Sensitive data en logs (PII, tokens) | El middleware ya redacta `authorization`, `x-api-key`, `cookie`. Para PII en bodies, **sanitizar antes de loggear** (no enviar el body crudo) |
| El endpoint `/v1/_dev/logs` está abierto a cualquier API key del tenant | En MVP OK. En prod, agregar check de scope='admin' o crear API keys de tipo 'dev_log_reader' |

---

## Por qué esto > Sentry / DataDog / etc.

No reemplaza un APM profesional. Pero para el caso "**estoy debugueando este endpoint AHORA y necesito ver qué pasó adentro**" es:

- ✅ **Gratis** (Stratus tiene tier generoso)
- ✅ **0 vendors** (todo dentro de Catalyst)
- ✅ **Inspeccionable desde un script** sin OAuth dance ni SDK extra
- ✅ **Estructurado en JSON** (no grep en texto plano)
- ✅ **Compatible con agentes IA** que iteran sin humano (Claude/Copilot/etc pueden leer y corregir)

Cuando llegues a prod con tráfico real, agregale Sentry encima para alerting + traces, pero mantené este logger para el debug iterativo.

---

## Resumen — checklist de implementación

- [ ] Crear bucket Stratus `mi-app-logs` (Catalyst Console → Stratus → Create)
- [ ] Verificar `zcatalyst-sdk-node` ≥ 3.4 en `functions/*/package.json`
- [ ] Crear `functions/api-v1/lib/catalyst-app.js` (helper getApp)
- [ ] Crear `functions/api-v1/lib/stratus-logger.js` (middleware)
- [ ] Crear `functions/api-v1/routes/dev-logs.js` (endpoint lectura)
- [ ] Wire en `index.js`: `app.use(stratusLogger(...))` ANTES de las routes
- [ ] Wire en `index.js`: `app.use('/v1/_dev/logs', require('./routes/dev-logs'))`
- [ ] Crear `scripts/read-log.ts` (CLI local)
- [ ] `npm script` `"read-log": "tsx scripts/read-log.ts"` en package.json raíz
- [ ] Deploy + test: `catalyst deploy && curl ... && pnpm read-log <req-id>`

Una vez funcionando, replicarlo en cada nueva function (mismo middleware, mismo bucket, diferente `functionName`).
