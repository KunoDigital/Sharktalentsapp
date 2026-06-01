/**
 * Webhook entrante de Zoho Recruit — recibe cambios hechos en Recruit.
 *
 * Cierra el cycle bidireccional: nosotros mandamos cambios via outbox `sync.recruit`
 * → Recruit; ahora también reflejamos cambios que el cliente hace en Recruit
 * (ej: marca un candidato como hired desde la app de Zoho Recruit) → SharkTalents.
 *
 * Eventos soportados:
 *   - candidate.status_changed   → si el cliente movió el candidato manualmente, sync el stage
 *   - candidate.hired            → terminal, marca pipeline_stage='hired'
 *   - candidate.rejected         → terminal, marca pipeline_stage='rejected_by_admin'
 *
 * Validación: secret literal en `ZOHO_RECRUIT_WEBHOOK_SECRET`. Zoho NO firma con HMAC
 * (a diferencia de Clerk/Svix). Se acepta el secret como header `X-Zoho-Recruit-Secret`
 * o como URL query param del mismo nombre — Zoho permite configurarlo de cualquier forma.
 *
 * Idempotencia via ProcessedEvents.
 *
 * Endpoint:
 *   POST /api/webhooks/zoho-recruit?X-Zoho-Recruit-Secret=<secret>
 *   o
 *   POST /api/webhooks/zoho-recruit con header X-Zoho-Recruit-Secret: <secret>
 *   Body: { event_id, event_type, candidate_id, recruit_status?, sharktalents_application_id? }
 */
import { timingSafeEqual } from 'crypto';
import type { RequestContext } from '../lib/context';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { transitionAllowed, type PipelineStage, isStage } from '../lib/pipelineStateMachine';

const log = logger('ZOHO_RECRUIT_WEBHOOK');

type RecruitEvent = {
  event_id: string;
  event_type: 'candidate.status_changed' | 'candidate.hired' | 'candidate.rejected' | string;
  candidate_id?: string;
  recruit_status?: string;
  sharktalents_application_id?: string;
};

async function readRawBody(req: RequestContext['req']): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Verificación de secret literal (NO HMAC) con timing-safe comparison.
 * Zoho Recruit manda el secret tal cual lo configuras en webhook setup; no firma el body.
 */
function verifySecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function isAlreadyProcessed(req: RequestContext['req'], eventId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(eventId)}' AND provider = 'zoho_recruit_webhook' LIMIT 1`,
      )) as unknown[],
      'ProcessedEvents',
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markProcessed(req: RequestContext['req'], eventId: string): Promise<void> {
  try {
    await datastore(req).table('ProcessedEvents').insertRow({
      event_id: eventId,
      provider: 'zoho_recruit_webhook',
      processed_at: now(),
    });
  } catch (err) {
    log.warn('failed to mark recruit event processed', { eventId, error: (err as Error).message });
  }
}

/**
 * Mapea estados de Recruit a stages de SharkTalents.
 *
 * Recruit tiene su propio estado (Hired, Rejected, In Process, Offer Made, etc.).
 * Este mapeo es nuestra interpretación. Si Cris cambia los nombres en Recruit, hay que
 * actualizar este mapa.
 */
function mapRecruitStatusToStage(status: string | undefined): PipelineStage | null {
  if (!status) return null;
  const normalized = status.toLowerCase().replace(/\s+/g, '_');
  switch (normalized) {
    case 'hired': return 'hired';
    case 'rejected':
    case 'rejected_by_client':
    case 'rejected_by_employer': return 'rejected_by_admin';
    case 'offer_made':
    case 'offer_extended': return 'offered';
    case 'offer_declined':
    case 'declined': return 'offer_declined';
    case 'withdrew':
    case 'withdrawn': return 'withdrew';
    case 'interview_scheduled':
    case 'interview': return 'interview_scheduled';
    case 'finalist':
    case 'shortlisted': return 'finalist';
    default: return null;
  }
}

function eventToTargetStage(event: RecruitEvent): PipelineStage | null {
  if (event.event_type === 'candidate.hired') return 'hired';
  if (event.event_type === 'candidate.rejected') return 'rejected_by_admin';
  if (event.event_type === 'candidate.status_changed') {
    return mapRecruitStatusToStage(event.recruit_status);
  }
  return null;
}

async function findApplication(req: RequestContext['req'], event: RecruitEvent): Promise<{ resultId: string; currentStage: string } | null> {
  // Preferimos el sharktalents_application_id si viene
  if (event.sharktalents_application_id) {
    const rows = unwrapRows<{ ROWID: string; pipeline_stage: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, pipeline_stage FROM Results WHERE ROWID = '${escapeSql(event.sharktalents_application_id)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    if (rows[0]) return { resultId: rows[0].ROWID, currentStage: rows[0].pipeline_stage };
  }
  // TODO: fallback by candidate_id requiere mapping table RecruitCandidateMappings (Block 3)
  // Mientras tanto, sin mapping no podemos resolver.
  return null;
}

export async function handleZohoRecruitWebhook(ctx: RequestContext): Promise<void> {
  const e = env();
  const secret = e.ZOHO_RECRUIT_WEBHOOK_SECRET;
  if (!secret) {
    log.error('ZOHO_RECRUIT_WEBHOOK_SECRET not configured');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(ctx.req);

  // Zoho Recruit NO firma webhooks con HMAC (a diferencia de Clerk/Svix).
  // Solo manda un secret literal como custom header o URL query param.
  // Aceptamos AMBOS y comparamos con timingSafeEqual para evitar timing attacks.
  const headerSecret = ctx.req.headers['x-zoho-recruit-secret'];
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const querySecret = url.searchParams.get('X-Zoho-Recruit-Secret') ?? url.searchParams.get('x-zoho-recruit-secret');
  const providedSecret = (typeof headerSecret === 'string' ? headerSecret : null) ?? querySecret;
  if (!providedSecret) {
    throw new UnauthorizedError('Missing X-Zoho-Recruit-Secret (header or query param)');
  }
  if (!verifySecret(providedSecret, secret)) {
    throw new UnauthorizedError('Invalid Zoho Recruit secret');
  }

  let event: RecruitEvent;
  try {
    event = JSON.parse(rawBody) as RecruitEvent;
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  if (!event.event_id || !event.event_type) {
    throw new ValidationError('event_id + event_type required');
  }

  if (await isAlreadyProcessed(ctx.req, event.event_id)) {
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  const targetStage = eventToTargetStage(event);
  if (!targetStage) {
    log.info('recruit event accepted but no transition', {
      eventId: event.event_id,
      type: event.event_type,
      recruit_status: event.recruit_status,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }

  const app = await findApplication(ctx.req, event);
  if (!app) {
    log.warn('recruit event for unknown application — accepting', {
      eventId: event.event_id,
      candidate_id: event.candidate_id,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }

  if (!isStage(app.currentStage)) {
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }

  // Si el stage destino es igual al actual, no-op
  if (app.currentStage === targetStage) {
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false, reason: 'same_stage' });
    return;
  }

  // Si la transición no es válida en nuestro state machine, loggeamos y no aplicamos.
  // Esto puede pasar si Recruit hace saltos que nosotros no permitimos (ej: directo a hired
  // sin pasar por offered). En ese caso, Cris ve el log y decide manualmente.
  if (!transitionAllowed(app.currentStage as PipelineStage, targetStage)) {
    log.warn('recruit event would cause invalid transition', {
      resultId: app.resultId,
      from: app.currentStage,
      to: targetStage,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, {
      received: true,
      transitioned: false,
      reason: 'transition_not_allowed',
      from: app.currentStage,
      to: targetStage,
    });
    return;
  }

  try {
    await datastore(ctx.req).table('PipelineTransitions').insertRow({
      result_id: app.resultId,
      from_stage: app.currentStage,
      to_stage: targetStage,
      actor: 'zoho_recruit_webhook',
      reason: `Recruit ${event.event_type}${event.recruit_status ? `: ${event.recruit_status}` : ''}`,
      transitioned_at: now(),
    });
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: app.resultId,
      pipeline_stage: targetStage,
    });
    await markProcessed(ctx.req, event.event_id);

    log.info('recruit event applied', {
      eventId: event.event_id,
      resultId: app.resultId,
      from: app.currentStage,
      to: targetStage,
    });
    sendJson(ctx.res, 200, { received: true, transitioned: true, target_stage: targetStage });
  } catch (err) {
    log.error('recruit webhook processing failed', {
      eventId: event.event_id,
      error: (err as Error).message,
    });
    sendJson(ctx.res, 503, { error: { code: 'processing_failed', message: 'will be retried' } });
  }
}

export const _internal = { verifySecret, eventToTargetStage, mapRecruitStatusToStage };
