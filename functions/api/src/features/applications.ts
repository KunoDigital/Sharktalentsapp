/**
 * Applications = Results en BD. Una aplicación = un candidato aplicando a un puesto.
 * State machine: prefilter_pending → tecnica → conductual → integridad → finalist | rejected.
 * Cada transición se persiste en PipelineTransitions (append-only).
 */

import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows, safeLimit, bigintInClause } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import {
  type PipelineStage,
  ALL_STAGES,
  isStage,
  transitionAllowed,
} from '../lib/pipelineStateMachine';

export type { PipelineStage };

const log = logger('APPLICATIONS');
const RESULTS_TABLE = 'Results';
const TRANSITIONS_TABLE = 'PipelineTransitions';
const JOBS_TABLE = 'Jobs';

export type Result = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  answers: string | null;
  pipeline_stage: PipelineStage;
  started_at: string;
  completed_at: string | null;
  report_downloaded_at: string | null;
  idempotency_key: string | null;
  cv_file_id: string | null;
};

export type Transition = {
  ROWID: string;
  result_id: string;
  from_stage: string | null;
  to_stage: string;
  actor: string;
  reason: string | null;
  transitioned_at: string;
};

// ---- DB ----

async function getResultById(req: IncomingMessage, id: string): Promise<Result | null> {
  const query = `SELECT * FROM ${RESULTS_TABLE} WHERE ROWID = '${escapeSql(id)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Result>(result, RESULTS_TABLE)[0] ?? null;
}

async function getJobTenantId(req: IncomingMessage, jobId: string): Promise<string | null> {
  const query = `SELECT tenant_id FROM ${JOBS_TABLE} WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  type Pick = { tenant_id: string };
  const rows = unwrapRows<Pick>(result, JOBS_TABLE);
  return rows[0]?.tenant_id ?? null;
}

/**
 * 2026-06-04: refactor sin JOIN — Catalyst rompió los JOINs entre Results y Jobs.
 * El handler ya validó tenant via getJobTenantId; acá filtramos solo por assessment_id.
 */
async function listByJob(req: IncomingMessage, jobId: string, _tenantId: string): Promise<Result[]> {
  const query = `SELECT * FROM ${RESULTS_TABLE} WHERE assessment_id = '${escapeSql(jobId)}' ORDER BY CREATEDTIME DESC LIMIT 300`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Result>(result, RESULTS_TABLE);
}

/**
 * 2026-06-04: refactor sin JOIN — primero traer Jobs del tenant, después Results en chunks.
 * BIGINTs en IN clause SIN quotes (Catalyst los espera como número, no string).
 */
async function listByTenant(req: IncomingMessage, tenantId: string, limit = 200): Promise<Result[]> {
  const jobRows = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' LIMIT 300`,
    )) as unknown[],
    'Jobs',
  );
  if (jobRows.length === 0) return [];

  const results: Result[] = [];
  const cappedLimit = safeLimit(limit, 200);
  for (let i = 0; i < jobRows.length && results.length < cappedLimit; i += 30) {
    const chunk = jobRows.slice(i, i + 30);
    const inClause = bigintInClause(chunk.map((j) => j.ROWID));
    if (!inClause) continue;
    const rows = unwrapRows<Result>(
      (await zcql(req).executeZCQLQuery(
        `SELECT * FROM ${RESULTS_TABLE} WHERE assessment_id IN (${inClause}) ORDER BY CREATEDTIME DESC LIMIT ${cappedLimit}`,
      )) as unknown[],
      RESULTS_TABLE,
    );
    results.push(...rows);
  }
  // Ordenar por started_at desc y truncar
  results.sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  return results.slice(0, limit);
}

async function listTransitions(req: IncomingMessage, resultId: string): Promise<Transition[]> {
  const query = `SELECT * FROM ${TRANSITIONS_TABLE} WHERE result_id = '${escapeSql(resultId)}' ORDER BY transitioned_at ASC`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Transition>(result, TRANSITIONS_TABLE);
}

async function insertResult(req: IncomingMessage, payload: Omit<Result, 'ROWID'>): Promise<Result> {
  const row = await datastore(req).table(RESULTS_TABLE).insertRow(payload);
  return unwrapRow<Result>(row, RESULTS_TABLE) as Result;
}

async function updateStage(req: IncomingMessage, resultId: string, stage: PipelineStage): Promise<Result | null> {
  const completedAt = ['finalist', 'hired', 'auto_rejected_low_score', 'rejected_by_admin', 'offer_declined', 'withdrew'].includes(stage)
    ? now()
    : undefined;
  const row = await datastore(req).table(RESULTS_TABLE).updateRow({
    ROWID: resultId,
    pipeline_stage: stage,
    ...(completedAt ? { completed_at: completedAt } : {}),
  });
  return unwrapRow<Result>(row, RESULTS_TABLE);
}

async function insertTransition(
  req: IncomingMessage,
  payload: { result_id: string; from_stage: string | null; to_stage: string; actor: string; reason: string | null },
): Promise<Transition> {
  const row = await datastore(req).table(TRANSITIONS_TABLE).insertRow({
    ...payload,
    transitioned_at: now(),
  });
  return unwrapRow<Transition>(row, TRANSITIONS_TABLE) as Transition;
}

// ---- Handlers ----

export async function listApplications(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const jobId = url.searchParams.get('job_id');
  const candidateId = url.searchParams.get('candidate_id');

  let results: Result[];
  if (jobId) {
    const ownerTenant = await getJobTenantId(ctx.req, jobId);
    if (ownerTenant !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);
    results = await listByJob(ctx.req, jobId, tenantId);
  } else if (candidateId) {
    // Todas las applications del candidato EN ESTE tenant.
    // Cross-tenant: NO exponer aplicaciones a jobs de otros tenants (privacy).
    results = await listByCandidate(ctx.req, candidateId, tenantId);
  } else {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 200)));
    results = await listByTenant(ctx.req, tenantId, limit);
  }
  log.info('list', { traceId: ctx.traceId, tenantId, jobId, candidateId, count: results.length });
  sendJson(ctx.res, 200, { applications: results });
}

/**
 * 2026-06-04: refactor sin JOIN. Filtramos cliente-side por assessment_id contra
 * el set de Jobs del tenant.
 */
async function listByCandidate(req: IncomingMessage, candidateId: string, tenantId: string): Promise<Result[]> {
  // 1) Todos los Results del candidato (todos los tenants — filtramos abajo)
  const allResults = unwrapRows<Result>(
    (await zcql(req).executeZCQLQuery(
      `SELECT * FROM ${RESULTS_TABLE} WHERE candidate_id = '${escapeSql(candidateId)}' ORDER BY CREATEDTIME DESC LIMIT 200`,
    )) as unknown[],
    RESULTS_TABLE,
  );
  if (allResults.length === 0) return [];

  // 2) ROWIDs de Jobs del tenant
  const jobRows = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' LIMIT 300`,
    )) as unknown[],
    'Jobs',
  );
  const tenantJobIds = new Set(jobRows.map((j) => String(j.ROWID)));

  // 3) Filtrar cliente-side
  return allResults.filter((r) => tenantJobIds.has(String(r.assessment_id))).slice(0, 100);
}

export async function getApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('application id missing in path');

  const result = await getResultById(ctx.req, id);
  if (!result) throw new NotFoundError(`Application ${id} not found`);

  const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Application ${id} not found`);

  const transitions = await listTransitions(ctx.req, id);
  sendJson(ctx.res, 200, { application: result, transitions });
}

/**
 * GET /api/applications/:id/cv-download
 * Descarga el CV (PDF) del candidato. Protegido por tenant ownership.
 */
export async function downloadApplicationCv(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const urlPath = (ctx.req.url ?? '/').split('?')[0];
  const match = urlPath.match(/\/api\/applications\/([^/]+)\/cv-download\/?$/);
  const id = match?.[1];
  if (!id) throw new ValidationError('application id missing in path');

  const result = await getResultById(ctx.req, id);
  if (!result) throw new NotFoundError(`Application ${id} not found`);

  const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Application ${id} not found`);

  if (!result.cv_file_id) {
    throw new NotFoundError(`No CV uploaded for application ${id}`);
  }

  const { downloadCvFromFileStore } = await import('../lib/cvStorage.js');
  const buffer = await downloadCvFromFileStore(ctx.req, result.cv_file_id);

  const filename = `cv-${id}.pdf`;
  ctx.res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, no-store',
  });
  ctx.res.end(buffer);
}

export async function createApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  if (typeof body.assessment_id !== 'string' || !body.assessment_id) {
    throw new ValidationError('assessment_id (job id) is required');
  }
  if (typeof body.candidate_id !== 'string' || !body.candidate_id) {
    throw new ValidationError('candidate_id is required');
  }

  const ownerTenant = await getJobTenantId(ctx.req, body.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Job ${body.assessment_id} not found`);

  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
    ? body.idempotency_key
    : null;

  // Idempotency: si el caller mandó la misma key + (assessment_id, candidate_id), devolver
  // la aplicación existente. Esto evita duplicados por retries del frontend.
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(ctx.req, body.assessment_id, body.candidate_id, idempotencyKey);
    if (existing) {
      log.info('idempotency hit, returning existing application', {
        traceId: ctx.traceId, applicationId: existing.ROWID, idempotencyKey,
      });
      sendJson(ctx.res, 200, { application: existing, idempotent: true });
      return;
    }
  }

  const created = await insertResult(ctx.req, {
    assessment_id: body.assessment_id,
    candidate_id: body.candidate_id,
    answers: null,
    pipeline_stage: 'prefilter_pending',
    started_at: now(),
    completed_at: null,
    report_downloaded_at: null,
    idempotency_key: idempotencyKey,
    cv_file_id: null,
  });

  await insertTransition(ctx.req, {
    result_id: created.ROWID,
    from_stage: null,
    to_stage: 'prefilter_pending',
    actor: `admin:${ctx.user!.clerk_user_id}`,
    reason: 'Application created',
  });

  log.info('created', { traceId: ctx.traceId, applicationId: created.ROWID });
  void auditLog(ctx, {
    action: 'application.create',
    resource_type: 'application',
    resource_id: created.ROWID,
    changes: { assessment_id: body.assessment_id, candidate_id: body.candidate_id },
  });
  sendJson(ctx.res, 201, { application: created });
}

async function findByIdempotencyKey(
  req: IncomingMessage,
  assessmentId: string,
  candidateId: string,
  idempotencyKey: string,
): Promise<Result | null> {
  const query = `SELECT * FROM ${RESULTS_TABLE}
    WHERE assessment_id = '${escapeSql(assessmentId)}'
      AND candidate_id = '${escapeSql(candidateId)}'
      AND idempotency_key = '${escapeSql(idempotencyKey)}'
    LIMIT 1`.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Result>(result, RESULTS_TABLE)[0] ?? null;
}

export async function transitionApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('application id missing in path');

  const result = await getResultById(ctx.req, id);
  if (!result) throw new NotFoundError(`Application ${id} not found`);

  const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Application ${id} not found`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  if (!isStage(body.to_stage)) throw new ValidationError(`to_stage invalid; allowed: ${ALL_STAGES.join(', ')}`);

  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;
  const fromStage = result.pipeline_stage;
  const toStage = body.to_stage;

  if (!transitionAllowed(fromStage, toStage)) {
    throw new ConflictError(`Transition ${fromStage} → ${toStage} not allowed`);
  }

  const updated = await updateStage(ctx.req, id, toStage);
  const transition = await insertTransition(ctx.req, {
    result_id: id,
    from_stage: fromStage,
    to_stage: toStage,
    actor: `admin:${ctx.user!.clerk_user_id}`,
    reason,
  });

  log.info('transitioned', {
    traceId: ctx.traceId, applicationId: id, from: fromStage, to: toStage,
  });
  void auditLog(ctx, {
    action: 'application.transition',
    resource_type: 'application',
    resource_id: id,
    changes: { from: fromStage, to: toStage, reason },
  });

  // Auto-populate del pool cuando el candidato pasa a estados post-tests.
  // Se ejecuta también en transiciones manuales (desde admin UI, no solo automáticas).
  if (['integridad_completed', 'videos_completed', 'finalist'].includes(toStage)) {
    const { upsertPoolFromApplication } = await import('../lib/poolAutoPopulate.js');
    void upsertPoolFromApplication(ctx.req, id);
  }

  // Notificar a Cris cuando hay un nuevo finalist
  if (toStage === 'finalist') {
    const { enqueueNotification } = await import('./notifications.js');
    void enqueueNotification(ctx.req, {
      tenantId,
      type: 'finalist_ready',
      message: `Nuevo finalist en pipeline: revisar y decidir`,
      resourceType: 'application',
      resourceId: id,
      link: `/candidates/${id}`,
    });
    // Trigger automático del email "finalistas listos" al cliente cuando hay 3.
    // Idempotente — solo dispara una vez por job.
    void maybeTriggerFinalistsReady(ctx.req, result.assessment_id, tenantId);
  }

  // Hito al cliente: funnel_active cuando 3+ candidatos están en pruebas para este job.
  // Idempotente — solo dispara una vez por job (verifica OutboxEvents previo).
  // Threshold 3 hardcoded; en el futuro puede ser env var por tenant.
  if (FUNNEL_TRIGGER_STAGES.includes(toStage)) {
    void maybeTriggerFunnelActive(ctx.req, result.assessment_id, tenantId);
  }

  // Notificación al candidato del siguiente paso (email + WhatsApp).
  // 2026-06-04 (audit fix #16): fireAndForget wrap. Antes el IIFE no tenía try/catch.
  const { fireAndForget } = await import('../lib/fireAndForget.js');
  fireAndForget('notifyCandidateOnTransition[admin]', async () => {
    const { notifyCandidateOnTransition } = await import('../lib/candidateNotifier.js');
    await notifyCandidateOnTransition(ctx.req, {
      applicationId: id,
      toStage,
      reason: reason ?? undefined,
    });
  });

  // Outbox producer: enqueue cambio de stage para consumers genéricos.
  // audit fix #16: wrap fireAndForget.
  fireAndForget('enqueueOutbox.application_transitioned', () => enqueueOutboxEvent(ctx.req, {
    event_type: 'application.transitioned',
    payload: {
      tenant_id: tenantId,
      application_id: id,
      from_stage: fromStage,
      to_stage: toStage,
      reason: reason ?? null,
      transitioned_at: now(),
    },
  }));

  // Producer específico sync.recruit (solo si Zoho Recruit está configurado).
  // audit fix #16: wrap fireAndForget.
  fireAndForget('publishRecruitSync[admin_transition]', async () => {
    const { publishRecruitSync } = await import('../lib/recruitSyncPublisher.js');
    await publishRecruitSync(ctx.req, {
      application_id: id,
      job_id: result.assessment_id,
      tenant_id: tenantId,
      from_stage: fromStage,
      to_stage: toStage,
      actor: `admin:${ctx.user!.clerk_user_id}`,
      reason: reason ?? undefined,
      transitioned_at: now(),
    });
  });

  sendJson(ctx.res, 200, { application: updated, transition });
}

/**
 * Helper para enqueue events al OutboxEvents. Fire-and-forget, no rompe el flow si falla.
 */
async function enqueueOutboxEvent(
  req: IncomingMessage,
  event: { event_type: string; payload: Record<string, unknown> },
): Promise<void> {
  try {
    await datastore(req).table('OutboxEvents').insertRow({
      event_type: event.event_type,
      payload: stringifyAndTruncate(event.payload, FIELD_LIMITS.OUTBOX_PAYLOAD, `OutboxEvents.payload[${event.event_type}]`),
      status: 'pending',
      retry_count: 0,
      last_error: null,
      created_at: now(),
      processed_at: null,
    });
  } catch (err) {
    log.warn('enqueueOutboxEvent failed', { event_type: event.event_type, error: (err as Error).message });
  }
}

const FUNNEL_TRIGGER_STAGES: readonly PipelineStage[] = [
  'tecnica_completed', 'conductual_completed', 'integridad_completed',
  'videos_pending', 'videos_completed', 'bot_decision_advance',
];
const FUNNEL_THRESHOLD = 3;

/**
 * Trigger del hito "funnel_active" al cliente: cuando 3+ candidatos están en pruebas
 * para un job, le mandamos un email "Tu embudo tiene X candidatos en evaluación".
 *
 * Idempotente: si ya hay un OutboxEvent `client.notify.funnel_active` con este job_id,
 * skip. Esto evita re-disparar el email cada vez que un candidato avanza.
 */
async function maybeTriggerFunnelActive(req: IncomingMessage, jobId: string, tenantId: string): Promise<void> {
  try {
    // 2026-06-04 (audit fix #7): el LIKE '%"job_id":"X"%' puede dar match falso si
    // otro job_id contiene esa subcadena. Filtramos cliente-side por job_id exacto.
    // Como el universo de eventos client.notify.* del último mes es chico, traer 100
    // y filtrar en memoria es barato y exacto.
    const candidates = unwrapRows<{ ROWID: string; payload: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, payload FROM OutboxEvents
         WHERE event_type = 'client.notify.funnel_active'
         ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'OutboxEvents',
    );
    const existing = candidates.find((row) => {
      try {
        const p = JSON.parse(row.payload) as { job_id?: string };
        return p.job_id === jobId;
      } catch { return false; }
    });
    if (existing) return;

    const stagesList = FUNNEL_TRIGGER_STAGES.map((s) => `'${s}'`).join(',');
    const counts = unwrapRows<{ c: number; cnt: number }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT COUNT(ROWID) AS cnt FROM Results
         WHERE assessment_id = '${escapeSql(jobId)}'
           AND pipeline_stage IN (${stagesList})`,
      )) as unknown[],
      'Results',
    );
    const count = Number(counts[0]?.cnt ?? counts[0]?.c ?? 0);
    if (count < FUNNEL_THRESHOLD) return;

    const jobRows = unwrapRows<{ ROWID: string; title: string; client_email?: string | null; client_name?: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, title, client_email, client_name FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const job = jobRows[0];
    if (!job) return;
    const clientEmail = (job.client_email || '').trim();
    if (!clientEmail) {
      log.info('funnel_active skipped — no client_email on job', { jobId });
      return;
    }

    const { publishAndProcessEvent } = await import('./outbox.js');
    await publishAndProcessEvent(req, 'client.notify.funnel_active', {
      tenant_id: tenantId,
      job_id: jobId,
      client_email: clientEmail,
      client_name: job.client_name || 'cliente',
      job_title: job.title,
      candidates_in_tests: count,
    });
    log.info('funnel_active triggered', { jobId, count });
  } catch (err) {
    log.warn('maybeTriggerFunnelActive failed', { jobId, error: (err as Error).message });
  }
}

export async function getApplicationTransitions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromTransitionsPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('application id missing in path');

  const result = await getResultById(ctx.req, id);
  if (!result) throw new NotFoundError(`Application ${id} not found`);
  const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Application ${id} not found`);

  const transitions = await listTransitions(ctx.req, id);
  sendJson(ctx.res, 200, { transitions });
}

// Path estricto: matchea exactamente `/api/applications/<id>` con sufijos válidos.
// Si en el futuro se agrega un nuevo sub-path (ej: /scores), agregalo a la alternation.
function extractIdFromPath(url: string): string | null {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/applications\/([^/]+)(?:\/(?:transition|transitions|scores|integrity|bot-review))?\/?$/);
  return match?.[1] ?? null;
}

/**
 * POST /api/applications/_bulk-transition
 *
 * Transiciona N aplicaciones de una vez. Útil para operaciones masivas tipo
 * "rechazar 20 candidatos que no pasaron filtro técnico".
 *
 *   Body: { application_ids: string[], to_stage: PipelineStage, reason?: string }
 *
 *   Response: { results: Array<{ application_id, success, error? }> }
 *
 * Cada transición valida tenant + state machine. Falla parcial es OK — devuelve
 * lo que pasó y lo que falló por separado.
 */
export async function bulkTransitionApplications(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const body = await readJsonBody<{ application_ids?: unknown; to_stage?: unknown; reason?: unknown }>(ctx.req);
  if (!Array.isArray(body.application_ids) || body.application_ids.length === 0) {
    throw new ValidationError('application_ids array required (non-empty)');
  }
  if (body.application_ids.length > 100) {
    throw new ValidationError('máximo 100 aplicaciones por bulk transition');
  }
  if (!isStage(body.to_stage)) {
    throw new ValidationError(`to_stage invalid; allowed: ${ALL_STAGES.join(', ')}`);
  }
  const toStage = body.to_stage as PipelineStage;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;

  const results: Array<{ application_id: string; success: boolean; error?: string; from_stage?: string }> = [];

  for (const rawId of body.application_ids) {
    const appId = typeof rawId === 'string' ? rawId : '';
    if (!appId) {
      results.push({ application_id: String(rawId), success: false, error: 'invalid id' });
      continue;
    }
    try {
      const result = await getResultById(ctx.req, appId);
      if (!result) {
        results.push({ application_id: appId, success: false, error: 'not found' });
        continue;
      }
      const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
      if (ownerTenant !== tenantId) {
        results.push({ application_id: appId, success: false, error: 'not in your tenant' });
        continue;
      }
      const fromStage = result.pipeline_stage;
      if (!transitionAllowed(fromStage, toStage)) {
        results.push({ application_id: appId, success: false, error: `${fromStage} → ${toStage} no permitido`, from_stage: fromStage });
        continue;
      }
      await updateStage(ctx.req, appId, toStage);
      await insertTransition(ctx.req, {
        result_id: appId,
        from_stage: fromStage,
        to_stage: toStage,
        actor: `admin:${ctx.user!.clerk_user_id}:bulk`,
        reason: reason ?? 'Bulk transition',
      });

      // Notificación al candidato del nuevo paso/rechazo. audit fix #16.
      {
        const { fireAndForget } = await import('../lib/fireAndForget.js');
        fireAndForget('notifyCandidateOnTransition[bulk]', async () => {
          const { notifyCandidateOnTransition } = await import('../lib/candidateNotifier.js');
          await notifyCandidateOnTransition(ctx.req, {
            applicationId: appId,
            toStage,
            reason: reason ?? undefined,
          });
        });
      }

      results.push({ application_id: appId, success: true, from_stage: fromStage });
    } catch (err) {
      results.push({ application_id: appId, success: false, error: (err as Error).message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  void auditLog(ctx, {
    action: 'application.transition',
    resource_type: 'application',
    resource_id: 'bulk',
    changes: { to_stage: toStage, total: results.length, succeeded, failed },
  });
  log.info('bulk transition', { traceId: ctx.traceId, tenantId, toStage, succeeded, failed });
  sendJson(ctx.res, 200, { results, summary: { total: results.length, succeeded, failed } });
}

/**
 * GET /api/applications/:id/bot-decision
 * Devuelve la última decisión del bot decisor para esta application.
 * Si no hay (bot no se ejecutó o tabla no existe), devuelve null.
 */
export async function getApplicationBotDecision(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('application id missing in path');

  const result = await getResultById(ctx.req, id);
  if (!result) throw new NotFoundError(`Application ${id} not found`);
  const ownerTenant = await getJobTenantId(ctx.req, result.assessment_id);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Application ${id} not found`);

  try {
    type Row = {
      ROWID: string;
      decision: string;
      to_stage_proposed: string;
      from_stage: string;
      confidence: number;
      rationale: string;
      auto_executed: boolean;
      overridden: boolean;
      overridden_by: string | null;
      overridden_reason: string | null;
      created_at: string;
    };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, decision, to_stage_proposed, from_stage, confidence, rationale,
                auto_executed, overridden, overridden_by, overridden_reason, created_at
         FROM BotDecisions
         WHERE result_id = '${escapeSql(id)}'
         ORDER BY CREATEDTIME DESC LIMIT 1`,
      )) as unknown[],
      'BotDecisions',
    );
    const r = rows[0];
    if (!r) {
      sendJson(ctx.res, 200, { decision: null });
      return;
    }
    sendJson(ctx.res, 200, {
      decision: {
        id: r.ROWID,
        decision: r.decision,
        from_stage: r.from_stage,
        to_stage_proposed: r.to_stage_proposed,
        confidence_pct: Number(r.confidence) || 0,
        rationale: r.rationale,
        auto_executed: r.auto_executed,
        overridden: r.overridden,
        overridden_by: r.overridden_by,
        overridden_reason: r.overridden_reason,
        decided_at: r.created_at,
      },
    });
  } catch (err) {
    log.debug('bot decision query failed (BotDecisions tabla puede no existir)', { error: (err as Error).message });
    sendJson(ctx.res, 200, { decision: null, table_not_ready: true });
  }
}

function extractIdFromTransitionsPath(url: string): string | null {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/applications\/([^/]+)\/transitions\/?$/);
  return match?.[1] ?? null;
}

const FINALIST_THRESHOLD = 3;

/**
 * Trigger automático del email "finalistas listos" al cliente cuando el job
 * tiene 3+ candidatos en stage 'finalist'.
 *
 * Idempotente: si ya hay un OutboxEvent `client.notify.finalists_ready` con este
 * job_id, no dispara de nuevo. Cris puede mandar manualmente desde el botón en
 * JobDetail si quiere reenviar.
 */
async function maybeTriggerFinalistsReady(req: IncomingMessage, jobId: string, tenantId: string): Promise<void> {
  try {
    // 2026-06-04 (audit fix #7): mismo patrón que maybeTriggerFunnelActive — filtrar
    // por job_id exacto cliente-side en vez de LIKE en payload. Evita falsos positivos
    // y falsos negativos por escaping.
    const candidates = unwrapRows<{ ROWID: string; payload: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, payload FROM OutboxEvents
         WHERE event_type = 'client.notify.finalists_ready'
         ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'OutboxEvents',
    );
    const existing = candidates.find((row) => {
      try {
        const p = JSON.parse(row.payload) as { job_id?: string };
        return p.job_id === jobId;
      } catch { return false; }
    });
    if (existing) return;

    // Contar finalists actuales
    const counts = unwrapRows<{ cnt: number; c: number }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT COUNT(ROWID) AS cnt FROM Results
         WHERE assessment_id = '${escapeSql(jobId)}'
           AND pipeline_stage = 'finalist'`,
      )) as unknown[],
      'Results',
    );
    const count = Number(counts[0]?.cnt ?? counts[0]?.c ?? 0);
    if (count < FINALIST_THRESHOLD) return;

    // Cargar job para obtener client_email + title
    const jobRows = unwrapRows<{ ROWID: string; title: string; client_email?: string | null; client_name?: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, title, client_email, client_name FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const job = jobRows[0];
    if (!job) return;
    const clientEmail = (job.client_email || '').trim();
    if (!clientEmail) {
      log.info('finalists_ready skipped — no client_email on job', { jobId });
      return;
    }

    // Firmar report_token + URL
    const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
    const { env } = await import('../lib/env.js');
    const reportToken = signToken({
      kind: 'report_bundle',
      ref: jobId,
      exp: expiresIn(WEEK_SEC),
    });
    const reportUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/r/${reportToken}`;

    const { publishAndProcessEvent } = await import('./outbox.js');
    await publishAndProcessEvent(req, 'client.notify.finalists_ready', {
      tenant_id: tenantId,
      job_id: jobId,
      client_email: clientEmail,
      client_name: job.client_name || 'cliente',
      job_title: job.title,
      finalist_count: count,
      report_url: reportUrl,
      recruiter_name: 'Kuno Digital',
    });
    log.info('finalists_ready auto-triggered', { jobId, count });
  } catch (err) {
    log.warn('maybeTriggerFinalistsReady failed', { jobId, error: (err as Error).message });
  }
}
