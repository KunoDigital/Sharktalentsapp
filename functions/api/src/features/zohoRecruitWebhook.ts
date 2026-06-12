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
  event_type: 'candidate.status_changed' | 'candidate.hired' | 'candidate.rejected' | 'candidate.created' | string;
  candidate_id?: string;
  recruit_status?: string;
  sharktalents_application_id?: string;
  // Campos para candidate.created (2026-06-04, Fase 3.5):
  recruit_application_id?: string;
  recruit_job_id?: string;
  candidate_email?: string;
  candidate_first_name?: string;
  candidate_last_name?: string;
  candidate_phone?: string;
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
    // Schema real (2026-06-05): event_id, provider, received_at. NO processed_at.
    await datastore(req).table('ProcessedEvents').insertRow({
      event_id: eventId,
      provider: 'zoho_recruit_webhook',
      received_at: now(),
    });
  } catch (err) {
    // Catalyst tira errores como string, no Error — sacar tanto .message como String(err).
    const errStr = (err as Error)?.message || String(err);
    log.warn('failed to mark recruit event processed', { eventId, error: errStr.slice(0, 300) });
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

/**
 * Handler de `candidate.created` (Fase 3.5).
 *
 * Cuando un candidato se registra en Zoho Recruit (workflow rule en módulo Solicitudes),
 * SharkTalents recibe este evento y:
 *   1. Encuentra el Job correspondiente en SharkTalents por recruit_job_id.
 *   2. Encuentra (o crea) el Candidate por email + tenant.
 *   3. Crea la Application (Result) en stage 'prefilter_pending'.
 *   4. Dispara outbox `application.created` para el primer email/WhatsApp.
 *
 * Idempotency: event_id se marca como processed al final. Si Recruit reintenta, se
 * detecta como duplicate y se devuelve 200 sin volver a crear.
 *
 * Tolerancia:
 *   - Si el Job no existe en SharkTalents (recruit_job_id desconocido) → log + 200 +
 *     alerta para que Cris lo resuelva manual. No falla el webhook.
 *   - Si email vacío → 400 (no podemos identificar candidato sin email).
 */
async function handleCandidateCreated(ctx: RequestContext, event: RecruitEvent): Promise<void> {
  const email = (event.candidate_email ?? '').trim().toLowerCase();
  const recruitJobId = (event.recruit_job_id ?? '').trim();
  if (!email) {
    throw new ValidationError('candidate_email required for candidate.created');
  }
  if (!recruitJobId) {
    throw new ValidationError('recruit_job_id required for candidate.created');
  }

  const firstName = (event.candidate_first_name ?? '').trim();
  const lastName = (event.candidate_last_name ?? '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').slice(0, 255) || email.split('@')[0];
  const phone = (event.candidate_phone ?? '').trim().slice(0, 50) || null;
  const recruitApplicationId = (event.recruit_application_id ?? '').trim() || null;

  // 1. Encontrar el Job en SharkTalents.
  // 2026-06-05: Recruit envía el slug humano (ZR_XX_JOB) en lugar del bigint interno.
  // Buscamos por 2 columnas:
  //   - recruit_job_id (bigint que devuelve Recruit cuando publicamos vía API).
  //   - recruit_job_slug (slug humano ZR_XX_JOB, llenado por el backfill o auto al publicar).
  // Si una matchea, encontramos el Job. Si no, alerta job_unknown.
  let jobRows = unwrapRows<{ ROWID: string; tenant_id: string; title: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id, title FROM Jobs WHERE recruit_job_id = '${escapeSql(recruitJobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  );
  if (jobRows.length === 0) {
    jobRows = unwrapRows<{ ROWID: string; tenant_id: string; title: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title FROM Jobs WHERE recruit_job_slug = '${escapeSql(recruitJobId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
  }
  const job = jobRows[0];
  if (!job) {
    // Job no mapeado. Alerta a Cris para que lo resuelva manual.
    log.warn('candidate.created — Job not found in SharkTalents', { eventId: event.event_id, recruitJobId });
    try {
      const { alertCris } = await import('../lib/alerting.js');
      await alertCris(ctx.req, {
        severity: 'warning',
        code: 'recruit.candidate_created.job_unknown',
        message: `Candidato ${email} se registró en Recruit para Job ${recruitJobId} pero el Job no existe en SharkTalents`,
        context: { event_id: event.event_id, recruit_job_id: recruitJobId, candidate_email: email },
        resourceType: 'job',
        resourceId: recruitJobId,
      });
    } catch { /* tolerar */ }
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, action: 'skipped', reason: 'job_not_found' });
    return;
  }

  // 2. Encontrar o crear el Candidate por email.
  // Candidates es tabla GLOBAL (compartida entre tenants) — el email es el identificador
  // único. La asociación tenant ↔ candidate vive en JobApplications.tenant_id, no acá.
  type CandRow = { ROWID: string; email: string; name: string };
  const existingCand = unwrapRows<CandRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, name FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  );

  let candidateId: string;
  let candidateAction: 'created' | 'reused';
  if (existingCand[0]) {
    candidateId = existingCand[0].ROWID;
    candidateAction = 'reused';
    // Si llegó con nombre/teléfono nuevo y antes era genérico, mejorar el row.
    if ((!existingCand[0].name || existingCand[0].name === email.split('@')[0]) && fullName && fullName !== email.split('@')[0]) {
      try {
        await datastore(ctx.req).table('Candidates').updateRow({ ROWID: candidateId, name: fullName });
      } catch { /* tolerar */ }
    }
  } else {
    // Catalyst rechaza null explícito en columnas opcionales — solo incluimos campos que
    // tienen valor real para evitar "Invalid input value for column X".
    const insertPayload: Record<string, unknown> = {
      email,
      name: fullName,
      created_at: now(),
    };
    if (phone) insertPayload.phone = phone;
    // recruit_candidate_id sí existe en Candidates (extra column verificada con
    // verify-tables 2026-06-05) — útil para sync bidireccional con Recruit.
    if (event.candidate_id) insertPayload.recruit_candidate_id = event.candidate_id;
    const insertedCand = await datastore(ctx.req).table('Candidates').insertRow(insertPayload);
    const newId = (insertedCand as { ROWID?: string }).ROWID
      ?? (insertedCand as { Candidates?: { ROWID?: string } }).Candidates?.ROWID;
    if (!newId) {
      throw new Error('Candidates insert no devolvió ROWID');
    }
    candidateId = String(newId);
    candidateAction = 'created';
  }

  // 3. Idempotency a nivel application: si ya existe Result para ese (candidate, job),
  // no duplicar (Recruit puede reintentar el webhook con el mismo event_id se atrapa
  // arriba pero por si acaso event_id no fuera estable).
  const existingApp = unwrapRows<{ ROWID: string; pipeline_stage: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage FROM Results WHERE candidate_id = '${escapeSql(candidateId)}' AND assessment_id = '${escapeSql(job.ROWID)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  );
  if (existingApp[0]) {
    log.info('candidate.created — application already exists, skipping create', {
      eventId: event.event_id, candidateId, jobId: job.ROWID, resultId: existingApp[0].ROWID,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, {
      received: true, action: 'existing',
      candidate_id: candidateId, application_id: existingApp[0].ROWID, candidate_action: candidateAction,
    });
    return;
  }

  // 4. Crear la Application (Result) en stage inicial.
  // Schema real de Results (2026-06-05): assessment_id, candidate_id, answers,
  // pipeline_stage, started_at, completed_at, report_downloaded_at, idempotency_key,
  // sign_request_id. NO tiene tenant_id (la asociación tenant va via Jobs.tenant_id),
  // ni recruit_candidate_id (eso vive en Candidates), ni recruit_application_id
  // (lo guardamos en idempotency_key como hack temporal — ZR_XX_APP es único).
  const resultsPayload: Record<string, unknown> = {
    candidate_id: candidateId,
    assessment_id: job.ROWID,
    pipeline_stage: 'prefilter_pending',
    started_at: now(),
  };
  if (recruitApplicationId) resultsPayload.idempotency_key = recruitApplicationId;
  const insertedApp = await datastore(ctx.req).table('Results').insertRow(resultsPayload);
  const applicationId = String(
    (insertedApp as { ROWID?: string }).ROWID
    ?? (insertedApp as { Results?: { ROWID?: string } }).Results?.ROWID
    ?? '',
  );
  if (!applicationId) throw new Error('Results insert no devolvió ROWID');

  // 5. Insertar PipelineTransitions de la transición inicial (best-effort).
  try {
    await datastore(ctx.req).table('PipelineTransitions').insertRow({
      result_id: applicationId,
      from_stage: '',
      to_stage: 'prefilter_pending',
      actor: 'zoho_recruit_webhook:candidate.created',
      reason: 'Candidato registrado en Recruit',
      transitioned_at: now(),
    });
  } catch (err) {
    log.warn('PipelineTransitions insert failed (Result already created)', {
      eventId: event.event_id, applicationId, error: (err as Error).message,
    });
  }

  // 6. Disparar evento outbox para que SharkTalents mande el primer email/WhatsApp.
  try {
    const { publishOutboxEvent } = await import('./outbox.js');
    const { fireAndForget } = await import('../lib/fireAndForget.js');
    fireAndForget('publishOutbox.application_created[from_recruit]', () =>
      publishOutboxEvent(ctx.req, 'application.created', {
        tenant_id: job.tenant_id,
        application_id: applicationId,
        candidate_id: candidateId,
        job_id: job.ROWID,
        job_title: job.title,
        candidate_email: email,
        candidate_name: fullName,
        source: 'zoho_recruit_webhook',
      }),
    );
  } catch { /* tolerar */ }

  // 7. Sellar idempotency.
  await markProcessed(ctx.req, event.event_id);

  log.info('candidate.created — application created from Recruit webhook', {
    eventId: event.event_id, candidateId, jobId: job.ROWID, applicationId,
    candidateAction, jobTitle: job.title,
  });

  sendJson(ctx.res, 200, {
    received: true, action: 'created',
    candidate_id: candidateId,
    application_id: applicationId,
    candidate_action: candidateAction,
    job_id: job.ROWID,
  });
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

  // 2026-06-05: Recruit puede mandar el body en 3 formatos distintos según cómo se
  // configura el webhook:
  //   A) JSON puro: `{event_id: ..., ...}` → JSON.parse directo.
  //   B) JSON envuelto: `{"payload": {...}}` o `{"payload": "stringified-json"}`.
  //   C) Form-urlencoded: `payload=%7B%22event_id%22%3A...%7D` (cuando Recruit elige
  //      mandar el "Nombre del parámetro" como key del form). En este caso el rawBody
  //      empieza con `payload=` y el JSON está URL-encoded después del `=`.
  // Aceptamos los 3 para que la config del workflow no condicione el handler.
  let event: RecruitEvent;
  const tryParseInner = (rawJson: string | RecruitEvent | { payload?: RecruitEvent | string }): RecruitEvent => {
    if (typeof rawJson === 'string') return JSON.parse(rawJson) as RecruitEvent;
    if ('payload' in rawJson && rawJson.payload !== undefined) {
      return typeof rawJson.payload === 'string' ? JSON.parse(rawJson.payload) : rawJson.payload;
    }
    return rawJson as RecruitEvent;
  };
  try {
    // Caso C: form-urlencoded. Recruit puede mandar el body como
    // `X-Zoho-Recruit-Secret=...&payload=%7B...%7D` (con el secret duplicado al inicio).
    // Buscamos el parámetro `payload` con URLSearchParams sin importar su posición.
    const isFormUrlEncoded = rawBody.includes('payload=') && (
      rawBody.includes('&') || rawBody.startsWith('payload=')
    );
    if (isFormUrlEncoded) {
      const params = new URLSearchParams(rawBody);
      const payloadStr = params.get('payload');
      if (!payloadStr) throw new Error('payload key not found in form-urlencoded body');
      event = tryParseInner(JSON.parse(payloadStr) as RecruitEvent | { payload?: RecruitEvent | string });
    } else {
      // Caso A o B: JSON puro o envuelto.
      const parsed = JSON.parse(rawBody) as RecruitEvent | { payload?: RecruitEvent | string };
      event = tryParseInner(parsed);
    }
  } catch (err) {
    // Loguear lo que llegó para diagnosticar — solo primeros 500 chars para no inflar logs.
    log.warn('webhook body parse failed', {
      contentType: ctx.req.headers['content-type'],
      bodyPreview: rawBody.slice(0, 500),
      error: (err as Error)?.message ?? String(err),
    });
    throw new ValidationError('invalid JSON body');
  }
  if (!event.event_id || !event.event_type) {
    throw new ValidationError('event_id + event_type required');
  }

  if (await isAlreadyProcessed(ctx.req, event.event_id)) {
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  // 2026-06-04 (Fase 3.5): handler dedicado para "candidato se registró en Recruit".
  // Crea (o reusa) Candidate y Application en SharkTalents para que el flow de mensajes
  // pase a manos de SharkTalents (no Recruit).
  if (event.event_type === 'candidate.created') {
    await handleCandidateCreated(ctx, event);
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

  // 2026-06-04 (audit fix #15): markProcessed PRIMERO para sellar la idempotency key,
  // así si Recruit reintenta el webhook (común al recibir 503 nuestro), no se aplican
  // las mutaciones dos veces. Si después las mutaciones fallan, devolvemos 503 pero el
  // event_id ya quedó marcado como procesado — Cris ve la alerta y resuelve manual.
  try {
    await markProcessed(ctx.req, event.event_id);
  } catch (err) {
    // Race: si dos requests del mismo event_id llegan simultáneos, el segundo falla acá.
    // Eso significa que el primero ya empezó a procesarlo → devolvemos duplicate.
    log.info('recruit event already being processed (race)', {
      eventId: event.event_id, error: (err as Error).message,
    });
    sendJson(ctx.res, 200, { received: true, duplicate: true, reason: 'concurrent_processing' });
    return;
  }

  try {
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: app.resultId,
      pipeline_stage: targetStage,
    });
    // PipelineTransitions es auditoría histórica. Si falla, log.warn y seguir; el invariante
    // de pipeline_stage en Results es la fuente de verdad.
    try {
      await datastore(ctx.req).table('PipelineTransitions').insertRow({
        result_id: app.resultId,
        from_stage: app.currentStage,
        to_stage: targetStage,
        actor: 'zoho_recruit_webhook',
        reason: `Recruit ${event.event_type}${event.recruit_status ? `: ${event.recruit_status}` : ''}`,
        transitioned_at: now(),
      });
    } catch (err) {
      log.warn('PipelineTransitions insert failed (Results already updated)', {
        eventId: event.event_id, resultId: app.resultId, error: (err as Error).message,
      });
    }

    log.info('recruit event applied', {
      eventId: event.event_id,
      resultId: app.resultId,
      from: app.currentStage,
      to: targetStage,
    });
    sendJson(ctx.res, 200, { received: true, transitioned: true, target_stage: targetStage });
  } catch (err) {
    // Results update falló → la idempotency key ya quedó marcada pero NO se aplicó nada.
    // Alertamos para que Cris lo resuelva manual (re-aplicar o invalidar el evento).
    log.error('recruit webhook Results update failed AFTER markProcessed — manual intervention needed', {
      eventId: event.event_id,
      resultId: app.resultId,
      error: (err as Error).message,
    });
    try {
      const { alertCris } = await import('../lib/alerting.js');
      await alertCris(ctx.req, {
        severity: 'critical',
        code: 'recruit_webhook.partial_apply',
        message: `Recruit webhook ${event.event_id} marcado procesado pero Results.update falló — necesita revisión manual`,
        context: { eventId: event.event_id, resultId: app.resultId, fromStage: app.currentStage, toStage: targetStage, error: (err as Error).message },
        resourceType: 'application',
        resourceId: app.resultId,
      });
    } catch { /* tolerar */ }
    sendJson(ctx.res, 503, { error: { code: 'processing_failed_after_mark', message: 'event_id sellado pero apply falló — Cris fue notificada' } });
  }
}

export const _internal = { verifySecret, eventToTargetStage, mapRecruitStatusToStage };
