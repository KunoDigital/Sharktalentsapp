# 07 — Performance y Costos

En Catalyst, los fetches de DataStore son el costo dominante. Una app mal optimizada puede facturar **$20-50/mes** solo en queries, cuando con los mismos features podría facturar $5.

Caso real observado:
- 364,395 fetches/mes = **$21.86/mes** solo de un cron function
- Root cause: 7 queries por corrida × 60 corridas/hora × 24h × 30 días = 302k
- Fix: consolidar 7 queries en 1 → ahorro ~70%

---

## Cálculo de costos aproximados (al día de hoy)

| Operación | Costo | Notas |
|---|---|---|
| Fetch | $0.00006 | Cada SELECT o getRow |
| Insert | $0.0001 | Cada insertRow |
| Update | $0.00008 | Cada updateRow |
| Delete | $0.00008 | Cada deleteRow |
| Storage | $0.00072/GB/día | Muy barato para apps típicas |

**Multiplicadores típicos del mes:**
- Un cron que corre cada 1 min = 43,200 ejecuciones/mes
- Polling de dashboard cada 30s × 8h/día × 2 users = 57,600 requests/mes
- Webhooks externos típicos: 100-10,000/mes

Si cada uno hace 3-10 queries, facturás fácil 100k-500k fetches/mes.

---

## Proyectar antes de deploy

Antes de agregar una feature que hace queries, proyectá el costo:

```
volumen_esperado × queries_por_op × costo_por_query
```

**Ejemplo: polling del dashboard cada 30s**
- Usuarios concurrentes: 3
- Horas/día: 8
- Días/mes: 22 (laborales)
- Calls/hora: 120 (cada 30s)
- Queries por call: 3 (lista + HsmLog + config)

```
3 × 8 × 22 × 120 × 3 = 190,080 queries/mes
× $0.00006 = $11.40/mes
```

Si subís el intervalo a 90s, dividís por 3 → $3.80/mes. Ganancia de $7.60/mes por cambiar una constante.

---

## Optimización #1: consolidar queries

### Anti-pattern: N+1

```js
// ❌ Mal — 1 + N queries
const orders = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
for (const order of orders) {
    const user = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Users WHERE ROWID = '${order.Orders.user_id}'`
    );
    order.user = user[0].Users;
}
```

Para 100 orders: 101 queries.

### Pattern correcto: batch

```js
// ✅ Bien — 2 queries, no N+1
const orders = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');
const userIds = [...new Set(orders.map(o => o.Orders.user_id))];
const users = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Users WHERE ROWID IN (${userIds.map(escapeSql).join(',')})`
);
const usersById = Object.fromEntries(users.map(u => [u.Users.ROWID, u.Users]));
for (const order of orders) {
    order.user = usersById[order.Orders.user_id];
}
```

Para 100 orders: 2 queries. 50× menos costo.

### Pattern: consolidar queries de cron

Ejemplo real: un cron que evalúa múltiples reglas sobre la misma tabla.

**Antes (7 queries):**
```js
// Cada rule hace su propia query al mismo tabla
for (const rule of TIMER_RULES) {
    const rows = await app.zcql().executeZCQLQuery(
        `SELECT * FROM Orders WHERE status = '${rule.value}'`
    );
    // procesar rows
}
```

**Después (1 query):**
```js
const allRows = await app.zcql().executeZCQLQuery(`
    SELECT * FROM Orders
    WHERE status IN ('pending', 'processing', 'completed', 'failed')
      AND archived_at IS NULL
`);

for (const rule of TIMER_RULES) {
    const matching = allRows.filter(r => r.Orders.status === rule.value);
    // procesar matching
}
```

Ahorro: 6 queries por corrida, 86% de reducción.

---

## Optimización #2: ajustar cadencia

El volumen es lineal con la frecuencia:

| Intervalo | Queries/mes (polling 8h/día) |
|---|---|
| 15 seg | 345,600 |
| 30 seg | 172,800 |
| 60 seg | 86,400 |
| 90 seg | 57,600 |
| 2 min | 43,200 |
| 5 min | 17,280 |

**Regla:** usar la cadencia más lenta que el UX tolere.

Para dashboards operativos: 60-90 seg casi siempre suficiente. Para datos semi-real-time: 15-30 seg.

### Crons

Similar:

| Intervalo | Ejecuciones/mes |
|---|---|
| 1 min | 43,200 |
| 5 min | 8,640 |
| 15 min | 2,880 |
| 1 hora | 720 |

**Si el timeout que chequea el cron es 60 seg, debes correr al menos cada minuto.** Si el timeout es 5 min, cada 5 min está bien.

**Lección importante:** si bajás la frecuencia del cron, también considerá aumentar los timeouts de negocio en proporción. No pueden desacoplarse.

---

## Optimización #3: caché en memoria

Catalyst functions pueden re-usar el mismo contenedor entre invocaciones (warm start). Una cache module-global puede persistir ~10-30 min.

```js
// services/config.js

let cachedConfig = null;
let cacheExpires = 0;

async function getConfig(app) {
    if (cachedConfig && Date.now() < cacheExpires) {
        return cachedConfig;
    }

    const rows = await app.zcql().executeZCQLQuery('SELECT * FROM Config');
    cachedConfig = rows.reduce((acc, r) => {
        const row = r.Config || r;
        acc[row.key] = row.value;
        return acc;
    }, {});
    cacheExpires = Date.now() + 300_000;  // 5 min

    return cachedConfig;
}

module.exports = { getConfig };
```

Con warm starts, muchas requests que necesitan config leen de memoria, no de DB.

**Cuidado:** si el config cambia (admin lo modifica), la cache tarda 5 min en invalidarse. Para data que cambia más frecuente, menor TTL o no cachear.

---

## Optimización #4: queries selectivas

No traigas todo:

```js
// ❌ Mal — trae 30+ columnas cuando solo necesitás 3
SELECT * FROM Orders

// ✅ Bien — explícito
SELECT ROWID, status, amount FROM Orders
```

**Beneficio:** menos datos en la red. Catalyst cuenta igual el fetch, pero la latencia baja y el payload es menor (ayuda al timeout de 30s).

---

## Optimización #5: paginación

Nunca traigas todo un table grande:

```js
// ❌ Mal
const all = await app.zcql().executeZCQLQuery('SELECT * FROM Orders');  // 100k rows

// ✅ Bien
const PAGE_SIZE = 50;
const page = parseInt(ctx.parsed.query.page || '1', 10);
const offset = (page - 1) * PAGE_SIZE;
const rows = await app.zcql().executeZCQLQuery(
    `SELECT * FROM Orders ORDER BY CREATEDTIME DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
);
```

### Listas grandes para admin: limite superior

Aunque el panel muestre los "500 más recientes", el query a DataStore puede traer todo. Explícito el LIMIT:

```js
// Siempre LIMIT
const rows = await app.zcql().executeZCQLQuery(
    'SELECT * FROM Orders WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 500'
);
```

---

## Optimización #6: archival/soft delete

Tablas que crecen sin control aumentan costo de queries (aunque se leen con LIMIT, los fetch de metadata pueden ser más caros). Archival strategy:

```
Orders       ← tabla caliente, solo "activos" (últimos 90 días o activos)
OrdersArchive ← tabla fría, histórico
```

O más simple: columna `archived_at` en la misma tabla, y filtrás:

```js
SELECT * FROM Orders WHERE archived_at IS NULL
```

Los archived no aparecen en queries operacionales. Admin puede consultar archivos manualmente para auditoría.

**Automatizar:** un cron semanal que mueve a archive lo que tiene más de 90 días.

---

## Optimización #7: reducir round-trips

Si necesitás hacer 3 updates secuenciales en la misma fila, consolidá en 1:

```js
// ❌ Mal — 3 updates
await table.updateRow({ ROWID, status: 'pending' });
await table.updateRow({ ROWID, updated_at: now });
await table.updateRow({ ROWID, user_id: userId });

// ✅ Bien — 1 update
await table.updateRow({
    ROWID,
    status: 'pending',
    updated_at: now,
    user_id: userId
});
```

---

## Optimización #8: evitar queries redundantes

Pasá el dato, no lo re-queryes:

```js
// ❌ Mal — query redundante
async function handleUpdate(ctx, rowId) {
    const order = await getOrder(ctx.app, rowId);
    await validateOrder(ctx.app, rowId);  // hace otro getOrder adentro
    await processOrder(ctx.app, rowId);   // hace otro getOrder adentro
}

// ✅ Bien — pasá el objeto
async function handleUpdate(ctx, rowId) {
    const order = await getOrder(ctx.app, rowId);
    await validateOrder(order);
    await processOrder(ctx.app, order);
}
```

---

## Polling vs Event-driven

### Cuándo usar polling

- El proveedor externo no tiene webhooks confiables
- Necesitás "timeouts" ("si pasa X tiempo, hacer Y")
- Requisitos de UI "casi real time" (dashboard operativo)

### Cuándo usar event-driven

- Catalyst DataStore triggers (Event Functions): se disparan al crear/actualizar filas
- Webhooks de providers externos: Stripe, Twilio, SendGrid, verification providers, etc.
- Messaging queue: si tenés Redis/SQS externos

### Patrón híbrido

La mayoría de apps reales usan **ambos**:
- Webhooks para notificaciones inmediatas de eventos externos
- Polling/crons para timeouts y cleanup

Ejemplo: un flujo de verificación tercerizada usa este patrón:
- Webhook del provider → reacciona inmediato al cambio de estado
- Cron que chequea timeouts (si el webhook no llega por alguna razón) → fallback de robustez

---

## Frontend polling

### Regla de oro

```
intervalo de polling = (tolerancia de UX para "datos viejos") × 0.5
```

Si el usuario tolera datos de 2 min viejos, polling cada 60s. Si tolera 5 min, polling cada 2 min.

### Abort en cambio de tab

```js
// React hook que para el polling cuando la tab está en background
useEffect(() => {
    if (document.hidden) return;  // no poll si tab no visible
    const interval = setInterval(fetchData, 90000);
    return () => clearInterval(interval);
}, [document.visibilityState]);
```

Gran ahorro en apps que los users dejan abiertas pero no miran.

---

## Costos de storage

Storage es **muy barato** ($0.00072/GB/día), pero archivos grandes suman:

| Dato | Costo/mes |
|---|---|
| 1 GB de DataStore | $0.02 |
| 100 GB File Store (PDFs) | $2.16 |

No optimices storage a menos que tengas TB.

**Pero cuidado con File Store:** apps que generan archivos temporales (PDFs, reports, uploads) deben tener cleanup automático. Sin cleanup, un sistema que procesa ~100 archivos/día puede acumular 1-2 GB/mes. Manageable pero acumulativo.

---

## Monitoreo de factura

Catalyst Console → Billing tiene breakdown por recurso. Revisá **mensualmente**:

- Si `Fetch` es > 80% del costo → revisar queries y polling
- Si `Insert` es alto → revisar inserts en loops, batching
- Si `Cron executions` es alto → revisar frecuencia
- Si `Storage` crece lineal → implementar archival

### Trigger temprano

Poner alerta en la cuenta de Catalyst a un threshold (ej. $30/mes). Si lo supera, investigar.

---

## Micro-optimizaciones que NO importan

No pierdas tiempo en:

- `const` vs `let` performance (ninguna diferencia medible)
- `JSON.parse` vs alternativas (casi siempre despreciable)
- Tipado con TypeScript (impacto cero en runtime)
- Minificar JS server-side (Catalyst lo maneja)

**Sí importa:**
- Cantidad de queries a DB
- Tamaño de payloads transferidos
- Cadencia de jobs
- Timeouts correctos

---

## Checklist de performance

Antes de deploy:

- [ ] Ningún handler hace N+1 queries
- [ ] Crons consolidan queries donde es posible
- [ ] Polling frontend usa el intervalo más lento tolerable
- [ ] Cron frecuency matches business timeout requirements
- [ ] Listas grandes tienen paginación
- [ ] Queries especifican columnas necesarias, no `*` salvo que se use todo
- [ ] Cache en memoria para config/lookups que cambian raro
- [ ] Archival strategy para tablas que crecen lineal
- [ ] Monitoring de factura mensual habilitado
- [ ] Costos proyectados antes de features nuevas caras
