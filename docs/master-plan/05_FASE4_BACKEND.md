# 05 — Fase 4: Backend

**Objetivo:** modularizar, eliminar N+1 queries (el problema de costo dominante), agregar idempotencia, cachear seeds, meter outbox pattern para side-effects.

**Tiempo estimado:** 2 semanas.
**Dependencias:** Fase 1 (estructura), Fase 2 (schema). Puede ejecutarse en paralelo a Fase 3.
**Riesgo:** medio-alto. Cambios extensos en handlers y services.

**Referencias teóricas:** [02_MODULARIZACION.md](../aprendizajes/02_MODULARIZACION.md), [05_RELIABILITY.md](../aprendizajes/05_RELIABILITY.md), [07_PERFORMANCE_COSTOS.md](../aprendizajes/07_PERFORMANCE_COSTOS.md).

---

## Deliverables

- [ ] `handlers/` separado de lógica de negocio
- [ ] 0 queries N+1 en endpoints admin (medir antes y después)
- [ ] Idempotencia en `/submit`, `/generate-explanations`, `/publish`
- [ ] Seeds JSON cacheados en memoria
- [ ] Outbox pattern para translations + notificaciones futuras
- [ ] `ctx` object propagado en todo handler
- [ ] Errors tipados (`AppError`, `ValidationError`, etc.)
- [ ] Eliminación de `/api/admin/recalculate-competencias` en runtime (solo cron)

---

## 1. Modularización definitiva

### Estructura final `functions/api/src/`

Ya detallada en [Fase 1](02_FASE1_FUNDAMENTOS.md#4-estructura-de-carpetas-nueva). Repaso:

```
src/
├── index.ts                (entry, 30 líneas)
├── router.ts               (solo route matching + middleware raíz)
├── handlers/               (un archivo por recurso)
├── services/               (lógica de negocio, sin HTTP)
├── integrations/           (Anthropic, File Store)
├── db/                     (queries por tabla)
├── middleware/             (auth, rateLimit, validation)
└── lib/                    (errors, logger, retry, circuitBreaker, env, etc.)
```

### Reglas de dependencia

```
router → middleware + handlers
handlers → services + middleware/validation
services → db + integrations + lib
integrations → lib
db → lib (helpers)
```

**Violaciones NO permitidas:**
- `db/` importando de `services/` (invertido).
- `services/` importando `handlers/`.
- Código HTTP (`req`, `res`) dentro de `services/`.

Un linter podría atraparlos; por ahora, convención + code review.

---

## 2. Patrón ctx object

Todos los handlers reciben un `ctx`:

```typescript
// lib/context.ts
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  user?: { username: string; role: 'admin' };
  traceId: string;     // generado al inicio
}
```

Router construye el ctx:

```typescript
// router.ts
import { randomBytes } from 'crypto';

export async function handleRequest(req, res) {
  const parsed = parseUrl(req);
  const ctx: RequestContext = {
    req, res,
    params: {},
    query: parsed.query,
    traceId: req.headers['x-trace-id'] || randomBytes(8).toString('hex'),
  };
  // ... routing
}
```

Handlers reciben `ctx` único argumento:

```typescript
// handlers/adminJobs.ts
export async function createJob(ctx: RequestContext) {
  requireAdmin(ctx);
  const body = await parseBody(ctx.req);
  const validated = validateJobPayload(body);
  const job = await jobsService.create(ctx.req, validated, ctx.user!.username);
  sendJson(ctx.res, 201, job);
}
```

**Beneficio:** firmas estables. Agregar middleware (ej. `ctx.auditLog`) no requiere tocar todas las funciones.

---

## 3. Eliminación de N+1 queries

Este es el cambio de mayor impacto en costos. Auditamos cada endpoint que lista datos o agrega relaciones:

### Endpoints afectados

| Endpoint | N+1 actual | Plan |
|---|---|---|
| `GET /admin/candidates` | 1 + N×Results + N²×Assessments | Batch en memoria |
| `GET /admin/jobs/:id/comparison` | 1 + N×Candidates + N×Results (×4 assessments) | Batch queries por tabla |
| `GET /admin/jobs/:id/pipeline` | 1 + N×Candidates | Batch candidates |
| `GET /admin/jobs/:id/client-report` | 1 + N×Candidates + N×Results | Batch |
| `GET /admin/jobs/:id/integrity-results` | 1 + N×Candidates | Batch |
| `GET /public/report/*` | 1 + N×Candidates + N×Results + 1×Anthropic | Batch + cache |

### Patrón: batch N+1 → 2 queries

**Antes:**
```typescript
for (const order of orders) {
  const user = await db.queryOne(`SELECT * FROM Users WHERE ROWID = ${order.user_id}`);
  order.user = user;
}
```

**Después:**
```typescript
const userIds = [...new Set(orders.map(o => o.user_id))];
const users = await db.queryAll(
  `SELECT * FROM Users WHERE ROWID IN (${userIds.map(db.esc).join(',')})`
);
const usersById = new Map(users.map(u => [u.ROWID, u]));
for (const order of orders) {
  order.user = usersById.get(order.user_id) || null;
}
```

### Caso concreto: `GET /admin/candidates`

**Actual** ([adminCandidates.ts:6-20](../../functions/sharktalents/src/routes/adminCandidates.ts#L6-L20)):

Para N candidatos hace 1 + N + N×M queries (N candidates × M assessments cada uno).

Para 100 candidatos con 10 assessments promedio = **1001 queries**.

**Refactor:**

```typescript
// services/candidatesService.ts
export async function listCandidatesWithJobCount(req: any): Promise<CandidateListItem[]> {
  // 1. Todos los candidatos
  const candidates = await db.candidates.listAll(req);
  if (candidates.length === 0) return [];

  const candidateIds = candidates.map(c => c.id);

  // 2. Todos los results de esos candidatos (1 query)
  const results = await db.results.listByCandidateIds(req, candidateIds);

  // 3. Assessment IDs únicos de esos results (1 query)
  const assessmentIds = [...new Set(results.map(r => r.assessment_id))];
  const assessments = await db.assessments.listByIds(req, assessmentIds);
  const assessmentToJob = new Map(assessments.map(a => [a.id, a.job_id]));

  // 4. Contar jobs distintos por candidato en memoria
  const jobsPerCandidate = new Map<string, Set<string>>();
  for (const r of results) {
    const jobId = assessmentToJob.get(r.assessment_id);
    if (!jobId) continue;
    if (!jobsPerCandidate.has(r.candidate_id)) {
      jobsPerCandidate.set(r.candidate_id, new Set());
    }
    jobsPerCandidate.get(r.candidate_id)!.add(jobId);
  }

  return candidates.map(c => ({
    ...c,
    jobs_count: jobsPerCandidate.get(c.id)?.size || 0,
  }));
}
```

**Resultado:** 100 candidatos → 3 queries (en vez de 1001). **99.7% de reducción.**

### Patrón de helper batch en `db/`

Cada módulo de DB expone funciones batch:

```typescript
// db/results.ts
export async function listByCandidateIds(req: any, ids: string[]): Promise<Result[]> {
  if (ids.length === 0) return [];
  const list = ids.map(db.esc).join(',');
  return await db.queryAll(req,
    `SELECT * FROM Results WHERE candidate_id IN (${list}) AND completed_at IS NOT NULL AND completed_at != ''`,
    'Results'
  );
}

export async function listByAssessmentIds(req: any, ids: string[]): Promise<Result[]> {
  if (ids.length === 0) return [];
  const list = ids.map(db.esc).join(',');
  return await db.queryAll(req,
    `SELECT * FROM Results WHERE assessment_id IN (${list})`,
    'Results'
  );
}
```

### Caso concreto: `GET /admin/jobs/:id/comparison`

Hoy hace potencialmente miles de queries por la doble iteración assessments × candidates. Refactor:

```typescript
// services/comparisonService.ts
export async function buildComparison(req: any, jobId: string): Promise<ComparisonData> {
  const job = await db.jobs.getById(req, jobId);
  if (!job) throw new NotFoundError('Job not found');

  const ip = await db.jobProfiles.getByJobId(req, jobId);
  const ic = await db.jobCompetencias.listByJobId(req, jobId);

  // 1 query: todos los assessments del job
  const assessments = await db.assessments.listByJobId(req, jobId);

  // 1 query: todos los results completados de esos assessments
  const assessmentIds = assessments.map(a => a.id);
  const results = await db.results.listByAssessmentIds(req, assessmentIds);

  // 1 query: todos los candidates involucrados
  const candidateIds = [...new Set(results.map(r => r.candidate_id))];
  const candidates = await db.candidates.listByIds(req, candidateIds);

  // 1 query cada: scores normalizados
  const resultIds = results.map(r => r.id);
  const [discScores, cognitiveScores, emotionalScores, integrityScores,
         integrityDimensions, technicalScores, competenciaScores, screenExits] =
    await Promise.all([
      db.discScores.listByResultIds(req, resultIds),
      db.cognitiveScores.listByResultIds(req, resultIds),
      db.emotionalScores.listByResultIds(req, resultIds),
      db.integrityScores.listByResultIds(req, resultIds),
      db.integrityDimensions.listByResultIds(req, resultIds),
      db.technicalScores.listByResultIds(req, resultIds),
      db.competenciaScores.listByResultIds(req, resultIds),
      db.screenExits.listByResultIds(req, resultIds),
    ]);

  // Ensamblar en memoria
  return assembleComparison(candidates, results, assessments, { ip, ic }, {
    discScores, cognitiveScores, emotionalScores, integrityScores,
    integrityDimensions, technicalScores, competenciaScores, screenExits,
  });
}
```

**Queries totales:** 12 fijas, independiente de N candidatos. Hoy eran ~N×10 = potencialmente cientos.

---

## 4. Cache de seeds JSON

Hoy [loadQuestions.ts:12](../../functions/sharktalents/src/seeds/loadQuestions.ts#L12) lee JSON del disco cada vez que se pide un test. Esas lecturas suman.

### Módulo con cache

```typescript
// seeds/loadQuestions.ts
import * as path from 'path';
import * as fs from 'fs';

const seedsDir = path.join(__dirname, '..', '..', 'seeds');
const cache = new Map<string, any[]>();

function loadJsonCached(filename: string): any[] {
  if (cache.has(filename)) return cache.get(filename)!;
  const filePath = path.join(seedsDir, filename);
  if (!fs.existsSync(filePath)) {
    cache.set(filename, []);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  cache.set(filename, data);
  return data;
}

export function getKudertSections(cognitiveLevel: string): Section[] {
  const disc = loadJsonCached('disc.json');
  const emotional = loadJsonCached('emotional.json');
  const cogFile = cognitiveLevel === 'senior' ? 'cognitive_senior_v2.json'
    : cognitiveLevel === 'mid' ? 'cognitive_mid_v2.json'
    : 'cognitive_basic_v2.json';
  const cogQuestions = loadJsonCached(cogFile);

  // ... resto igual
}
```

Catalyst reutiliza el container entre invocaciones (warm start). La primera request carga los JSONs, las siguientes leen de memoria.

**Beneficio:** ~7 reads de disco por test → 0 en invocaciones subsecuentes (durante la vida del container).

---

## 5. Idempotencia

### `POST /public/test/:token/submit`

Hoy no es idempotente. Si el candidato da doble click, se crean 2 results (aunque el segundo falla en el check `already_completed`).

**Fix**: usar `Idempotency-Key` header opcional + verificación de estado.

```typescript
// handlers/publicTest.ts
export async function submitTest(ctx: RequestContext) {
  const { token } = ctx.params;
  const body = await parseBody(ctx.req);
  const { email, answers, screen_exits, screen_exit_log } = body;

  validateEmail(email);

  // Idempotencia: si ya hay un result completed, devolverlo (no crear otro)
  const assessment = await db.assessments.getByPublicToken(ctx.req, token);
  if (!assessment) throw new NotFoundError('Test not found');
  const candidate = await db.candidates.getByEmail(ctx.req, email);
  if (!candidate) throw new NotFoundError('Candidate not found');

  const existing = await db.results.findByAssessmentAndCandidate(ctx.req, assessment.id, candidate.id);

  if (existing && existing.completed_at) {
    // Idempotente: devolver el result existente, no reprocesar
    console.log(`[SUBMIT] Duplicate submit for ${email}, returning existing result`);
    return sendJson(ctx.res, 200, {
      result_id: existing.id,
      already_completed: true,
      message: 'Test was already submitted',
    });
  }

  // ... proceso normal
}
```

### `POST /admin/client-report/:reportId/generate-explanations`

Esta operación es costosa (N llamadas a Anthropic). Debe ser idempotente y resumible.

```typescript
// services/reportsService.ts
export async function generateExplanations(req: any, reportId: string): Promise<void> {
  const report = await db.clientReports.getById(req, reportId);
  if (!report) throw new NotFoundError();

  const rcList = await db.reportCandidates.listByReportId(req, reportId);

  // Para cada RC, solo generar si no tiene ya explicaciones
  for (const rc of rcList) {
    if (rc.report_file_id) {
      console.log(`[REPORT-GEN] RC ${rc.id} already has explanations, skipping`);
      continue;
    }
    await generateExplanationForCandidate(req, rc);
  }
}
```

Re-correr la función: si un candidato ya tiene explicaciones, se saltea. Si hubo un fallo a la mitad, la re-ejecución completa los faltantes sin duplicar.

### Tabla `ProcessedEvents` para webhooks futuros

Si en algún momento se integra con webhooks externos (payments, CRM), usar:

```typescript
// db/processedEvents.ts
export async function markProcessed(req: any, eventId: string, provider: string): Promise<boolean> {
  const existing = await db.queryOne(req,
    `SELECT ROWID FROM ProcessedEvents WHERE event_id = ${db.esc(eventId)} AND provider = ${db.esc(provider)}`,
    'ProcessedEvents'
  );
  if (existing) return false;  // ya procesado

  await db.insert(req, 'ProcessedEvents', {
    event_id: eventId,
    provider,
    received_at: db.now(),
  });
  return true;
}
```

---

## 6. Outbox pattern

### Qué va al outbox

Tres operaciones actuales que son **side-effects externos async**:

1. **Traducción a inglés** al publicar reporte (hoy está inline en `/publish`, puede tardar mucho).
2. **Análisis de transcripción de entrevista** — hoy inline, puede fallar.
3. **Futuro: emails** al candidato al finalizar el test.

### Patrón

Al hacer una acción que dispara side-effect externo, guardás en `OutboxEvents` antes:

```typescript
// En /publish
async function publishReport(req: any, reportId: string): Promise<void> {
  const report = await db.clientReports.getById(req, reportId);
  if (!report) throw new NotFoundError();

  // Update status inline (rápido, DB-only)
  await db.clientReports.update(req, reportId, {
    status: 'published',
    published_at: db.now(),
  });

  // Encolar translation como outbox event (async)
  await db.outboxEvents.insert(req, {
    event_type: 'report.translate_en',
    payload: JSON.stringify({ reportId }),
    status: 'pending',
    retry_count: 0,
    created_at: db.now(),
  });

  // Return rápido al admin — la traducción se procesa async
}
```

### Worker del outbox

Catalyst Cron Function nueva (`functions/cron/`) que procesa el outbox cada 1 min:

```typescript
// functions/cron/src/index.ts
module.exports = async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    await processOutbox(app);
  } catch (err: any) {
    console.error('[CRON] Error:', err.message, err.stack);
  } finally {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  }
};

async function processOutbox(req: any): Promise<void> {
  const pending = await db.outboxEvents.listPending(req, 10);  // max 10 por corrida

  for (const event of pending) {
    try {
      await db.outboxEvents.update(req, event.id, { status: 'processing' });
      await dispatchEvent(req, event);
      await db.outboxEvents.update(req, event.id, {
        status: 'sent',
        processed_at: db.now(),
      });
    } catch (err: any) {
      const newRetry = (event.retry_count || 0) + 1;
      await db.outboxEvents.update(req, event.id, {
        status: newRetry >= 5 ? 'failed' : 'pending',
        retry_count: newRetry,
        last_error: err.message.substring(0, 500),
      });
    }
  }
}

async function dispatchEvent(req: any, event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload);
  switch (event.event_type) {
    case 'report.translate_en':
      await reportsService.translateToEnglish(req, payload.reportId);
      return;
    case 'email.send':
      await emailService.send(req, payload);
      return;
    default:
      throw new Error(`Unknown event type: ${event.event_type}`);
  }
}
```

### Cron function setup

Necesita carpeta `functions/cron/` con su `catalyst-config.json`:

```json
{
  "deployment": {
    "name": "cron",
    "stack": "node20",
    "type": "basicio",
    "memory": 256,
    "timeout": 900,
    "env_variables": {
      "INTERNAL_API_KEY": "set-in-catalyst-console",
      "APP_BASE_URL": "https://sharktalents.ai"
    }
  },
  "execution": {
    "main": "index.js"
  }
}
```

Configurar en Catalyst Console → Cron Jobs:
- Trigger cada 1 min
- Apuntar a función `cron`

---

## 7. Errors tipados

### `lib/errors.ts`

```typescript
export class AppError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(msg = 'Unauthorized') { super(msg, 401); }
}

export class ForbiddenError extends AppError {
  constructor(msg = 'Forbidden') { super(msg, 403); }
}

export class NotFoundError extends AppError {
  constructor(msg = 'Not found') { super(msg, 404); }
}

export class ValidationError extends AppError {
  constructor(msg: string) { super(msg, 400); }
}

export class ConflictError extends AppError {
  constructor(msg: string) { super(msg, 409); }
}

export class RateLimitError extends AppError {
  constructor(msg = 'Rate limit exceeded') { super(msg, 429); }
}

export class InternalError extends AppError {
  constructor(msg = 'Internal server error') { super(msg, 500); }
}

export class ServiceUnavailableError extends AppError {
  constructor(msg = 'Service unavailable') { super(msg, 503); }
}
```

### Manejo centralizado en router

```typescript
// router.ts
try {
  await route.handler(ctx);
} catch (err: any) {
  if (err instanceof AppError) {
    console.log(`[ROUTE] ${method} ${path} → ${err.status} ${err.message}`);
    return sendJson(ctx.res, err.status, { error: err.message });
  }
  console.error(`[ROUTE] ${method} ${path} UNCAUGHT:`, err.message, err.stack?.split('\n').slice(0, 5).join('\n'));
  sendJson(ctx.res, 500, { error: 'Internal Server Error' });
}
```

Los handlers solo tiran errors; el router los convierte a HTTP.

---

## 8. Logger con prefijos consistentes

### `lib/logger.ts`

```typescript
type Level = 'info' | 'warn' | 'error';

function log(level: Level, prefix: string, message: string, fields?: Record<string, any>): void {
  const parts = [`[${prefix}]`, message];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  const line = parts.join(' ');
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(prefix: string) {
  return {
    info: (msg: string, fields?: Record<string, any>) => log('info', prefix, msg, fields),
    warn: (msg: string, fields?: Record<string, any>) => log('warn', prefix, msg, fields),
    error: (msg: string, fields?: Record<string, any>) => log('error', prefix, msg, fields),
  };
}
```

### Uso

```typescript
// handlers/adminJobs.ts
import { createLogger } from '../lib/logger';
const logger = createLogger('ADMIN-JOBS');

export async function createJob(ctx: RequestContext) {
  logger.info('create started', { user: ctx.user!.username, traceId: ctx.traceId });
  // ...
  logger.info('create completed', { jobId: job.id, durationMs: Date.now() - start });
}
```

Catalyst Logs se filtran fácilmente por `[ADMIN-JOBS]` para aislar flow.

---

## 9. Eliminar recalculate-competencias runtime

Hoy existe `POST /api/admin/recalculate-competencias` que recalcula TODAS las competencias de TODOS los candidatos. Es útil cuando se cambia la lógica, pero:

1. Lo maneja un endpoint HTTP → timeout 30s → fracasa para > ~500 results.
2. Debería ser un cron/script admin, no un endpoint público.

### Refactor

- **Remover** el endpoint público.
- **Crear** script en `scripts/recalculate-competencias.sh` que llama a un endpoint interno protegido con `INTERNAL_API_KEY`.
- **Nuevo endpoint** `POST /internal/recalculate-competencias` con `requireInternalKey`.
- Procesa en batches de 50 results.

```typescript
// handlers/internal.ts
export async function recalculateCompetencias(ctx: RequestContext) {
  requireInternalKey(ctx);
  const body = await parseBody(ctx.req);
  const batchSize = 50;
  const offset = parseInt(body.offset || '0', 10);

  const results = await db.results.listCompletedPaginated(ctx.req, offset, batchSize);
  // ... recalcular cada uno ...
  sendJson(ctx.res, 200, {
    processed: results.length,
    nextOffset: results.length < batchSize ? null : offset + batchSize,
  });
}
```

Script llama en loop hasta que `nextOffset` sea null.

---

## 10. Consolidación de queries en hot paths

Auditar endpoints llamados frecuentemente y optimizar:

### `GET /admin/jobs/costs`

Actualmente hace 1 + 3N + N×M queries (N jobs, M assessments cada uno). Optimizar:

```typescript
// services/costsService.ts
export async function buildCostsReport(req: any): Promise<JobCost[]> {
  const jobs = await db.jobs.listAll(req);
  const jobIds = jobs.map(j => j.id);

  const [costConfigs, assessments, results, tokenUsage] = await Promise.all([
    db.jobCostConfig.listByJobIds(req, jobIds),
    db.assessments.listByJobIds(req, jobIds),
    db.results.listByJobIds(req, jobIds),  // nueva query: join implicit
    db.tokenUsage.aggregateByJob(req, jobIds),
  ]);

  const costConfigByJob = new Map(costConfigs.map(c => [c.job_id, c]));
  const assessmentsByJob = groupBy(assessments, 'job_id');
  const completedResultsByAssessment = new Map();
  for (const r of results) {
    if (!r.completed_at) continue;
    const list = completedResultsByAssessment.get(r.assessment_id) || [];
    list.push(r);
    completedResultsByAssessment.set(r.assessment_id, list);
  }
  const tokensByJob = new Map(tokenUsage.map(t => [t.job_id, t]));

  return jobs.map(job => buildCostForJob(job, {
    costConfig: costConfigByJob.get(job.id),
    assessments: assessmentsByJob.get(job.id) || [],
    completedResults: completedResultsByAssessment,
    tokens: tokensByJob.get(job.id) || { total_input: 0, total_output: 0 },
  }));
}
```

### Nueva query necesaria: `Results.listByJobIds`

ZCQL no tiene joins, pero podemos usar la relación Results → Assessments → Jobs:

```typescript
// db/results.ts
export async function listByJobIds(req: any, jobIds: string[]): Promise<Result[]> {
  if (jobIds.length === 0) return [];
  const assessments = await db.assessments.listByJobIds(req, jobIds);
  const assessmentIds = assessments.map(a => a.id);
  return await listByAssessmentIds(req, assessmentIds);
}
```

Dos queries → resultado consolidado.

---

## 11. Inventario de queries resultante

Target final: cada endpoint hace < 10 queries fijas.

Auditar con:

```bash
# antes de refactor: log cada query
grep -c "db.queryOne\|db.queryAll\|db.insert\|db.update" src/handlers/*.ts
```

Objetivo: reducir el total en al menos 60%.

---

## 12. Checklist de cierre Fase 4

- [ ] `handlers/` con archivos por recurso (9 archivos)
- [ ] `services/` con lógica limpia sin HTTP
- [ ] `db/` con módulos por tabla (26 archivos)
- [ ] `lib/` con errors, logger, env, helpers
- [ ] `middleware/` con auth, validation, rateLimit
- [ ] `integrations/` con anthropic + catalystFileStore
- [ ] `ctx` object usado consistentemente
- [ ] Todos los errors tirados con clases tipadas (`throw new ValidationError(...)`)
- [ ] Logger con prefijos en lugar de `console.log` pelado
- [ ] Batch queries en 6 endpoints identificados
- [ ] Seeds cacheados en memoria
- [ ] Idempotencia en `/submit`, `/generate-explanations`, `/publish`
- [ ] Outbox table populada en `/publish` con evento `report.translate_en`
- [ ] Cron function creada (opcional en esta fase si no se usa outbox todavía)
- [ ] Endpoint `/admin/recalculate-competencias` removido del API admin
- [ ] Métrica de queries por request log al final de cada handler
- [ ] Smoke test: todas las operaciones del admin funcionan (ver [11_CHECKLIST_PROD.md](11_CHECKLIST_PROD.md))
- [ ] Deploy a dev exitoso

---

## Siguiente paso

→ [06_FASE5_ANTHROPIC.md](06_FASE5_ANTHROPIC.md) — prompt caching, retry, circuit breaker en integración con Anthropic.
