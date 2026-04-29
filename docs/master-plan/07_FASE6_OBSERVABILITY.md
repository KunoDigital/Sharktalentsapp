# 07 — Fase 6: Observability

**Objetivo:** que podamos debuggear producción a las 3am. Logs estructurados, health checks, audit log, runbooks, alertas externas, métricas.

**Tiempo estimado:** 1 semana.
**Dependencias:** Fase 4 (logger, ctx con traceId, tabla AuditLog).
**Riesgo:** bajo. Agrega sin modificar comportamiento.

**Referencias teóricas:** [06_OBSERVABILITY.md](../aprendizajes/06_OBSERVABILITY.md).

---

## Deliverables

- [ ] `/health` endpoint básico
- [ ] `/health/detailed` endpoint con checks por subsistema (protegido)
- [ ] `/metrics` endpoint (protegido)
- [ ] Audit log en toda acción admin
- [ ] Correlation IDs (traceId) en todos los logs
- [ ] Logs con prefijos consistentes en todos los módulos
- [ ] Monitoring externo configurado (UptimeRobot o similar)
- [ ] Alertas a email/Slack configuradas
- [ ] 5 runbooks mínimos creados
- [ ] Convenciones documentadas en `CLAUDE.md`

---

## 1. Convención de logs

### Formato

```
[MODULE-SUBMODULE] mensaje field1=value1 field2=value2 traceId=<id>
```

### Niveles

| Nivel | Uso | Ejemplo |
|---|---|---|
| `console.log` | operación normal, info útil para debug | `[API] POST /jobs user=daisy traceId=abc` |
| `console.warn` | algo raro pero no crítico | `[ANTHROPIC] timeout on attempt 1, retrying` |
| `console.error` | error real que requiere atención | `[ANTHROPIC] Circuit open after 5 failures` |

### Prefijos por módulo

| Prefijo | Módulo |
|---|---|
| `[ROUTER]` | router.ts, matching de rutas |
| `[AUTH]` | middleware de auth, login, JWT |
| `[ADMIN-JOBS]` | handlers/adminJobs.ts |
| `[ADMIN-ASSESSMENTS]` | handlers/adminAssessments.ts |
| `[ADMIN-RESULTS]` | handlers/adminResults.ts |
| `[ADMIN-CANDIDATES]` | handlers/adminCandidates.ts |
| `[ADMIN-LIBRARY]` | handlers/adminLibrary.ts |
| `[ADMIN-REPORTS]` | handlers/adminReports.ts |
| `[PUBLIC-TEST]` | handlers/publicTest.ts |
| `[PUBLIC-REPORT]` | handlers/publicReport.ts |
| `[HEALTH]` | handlers/health.ts |
| `[ANTHROPIC]` | integrations/anthropic.ts |
| `[FILE-STORE]` | integrations/catalystFileStore.ts |
| `[DB]` | helpers de DB (queries lentas, errores) |
| `[PIPELINE]` | services/stateMachine.ts |
| `[AUDIT]` | services/auditLog.ts |
| `[OUTBOX]` | services/outbox.ts |
| `[CRON]` | functions/cron/ |
| `[BREAKER]` | lib/circuitBreaker.ts |
| `[RETRY]` | lib/retry.ts |
| `[RATE]` | middleware/rateLimit.ts |

### Campos estándar

Siempre que aplique, incluir:
- `traceId` (correlation ID)
- IDs del recurso (`jobId`, `candidateId`, `resultId`)
- `user` (para operaciones admin)
- `durationMs` (para operaciones que toman tiempo)

### Antipatterns prohibidos

- ❌ `console.log('got it')` — no contextual
- ❌ `console.error(err)` — pierde el stack en algunos casos
- ❌ Loguear passwords, tokens completos, PII
- ❌ `console.log(JSON.stringify(req))` — puede tener secrets y ser gigante

---

## 2. Correlation IDs (traceId)

### Generación

Al inicio de cada request:

```typescript
// router.ts
import { randomBytes } from 'crypto';

const traceId = (req.headers as any)['x-trace-id'] || randomBytes(8).toString('hex');
ctx.traceId = traceId;
res.setHeader('X-Trace-Id', traceId);  // devolver al cliente
```

Si viene un `X-Trace-Id` en el header, usarlo — permite correlacionar desde el frontend al backend.

### Propagación

- En cada `console.log`, incluir `traceId=${ctx.traceId}`.
- Al llamar al File Store o a Anthropic (si soportan), pasar el traceId.
- En frontend, generar un traceId al iniciar cada acción "grande" y pasarlo en el header a cada request derivada.

### Uso al debuggear

Cuando un usuario reporta un problema:
1. Pedirle el traceId (visible en DevTools → Network → Response Headers).
2. En Catalyst Logs, filtrar por `traceId=<id>` → ves todo el hilo.

---

## 3. Health check endpoint

### `GET /health` (público, sin auth)

Para monitoring externo. Responde 200 si la app funciona.

```typescript
// handlers/health.ts
export async function check(ctx: RequestContext) {
  const startedAt = Date.now();
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: getEnv('APP_VERSION', 'unknown'),
    uptime_sec: Math.round(process.uptime()),
    checks: {},
  };

  // Check: DB reachable
  try {
    await db.queryOne(ctx.req, `SELECT ROWID FROM Config LIMIT 1`, 'Config');
    health.checks.db = 'ok';
  } catch (err: any) {
    health.checks.db = `fail: ${err.message.substring(0, 100)}`;
    health.status = 'degraded';
  }

  // Check: Env vars críticas presentes
  const required = ['ANTHROPIC_API_KEY', 'JWT_SECRET', 'APP_BASE_URL'];
  for (const v of required) {
    if (!process.env[v]) {
      health.checks[`env_${v}`] = 'missing';
      health.status = 'degraded';
    }
  }

  health.response_time_ms = Date.now() - startedAt;

  const statusCode = health.status === 'ok' ? 200 : 503;
  sendJson(ctx.res, statusCode, health);
}
```

### `GET /health/detailed` (protegido con internal key o admin)

Para cuando se investiga un issue. Incluye más checks.

```typescript
export async function detailedCheck(ctx: RequestContext) {
  requireInternalKey(ctx);  // o requireAdmin

  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check: DB con query real
  try {
    const jobs = await db.queryOne(ctx.req, 'SELECT COUNT(*) AS c FROM Jobs', 'Jobs');
    health.checks.db_query = 'ok';
    health.checks.jobs_count = jobs?.c || 0;
  } catch (err: any) {
    health.checks.db_query = `fail: ${err.message}`;
    health.status = 'degraded';
  }

  // Check: Anthropic reachable (sin consumir mucho)
  try {
    const testStart = Date.now();
    await client.messages.create({
      model: getEnv('ANTHROPIC_MODEL'),
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    }, { timeout: 5000 });
    health.checks.anthropic = 'ok';
    health.checks.anthropic_latency_ms = Date.now() - testStart;
  } catch (err: any) {
    health.checks.anthropic = `fail: ${err.message.substring(0, 200)}`;
    health.status = 'degraded';
  }

  // Check: File Store reachable
  try {
    const app = catalyst.initialize(ctx.req);
    await app.filestore().getAllFolders();
    health.checks.file_store = 'ok';
  } catch (err: any) {
    health.checks.file_store = `fail: ${err.message.substring(0, 200)}`;
    health.status = 'degraded';
  }

  // Check: backlog de outbox
  try {
    const pending = await db.queryOne(ctx.req,
      `SELECT COUNT(*) AS c FROM OutboxEvents WHERE status = 'pending'`,
      'OutboxEvents'
    );
    health.checks.outbox_pending = pending?.c || 0;
    if ((pending?.c || 0) > 100) {
      health.checks.outbox = 'backlog_alert';
      health.status = 'degraded';
    }
  } catch {}

  // Check: circuit breakers abiertos
  try {
    const open = await db.queryAll(ctx.req,
      `SELECT service FROM CircuitBreakers WHERE open_until > ${Date.now()}`,
      'CircuitBreakers'
    );
    health.checks.breakers_open = open.map(b => b.service);
    if (open.length > 0) health.status = 'degraded';
  } catch {}

  sendJson(ctx.res, 200, health);
}
```

---

## 4. Métricas endpoint

### `GET /admin/metrics` (protegido admin)

Returns agregados útiles para dashboard interno.

```typescript
// handlers/metrics.ts
export async function getMetrics(ctx: RequestContext) {
  requireAdmin(ctx);

  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const oneDayAgo = now - 86400_000;

  const [
    jobsTotal, jobsActive,
    candidatesTotal,
    resultsLastHour, resultsLastDay,
    reportsPublished,
    outboxPending, outboxFailed,
    tokensLastDay,
    breakersOpen,
  ] = await Promise.all([
    db.queryOne(ctx.req, 'SELECT COUNT(*) AS c FROM Jobs', 'Jobs'),
    db.queryOne(ctx.req, "SELECT COUNT(*) AS c FROM Jobs WHERE is_active = true", 'Jobs'),
    db.queryOne(ctx.req, 'SELECT COUNT(*) AS c FROM Candidates', 'Candidates'),
    db.queryOne(ctx.req, `SELECT COUNT(*) AS c FROM Results WHERE completed_at > '${new Date(oneHourAgo).toISOString()}'`, 'Results'),
    db.queryOne(ctx.req, `SELECT COUNT(*) AS c FROM Results WHERE completed_at > '${new Date(oneDayAgo).toISOString()}'`, 'Results'),
    db.queryOne(ctx.req, "SELECT COUNT(*) AS c FROM ClientReports WHERE status = 'published'", 'ClientReports'),
    db.queryOne(ctx.req, "SELECT COUNT(*) AS c FROM OutboxEvents WHERE status = 'pending'", 'OutboxEvents'),
    db.queryOne(ctx.req, "SELECT COUNT(*) AS c FROM OutboxEvents WHERE status = 'failed'", 'OutboxEvents'),
    db.queryOne(ctx.req, `SELECT SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cached_tokens) AS c FROM TokenUsage WHERE created_at > '${new Date(oneDayAgo).toISOString()}'`, 'TokenUsage'),
    db.queryAll(ctx.req, `SELECT service FROM CircuitBreakers WHERE open_until > ${now}`, 'CircuitBreakers'),
  ]);

  sendJson(ctx.res, 200, {
    timestamp: new Date().toISOString(),
    jobs: {
      total: jobsTotal?.c || 0,
      active: jobsActive?.c || 0,
    },
    candidates: {
      total: candidatesTotal?.c || 0,
    },
    results: {
      last_hour: resultsLastHour?.c || 0,
      last_day: resultsLastDay?.c || 0,
    },
    reports: {
      published_total: reportsPublished?.c || 0,
    },
    outbox: {
      pending: outboxPending?.c || 0,
      failed: outboxFailed?.c || 0,
    },
    tokens_last_day: {
      input: tokensLastDay?.i || 0,
      output: tokensLastDay?.o || 0,
      cached: tokensLastDay?.c || 0,
    },
    breakers_open: breakersOpen.map((b: any) => b.service),
  });
}
```

---

## 5. Audit log

### Qué auditar

Toda operación que modifique data importante:

| Acción | Actor | Resource | Changes |
|---|---|---|---|
| `auth.login` | user | - | `{ success: true/false }` |
| `job.create` | user | job | `{ title, company }` |
| `job.update` | user | job | `{ field: { from, to } }` |
| `job.archive` | user | job | - |
| `assessment.generate_technical` | user | assessment | `{ tokens }` |
| `assessment.regenerate_technical` | user | assessment | `{ prompt_length, tokens }` |
| `pipeline.transition` | user/system | result | `{ from_stage, to_stage }` (también va a PipelineTransitions) |
| `report.create` | user | report | `{ candidate_ids }` |
| `report.generate_explanations` | user | report | `{ candidates, tokens }` |
| `report.publish` | user | report | - |
| `library.create` | user | library_item | `{ name }` |
| `library.delete` | user | library_item | - |

### `services/auditLog.ts`

```typescript
export async function log(req: any, event: {
  actor: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, any>;
  request?: IncomingMessage;
}): Promise<void> {
  try {
    await db.auditLog.insert(req, {
      actor_user: event.actor,
      action: event.action,
      resource_type: event.resourceType || '',
      resource_id: event.resourceId || '',
      changes: event.changes ? JSON.stringify(event.changes).substring(0, 5000) : '',
      ip: (event.request?.headers as any)?.['x-forwarded-for'] || '',
      user_agent: ((event.request?.headers as any)?.['user-agent'] || '').substring(0, 300),
      created_at: db.now(),
    });
  } catch (err: any) {
    console.error(`[AUDIT] Failed to log ${event.action}: ${err.message}`);
    // No tirar — el logging no debe bloquear el flow
  }
}
```

### Uso

```typescript
// handlers/adminJobs.ts
export async function createJob(ctx: RequestContext) {
  requireAdmin(ctx);
  const body = await parseBody(ctx.req);
  const validated = validateJobPayload(body);

  const job = await jobsService.create(ctx.req, validated, ctx.user!.username);

  await auditLog.log(ctx.req, {
    actor: ctx.user!.username,
    action: 'job.create',
    resourceType: 'job',
    resourceId: job.id,
    changes: { title: job.title, company: job.company },
    request: ctx.req,
  });

  sendJson(ctx.res, 201, job);
}
```

---

## 6. Monitoring externo

Opciones gratuitas/baratas:
- **UptimeRobot** — 50 monitors gratis, alerts por email/Slack
- **Better Stack (ex. Better Uptime)** — plan gratis con restricciones
- **Pingdom** — pago, mejor UI
- **Self-hosted: healthchecks.io** — SaaS gratis con límites generosos

### Setup básico con UptimeRobot

1. Crear cuenta en https://uptimerobot.com/
2. Add monitor:
   - Type: HTTP(s)
   - URL: `https://sharktalents.ai/server/api/api/health`
   - Interval: 5 min
   - Keyword (para detectar degraded): `"status":"ok"`
3. Configurar alertas a email + Slack webhook.

### Dead-man switch

El `/health` responde 200 incluso si algo raro — puede pasar que el cron esté muerto. Agregar un check específico:

**Cron monitor:** el cron de outbox debería correr cada 1 min. Si en 10 min no corre, algo está mal.

Implementación:
- El cron, al empezar, inserta un row en tabla `HealthChecks`:
  ```typescript
  // En functions/cron/index.js
  await db.healthChecks.upsert(req, 'cron_outbox', { last_run_at: db.now() });
  ```
- `/health/detailed` chequea que `last_run_at` sea reciente:
  ```typescript
  const cronHealth = await db.healthChecks.get(ctx.req, 'cron_outbox');
  const staleMinutes = (Date.now() - new Date(cronHealth.last_run_at).getTime()) / 60000;
  if (staleMinutes > 5) {
    health.checks.cron_outbox = 'stale';
    health.status = 'degraded';
  }
  ```

Tabla nueva `HealthChecks`:
```
HealthChecks
├── ROWID         BigInt
├── check_name    Text (50, unique check)
├── last_run_at   DateTime
├── last_status   Text (20)      ('ok' | 'failed')
├── last_error    Text (500, nullable)
```

---

## 7. Runbooks

Crear como mínimo 5 en `docs/RUNBOOKS/`:

### `docs/RUNBOOKS/smoke-tests.md`

Tests manuales a correr post-deploy:

```markdown
# Smoke tests manuales

## Antes de correr
- Estás en el ambiente correcto (dev / prod)
- Tenés las credenciales admin

## Flow crítico — panel admin

- [ ] Login con credenciales admin → llega a /admin
- [ ] Crear puesto nuevo:
  - [ ] Título, company, nivel cognitivo
  - [ ] Perfil DISC (sliders)
  - [ ] Perfil cognitivo (sliders)
  - [ ] Mínimo técnico (60%)
  - [ ] Competencias (agregar 1–2)
  - [ ] Crear → se genera puesto + 3 assessments
- [ ] Ver detalle del puesto:
  - [ ] Links de las 3 pruebas copiables
  - [ ] Botón "Generar técnica con IA" funciona (~30s)
  - [ ] Las 25 preguntas aparecen editables

## Flow crítico — candidato

- [ ] Abrir link de kudert en incógnito
- [ ] Aceptar términos → registro
- [ ] Completar DISC (40 preguntas)
- [ ] Completar cognitivo (100 con timer)
- [ ] Completar emocional (20)
- [ ] Submit → pantalla "prueba completada"

## Flow crítico — reportes

- [ ] Ir a Pipeline del puesto → ver al candidato
- [ ] Mover a "Siguiente etapa" en técnica
- [ ] Ir a Comparativa → seleccionar 2 candidatos
- [ ] Preparar reporte → generar explicaciones con IA
- [ ] Publicar → obtener URL público
- [ ] Abrir URL público → verificar que se ve correcto
- [ ] Cambiar `?lang=en` → verificar que se ve en inglés

## Flow crítico — seguridad

- [ ] `curl /admin/jobs` sin X-Auth-Token → 401
- [ ] `curl /public/report/fake/fake/1?token=wrong` → 403
- [ ] `curl /admin/login` con password incorrecto → 401
```

### `docs/RUNBOOKS/cron-detenido.md`

Ya en [aprendizajes/06](../aprendizajes/06_OBSERVABILITY.md#runbooks). Adaptar a SharkTalents:

```markdown
# Runbook — Cron detenido (outbox)

## Síntomas
- `/health/detailed` muestra `cron_outbox: stale`
- OutboxEvents acumulados en `pending` sin procesar
- Reportes publicados no se traducen a EN

## Diagnóstico
1. Catalyst Console → Cron Jobs → verificar si está `enabled`
2. Catalyst Logs → filter `cron_outbox` → último error
3. Verificar env vars del cron (debe tener INTERNAL_API_KEY)

## Causas comunes
- Excepción lanzada → Catalyst apagó el cron
- Env var faltante
- Timeout > 15 min (el cron individual debería tomar < 30s)

## Remediación
1. Fix la causa raíz en el código/config
2. Re-enable en Catalyst Console
3. Ver que vuelva a correr en < 2 min
4. Procesar backlog: los OutboxEvents `pending` se retoman solos
```

### `docs/RUNBOOKS/reporte-publico-404.md`

```markdown
# Runbook — Cliente reporta 404 en reporte público

## Síntomas
- Cliente dice "el link no funciona"
- `/api/public/report/<company>/<job>/<id>` devuelve 404

## Diagnóstico
1. Verificar que el reporte existe:
   ```sql
   SELECT status, company_slug, job_slug FROM ClientReports WHERE ROWID = <id>
   ```
2. Verificar que `status = 'published'` (no 'draft')
3. Verificar que `company_slug` y `job_slug` matchean la URL
4. Verificar que el cliente tiene el `?token=...` correcto

## Causas comunes
- Reporte en estado `draft` (no publicado)
- Slugs cambiaron después de publicar (se renombró el job)
- Token de acceso en URL es incorrecto

## Remediación
- Si draft: preparador debe publicar.
- Si slugs cambiaron: republicar el reporte.
- Si token incorrecto: copiar el URL correcto desde /admin/reportes.
```

### `docs/RUNBOOKS/data-store-lento.md`

```markdown
# Runbook — Queries lentas en DataStore

## Síntomas
- Endpoints /admin tardan > 5 seg
- Logs muestran `[DB:query]` con duraciones altas
- `/health` tiene `response_time_ms > 2000`

## Diagnóstico
1. ¿Qué endpoint está lento? Filter logs por `[ROUTER]` y ver `durationMs`.
2. ¿Cuántas queries hace ese endpoint? Debería ser < 10. Si 50+, hay N+1.
3. Catalyst Console → DataStore → Statistics: ¿hay tabla con > 10k rows sin archival?

## Causas comunes
- N+1 query recién introducido
- Tabla sin filter por `is_active`
- Loop sobre data grande sin paginación

## Remediación
- Si es N+1: refactorizar a batch (ver Fase 4).
- Si es tabla grande: agregar LIMIT + paginación.
- Si es lookup por columna no indexada: considerar si cambia el access pattern.
```

### `docs/RUNBOOKS/costo-catalyst-alto.md`

```markdown
# Runbook — Factura Catalyst disparada

## Síntomas
- Email de Catalyst con monto superior al esperado
- $30+/mes sin crecimiento proporcional de usuarios

## Diagnóstico
1. Catalyst Console → Billing → breakdown por tipo de operación
2. ¿Cuál es el dominante? Usualmente `Fetch`.
3. Si Fetch: ¿qué function es la más activa? (ver per-function metrics)
4. Pensar qué cambió: cron nuevo, polling más frecuente, endpoint nuevo con N+1

## Remediación inmediata
- Bajar cadencia de crons (si aplica)
- Activar cache en endpoints hot
- Identificar N+1 y fixear

## Prevención
- Monitorear TokenUsage en /admin/metrics
- Alerta cuando queries_per_hour > threshold
- Pre-estimar costo antes de nuevas features
```

### `docs/RUNBOOKS/anthropic-caido.md`

Ya en [Fase 5](06_FASE5_ANTHROPIC.md#11-runbook-docsrunbooksanthropic-caidomd).

### `docs/RUNBOOKS/rotation-secrets.md`

Ya en [Fase 3](04_FASE3_SEGURIDAD.md#13-runbook-de-rotation).

---

## 8. Alertas configuradas

### Nivel 1 (crítico, 24/7 a email)
- Health check falla por > 15 min
- Anthropic circuit breaker abierto por > 10 min
- Outbox pending > 500 (backlog crítico)

### Nivel 2 (warning, horario laboral)
- Costos Catalyst > $30 en el mes
- Outbox failed > 20
- Audit log detecta acción sospechosa (muchos login fail en 5 min)

### Configuración

**UptimeRobot:**
- Monitor HTTP `/health` cada 5 min
- Keyword `"status":"ok"` → si no match, alerta
- Alert contact: email + Slack webhook

**Slack webhook desde cron:**
En cron de outbox, chequear periódicamente y alertar:
```typescript
if (breakersOpenMinutes > 10 || outboxPending > 500) {
  await sendSlackAlert({
    severity: 'high',
    title: 'SharkTalents degraded',
    details: `Breakers: ${breakers}. Outbox pending: ${outboxPending}`,
  });
}
```

---

## 9. Checklist de cierre Fase 6

- [ ] `handlers/health.ts` con `/health` y `/health/detailed`
- [ ] `handlers/metrics.ts` con `/admin/metrics`
- [ ] `services/auditLog.ts` implementado
- [ ] Audit log llamado en 12+ operaciones admin clave
- [ ] Correlation ID (`traceId`) propagado en logs
- [ ] Prefijos de log consistentes en todos los módulos
- [ ] `lib/logger.ts` en uso (no `console.log` directo)
- [ ] Tabla `HealthChecks` creada (para dead-man switch del cron)
- [ ] UptimeRobot (o similar) configurado con alert a email
- [ ] 5 runbooks en `docs/RUNBOOKS/`
- [ ] Smoke test: `curl /health` → 200 con JSON esperado
- [ ] Smoke test: `curl /health` con DB caída (simulado) → 503
- [ ] Smoke test: hacer 10 acciones admin → ver audit log con los 10 eventos
- [ ] Verificar que logs tienen prefijos en Catalyst Console

---

## Siguiente paso

→ [08_FASE7_FRONTEND.md](08_FASE7_FRONTEND.md) — fetch wrapper, error boundary, URLs en env vars, versioning visible.
