# 13 — Casos de Estudio

Bugs reales de producción con síntoma, causa root, fix y lección. Los nombres de entidades se generalizan para que apliquen a cualquier proyecto.

Cada caso tiene el mismo formato: **Síntoma → Investigación → Causa root → Fix inmediato → Fix preventivo → Lecciones**.

---

## Caso 1: El cron que se murió silenciosamente

### Contexto
Un sistema con una tabla de `Flows` en estado `AWAITING_EXTERNAL_RESPONSE` que debe tener timeout 60 seg. Un Cron Function corre cada 1 min y cierra los flows vencidos.

### Síntoma
Flows quedan en `AWAITING_EXTERNAL_RESPONSE` por 18+ minutos, sin transición automática a `FAILED`.

### Investigación
1. Revisar logs de la cron function → no hay logs recientes
2. Catalyst Console → Cron Jobs → **el job aparecía como "disabled"**
3. Última ejecución: un error hace varias horas

### Causa root
En algún momento, una invocación del cron lanzó excepción no manejada. Catalyst, como protección, **apaga el cron automáticamente**. Sin alerta. Sin email.

### Fix inmediato
1. Re-enable el cron desde Catalyst Console
2. Investigar cuál fue el error original (log del último fallo)

### Fix preventivo
Blindar el handler raíz para que NUNCA rethrow:

```js
module.exports = async (req, res) => {
    try {
        const app = catalyst.initialize(req);
        await runAllJobs(app);
    } catch (err) {
        // CRÍTICO: no rethrow, siempre log + 200
        console.error('[CRON] Error crítico:', err.message, err.stack);
    } finally {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    }
};

async function runAllJobs(app) {
    // Cada job en su try/catch individual
    try { await jobA(app); } catch (e) { console.error('[JOB-A]', e.message); }
    try { await jobB(app); } catch (e) { console.error('[JOB-B]', e.message); }
}
```

### Lecciones
1. **Catalyst apaga crons que fallan, sin alerta.** Asumir que puede pasar.
2. **Monitoring externo obligatorio.** Un ping externo cada 5 min al endpoint `/check` — si deja de responder 200, alerta al equipo.
3. **Dead-man's switch:** chequear periódicamente "¿el cron procesó algo en las últimas N horas?". Si no, algo está mal aunque el endpoint responda 200.
4. **Try/catch raíz + siempre 200**: un error individual no debe matar el job entero.

---

## Caso 2: Tres carpetas por registro en sistema externo

### Contexto
Al procesar un registro, se crea (find-or-create) una carpeta en un sistema de archivos externo (Google Drive, WorkDrive, S3 con paths). La carpeta se identifica por un ID único del negocio.

### Síntoma
Para un registro se encontraron 3 carpetas distintas. Los archivos quedaban repartidos entre ellas inconsistentemente.

### Investigación
La función `findFolder` buscaba la carpeta por nombre con `includes`:

```js
const existing = folders.find(f => f.name.includes(customerId));
```

En el sistema externo había:
- `Cliente - 12345`
- `Cliente - 12345 (2026-04-23 15:30:12)` ← creado por automation que agregaba timestamp si detectaba duplicado
- `Cliente - 123456` ← otro cliente con ID que empieza igual

Tres variantes matcheaban. Condiciones de carrera hacían que el código eligiera inconsistentemente.

### Fix inmediato
Consolidar archivos en la carpeta correcta manualmente.

### Fix preventivo
Regex con anchor exacto:

```js
const regex = new RegExp(`-\\s*${escapeRegex(customerId)}\\s*$`);
const existing = folders.find(f => regex.test(f.name));
```

O mejor: buscar por ID único del sistema externo (no nombre) si el API lo permite.

### Lecciones
1. **Búsquedas por nombre son frágiles.** Siempre pattern exacto o con anchors.
2. **Sistemas externos pueden mutar nombres.** Otros tools/automations pueden agregar sufijos. Probar con data real.
3. **Idempotencia solo sirve si el lookup es determinista.** Si dos entradas matchean, no hay idempotencia real.

---

## Caso 3: Acción disparada antes de que el estado lo permita

### Contexto
Un panel admin con un botón "Reprocesar" que dispara una integración con API externa. La integración solo es válida si el flow está en estado `SIGNED`.

### Síntoma
Flows mostraban `external_api_status = 'pending'` aunque aún no estaban firmados. La API externa recibía datos inválidos.

### Investigación
El handler no validaba el estado del registro antes de disparar:

```js
async function handleReprocess(req, res, app, rowId) {
    await validateAuth();
    const row = await getRow(app, rowId);
    // FALTA: chequear que current_state === 'SIGNED' antes de disparar
    const result = await sendToExternalApi(row);
    if (result.success) {
        await updateRow({
            external_api_status: 'pending',
            external_api_pending_since: now
        });
    }
}
```

El operador hizo click por error en un registro donde el cliente no había firmado. La API externa recibió data incompleta → respondió error → el flow quedó en un estado inconsistente.

### Fix
Validar precondiciones antes de disparar:

```js
if (row.current_state !== 'SIGNED') {
    throw new ValidationError(
        `Cannot reprocess: current_state is ${row.current_state}, expected 'SIGNED'`
    );
}
```

Y en frontend, deshabilitar el botón si la precondición no se cumple:

```tsx
<button
    disabled={order.current_state !== 'SIGNED'}
    onClick={reprocess}
>
    Reprocesar
</button>
```

### Lecciones
1. **Cualquier acción que dispara proceso irreversible DEBE validar precondiciones.** No confiar en que el frontend filtró.
2. **Validación doble (frontend + backend).** Frontend por UX, backend por seguridad.
3. **Estados canónicos (state machine) ayudan:** con transitions explícitas, "SIGNED requerido" es literal en el código.

---

## Caso 4: Webhooks del proveedor devolviendo 401

### Contexto
Integración con proveedor externo (payments, verification, etc.) que envía webhooks firmados con HMAC.

### Síntoma
Después de una actualización del proveedor, todos los webhooks empiezan a recibir 401 del backend. Estados dejan de actualizarse en tiempo real.

### Investigación
El código validaba con header `x-signature` y HMAC del body:

```js
const signature = req.headers['x-signature'];
const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
if (signature !== expected) return reject401();
```

El proveedor había migrado a v2:
- Header nuevo: `x-signature-v2`
- Nuevo timestamp header: `x-timestamp`
- HMAC sobre `timestamp + '.' + body` (no solo body)

### Fix
Soportar ambas versiones:

```js
function verifySignature(req, body) {
    const secret = process.env.WEBHOOK_SECRET;

    // V2 (nuevo)
    const sigV2 = req.headers['x-signature-v2'];
    const ts = req.headers['x-timestamp'];
    if (sigV2 && ts) {
        const expected = crypto.createHmac('sha256', secret)
            .update(`${ts}.${body}`).digest('hex');
        if (timingSafeEqual(sigV2, expected)) return true;
    }

    // V1 (legacy)
    const sigV1 = req.headers['x-signature'];
    if (sigV1) {
        const expected = crypto.createHmac('sha256', secret)
            .update(body).digest('hex');
        if (timingSafeEqual(sigV1, expected)) return true;
    }

    return false;
}
```

Log detallado al fallar ayuda a detectar el cambio rápido:
```js
console.error('[WEBHOOK] Invalid signature. Headers:', JSON.stringify(req.headers));
```

### Lecciones
1. **Los proveedores cambian formatos sin aviso prominente.** Suscribirse a sus API changelogs.
2. **Soportar múltiples versiones** durante transición. Aceptar cualquiera que match.
3. **Logs detallados** al fallar verificación aceleran diagnóstico.
4. **Monitoring de webhook failure rate**: si pasa de 0% a 100%, alerta inmediata.

---

## Caso 5: Factura alta en queries de DataStore

### Contexto
App con Cron Function que chequea múltiples reglas cada 1 minuto.

### Síntoma
Factura mensual llega con ~$25 solo de Fetch de DataStore. Volumen sospechoso para una app con pocos usuarios.

### Investigación
Catalyst Console → Billing → breakdown por recurso: **~400k Fetches/mes**.

Analizamos las fuentes:

**Causa 1:** Cron con 7 reglas, cada una hace una query separada:

```js
for (const rule of RULES) {  // 7 iteraciones
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Flows WHERE status = '${rule.value}'`
    );
    processRows(rows, rule);
}
```

Cada corrida = 1 query de Config + 7 queries de Flows = 8 queries.
Corriendo cada 1 min × 24h × 30 días = **~345,600 queries/mes solo el cron**.

**Causa 2:** Dashboard con polling cada 30 seg:
2 queries × 120/hora × 8h/día × 2 users × 22 días = **~85k queries/mes**.

### Fix
**Backend — consolidar queries:**

```js
// 1 sola query consolidada
const allRows = await app.zcql().executeZCQLQuery(`
    SELECT * FROM Flows
    WHERE archived_at IS NULL
      AND status IN ('state_a', 'state_b', 'state_c', 'state_d', 'state_e')
`);

// Filtrado por rule en memoria
for (const rule of RULES) {
    const matching = allRows.filter(row => row.Flows.status === rule.value);
    processRows(matching, rule);
}
```

Reducción: 8 queries → 2 por corrida. **Ahorro 75% del cron.**

**Frontend — ajustar polling de 30s → 90s.**
Reducción: 66% del volumen del polling.

**Total:** ahorro proyectado ~$16/mes (65% de la factura).

### Lecciones
1. **DataStore Fetch es el costo dominante.** Cada query cuenta individualmente.
2. **N queries en un loop = N veces el costo.** Consolidar siempre.
3. **Cadencia alta multiplica dramáticamente.** Cron 1 min × 7 queries × 30 días = 300k.
4. **Monitoreo de factura temprano.** Alerta a threshold (ej. $30/mes).
5. **Polling frontend: usar la cadencia más lenta que el UX tolere.**

---

## Caso 6: Registros "invisibles" por bundle viejo cacheado

### Contexto
Panel frontend servido por Catalyst Client Hosting. Usuarios con rol operador reportan que no ven registros recientes.

### Síntoma
Administradores ven todos los registros. Operadores no ven los 3 más nuevos.

### Investigación
1. Hipótesis inicial: "hay filtro por rol en el frontend". Se buscó durante 30 min — no existía.
2. Pedimos al usuario operador ejecutar en la Console del browser:
   ```js
   fetch('/server/api_function/orders')
       .then(r => r.json())
       .then(d => console.log('Total:', d.length, 'IDs:', d.map(o => o.id).join(',')))
   ```
3. Response incluía los 3 registros que "no veía".

### Causa root
El usuario tenía un bundle JS cacheado que era **versión vieja** del frontend. En esa versión vieja había un bug (ya arreglado) que filtraba los registros.

### Fix inmediato
Hard refresh del browser (Cmd+Shift+R) o limpiar cache.

### Fix preventivo
1. **Versioning visible** en UI: footer con `v2.5.2`. Así al reportar bug, el user dice la versión y sabemos si tiene cache viejo.
2. **Cache busting** en el build: Vite/webpack ya lo hacen por default con hash en filenames (`index-abc123.js`).
3. **Service Worker** con estrategia "network-first" para el bundle principal.

### Lecciones
1. **Bundle JS cacheado es una fuente de bugs fantasma.** El código del repo dice X, el browser ejecuta Y.
2. **Versioning visible** acelera diagnóstico.
3. **DevTools Network es la primera herramienta de debugging.** Antes de buscar en código, ver qué manda/recibe el browser.
4. **Reproducir en incógnito** descarta problemas de cache.

---

## Caso 7: Double-charge que casi fue a producción

### Contexto
App con un flow donde, al completar firma digital, se dispara el cobro con Stripe (o similar API de pagos).

### Síntoma en dev
Durante test end-to-end, el cobro se ejecutó 2 veces en el mismo registro. Afortunadamente el sandbox del proveedor lo detectó como duplicado por idempotency key.

### Investigación
Descubrimos dos paths que disparaban el cobro:

1. Callback de "firma completada" → dispara cobro inline
2. Webhook del proveedor de firma (que también indica "completed") → dispara cobro

Como ambos llegaban casi simultáneamente en dev, el cobro se enviaba dos veces.

### Fix
Helper idempotente que centraliza el trigger:

```js
async function triggerChargeIfReady(app, orderId) {
    const order = await ordersDb.getById(app, orderId);

    if (order.charge_status === 'success') {
        console.log(`[CHARGE] Already charged, skip orderId=${orderId}`);
        return;
    }

    if (order.current_state !== 'SIGNED') {
        console.warn(`[CHARGE] Not ready, state=${order.current_state}`);
        return;
    }

    const result = await stripe.createCharge(order);
    await ordersDb.update(app, orderId, {
        charge_status: result.success ? 'success' : 'failed',
        charge_id: result.id
    });
}
```

Ambos callers (callback directo y webhook) llaman al helper. El segundo detecta `charge_status === 'success'` y hace skip.

### Lecciones
1. **Múltiples caminos al mismo side-effect son peligrosos.** Garantizar idempotencia o centralizar.
2. **Idempotencia como check de estado**, no solo "no va a pasar dos veces".
3. **Bugs en dev son oportunidades.** Si no los detectamos ahí, habríamos cobrado doble a clientes reales.
4. **Idempotency keys del proveedor** son la última línea de defensa, no la primera.

---

## Caso 8: Schema retroactivo sin migración

### Contexto
La app evoluciona. En un momento se agrega un nuevo campo requerido por una integración externa.

### Síntoma
Registros procesados antes del cambio fallan al intentar la integración nueva. Error: "field X is required".

### Investigación
Historia:
1. Inicialmente `Orders` tenía campo `customer_tax_id`
2. Se agregó una integración que requería `customer_tax_id_formatted` (versión normalizada)
3. El código nuevo esperaba el campo formateado
4. Registros viejos no tenían el campo nuevo → la integración fallaba

### Fix

**Forward fix:** en el código de creación, siempre generar el campo derivado:

```js
const formatted = formatTaxId(payload.customer_tax_id);
await db.orders.create({
    ...payload,
    customer_tax_id_formatted: formatted
});
```

**Backward fix:** script de migración que backfillea registros viejos:

```js
async function backfillFormattedTaxId(app) {
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT ROWID, customer_tax_id FROM Orders WHERE customer_tax_id_formatted IS NULL`
    );
    for (const row of rows) {
        const r = row.Orders;
        const formatted = formatTaxId(r.customer_tax_id);
        await app.datastore().table('Orders').updateRow({
            ROWID: r.ROWID,
            customer_tax_id_formatted: formatted
        });
    }
}
```

**Defensive fix en runtime:** si el campo falta, calcular al vuelo:

```js
function getFormattedTaxId(order) {
    return order.customer_tax_id_formatted
        || formatTaxId(order.customer_tax_id);
}
```

### Lecciones
1. **Cambios de schema retroactivos son dolorosos.** Planear migración al mismo tiempo que el cambio.
2. **Defaults sensatos en el código** evitan bugs. Si el nuevo campo está vacío, calcular al vuelo como fallback.
3. **Validación en el punto de entrada** (al crear) evita data inconsistente.

---

## Caso 9: Race condition en cron optimizado

### Contexto
Un cron que procesa múltiples reglas. Cada regla puede disparar una acción distinta sobre el mismo registro.

Después de optimizar (consolidar 7 queries en 1), aparece un bug nuevo.

### Síntoma
A veces, el mismo registro recibe 2 acciones distintas en la misma corrida del cron. Ejemplo: 2 emails diferentes al mismo cliente.

### Investigación
**Antes de la optimización:**

```js
for (const rule of RULES) {
    const rows = await query(`WHERE status = '${rule.value}'`);  // fetch fresco
    for (const row of rows) {
        await processRow(row, rule);
        await updateDb(row.id, { last_action: rule.key, updated_at: now });
    }
}
```

Al hacer `query` fresco en cada iteración, después del primer `updateDb`, las siguientes iteraciones ya no matcheaban ese registro (porque `updated_at` cambió).

**Después de la optimización:**

```js
const allRows = await query('WHERE ...');  // una sola query
for (const rule of RULES) {
    const matching = allRows.filter(r => r.status === rule.value);
    for (const row of matching) {
        await processRow(row, rule);
        await updateDb(row.id, { last_action: rule.key, updated_at: now });
        // ← row en la copia en memoria sigue con updated_at VIEJO
    }
}
```

Un row que ya fue procesado por rule A seguía siendo elegible para rule B porque `row.updated_at` en memoria no se refrescó.

### Fix
Mutar la copia in-memory al procesar:

```js
if (result.success) {
    const newUpdatedAt = toCatalystDateTime();
    await updateDb(row.id, { last_action: rule.key, updated_at: newUpdatedAt });
    row.updated_at = newUpdatedAt;  // ← reflejar en memoria
    row.last_action = rule.key;
}
```

### Lecciones
1. **Optimización puede introducir bugs sutiles.** Cambios "batch read + loop" vs "N reads secuenciales" tienen semánticas distintas.
2. **In-memory state debe reflejar DB state** si modificás la DB en el loop.
3. **Testear happy path Y edge cases** antes de deployar optimizaciones.
4. **Git diff review** antes de merge: ¿qué invariante cambió con este "pequeño refactor"?

---

## Caso 10: Doble procesamiento de webhook por reintento del proveedor

### Contexto
Webhook de proveedor externo. El proveedor reintenta si no recibe 2xx dentro de cierto tiempo.

### Síntoma
Al recibir webhook de evento "pago exitoso", se creaban 2 registros en la DB. Descubierto al comparar cantidad de eventos del proveedor vs registros creados.

### Causa root
El handler procesaba el evento antes de responder. Si el procesamiento tardaba >5 seg, el proveedor asumía timeout y reintentaba. Segundo webhook llegaba y creaba otro registro.

### Fix
Idempotencia por `event_id` del proveedor:

```js
exports.handleWebhook = async (ctx) => {
    const event = await verifyAndParseWebhook(ctx);

    // Chequeo idempotencia ANTES de procesar
    const existing = await ctx.app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(event.id)}'`
    );
    if (existing.length > 0) {
        return sendJson(ctx.res, 200, { received: true, duplicate: true });
    }

    await ctx.app.datastore().table('ProcessedEvents').insertRow({
        event_id: event.id,
        provider: 'stripe',
        received_at: toCatalystDateTime()
    });

    // Responder 200 rápido antes de procesar
    sendJson(ctx.res, 200, { received: true });

    // Procesar async — si falla, outbox/retry worker se encarga
    processEventAsync(event).catch(err => {
        console.error(`[WEBHOOK] Async processing failed:`, err.message);
    });
};
```

### Lecciones
1. **Todos los proveedores reintentan webhooks.** Asumirlo como default.
2. **Idempotencia por `event_id`** es patrón universal.
3. **Marcar processed ANTES de procesar.** Si procesamos primero y marcamos después, un fallo intermedio lleva a re-procesar.
4. **Responder 200 rápido** (< 2 seg típicamente). Procesar async.

---

## Patrones comunes detrás de todos estos casos

Mirando juntos, emergen meta-patterns:

### 1. Estado distribuido sin sincronización
Casos 3, 7, 9: cada uno sufre por estado en múltiples lugares/copias sin coordinación.

**Solución:** state machine explícita, una fuente de verdad.

### 2. Sistemas externos impredecibles
Casos 1, 4, 10: proveedores y Catalyst mismo tienen comportamientos inesperados.

**Solución:** defensive programming, monitoring externo, circuit breakers, idempotencia.

### 3. Optimización sin tests
Casos 5, 9: optimizaciones introdujeron bugs sutiles.

**Solución:** cambios incrementales, verificar invariantes antes/después, tests de integración.

### 4. Cache como fuente de bugs
Caso 6: bundle cacheado, estado en memoria stale.

**Solución:** versioning visible, cache busters, invalidación explícita.

### 5. Guardas ausentes cuestan caro
Casos 3, 8: validaciones omitidas al inicio.

**Solución:** validación en puntos de entrada, defaults seguros, precondition checks.

---

## Template para documentar un caso nuevo

```markdown
## Caso N: [Título descriptivo]

### Contexto
[Setup mínimo para entender el caso, 2-3 líneas]

### Síntoma
[Qué se observó en producción/dev]

### Investigación
[Pasos que llevaron a la causa]

### Causa root
[Explicación clara del problema subyacente]

### Fix inmediato
[Cómo se remedió rápido]

### Fix preventivo
[Cambio estructural que previene reincidencia]

### Lecciones
1. [Generalización 1]
2. [Generalización 2]
...
```

Llenarlo mientras está fresco. La memoria es mala y la próxima vez no te vas a acordar del detalle que hizo la diferencia.
