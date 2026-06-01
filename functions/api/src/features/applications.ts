/**
 * Applications = Results en BD. Una aplicación = un candidato aplicando a un puesto.
 * State machine: prefilter_pending → tecnica → conductual → integridad → finalist | rejected.
 * Cada transición se persiste en PipelineTransitions (append-only).
 */

import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
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

async function listByJob(req: IncomingMessage, jobId: string, tenantId: string): Promise<Result[]> {
  // Defense-in-depth: el handler ya valida que el job pertenezca al tenant via getJobTenantId,
  // pero acá repetimos el JOIN. Si en el futuro alguien llama listByJob desde otro lugar
  // sin el guard, el JOIN protege igual.
  const query = `
    SELECT R.*
    FROM Results R
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE R.assessment_id = '${escapeSql(jobId)}'
      AND J.tenant_id = '${escapeSql(tenantId)}'
    ORDER BY R.CREATEDTIME DESC
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Result>(result, RESULTS_TABLE);
}

async function listByTenant(req: IncomingMessage, tenantId: string, limit = 200): Promise<Result[]> {
  const query = `
    SELECT R.*
    FROM Results R
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE J.tenant_id = '${escapeSql(tenantId)}'
    ORDER BY R.CREATEDTIME DESC
    LIMIT ${Math.min(limit, 500)}
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Result>(result, RESULTS_TABLE);
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

  let results: Result[];
  if (jobId) {
    const ownerTenant = await getJobTenantId(ctx.req, jobId);
    if (ownerTenant !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);
    results = await listByJob(ctx.req, jobId, tenantId);
  } else {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 200)));
    results = await listByTenant(ctx.req, tenantId, limit);
  }
  log.info('list', { traceId: ctx.traceId, tenantId, jobId, count: results.length });
  sendJson(ctx.res, 200, { applications: results });
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
  }

  // Outbox producer: enqueue cambio de stage para consumers genéricos
  void enqueueOutboxEvent(ctx.req, {
    event_type: 'application.transitioned',
    payload: {
      tenant_id: tenantId,
      application_id: id,
      from_stage: fromStage,
      to_stage: toStage,
      reason: reason ?? null,
      transitioned_at: now(),
    },
  });

  // Producer específico sync.recruit (solo si Zoho Recruit está configurado)
  void (async () => {
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
  })();

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

function extractIdFromTransitionsPath(url: string): string | null {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/applications\/([^/]+)\/transitions\/?$/);
  return match?.[1] ?? null;
}
