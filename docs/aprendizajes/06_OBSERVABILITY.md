# 06 — Observability: logs, debugging, health checks

Si no podés debuggear un incidente de producción a las 3am, tu app no está lista para producción.

---

## Logs estructurados con prefijos

### Convención de prefijos

Cada módulo/flujo tiene un prefijo único. Así filtrás rápido en Catalyst Logs.

```js
console.log(`[HSM-TIMER] Iniciando chequeo...`);
console.log(`[WEBHOOK-STRIPE] Evento ${eventId} procesado`);
console.log(`[PAYMENT] rowId=${rowId} status=success duration=${ms}ms`);
console.error(`[FILE-SYNC] Error upload storage:`, err.message);
```

**Reglas:**
- Prefijo en `[MAYÚSCULAS]` con guiones (sin espacios)
- Jerárquico cuando aplique: `[AUTH-LOGIN]`, `[AUTH-LOGOUT]`
- Consistente en todo el código (el mismo flow usa el mismo prefijo)

### Niveles de log

```js
console.log('[MODULE] Operación normal');           // info/trace
console.warn('[MODULE] Algo raro, no crítico');     // warn
console.error('[MODULE] Falla real:', err.message); // error
```

Catalyst los muestra con ícono distinto en la consola. Usalos correctamente.

**Regla:** si un error atrapado no es realmente un problema (ej. "fila no existe, era lo esperado"), log como `warn`, no `error`. Así el volumen de error real no se diluye.

---

## Incluir contexto suficiente

```js
// ❌ Mal — no sé a qué se refiere
console.log('Procesado');

// ✅ Bien — info accionable
console.log(`[ORDER] processed orderId=${orderId} status=completed duration=${Date.now() - startTime}ms`);
```

### IDs consistentes

Cada log debe incluir:
- **ID del recurso** (orderId, userId, rowId, idempotencia)
- **Operación** (create, update, send, process)
- **Duración** cuando tome tiempo apreciable
- **Estado resultado** cuando aplique (success, failed, skipped)

### Correlation IDs

Si una operación atraviesa múltiples funciones/sistemas, propagar un correlation ID:

```js
// Al recibir una request
const traceId = req.headers['x-trace-id'] || crypto.randomBytes(8).toString('hex');

console.log(`[API] trace=${traceId} POST /orders`);

// Al llamar sistema externo
await axios.post(url, payload, {
    headers: { 'x-trace-id': traceId, ... }
});

console.log(`[API] trace=${traceId} Order ${orderId} dispatched`);
```

Así al debuggear un flujo, grep `trace=abc123` te da el hilo completo.

---

## No loguear secrets ni PII

```js
// ❌ Mal
console.log(`[LOGIN] user=${username} password=${password}`);
console.log(`[PAYMENT] card=${cardNumber} cvv=${cvv}`);
console.log(`[USER] full_ssn=${user.ssn} email=${user.email}`);

// ✅ Bien
console.log(`[LOGIN] user=${username}`);
console.log(`[PAYMENT] card=****${cardNumber.slice(-4)}`);
console.log(`[USER] userId=${user.id}`);
```

### Fragmentos de secrets para debug

```js
const key = process.env.INTERNAL_API_KEY;
const frag = key ? `${key.slice(0, 4)}…${key.slice(-4)} (len=${key.length})` : 'null';
console.log(`[AUTH] key=${frag}`);
```

Así verificás que el secret esté presente sin exponerlo.

### Body truncado en errors

```js
try {
    await externalApi.call(payload);
} catch (err) {
    console.error(`[EXT] Error calling API:`, {
        message: err.message,
        status: err.response?.status,
        // Solo primeros 500 chars del body, sin datos sensibles estructurales
        body_preview: JSON.stringify(err.response?.data).slice(0, 500)
    });
}
```

---

## Structured logging (opcional pero recomendado)

Para facilitar filtrado en herramientas de logs:

```js
// lib/log.js

function log(level, prefix, message, fields = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        prefix,
        message,
        ...fields
    };
    console[level](JSON.stringify(entry));
}

exports.info = (prefix, message, fields) => log('log', prefix, message, fields);
exports.warn = (prefix, message, fields) => log('warn', prefix, message, fields);
exports.error = (prefix, message, fields) => log('error', prefix, message, fields);

// Uso
log.info('ORDER', 'created', { orderId, userId, amount });
```

**Ventaja:** parseable por herramientas (jq, Loki, Datadog).
**Desventaja:** menos legible en la consola de Catalyst.

Decisión: depende del equipo. Si usan tools externos → structured. Si solo Catalyst Logs → texto.

---

## Estructurar errors completos

Cuando atrapás un error, no perdás el stack:

```js
try {
    await doSomething();
} catch (err) {
    console.error(`[FLOW] Error en paso X:`, {
        message: err.message,
        stack: err.stack,  // CRÍTICO para debugging
        code: err.code,
        operation: 'send_notification',
        rowId,
        userId
    });
    throw err;  // re-lanzar si el caller debe reaccionar
}
```

**Nunca solo `console.error(err)`** — el stack se pierde a veces.

---

## Health check endpoint

Cada function debe tener un endpoint `/health` que tu monitoring externo consuma:

```js
// handlers/health.js

exports.check = async (ctx) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || 'unknown',
        uptime: Math.round(process.uptime()),
        checks: {}
    };

    // DB reachable?
    try {
        await ctx.app.zcql().executeZCQLQuery('SELECT ROWID FROM Users LIMIT 1');
        health.checks.db = 'ok';
    } catch (err) {
        health.checks.db = `fail: ${err.message}`;
        health.status = 'degraded';
    }

    // Env vars críticas presentes?
    const required = ['INTERNAL_API_KEY', 'APP_BASE_URL'];
    for (const v of required) {
        if (!process.env[v]) {
            health.checks[`env_${v}`] = 'missing';
            health.status = 'degraded';
        }
    }

    const status = health.status === 'ok' ? 200 : 503;
    sendJson(ctx.res, status, health);
};
```

### Monitoring externo

UptimeRobot / Better Stack / Pingdom consumen `/health` cada 1-5 min. Alert via Slack/email si:
- Status != 200 por más de N minutos consecutivos
- Latencia > X ms

Gratis para pocos checks. Vale oro cuando algo rompe en silencio.

### Health check detallado

Para ver "está el cron corriendo de verdad":

```js
exports.detailedHealth = async (ctx) => {
    requireInternalKey(ctx);  // proteger, no es público

    const lastCronRun = await getLatestCronExecution(ctx.app);
    const lastEmailSent = await getLatestEmailLog(ctx.app);

    const health = {
        status: 'ok',
        checks: {
            cron_recent: Date.now() - lastCronRun < 120_000 ? 'ok' : 'stale',
            emails_working: Date.now() - lastEmailSent < 3600_000 ? 'ok' : 'no_recent'
        }
    };

    sendJson(ctx.res, 200, health);
};
```

---

## Métricas clave por función

Para cada function crítica, exponé métricas agregadas:

```js
// handlers/metrics.js

exports.getMetrics = async (ctx) => {
    await requireAdminRole(ctx);

    const now = Date.now();
    const metrics = {
        timestamp: new Date().toISOString(),

        orders_last_hour: await count(ctx.app, 'Orders', now - 3600_000),
        orders_last_day: await count(ctx.app, 'Orders', now - 86400_000),

        failed_payments_last_day: await count(ctx.app, 'Payments', now - 86400_000, { status: 'failed' }),

        webhook_processing_backlog: await count(ctx.app, 'Outbox', null, { status: 'pending' }),

        users_active_last_week: await countDistinct(ctx.app, 'Sessions', now - 7 * 86400_000, 'user_id')
    };

    sendJson(ctx.res, 200, metrics);
};
```

---

## Audit log

Para operaciones críticas (crear/editar/eliminar), guardá audit log:

```js
// db/auditLog.js

exports.log = async (app, event) => {
    await app.datastore().table('AuditLog').insertRow({
        actor_user_id: event.userId,
        actor_username: event.username,
        action: event.action,         // 'order.create', 'user.delete', 'config.update'
        resource_type: event.type,
        resource_id: event.id,
        changes: JSON.stringify(event.changes || {}),
        ip: event.ip,
        user_agent: event.userAgent,
        created_at: new Date().toISOString()
    });
};

// En handlers
await auditLog.log(ctx.app, {
    userId: ctx.user.id,
    username: ctx.user.username,
    action: 'order.delete',
    type: 'order',
    id: orderId,
    changes: { status: { from: 'active', to: 'deleted' } },
    ip: ctx.req.headers['x-forwarded-for'],
    userAgent: ctx.req.headers['user-agent']
});
```

Cuando algo raro pasa ("¿quién eliminó ese cliente?"), el audit log tiene la respuesta.

---

## Debugging en Catalyst Console

Cómo usar Catalyst Logs efectivamente:

### 1. Filtro por función

Panel izquierdo → seleccionar `api_function`, `cron_function`, etc.

### 2. Filtro por timestamp

Narrow down al incidente. Catalyst tiene picker de rango.

### 3. Filtro por prefijo

Usá la caja de búsqueda: `[HSM-TIMER]` → todos los logs del timer HSM.

### 4. Filtro por nivel

"Error" / "Warn" / "Info" en el dropdown.

### 5. Sort por tiempo

Asc para seguir el flujo cronológico de un incident.

### 6. Export

Para análisis offline: export CSV, abrir en Excel/Numbers.

---

## Lo que hay que loguear SIEMPRE

### Al recibir una request

```js
console.log(`[API] ${method} ${path} user=${userId || 'anon'}`);
```

### Al llamar sistema externo

```js
console.log(`[EXT-STRIPE] POST /charges amount=${amount} orderId=${orderId}`);
// ... call ...
console.log(`[EXT-STRIPE] response status=${status} duration=${ms}ms`);
```

### Al procesar webhook entrante

```js
console.log(`[WEBHOOK-STRIPE] received eventId=${event.id} type=${event.type}`);
// ... proceso ...
console.log(`[WEBHOOK-STRIPE] processed eventId=${event.id} duration=${ms}ms`);
```

### Al fallar algo transitorio

```js
console.warn(`[EXT-STRIPE] timeout on attempt ${attempt}, will retry`);
```

### Al fallar algo permanente

```js
console.error(`[EXT-STRIPE] payment rejected orderId=${orderId}:`, err.message);
```

---

## Lo que NUNCA hay que loguear

- Passwords, tokens, API keys enteros
- Datos de tarjetas de crédito
- PII sin necesidad (emails OK si es necesario para debug, pero no SSN, direcciones)
- Stack traces con paths del sistema operativo que expongan structure interna
- User input sin sanitizar (previene log injection)

---

## Alertas

### Alertas desde Catalyst

Catalyst no tiene alertas nativas robustas. Alternativas:
- Un cron que cada X minutos lee logs recientes buscando patterns de error y manda alert a Slack
- Monitoring externo que pingea health checks
- Un "dead man's switch": si un cron importante no registró nada en las últimas N horas, alerta

### Ejemplo: alerta a Slack desde cron

```js
// cron_function/jobs/alerting.js

const axios = require('axios');

exports.run = async (app) => {
    const now = Date.now();
    const oneHourAgo = now - 3600_000;

    // Check: ¿hubo fallos de payment en la última hora?
    const recentFailures = await app.zcql().executeZCQLQuery(
        `SELECT COUNT(*) as count FROM Payments WHERE status = 'failed' AND created_at > ${oneHourAgo}`
    );
    const count = parseInt(recentFailures[0]['CASE'].count);

    if (count >= 10) {
        await sendSlackAlert({
            severity: 'high',
            title: `${count} payment failures in last hour`,
            details: `Check /server/api_function/metrics for details`
        });
    }
};

async function sendSlackAlert(payload) {
    await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: `🚨 [${payload.severity}] ${payload.title}\n${payload.details}`
    });
}
```

---

## Runbooks

Cuando algo falla, tener documentado **cómo investigar**. Crear `docs/RUNBOOKS/`:

```markdown
# Runbook: Cron job detenido

## Síntomas
- `[CRON] Iniciando chequeo...` no aparece en Catalyst Logs en las últimas 10 min
- Health check de `/cron_function/health` devuelve "stale"

## Diagnóstico

### 1. Verificar si el cron está habilitado en Catalyst
- Catalyst Console → Triggers → Cron Jobs
- Confirmar que el cron que invoca `/check` esté habilitado (nombre varía según setup)

### 2. Últimos logs
- Catalyst Console → Logs → filtrar por `cron_function`
- Buscar último `Error` antes del silencio

### 3. Causas comunes
- **Throw en raíz del handler:** Catalyst apaga el cron silenciosamente. Solución: envolver en try/catch y siempre devolver 200.
- **Timeout (> 15 min):** el job toma demasiado. Solución: optimizar queries o dividir en varios crons.
- **Config mal:** env var faltante causa throw al inicializar.

## Remediación

1. Re-enable el cron desde Catalyst Console
2. Fix la causa root (revisar logs del último error)
3. Monitoring: verificar que el health check vuelva a "ok" en 5 min
```

Tener runbooks para tus 5-10 incidents más comunes acelera la recuperación.

---

## Checklist de observability

- [ ] Todos los logs tienen prefijos consistentes
- [ ] Info operacional en `console.log`, warnings en `console.warn`, errors en `console.error`
- [ ] Errores incluyen `message + stack + context (IDs)`
- [ ] No se loguean secrets, passwords, ni PII innecesaria
- [ ] Health check `/health` en cada function
- [ ] Monitoring externo consumiendo health checks
- [ ] Audit log para operaciones críticas (crear/editar/eliminar)
- [ ] Correlation IDs en flujos multi-step
- [ ] Runbooks para los incidents más comunes
- [ ] Alertas configuradas para fallas críticas
- [ ] Endpoint de métricas agregadas (conteos, backlogs) para monitoring
