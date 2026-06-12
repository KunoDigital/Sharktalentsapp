/**
 * Recovery flow del candidato — pedir un nuevo link de test si lo perdió.
 *
 *   POST /apply/<tenantSlug>/<jobIdentifier>/resend
 *   Body: { email: "candidato@ejemplo.com" }
 *
 * Genera un nuevo token de test (con TTL fresco) para la Application existente del
 * candidato a ese puesto. Manda email con el link via outbox.
 *
 * Si no existe Application del candidato a ese puesto, devuelve 404.
 *
 * Rate-limited por IP para evitar abuse (atacante prueba emails).
 */
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { signToken, expiresIn, WEEK_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';
import { publishOutboxEvent } from './outbox';

const log = logger('PUBLIC_RECOVERY');

type TenantPick = { ROWID: string; slug: string; status: string };
type JobPick = { ROWID: string; tenant_id: string; title: string; company: string };
type CandidatePick = { ROWID: string; email: string };
type ResultPick = { ROWID: string; pipeline_stage: string };

export async function resendCandidateLink(ctx: RequestContext): Promise<void> {
  const match = ctx.req.url?.match(/^\/apply\/([^/]+)\/([^/]+)\/resend/);
  if (!match) throw new ValidationError('path inválido');
  const [, tenantSlug, jobIdentifier] = match;

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('email inválido');
  }

  // Tenant + Job lookup
  const tenant = unwrapRows<TenantPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, slug, status FROM Tenants WHERE slug = '${escapeSql(tenantSlug)}' LIMIT 1`,
    )) as unknown[],
    'Tenants',
  )[0];
  if (!tenant || tenant.status !== 'active') {
    // No revelar si el tenant existe (privacy): 404 genérico
    throw new NotFoundError('No encontramos esa aplicación. Contactá a tu reclutadora.');
  }

  let job = unwrapRows<JobPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id, title, company FROM Jobs WHERE ROWID = '${escapeSql(jobIdentifier)}' AND tenant_id = '${escapeSql(tenant.ROWID)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!job) {
    // Probar slug
    try {
      job = unwrapRows<JobPick>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, tenant_id, title, company FROM Jobs WHERE slug = '${escapeSql(jobIdentifier)}' AND tenant_id = '${escapeSql(tenant.ROWID)}' LIMIT 1`,
        )) as unknown[],
        'Jobs',
      )[0];
    } catch {
      // slug column may not exist — ignore
    }
  }
  if (!job) {
    throw new NotFoundError('No encontramos esa aplicación. Contactá a tu reclutadora.');
  }

  // Candidate por email
  const candidate = unwrapRows<CandidatePick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];

  if (!candidate) {
    // No revelar si existe el candidato. Devolver 200 igual que si lo encontró +
    // pero NO mandar email. Esto previene email enumeration.
    log.info('recovery requested for non-existent candidate', {
      traceId: ctx.traceId,
      email_masked: email.slice(0, 2) + '***',
      jobId: job.ROWID,
    });
    sendJson(ctx.res, 200, {
      sent: true,
      message: 'Si tu email tiene una aplicación a este puesto, recibirás un nuevo link en los próximos minutos.',
    });
    return;
  }

  // Application del candidato a este job
  const result = unwrapRows<ResultPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage FROM Results
       WHERE candidate_id = '${escapeSql(candidate.ROWID)}'
         AND assessment_id = '${escapeSql(job.ROWID)}'
       LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  if (!result) {
    // Mismo tratamiento que arriba: no revelar.
    sendJson(ctx.res, 200, {
      sent: true,
      message: 'Si tu email tiene una aplicación a este puesto, recibirás un nuevo link en los próximos minutos.',
    });
    return;
  }

  // Si el candidato ya está en stage terminal (rechazado, hired, etc.), no mandar link.
  if (['hired', 'rejected_by_admin', 'auto_rejected_low_score', 'offer_declined', 'withdrew'].includes(result.pipeline_stage)) {
    log.info('recovery for terminal stage candidate — skipping link', {
      traceId: ctx.traceId,
      resultId: result.ROWID,
      stage: result.pipeline_stage,
    });
    sendJson(ctx.res, 200, {
      sent: true,
      message: 'Si tu email tiene una aplicación a este puesto, recibirás un nuevo link en los próximos minutos.',
    });
    return;
  }

  // Generar nuevo token de test
  const newToken = signToken({
    kind: 'test',
    ref: result.ROWID,
    exp: expiresIn(WEEK_SEC),
  });

  // Enqueue email via outbox (que el cron procesará y mandará via Catalyst Email)
  await publishOutboxEvent(ctx.req, 'email.send_pending', {
    to: candidate.email,
    template: 'recovery_link',
    locale: 'es',
    vars: {
      candidate_email: candidate.email,
      job_title: job.title,
      job_company: job.company,
      test_link: `https://app.sharktalents.ai/#/test/${newToken}`,
      expiry_days: '7',
    },
  });

  log.info('recovery link sent', {
    traceId: ctx.traceId,
    resultId: result.ROWID,
    jobId: job.ROWID,
    email_masked: email.slice(0, 2) + '***',
  });

  sendJson(ctx.res, 200, {
    sent: true,
    message: 'Si tu email tiene una aplicación a este puesto, recibirás un nuevo link en los próximos minutos.',
  });
}

/**
 * Recovery genérico: candidato perdió el link entero (no sabe a qué tenant/job).
 *
 *   POST /candidate-recovery
 *   Body: { email: "candidato@ejemplo.com" }
 *
 * Busca el email entre Candidates, encuentra su Application activa más reciente,
 * genera un token de test fresco y manda email con el link a la fase que corresponde.
 *
 * **Importante:** SIEMPRE devuelve 200 con "si tu email está en nuestro sistema...",
 * para no leakear qué emails están registrados.
 *
 * Rate-limit por IP en el router.
 */
export async function genericRecoveryByEmail(ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('email inválido');
  }

  const successMsg = {
    sent: true,
    message: 'Si tu email está en nuestro sistema, vas a recibir un link en los próximos minutos.',
  };

  // Buscar candidato
  const cand = unwrapRows<{ ROWID: string; email: string; name?: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, name FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];
  if (!cand) {
    sendJson(ctx.res, 200, successMsg);
    return;
  }

  // Buscar Application activa más reciente
  type Row = {
    ROWID: string;
    pipeline_stage: string;
    assessment_id: string;
    job_title: string;
  };
  const apps = unwrapRows<Row>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT R.ROWID, R.pipeline_stage, R.assessment_id, J.title AS job_title
       FROM Results R
       JOIN Jobs J ON J.ROWID = R.assessment_id
       WHERE R.candidate_id = '${escapeSql(cand.ROWID)}'
         AND R.pipeline_stage NOT IN ('hired','offer_declined','withdrew','auto_rejected_low_score','rejected_by_admin')
       ORDER BY R.CREATEDTIME DESC LIMIT 1`,
    )) as unknown[],
    'Results',
  );
  const app = apps[0];
  if (!app) {
    sendJson(ctx.res, 200, successMsg);
    return;
  }

  // Mapear stage actual → próxima fase a continuar
  const PHASE_MAP: Record<string, string> = {
    prefilter_pending: 'prescreening',
    prefilter_passed: 'tecnica',
    tecnica_completed: 'disc',
    conductual_completed: 'integridad',
    integridad_completed: 'videos',
    videos_pending: 'videos',
  };
  const phase = PHASE_MAP[app.pipeline_stage] ?? 'prescreening';

  // Token + URL
  const token = signToken({
    kind: 'test',
    ref: app.ROWID,
    exp: expiresIn(2 * WEEK_SEC),
  });
  const base = env().APP_BASE_URL.replace(/\/$/, '');
  const testUrl = `${base}/app/#/test/${token}/${phase}`;

  // Encolar email
  try {
    await publishOutboxEvent(ctx.req, 'email.send_pending', {
      to: email,
      template: 'recovery_link',
      locale: 'es',
      job_id: app.assessment_id,
      vars: {
        candidate_name: (cand.name ?? '').trim() || 'candidato',
        job_title: app.job_title,
        test_url: testUrl,
      },
    });
    log.info('recovery link sent', { applicationId: app.ROWID, phase, email_masked: email.slice(0, 2) + '***' });
  } catch (err) {
    log.warn('recovery enqueue failed', { error: (err as Error).message });
  }

  sendJson(ctx.res, 200, successMsg);
}
