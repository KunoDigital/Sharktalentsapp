/**
 * Marketing funnel — endpoints públicos consumidos por la landing externa.
 *
 * Status: skeleton listo para cuando llegue la landing (ver
 * docs/master-plan/24_MARKETING_FUNNEL_TECH_BRIEF.md).
 *
 * Endpoints:
 *   POST   /api/marketing/lead              → captura lead del quiz + calculadora
 *   POST   /api/marketing/eval-request      → lead pide eval gratuita de un miembro
 *   GET    /api/marketing/lead-status       → query status por email
 *   POST   /api/marketing/lead/request-deletion → step 1 de GDPR delete
 *   DELETE /api/marketing/lead              → step 2 con token
 *
 * Auth: estos endpoints son PÚBLICOS (sin Clerk). Protegidos con:
 *   - X-Marketing-Site-Key header (no es secret, es discriminator de origen)
 *   - Rate limit fuerte por IP
 *   - Captcha Cloudflare Turnstile en eval-request
 *   - Honeypot fields
 *
 * Tablas (Block 5 pendientes):
 *   - MarketingLeads (email, contact_name, company, whatsapp, quiz_data, calculator_data,
 *                     score_quality, urgency, salary_target, source, utm_*, status,
 *                     eval_result_id, zoho_crm_lead_id, created_at, updated_at)
 *
 * Si la tabla no existe, todos los endpoints devuelven 503 (no graceful empty — esto es
 * captura de leads, perder data sería peor que devolver error explícito).
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { ValidationError, AppError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { publishOutboxEvent, publishAndProcessEvent } from './outbox';
import { verifyTurnstileToken, isDevBypass } from '../lib/turnstile';
import { createHash, randomBytes } from 'crypto';

const log = logger('MARKETING');
const TABLE_LEADS = 'MarketingLeads';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_PUESTO_TIPOS = ['gerencia_mando_medio', 'ventas', 'operaciones', 'tecnico'];
const VALID_PROCESO_ACTUAL = ['intuicion', 'cv_referencias', 'evaluaciones_propias', 'sin_proceso'];
const VALID_HISTORIAL_ERROR = ['si_reinicio', 'si_continuamos', 'no', 'no_responde'];
const VALID_URGENCIA = ['less_30d', '1-3m', '3m+', 'exploring'];
const VALID_LEAD_STATUSES = ['new', 'eval_requested', 'eval_completed', 'call_booked', 'won', 'lost'];

let tableReady: boolean | null = null;

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE_LEADS} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

export function _resetTableReadyForTests() {
  tableReady = null;
}

/**
 * Verifica el X-Marketing-Site-Key header.
 *
 * Esta key es PÚBLICA (vive en el bundle de la landing). Sirve para que el backend
 * identifique requests legítimos del funnel vs scripts random pegándole al endpoint.
 * Si se filtra → rotás la key y redeployás landing.
 *
 * Si MARKETING_SITE_KEY no está seteada en env, devolvemos error claro (mejor explicit
 * que silently accept all requests).
 */
function verifySiteKey(ctx: RequestContext): void {
  const expected = env().MARKETING_SITE_KEY;
  if (!expected) {
    throw new ValidationError('MARKETING_SITE_KEY not configured on backend');
  }
  const provided = ctx.req.headers['x-marketing-site-key'];
  if (typeof provided !== 'string' || provided !== expected) {
    throw new ValidationError('invalid or missing X-Marketing-Site-Key');
  }
}

function validateQuizData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('quiz_data required');
  const q = raw as Record<string, unknown>;
  if (typeof q.puesto_tipo !== 'string' || !VALID_PUESTO_TIPOS.includes(q.puesto_tipo)) {
    throw new ValidationError(`puesto_tipo must be one of ${VALID_PUESTO_TIPOS.join(', ')}`);
  }
  if (typeof q.proceso_actual !== 'string' || !VALID_PROCESO_ACTUAL.includes(q.proceso_actual)) {
    throw new ValidationError(`proceso_actual must be one of ${VALID_PROCESO_ACTUAL.join(', ')}`);
  }
  if (typeof q.historial_error !== 'string' || !VALID_HISTORIAL_ERROR.includes(q.historial_error)) {
    throw new ValidationError(`historial_error must be one of ${VALID_HISTORIAL_ERROR.join(', ')}`);
  }
  if (typeof q.urgencia !== 'string' || !VALID_URGENCIA.includes(q.urgencia)) {
    throw new ValidationError(`urgencia must be one of ${VALID_URGENCIA.join(', ')}`);
  }
  const salary = Number(q.salario_target);
  if (!Number.isFinite(salary) || salary < 100 || salary > 50000) {
    throw new ValidationError('salario_target must be 100..50000');
  }
  return { ...q, salario_target: Math.round(salary) };
}

/**
 * Score de calidad del lead derivado del quiz (0-100).
 *
 * Heurística simple — más alto = más probable conversión. Cris la afina con el tiempo
 * según qué leads cierran realmente.
 */
export function computeLeadScore(quiz: Record<string, unknown>): number {
  let score = 30; // baseline
  // Urgencia
  if (quiz.urgencia === 'less_30d') score += 30;
  else if (quiz.urgencia === '1-3m') score += 20;
  else if (quiz.urgencia === '3m+') score += 5;
  // Tuvo mala contratación → conoce el dolor
  if (quiz.historial_error === 'si_reinicio') score += 25;
  else if (quiz.historial_error === 'si_continuamos') score += 15;
  // Proceso actual débil → más probable comprar
  if (quiz.proceso_actual === 'intuicion' || quiz.proceso_actual === 'sin_proceso') score += 15;
  // Salary target alto → puesto importante
  const salary = Number(quiz.salario_target);
  if (salary >= 3000) score += 10;
  else if (salary >= 1500) score += 5;
  return Math.min(100, Math.max(0, score));
}

// ===== POST /api/marketing/lead =====

export async function captureLead(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, {
      error: { code: 'table_not_ready', message: 'MarketingLeads table not yet provisioned' },
    });
    return;
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  // Honeypot: si trae "website" con valor, es bot. Devolver 200 silencioso (no insertar).
  if (typeof body.website === 'string' && body.website.length > 0) {
    log.warn('honeypot triggered', { ip: ctx.req.headers['x-forwarded-for'] });
    sendJson(ctx.res, 200, { lead_id: 'lead_honeypot', message: 'ok' });
    return;
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_REGEX.test(email)) throw new ValidationError('email inválido');
  if (body.consent_marketing !== true) throw new ValidationError('consent_marketing must be true');

  const quizData = validateQuizData(body.quiz_data);
  const score = computeLeadScore(quizData);

  // Upsert por email
  const existing = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  // Headers de attribution (landing los manda en cada request)
  const visitId = typeof ctx.req.headers['x-visit-id'] === 'string' ? ctx.req.headers['x-visit-id'].slice(0, 64) : null;
  const metaEventId = typeof ctx.req.headers['x-meta-event-id'] === 'string' ? ctx.req.headers['x-meta-event-id'].slice(0, 64) : null;

  const payload = {
    email,
    contact_name: typeof body.contact_name === 'string' ? body.contact_name.trim().slice(0, 255) : null,
    company: typeof body.company === 'string' ? body.company.trim().slice(0, 255) : null,
    whatsapp: typeof body.whatsapp === 'string' ? body.whatsapp.trim().slice(0, 50) : null,
    quiz_data: stringifyAndTruncate(quizData, FIELD_LIMITS.QUIZ_DATA, 'MarketingLeads.quiz_data'),
    calculator_data: typeof body.calculator_data === 'object' && body.calculator_data
      ? stringifyAndTruncate(body.calculator_data, FIELD_LIMITS.CALCULATOR_DATA, 'MarketingLeads.calculator_data') : null,
    score_quality: score,
    urgency: quizData.urgencia,
    salary_target: quizData.salario_target,
    source: typeof body.source === 'string' ? body.source.slice(0, 50) : 'unknown',
    utm_source: typeof body.utm_source === 'string' ? body.utm_source.slice(0, 255) : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium.slice(0, 255) : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign.slice(0, 255) : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content.slice(0, 255) : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term.slice(0, 255) : null,
    visit_id: visitId,
    meta_event_id: metaEventId,
  };

  let leadId: string;
  let isNewLead: boolean;
  let existingResultId: string | null = null;
  let existingStatus: string | null = null;
  if (existing) {
    // Releer status + eval_result_id para decidir si reenviar email
    const existingFull = unwrapRows<{ ROWID: string; status: string; eval_result_id: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, status, eval_result_id FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(existing.ROWID)}' LIMIT 1`,
      )) as unknown[],
      TABLE_LEADS,
    )[0];
    existingResultId = existingFull?.eval_result_id ?? null;
    existingStatus = existingFull?.status ?? null;

    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: existing.ROWID,
      ...payload,
      updated_at: now(),
    });
    leadId = existing.ROWID;
    isNewLead = false;
    log.info('lead updated', { traceId: ctx.traceId, leadId, email_masked: email.slice(0, 2) + '***', score, existingStatus });
  } else {
    const inserted = await datastore(ctx.req).table(TABLE_LEADS).insertRow({
      ...payload,
      status: 'new',
      eval_result_id: null,
      zoho_crm_lead_id: null,
      created_at: now(),
      updated_at: now(),
    });
    const row = unwrapRow<{ ROWID: string }>(inserted, TABLE_LEADS);
    leadId = row?.ROWID ?? '';
    isNewLead = true;
    log.info('lead captured', { traceId: ctx.traceId, leadId, email_masked: email.slice(0, 2) + '***', score });
  }

  // Si el lead ya completó la evaluación previa, no reenviar links (ya recibió reporte)
  if (existingStatus === 'eval_completed' || existingStatus === 'won' || existingStatus === 'lost') {
    sendJson(ctx.res, 200, {
      lead_id: leadId,
      message: 'Lead actualizado (ya tenía evaluación completa)',
      next_action: 'noop',
    });
    return;
  }

  // Crear Result + Candidate placeholder + generar 2 links firmados.
  // Si el lead ya tenía un Result (re-submit del form), reusar el mismo para no
  // crear duplicados — los tokens generados a partir de ese resultId siguen vigentes.
  let resultId: string;
  if (existingResultId) {
    resultId = existingResultId;
    log.info('reusing existing demo result', { traceId: ctx.traceId, leadId, resultId });
  } else {
    const { jobId } = await ensureMarketingDemoSetup(ctx.req);

    // Candidate placeholder con datos del lead. Upsert por email — si ya existe,
    // reusa. Cuando la persona abra el link del demo-test y se registre, el
    // endpoint registerDemoTest hace upsert del Candidate (si registra con
    // otro email — caso "cliente reenvió a colaborador" — crea uno nuevo y
    // reasigna el Result).
    const placeholderName = payload.contact_name?.trim() || email.split('@')[0];
    const existingCand = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    )[0];
    let candidateId: string;
    if (existingCand) {
      candidateId = existingCand.ROWID;
    } else {
      const insertedCand = await datastore(ctx.req).table('Candidates').insertRow({
        name: placeholderName,
        email,
        created_at: now(),
      });
      candidateId = unwrapRow<{ ROWID: string }>(insertedCand, 'Candidates')?.ROWID ?? '';
    }

    // pipeline_stage='tecnica_completed' es el punto de partida del demo — saltea
    // la técnica (no aplica al demo) y permite transición a conductual o integridad
    // según qué link se complete primero.
    const insertedResult = await datastore(ctx.req).table('Results').insertRow({
      assessment_id: jobId,
      candidate_id: candidateId,
      pipeline_stage: 'tecnica_completed',
      started_at: now(),
      idempotency_key: `demo_lead_${leadId}`,
    });
    resultId = unwrapRow<{ ROWID: string }>(insertedResult, 'Results')?.ROWID ?? '';

    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      eval_result_id: resultId,
      status: 'eval_requested',
      updated_at: now(),
    });
  }

  const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
  const exp30d = expiresIn(30 * DAY_SEC);
  const conductualToken = signToken({ kind: 'demo_conductual', ref: resultId, exp: exp30d });
  const integridadToken = signToken({ kind: 'demo_integridad', ref: resultId, exp: exp30d });
  const baseUrl = env().APP_BASE_URL.replace(/\/$/, '');
  const conductualUrl = `${baseUrl}/app/index.html#/demo-test/conductual/${conductualToken}`;
  const integridadUrl = `${baseUrl}/app/index.html#/demo-test/integridad/${integridadToken}`;

  // Outbox: enquear lead.captured event para sync con Zoho CRM (solo nuevo lead)
  if (isNewLead) {
    void publishOutboxEvent(ctx.req, 'lead.captured', {
      lead_id: leadId,
      email,
      contact_name: payload.contact_name,
      company: payload.company,
      score_quality: score,
      urgency: quizData.urgencia,
    });
  }

  // Email thank-you al lead con los 2 links de prueba — sincrónico, siempre se manda
  // (también cuando es re-submit del form, porque la persona puede haber perdido el email)
  const emailResult = await publishAndProcessEvent(ctx.req, 'email.send_pending', {
    to: email,
    template: 'marketing_lead_thanks',
    locale: 'es',
    vars: {
      contact_name_prefix: payload.contact_name ? ` ${payload.contact_name.split(/\s+/)[0]}` : '',
      conductual_url: conductualUrl,
      integridad_url: integridadUrl,
    },
  });
  log.info('lead email send result', {
    traceId: ctx.traceId,
    leadId,
    ok: emailResult.ok,
    error: emailResult.error,
  });

  sendJson(ctx.res, isNewLead ? 201 : 200, {
    lead_id: leadId,
    message: isNewLead ? 'Lead capturado correctamente' : 'Lead actualizado + email reenviado',
    next_action: 'check_email',
    // URLs incluidas para testing E2E + uso programático (la landing puede mostrarlas en pantalla
    // como respaldo si el email se rebota).
    conductual_url: conductualUrl,
    integridad_url: integridadUrl,
  });
}

// ===== POST /api/marketing/eval-request =====

export async function requestEval(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads table not ready' } });
    return;
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  // Cloudflare Turnstile anti-bot — verificar ANTES de cualquier procesamiento
  const captchaToken = typeof body.captcha_token === 'string' ? body.captcha_token : '';
  if (!captchaToken) {
    sendJson(ctx.res, 403, { error: { code: 'invalid_captcha', message: 'captcha_token required' } });
    return;
  }
  if (!isDevBypass(captchaToken)) {
    const userIP = (ctx.req.headers['cf-connecting-ip'] as string | undefined)
      ?? (ctx.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const turnstileResult = await verifyTurnstileToken(captchaToken, userIP);
    if (!turnstileResult.ok) {
      log.warn('turnstile failed', { reason: turnstileResult.reason, codes: turnstileResult.errorCodes });
      sendJson(ctx.res, 403, {
        error: {
          code: 'invalid_captcha',
          message: 'No pasaste el challenge anti-bot. Recargá la página e intentá de nuevo.',
        },
      });
      return;
    }
  }

  const leadEmail = typeof body.lead_email === 'string' ? body.lead_email.trim().toLowerCase() : '';
  if (!leadEmail || !EMAIL_REGEX.test(leadEmail)) throw new ValidationError('lead_email inválido');

  const member = body.member_to_evaluate as Record<string, unknown> | undefined;
  if (!member || typeof member !== 'object') throw new ValidationError('member_to_evaluate required');
  const memberName = typeof member.full_name === 'string' ? member.full_name.trim() : '';
  const memberEmail = typeof member.email === 'string' ? member.email.trim().toLowerCase() : '';
  if (!memberName) throw new ValidationError('member_to_evaluate.full_name required');
  if (!memberEmail || !EMAIL_REGEX.test(memberEmail)) throw new ValidationError('member_to_evaluate.email inválido');
  if (memberEmail === leadEmail) throw new ValidationError('member email must differ from lead email');
  if (member.consent_obtained !== true) throw new ValidationError('consent_obtained must be true');

  // Verificar que el lead exista (lead debió hacer POST /lead primero)
  const lead = unwrapRows<{ ROWID: string; status: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, status FROM ${TABLE_LEADS} WHERE email = '${escapeSql(leadEmail)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) {
    sendJson(ctx.res, 404, { error: { code: 'lead_not_found', message: 'Llamá POST /api/marketing/lead primero' } });
    return;
  }

  // Auto-bootstrap tenant interno + Job demo (lazy create — solo una vez)
  const { jobId } = await ensureMarketingDemoSetup(ctx.req);

  // Buscar o crear Candidate por email (en el tenant interno)
  const existingCandidate = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(memberEmail)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];

  let candidateId: string;
  if (existingCandidate) {
    candidateId = existingCandidate.ROWID;
  } else {
    const insertedCand = await datastore(ctx.req).table('Candidates').insertRow({
      name: memberName,
      email: memberEmail,
      created_at: now(),
    });
    candidateId = unwrapRow<{ ROWID: string }>(insertedCand, 'Candidates')?.ROWID ?? '';
  }

  // Crear Result (= application) en pipeline_stage='applied' para este job demo
  const idempotencyKey = `demo_${lead.ROWID}_${memberEmail}`;
  let resultId: string;
  const existingResult = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Results WHERE candidate_id = '${escapeSql(candidateId)}' AND assessment_id = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  if (existingResult) {
    resultId = existingResult.ROWID;
  } else {
    const insertedResult = await datastore(ctx.req).table('Results').insertRow({
      assessment_id: jobId,
      candidate_id: candidateId,
      pipeline_stage: 'applied',
      started_at: now(),
      idempotency_key: idempotencyKey,
    });
    resultId = unwrapRow<{ ROWID: string }>(insertedResult, 'Results')?.ROWID ?? '';
  }

  // Firmar token de test (7 días)
  const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
  const testToken = signToken({ kind: 'test', ref: resultId, exp: expiresIn(WEEK_SEC) });
  const testUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/app/index.html#/test/${testToken}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Actualizar lead → status='eval_requested' + linkear el result_id
  await datastore(ctx.req).table(TABLE_LEADS).updateRow({
    ROWID: lead.ROWID,
    status: 'eval_requested',
    eval_result_id: resultId,
    updated_at: now(),
  });

  // Email al colaborador con link al test — sincrónico, llega ya
  await publishAndProcessEvent(ctx.req, 'email.send_pending', {
    to: memberEmail,
    template: 'marketing_demo_test_link',
    locale: 'es',
    vars: {
      member_name: memberName,
      lead_name: typeof body.lead_name === 'string' ? body.lead_name : leadEmail,
      lead_company: typeof body.lead_company === 'string' ? body.lead_company : '',
      test_url: testUrl,
      expires_at: expiresAt.toLocaleDateString('es-AR'),
      estimated_minutes: '60',
    },
  });

  log.info('eval request created', {
    traceId: ctx.traceId,
    leadId: lead.ROWID,
    candidateId,
    resultId,
    member_email_masked: memberEmail.slice(0, 2) + '***',
  });

  sendJson(ctx.res, 201, {
    request_id: resultId,
    message: 'Evaluación enviada al colaborador',
    estimated_time_minutes: 20,
    test_expires_at: expiresAt.toISOString(),
  });
}

/**
 * Auto-bootstrap del tenant interno + Job demo de marketing.
 *
 * En la PRIMERA llamada crea:
 *   - Tenant "SharkTalents Marketing" con slug "marketing" y status='active'
 *   - Job "Evaluación Demo" en ese tenant
 *
 * En llamadas siguientes solo busca y devuelve los IDs. Cacheable en memoria (cold-start
 * memo) porque los IDs nunca cambian.
 */
let cachedDemoIds: { tenantId: string; jobId: string } | null = null;

async function ensureMarketingDemoSetup(req: IncomingMessage): Promise<{ tenantId: string; jobId: string }> {
  if (cachedDemoIds) return cachedDemoIds;

  const MARKETING_SLUG = 'sharktalents-marketing';

  // Buscar tenant existente
  let tenantId: string;
  const existingTenant = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID FROM Tenants WHERE slug = '${escapeSql(MARKETING_SLUG)}' LIMIT 1`,
    )) as unknown[],
    'Tenants',
  )[0];

  if (existingTenant) {
    tenantId = existingTenant.ROWID;
  } else {
    log.info('bootstrapping marketing tenant (first eval-request)');
    const insertedTenant = await datastore(req).table('Tenants').insertRow({
      clerk_org_id: 'internal_marketing',
      name: 'SharkTalents Marketing',
      slug: MARKETING_SLUG,
      plan: 'internal',
      status: 'active',
      max_active_jobs: 1,
      max_candidates_per_month: 10_000,
      features_enabled: stringifyAndTruncate({ is_internal: true }, 2000, 'Tenants.features_enabled'),
      branding_config: null,
      billing_email: null,
      created_at: now(),
      updated_at: now(),
    });
    tenantId = unwrapRow<{ ROWID: string }>(insertedTenant, 'Tenants')?.ROWID ?? '';
    if (!tenantId) throw new AppError(500, 'tenant_bootstrap_failed', 'No se pudo bootstrap el tenant interno');
  }

  // Buscar Job demo
  let jobId: string;
  const existingJob = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' AND title = 'Evaluación Demo' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];

  if (existingJob) {
    jobId = existingJob.ROWID;
  } else {
    log.info('bootstrapping demo job in marketing tenant');
    const insertedJob = await datastore(req).table('Jobs').insertRow({
      tenant_id: tenantId,
      title: 'Evaluación Demo',
      company: 'SharkTalents',
      tech_prompt: null,
      cognitive_level: 'mid',
      is_active: true,
      company_context: 'Evaluación gratuita de talento — DISC + capacidad cognitiva + integridad (sin técnica ni video).',
      ideal_profile: null,
      tech_questions_cache: null,
      created_by: 'system',
      created_at: now(),
      updated_at: now(),
    });
    jobId = unwrapRow<{ ROWID: string }>(insertedJob, 'Jobs')?.ROWID ?? '';
    if (!jobId) throw new AppError(500, 'job_bootstrap_failed', 'No se pudo bootstrap el job demo');
  }

  cachedDemoIds = { tenantId, jobId };
  return cachedDemoIds;
}

// ===== GET /api/marketing/lead-status?email=... =====

export async function getLeadStatus(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { exists: false });
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    sendJson(ctx.res, 200, { exists: false });
    return;
  }

  type LeadStatusRow = {
    ROWID: string;
    status: string;
    eval_result_id: string | null;
    eval_completed_at?: string | null;
    demo_report_url?: string | null;
    call_booking_url?: string | null;
  };
  const lead = unwrapRows<LeadStatusRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, status, eval_result_id, eval_completed_at, demo_report_url, call_booking_url
       FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead) {
    sendJson(ctx.res, 200, { exists: false });
    return;
  }

  sendJson(ctx.res, 200, {
    exists: true,
    lead_status: lead.status,
    eval_completed_at: lead.eval_completed_at ?? undefined,
    demo_report_url: lead.demo_report_url ?? undefined,
    call_booking_url: lead.call_booking_url ?? undefined,
  });
}

// ===== POST /api/marketing/lead/request-deletion =====

/**
 * Step 1 GDPR/Ley 81 Panamá: genera un token de deletion y manda email al lead con el link.
 *
 * Body: { email: string }
 * Side effect: token guardado en MarketingLeads.deletion_token + deletion_token_expires_at,
 *              email enviado via outbox (template `marketing_deletion_request`).
 *
 * SIEMPRE devuelve 200 message genérico (no revelar si el email existe en BD para evitar
 * email enumeration attacks).
 */
export async function requestLeadDeletion(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const body = (await readJsonBody(ctx.req)) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_REGEX.test(email)) {
    sendJson(ctx.res, 200, {
      message: 'Si tu email está en nuestra base, recibirás un email con el link de baja en los próximos minutos.',
    });
    return;
  }

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, {
      message: 'Si tu email está en nuestra base, recibirás un email con el link de baja en los próximos minutos.',
    });
    return;
  }

  const lead = unwrapRows<{ ROWID: string; email: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (lead) {
    // Generar token random + hash para guardar (no guardamos el token raw)
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    try {
      await datastore(ctx.req).table(TABLE_LEADS).updateRow({
        ROWID: lead.ROWID,
        deletion_token_hash: tokenHash,
        deletion_token_expires_at: expiresAt,
        updated_at: now(),
      });

      // Enquear email via outbox (template `marketing_deletion_request`)
      void publishOutboxEvent(ctx.req, 'email.send_pending', {
        to: lead.email,
        template: 'marketing_deletion_request',
        locale: 'es',
        vars: {
          deletion_url: `https://www.sharktalents.ai/unsubscribe?email=${encodeURIComponent(lead.email)}&token=${token}`,
          expires_in_hours: '24',
        },
      });

      log.info('deletion link requested', { traceId: ctx.traceId, email_masked: email.slice(0, 2) + '***' });
    } catch (err) {
      log.warn('deletion request failed (lead exists but persist failed)', {
        traceId: ctx.traceId, error: (err as Error).message,
      });
      // No revelamos el error al cliente — respuesta genérica.
    }
  }

  // Respuesta genérica siempre (no revelar existencia del lead)
  sendJson(ctx.res, 200, {
    message: 'Si tu email está en nuestra base, recibirás un email con el link de baja en los próximos minutos.',
  });
}

// ===== DELETE /api/marketing/lead =====

/**
 * Step 2 GDPR/Ley 81 Panamá: confirma el borrado con el token recibido por email.
 *
 * Body: { email: string, deletion_token: string }
 * Side effect: borra el lead de MarketingLeads.
 *
 * Si el token no matchea o expiró → 403. Genérico para evitar oracles.
 */
export async function confirmLeadDeletion(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads table not ready' } });
    return;
  }

  const body = (await readJsonBody(ctx.req)) as { email?: unknown; deletion_token?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const token = typeof body.deletion_token === 'string' ? body.deletion_token : '';
  if (!email || !EMAIL_REGEX.test(email)) throw new ValidationError('email inválido');
  if (!token || token.length < 32) throw new ValidationError('deletion_token inválido');

  const tokenHash = createHash('sha256').update(token).digest('hex');

  type LeadRow = { ROWID: string; deletion_token_hash: string | null; deletion_token_expires_at: string | null };
  const lead = unwrapRows<LeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, deletion_token_hash, deletion_token_expires_at
       FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead || lead.deletion_token_hash !== tokenHash) {
    throw new AppError(403, 'invalid_deletion_token', 'Token inválido o no asociado a ese email');
  }

  if (lead.deletion_token_expires_at && new Date(lead.deletion_token_expires_at) < new Date()) {
    throw new AppError(403, 'deletion_token_expired', 'El link expiró. Pedí uno nuevo desde la página.');
  }

  // Borrar
  await datastore(ctx.req).table(TABLE_LEADS).deleteRow(lead.ROWID);

  log.info('lead deleted (GDPR)', { traceId: ctx.traceId, email_masked: email.slice(0, 2) + '***' });

  sendJson(ctx.res, 200, {
    message: 'Tus datos fueron eliminados de nuestra base. Quedan respaldos por hasta 30 días por requerimientos legales y luego se borran definitivamente.',
  });
}

// ===== Admin: lista leads del funnel =====

/**
 * GET /api/marketing/leads?status=new&limit=50
 *
 * Auth tenant (no requiere site key, requiere Clerk). Solo admins de SharkTalents
 * Marketing tenant deberían poder verlo, pero por ahora cualquier tenant puede.
 *
 * TODO: cuando exista flag is_internal en Tenants, restringir a tenants is_internal=true.
 */
export async function listMarketingLeads(ctx: RequestContext): Promise<void> {
  // Auth se hace en router (tenant-level). No usamos verifySiteKey acá.
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { leads: [], count: 0, table_ready: false });
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const urgency = url.searchParams.get('urgency');
  const minScore = Number(url.searchParams.get('min_score') ?? 0);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));

  const filters: string[] = [];
  if (status) filters.push(`status = '${escapeSql(status)}'`);
  if (urgency) filters.push(`urgency = '${escapeSql(urgency)}'`);
  if (minScore > 0) filters.push(`score_quality >= ${Math.round(minScore)}`);

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const q = `SELECT ROWID, email, contact_name, company, whatsapp, score_quality, urgency,
              salary_target, source, utm_source, utm_campaign, status, eval_result_id,
              eval_completed_at, demo_report_url, created_at, updated_at
              FROM ${TABLE_LEADS} ${whereClause}
              ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  const rows = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(q)) as unknown[],
    TABLE_LEADS,
  );

  // Stats agregados
  let stats = { total: 0, new: 0, eval_requested: 0, eval_completed: 0, call_booked: 0, won: 0, lost: 0 };
  try {
    const allRows = unwrapRows<{ status: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT status FROM ${TABLE_LEADS} LIMIT 5000`,
      )) as unknown[],
      TABLE_LEADS,
    );
    stats.total = allRows.length;
    for (const r of allRows) {
      if (r.status in stats) {
        (stats as Record<string, number>)[r.status]++;
      }
    }
  } catch {
    // si stats falla, devolvemos solo lo principal
  }

  sendJson(ctx.res, 200, {
    leads: rows,
    count: rows.length,
    stats,
    table_ready: true,
  });
}

// ===== Diagnóstico: estado tabla IntegrityDimensions + Candidate rename =====

export async function testIntegrityDimsInsert(ctx: RequestContext): Promise<void> {
  const debug: Record<string, unknown> = { step: 'start' };
  try {
    const { requireAuth } = await import('../lib/auth.js');
    const { requireTenant } = await import('./tenants.js');
    debug.step = 'requireAuth';
    await requireAuth(ctx);
    debug.step = 'requireTenant';
    await requireTenant(ctx);

    const m = ctx.req.url?.match(/^\/api\/_test_integrity_dims_insert\/([^/]+)\/?$/);
    const resultId = m?.[1];
    if (!resultId) {
      sendJson(ctx.res, 200, { ok: false, error: 'result_id missing in path', debug });
      return;
    }

    debug.step = 'try inserts';
    const attempts: Array<{ payload: Record<string, unknown>; result?: string }> = [
      { payload: { result_id: resultId, dimension: 'test_dim', nivel: 'bajo', pct: 50 } },
      { payload: { result_id: resultId, dimension: 'test_dim', level: 'bajo', pct: 50 } },
      { payload: { result_id: resultId, dimension: 'test_dim', nivel: 'bajo', percentage: 50 } },
      { payload: { result_id: resultId, dimension_name: 'test_dim', nivel: 'bajo', pct: 50 } },
    ];

    for (const a of attempts) {
      try {
        await datastore(ctx.req).table('IntegrityDimensions').insertRow(a.payload as { ROWID?: string });
        a.result = 'SUCCESS';
      } catch (err) {
        a.result = String((err as Error)?.message ?? err).slice(0, 400);
      }
    }

    debug.step = 'cleanup';
    try {
      const testRows = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM IntegrityDimensions WHERE result_id = '${escapeSql(resultId)}' AND (dimension = 'test_dim' OR dimension_name = 'test_dim') LIMIT 10`,
        )) as unknown[],
        'IntegrityDimensions',
      );
      for (const r of testRows) {
        try { await datastore(ctx.req).table('IntegrityDimensions').deleteRow(r.ROWID); } catch {/* ignore */}
      }
    } catch (err) {
      debug.cleanup_error = (err as Error).message;
    }

    sendJson(ctx.res, 200, { ok: true, attempts });
  } catch (err) {
    const e = err as Error;
    sendJson(ctx.res, 200, {
      ok: false,
      debug,
      error_name: e?.name,
      error_message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 6).join(' | '),
    });
  }
}

export async function inspectIntegrityDims(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/_inspect_integrity_dims\/([^/]+)\/?$/);
  const resultId = m?.[1];
  if (!resultId) throw new ValidationError('result_id missing');

  try {
    const rows = unwrapRows<Record<string, unknown>>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, dimension, pct, nivel FROM IntegrityDimensions WHERE result_id = '${escapeSql(resultId)}' LIMIT 50`,
      )) as unknown[],
      'IntegrityDimensions',
    );
    sendJson(ctx.res, 200, { ok: true, table_exists: true, count: rows.length, rows });
  } catch (err) {
    sendJson(ctx.res, 200, { ok: false, table_exists: false, error: (err as Error).message });
  }
}

export async function renameCandidate(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/candidates\/([^/]+)\/rename\/?$/);
  const candidateId = m?.[1];
  if (!candidateId) throw new ValidationError('candidate id missing');

  const body = (await readJsonBody(ctx.req)) as { name?: string };
  if (!body.name || body.name.length < 2) throw new ValidationError('name required (min 2 chars)');

  await datastore(ctx.req).table('Candidates').updateRow({
    ROWID: candidateId,
    name: body.name.trim().slice(0, 255),
  });
  sendJson(ctx.res, 200, { ok: true, candidateId, new_name: body.name });
}

// ===== POST /api/marketing/lead/:id/force-report (re-trigger del report generation) =====

export async function forceGenerateLeadReport(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/force-report\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing');

  const lead = unwrapRows<{ ROWID: string; eval_result_id: string | null; demo_report_url: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, eval_result_id, demo_report_url FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} no encontrado`);
  if (!lead.eval_result_id) {
    sendJson(ctx.res, 200, { ok: false, error: 'Lead has no eval_result_id (demo nunca se envió)' });
    return;
  }

  try {
    await tryCompleteMarketingDemo(ctx, lead.eval_result_id);
    // Re-leer el lead para devolver el URL actualizado
    const updated = unwrapRows<{ status: string; demo_report_url: string | null; eval_completed_at: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT status, demo_report_url, eval_completed_at FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
      )) as unknown[],
      TABLE_LEADS,
    )[0];
    sendJson(ctx.res, 200, { ok: true, lead: updated });
  } catch (err) {
    const e = err as Error;
    sendJson(ctx.res, 200, { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 5).join(' | ') });
  }
}

// ===== GET /api/marketing/lead/:id/demo-status (auth tenant — chequear progreso de pruebas) =====

export async function getLeadDemoStatus(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/demo-status\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing');

  const lead = unwrapRows<{ ROWID: string; status: string; eval_result_id: string | null; demo_report_url: string | null; email: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, status, eval_result_id, demo_report_url, email FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} no encontrado`);
  if (!lead.eval_result_id) {
    sendJson(ctx.res, 200, { lead, scores: null, demo_state: { sent: false, msg: 'Demo no enviada todavía' } });
    return;
  }

  const result = unwrapRows<{ ROWID: string; pipeline_stage: string; started_at: string; completed_at: string | null; candidate_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage, started_at, completed_at, candidate_id FROM Results WHERE ROWID = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  const scores = unwrapRows<{ disc_completed_at: string | null; velna_completed_at: string | null; emo_completed_at: string | null; int_completed_at: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT disc_completed_at, velna_completed_at, emo_completed_at, int_completed_at FROM Scores WHERE result_id = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
    )) as unknown[],
    'Scores',
  )[0];

  const discDone = !!(scores?.disc_completed_at);
  const velnaDone = !!(scores?.velna_completed_at);
  const conductualDone = discDone && velnaDone;
  const integridadDone = !!(scores?.int_completed_at);
  const bothDone = conductualDone && integridadDone;

  sendJson(ctx.res, 200, {
    lead,
    result,
    scores,
    demo_state: {
      conductual_done: conductualDone,
      disc_done: discDone,
      velna_done: velnaDone,
      integridad_done: integridadDone,
      both_done: bothDone,
      report_should_exist: bothDone,
      report_actually_exists: !!lead.demo_report_url,
    },
  });
}

// ===== PATCH /api/marketing/lead/:id (auth tenant — editar email/contacto/etc) =====

export async function patchLead(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads table not ready' } });
    return;
  }

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const patch: Record<string, unknown> = { ROWID: leadId, updated_at: now() };

  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new ValidationError('email inválido');
    patch.email = email;
  }
  if (typeof body.contact_name === 'string') patch.contact_name = body.contact_name.trim().slice(0, 255);
  if (typeof body.company === 'string') patch.company = body.company.trim().slice(0, 255);
  if (typeof body.whatsapp === 'string') patch.whatsapp = body.whatsapp.trim().slice(0, 50);

  if (Object.keys(patch).length <= 2) {
    throw new ValidationError('no fields to update');
  }

  await datastore(ctx.req).table(TABLE_LEADS).updateRow(patch as { ROWID: string });
  log.info('lead patched', { traceId: ctx.traceId, leadId, fields: Object.keys(patch) });
  sendJson(ctx.res, 200, { ok: true, leadId, updated_fields: Object.keys(patch) });
}

// ===== POST /api/marketing/_admin_wipe_leads (auth tenant — borra TODOS los leads) =====

/**
 * Borra todas las filas de MarketingLeads y los Results asociados (eval_result_id).
 * Los Candidates orphan que queden no estorban (se upsertan por email).
 *
 * Para emergencia / cleanup. Auth tenant — requiere Clerk.
 */
export async function adminWipeLeads(ctx: RequestContext): Promise<void> {
  const debug: Record<string, unknown> = { step: 'start' };
  try {
    debug.step = 'requireAuth';
    const { requireAuth } = await import('../lib/auth.js');
    await requireAuth(ctx);
    debug.step = 'requireTenant';
    const { requireTenant } = await import('./tenants.js');
    await requireTenant(ctx);

    debug.step = 'isTableReady';
    if (!(await isTableReady(ctx.req))) {
      sendJson(ctx.res, 200, { deleted_leads: 0, table_ready: false });
      return;
    }

    debug.step = 'select leads';
    const leads = unwrapRows<{ ROWID: string; email: string; eval_result_id: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, email, eval_result_id FROM ${TABLE_LEADS} LIMIT 300`,
      )) as unknown[],
      TABLE_LEADS,
    );
    debug.leads_found = leads.length;

    let leadsDeleted = 0;
    let resultsDeleted = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      if (lead.eval_result_id) {
        try {
          await datastore(ctx.req).table('Results').deleteRow(lead.eval_result_id);
          resultsDeleted++;
        } catch (err) {
          errors.push(`result ${lead.eval_result_id}: ${(err as Error).message}`);
        }
      }
      try {
        await datastore(ctx.req).table(TABLE_LEADS).deleteRow(lead.ROWID);
        leadsDeleted++;
      } catch (err) {
        errors.push(`lead ${lead.ROWID}: ${(err as Error).message}`);
      }
    }

    log.info('admin wipe leads', { traceId: ctx.traceId, leadsDeleted, resultsDeleted, errorsCount: errors.length });

    sendJson(ctx.res, 200, {
      leads_found: leads.length,
      leads_deleted: leadsDeleted,
      results_deleted: resultsDeleted,
      errors,
    });
  } catch (err) {
    const e = err as Error;
    log.error('admin wipe leads failed', { traceId: ctx.traceId, step: debug.step, error: String(e?.message), stack: e?.stack });
    sendJson(ctx.res, 200, {
      ok: false,
      debug,
      err_type: typeof err,
      err_str: String(err),
      err_json: JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})),
      err_name: e?.name ?? 'no-name',
      err_message: e?.message ?? 'no-message',
      stack_preview: e?.stack?.split('\n').slice(0, 5).join(' | ') ?? 'no-stack',
    });
  }
}

// ===== POST /api/marketing/lead-manual (auth tenant — Cris crea lead manual desde admin) =====

/**
 * Crear lead manual desde el admin (cuando llega por WhatsApp/teléfono, no por la landing).
 *
 * Mismo upsert que captureLead pero con campos opcionales y sin quiz_data/calculator_data
 * (Cris no los tiene de un lead llegado por WhatsApp).
 */
export async function createManualLead(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads not ready' } });
    return;
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_REGEX.test(email)) throw new ValidationError('email inválido');

  const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim().slice(0, 255) : null;
  const company = typeof body.company === 'string' ? body.company.trim().slice(0, 255) : null;
  const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim().slice(0, 50) : null;
  const urgency = typeof body.urgency === 'string' && VALID_URGENCIA.includes(body.urgency)
    ? body.urgency : 'exploring';
  const salaryTarget = Number.isFinite(body.salary_target) ? Math.round(Number(body.salary_target)) : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

  // Score básico desde lo que tenemos (sin quiz)
  const score = computeLeadScore({
    urgencia: urgency,
    historial_error: 'no',
    proceso_actual: 'evaluaciones_propias',
    salario_target: salaryTarget ?? 1000,
  });

  // Upsert por email
  const existing = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  const payload = {
    email,
    contact_name: contactName,
    company,
    whatsapp,
    score_quality: score,
    urgency,
    salary_target: salaryTarget,
    source: typeof body.source === 'string' ? body.source.slice(0, 50) : 'manual_whatsapp',
    // quiz_data + calculator_data: notas como JSON simple (manual no tiene quiz real)
    quiz_data: notes ? stringifyAndTruncate({ notes }, FIELD_LIMITS.QUIZ_DATA, 'MarketingLeads.quiz_data') : null,
  };

  let leadId: string;
  if (existing) {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: existing.ROWID, ...payload, updated_at: now(),
    });
    leadId = existing.ROWID;
    log.info('manual lead updated', { traceId: ctx.traceId, leadId, email_masked: email.slice(0, 2) + '***' });
  } else {
    const inserted = await datastore(ctx.req).table(TABLE_LEADS).insertRow({
      ...payload, status: 'new', eval_result_id: null, zoho_crm_lead_id: null,
      created_at: now(), updated_at: now(),
    });
    leadId = unwrapRow<{ ROWID: string }>(inserted, TABLE_LEADS)?.ROWID ?? '';
    log.info('manual lead created', { traceId: ctx.traceId, leadId, email_masked: email.slice(0, 2) + '***' });

    // Sync a CRM (mismo flow que captureLead)
    void publishOutboxEvent(ctx.req, 'lead.captured', {
      lead_id: leadId, email, contact_name: contactName, company,
      score_quality: score, urgency,
    });
  }

  sendJson(ctx.res, existing ? 200 : 201, { lead_id: leadId, action: existing ? 'updated' : 'created' });
}

// ===== POST /api/marketing/lead/:id/send-demo (admin manda demo a un lead) =====

/**
 * Variante admin de eval-request — sin site key, sin captcha.
 * Cris la dispara desde el detail del lead en Settings → Leads.
 */
export async function sendDemoToLead(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads not ready' } });
    return;
  }

  const match = (ctx.req.url ?? '').match(/^\/api\/marketing\/lead\/([^/]+)\/send-demo\/?$/);
  const leadId = match?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  type LeadRow = { ROWID: string; email: string; contact_name: string | null; company: string | null };
  const lead = unwrapRows<LeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, company FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new ValidationError(`Lead ${leadId} no encontrado`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const member = body.member_to_evaluate as Record<string, unknown> | undefined;
  if (!member || typeof member !== 'object') throw new ValidationError('member_to_evaluate required');
  const memberName = typeof member.full_name === 'string' ? member.full_name.trim() : '';
  const memberEmail = typeof member.email === 'string' ? member.email.trim().toLowerCase() : '';
  if (!memberName) throw new ValidationError('member_to_evaluate.full_name required');
  if (!memberEmail || !EMAIL_REGEX.test(memberEmail)) throw new ValidationError('member_to_evaluate.email inválido');

  const { jobId } = await ensureMarketingDemoSetup(ctx.req);

  // Buscar o crear Candidate
  const existingCandidate = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(memberEmail)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];
  const candidateId = existingCandidate
    ? existingCandidate.ROWID
    : unwrapRow<{ ROWID: string }>(
        await datastore(ctx.req).table('Candidates').insertRow({
          name: memberName, email: memberEmail, created_at: now(),
        }),
        'Candidates',
      )?.ROWID ?? '';

  // Crear Result
  const existingResult = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Results WHERE candidate_id = '${escapeSql(candidateId)}' AND assessment_id = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];
  const resultId = existingResult
    ? existingResult.ROWID
    : unwrapRow<{ ROWID: string }>(
        await datastore(ctx.req).table('Results').insertRow({
          assessment_id: jobId,
          candidate_id: candidateId,
          pipeline_stage: 'applied',
          started_at: now(),
          idempotency_key: `demo_${lead.ROWID}_${memberEmail}`,
        }),
        'Results',
      )?.ROWID ?? '';

  // Firmar 2 tokens — uno para conductual (DISC + cognitiva) y otro para integridad.
  // Esto matchea el flow del landing público (captureLead), que sí está wireado al backend real.
  // Los tokens duran 30 días.
  const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
  const exp30d = expiresIn(30 * DAY_SEC);
  const conductualToken = signToken({ kind: 'demo_conductual', ref: resultId, exp: exp30d });
  const integridadToken = signToken({ kind: 'demo_integridad', ref: resultId, exp: exp30d });
  const baseUrl = env().APP_BASE_URL.replace(/\/$/, '');
  const conductualUrl = `${baseUrl}/app/index.html#/demo-test/conductual/${conductualToken}`;
  const integridadUrl = `${baseUrl}/app/index.html#/demo-test/integridad/${integridadToken}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Update lead
  await datastore(ctx.req).table(TABLE_LEADS).updateRow({
    ROWID: lead.ROWID,
    status: 'eval_requested',
    eval_result_id: resultId,
    updated_at: now(),
  });

  // Email al destinatario con las 2 URLs (template del landing flow, igual que captureLead)
  await publishAndProcessEvent(ctx.req, 'email.send_pending', {
    to: memberEmail,
    template: 'marketing_lead_thanks',
    locale: 'es',
    vars: {
      contact_name_prefix: memberName ? ` ${memberName.split(/\s+/)[0]}` : '',
      lead_name: lead.contact_name ?? lead.email,
      lead_company: lead.company ?? '',
      conductual_url: conductualUrl,
      integridad_url: integridadUrl,
      expires_at: expiresAt.toLocaleDateString('es-AR'),
    },
  });

  log.info('demo sent from admin', {
    traceId: ctx.traceId, leadId, candidateId, resultId,
    member_email_masked: memberEmail.slice(0, 2) + '***',
  });

  sendJson(ctx.res, 201, {
    request_id: resultId,
    message: `Demo enviada a ${memberEmail}`,
    test_expires_at: expiresAt.toISOString(),
    conductual_url: conductualUrl,
    integridad_url: integridadUrl,
  });
}

// ===== GET /api/marketing/lead/:id/contract-context =====
// Devuelve los valores inferidos (puesto, salario, ruc) que el frontend debe pre-llenar
// en el modal de "Enviar contrato". Mira el lead + el último draft asociado al email.

async function resolveContractContext(
  req: RequestContext['req'],
  lead: { email: string; salary_target: number | null; whatsapp: string | null },
  traceId = '',
): Promise<{
  puesto_nombre: string | null;
  puesto_salario_usd: number | null;
  client_phone: string | null;
  client_ruc_nit_ein: string | null;
  client_address: string | null;
  source: 'draft' | 'lead' | 'crm' | 'draft+crm' | 'none';
  draft_id: string | null;
  crm_lead_id: string | null;
}> {
  let puesto_nombre: string | null = null;
  let salary_from_draft: number | null = null;
  let draft_id: string | null = null;

  // 1) Buscar el último draft asociado al email del lead (datos del puesto)
  try {
    const draftRows = unwrapRows<{ ROWID: string; draft_payload: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, draft_payload FROM JobProfileDrafts
         WHERE client_email = '${escapeSql(lead.email)}'
         ORDER BY CREATEDTIME DESC LIMIT 1`,
      )) as unknown[],
      'JobProfileDrafts',
    );
    const draftRow = draftRows[0];

    if (draftRow) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(draftRow.draft_payload); } catch { /* ignore */ }

      puesto_nombre = typeof payload.title === 'string' ? payload.title : null;
      const salaryRange = payload.salary_range_usd as { min?: number; max?: number } | undefined;
      salary_from_draft = salaryRange?.max ?? salaryRange?.min ?? null;
      draft_id = draftRow.ROWID;
    }
  } catch { /* draft table may not exist, fallthrough */ }

  // 2) Buscar en Zoho CRM (RUC + dirección + teléfono — datos del cliente que no viven en SharkTalents)
  let crm_lead_id: string | null = null;
  let client_ruc_nit_ein: string | null = null;
  let client_address: string | null = null;
  let client_phone_from_crm: string | null = null;
  try {
    const { findLeadInCrmByEmail } = await import('../lib/zohoCrmClient.js');
    const crmResult = await findLeadInCrmByEmail(lead.email, traceId);
    if (crmResult.ok && crmResult.data) {
      const crmLead = crmResult.data;
      crm_lead_id = typeof crmLead.id === 'string' ? crmLead.id : null;

      // Campos comunes de Zoho CRM Leads. Custom fields varían por tenant — el frontend
      // los ve igual aunque sean null.
      const rucCandidates = ['RUC', 'NIT', 'EIN', 'Tax_ID', 'Tax_Id', 'TAX_ID', 'RUC_NIT_EIN', 'CIF', 'CUIT'];
      for (const key of rucCandidates) {
        if (typeof crmLead[key] === 'string' && (crmLead[key] as string).trim()) {
          client_ruc_nit_ein = (crmLead[key] as string).trim();
          break;
        }
      }

      // Address: Zoho CRM tiene Street + City + State + Country + Zip_Code. Concatenamos.
      const street = typeof crmLead.Street === 'string' ? crmLead.Street.trim() : '';
      const city = typeof crmLead.City === 'string' ? crmLead.City.trim() : '';
      const state = typeof crmLead.State === 'string' ? crmLead.State.trim() : '';
      const country = typeof crmLead.Country === 'string' ? crmLead.Country.trim() : '';
      const zip = typeof crmLead.Zip_Code === 'string' ? crmLead.Zip_Code.trim() : '';
      const addressParts = [street, city, state, zip, country].filter(Boolean);
      if (addressParts.length > 0) {
        client_address = addressParts.join(', ');
      }

      // Phone (Mobile o Phone)
      const mobile = typeof crmLead.Mobile === 'string' ? crmLead.Mobile.trim() : '';
      const phone = typeof crmLead.Phone === 'string' ? crmLead.Phone.trim() : '';
      client_phone_from_crm = mobile || phone || null;
    }
  } catch { /* CRM offline / not configured — fallthrough con valores null */ }

  // Determinar source
  let source: 'draft' | 'lead' | 'crm' | 'draft+crm' | 'none' = 'none';
  if (draft_id && (crm_lead_id || client_address || client_ruc_nit_ein)) source = 'draft+crm';
  else if (draft_id) source = 'draft';
  else if (crm_lead_id || client_address || client_ruc_nit_ein) source = 'crm';
  else if (lead.salary_target) source = 'lead';

  return {
    puesto_nombre,
    puesto_salario_usd: salary_from_draft ?? lead.salary_target,
    client_phone: client_phone_from_crm ?? lead.whatsapp,
    client_ruc_nit_ein,
    client_address,
    source,
    draft_id,
    crm_lead_id,
  };
}

export async function getContractContext(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/contract-context\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing');

  const lead = unwrapRows<{ ROWID: string; email: string; salary_target: number | null; whatsapp: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, salary_target, whatsapp FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} no encontrado`);

  const ctx_ = await resolveContractContext(ctx.req, lead, ctx.traceId);
  sendJson(ctx.res, 200, ctx_);
}

// ===== POST /api/marketing/lead/:id/send-contract (mandar contrato firmable al cliente vía Zoho Sign) =====

/**
 * Manda el contrato standard de SharkTalents al cliente para firma electrónica.
 *
 * Pre-requisito: template del contrato cargado en Zoho Sign Console + env var
 * `ZOHO_SIGN_CONTRACT_TEMPLATE_ID` seteada.
 *
 * Body opcional (sino se toma del lead):
 *   { puesto_nombre, puesto_salario_usd, plazo_min_dias?, plazo_max_dias?,
 *     client_ruc_nit_ein?, client_address?, client_phone? }
 *
 * Si el lead no tiene contact_name/company → 400.
 * Si Sign no está configurado → 503 con mensaje claro.
 */
export async function sendContractToLead(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads not ready' } });
    return;
  }

  const match = (ctx.req.url ?? '').match(/^\/api\/marketing\/lead\/([^/]+)\/send-contract\/?$/);
  const leadId = match?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  type LeadRow = {
    ROWID: string;
    email: string;
    contact_name: string | null;
    company: string | null;
    whatsapp: string | null;
    salary_target: number | null;
  };
  const lead = unwrapRows<LeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, company, whatsapp, salary_target FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new ValidationError(`Lead ${leadId} no encontrado`);
  if (!lead.contact_name || !lead.company) {
    throw new ValidationError('Lead requiere contact_name + company para mandar contrato. Completalos primero (botón Editar en el lead).');
  }

  const body = (await readJsonBody(ctx.req).catch(() => ({}))) as Record<string, unknown>;

  // Resolver puesto + salario desde el draft asociado al email del lead si el caller no los pasó.
  // Esto evita que Cris tenga que llenar manualmente datos que ya existen en el draft.
  const resolved = await resolveContractContext(ctx.req, lead, ctx.traceId);
  const puestoNombre = typeof body.puesto_nombre === 'string' && body.puesto_nombre.trim().length > 0
    ? body.puesto_nombre
    : (resolved.puesto_nombre ?? 'Puesto por definir');
  const puestoSalario = typeof body.puesto_salario_usd === 'number' && body.puesto_salario_usd > 0
    ? body.puesto_salario_usd
    : (resolved.puesto_salario_usd ?? 0);
  if (!puestoSalario || puestoSalario <= 0) {
    throw new ValidationError('puesto_salario_usd requerido (>0) — la app no puede calcular el fee sin esto. No se encontró draft asociado al lead con salary_range definido.');
  }

  const { sendContract } = await import('../lib/zohoSignClient.js');
  const result = await sendContract({
    client_email: lead.email,
    client_name: lead.contact_name,
    client_company: lead.company,
    client_ruc_nit_ein: typeof body.client_ruc_nit_ein === 'string' ? body.client_ruc_nit_ein : undefined,
    client_address: typeof body.client_address === 'string' ? body.client_address : undefined,
    client_phone: typeof body.client_phone === 'string' ? body.client_phone : lead.whatsapp ?? undefined,
    puesto_nombre: puestoNombre,
    puesto_salario_usd: puestoSalario,
    plazo_min_dias: typeof body.plazo_min_dias === 'number' ? body.plazo_min_dias : 14,
    plazo_max_dias: typeof body.plazo_max_dias === 'number' ? body.plazo_max_dias : 30,
  }, ctx.traceId);

  if (!result.ok) {
    if (result.error.includes('not configured') || result.error.includes('TEMPLATE_ID')) {
      sendJson(ctx.res, 503, {
        error: {
          code: 'sign_not_configured',
          message: `Zoho Sign no está configurado todavía. Falta env var ZOHO_SIGN_CONTRACT_TEMPLATE_ID. Ver docs/contracts/zoho_sign_setup_guide.md.`,
        },
      });
      return;
    }
    sendJson(ctx.res, 502, { error: { code: 'sign_send_failed', message: result.error } });
    return;
  }

  log.info('contract sent via Sign', {
    traceId: ctx.traceId,
    leadId,
    sign_request_id: result.data.request_id,
    email_masked: lead.email.slice(0, 2) + '***',
  });

  sendJson(ctx.res, 201, {
    sign_request_id: result.data.request_id,
    signing_url: result.data.signing_url,
    message: `Contrato enviado a ${lead.email}. Cuando firme, el sistema crea el Tenant + Job automáticamente.`,
  });
}

// ===== POST /api/marketing/lead/:id/convert-to-tenant (cliente firmó, crear Tenant + portal) =====

/**
 * Convertir un lead → Tenant en SharkTalents.
 *
 * Disparado por Cris cuando el cliente firma el contrato (manual por ahora; cuando Sign
 * esté integrado, el webhook de Sign disparará esto automático).
 *
 * Crea: Tenant (con clerk_org_id placeholder hasta que Cris cree la org en Clerk),
 *       Portal token + email al cliente. NO crea Job todavía — Cris elige si convertir
 *       un draft existente o crea Job vacío.
 */
export async function convertLeadToTenant(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready', message: 'MarketingLeads not ready' } });
    return;
  }

  const match = (ctx.req.url ?? '').match(/^\/api\/marketing\/lead\/([^/]+)\/convert-to-tenant\/?$/);
  const leadId = match?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  type LeadFull = { ROWID: string; email: string; contact_name: string | null; company: string | null; status: string };
  const lead = unwrapRows<LeadFull>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, company, status FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new ValidationError(`Lead ${leadId} no encontrado`);
  if (!lead.email || !lead.company) {
    throw new ValidationError('Lead necesita email + company para convertir a Tenant');
  }

  // Slug del Tenant desde el nombre de la empresa
  const slug = lead.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

  // Crear Tenant. clerk_org_id placeholder — Cris la creará en Clerk y la conectará después.
  const tenantInsert = {
    clerk_org_id: `pending_${leadId}`,
    name: lead.company,
    slug,
    plan: 'standard',
    status: 'active',
    max_active_jobs: 5,
    max_candidates_per_month: 500,
    features_enabled: null,
    branding_config: null,
    billing_email: lead.email,
    created_at: now(),
    updated_at: now(),
  };
  const tenantRow = await datastore(ctx.req).table('Tenants').insertRow(tenantInsert);
  const tenant = unwrapRow<{ ROWID: string }>(tenantRow, 'Tenants');
  if (!tenant) throw new AppError(500, 'tenant_create_failed', 'No se pudo crear el Tenant');

  // Actualizar lead → status='won' + linkea con tenant
  await datastore(ctx.req).table(TABLE_LEADS).updateRow({
    ROWID: leadId,
    status: 'won',
    updated_at: now(),
  });

  log.info('lead converted to tenant', {
    traceId: ctx.traceId,
    leadId,
    tenantId: tenant.ROWID,
    company: lead.company,
  });

  sendJson(ctx.res, 201, {
    tenant_id: tenant.ROWID,
    slug,
    next_steps: [
      `Crear org en Clerk con nombre "${lead.company}" → copiar el clerk_org_id`,
      `PATCH /api/admin/tenants/${tenant.ROWID} con { clerk_org_id: "org_xxx" }`,
      `Emitir portal token desde Settings → Portales`,
    ],
  });
}

/**
 * POST /api/marketing/demo-test/register
 *
 * Body: { token, name, email }
 *
 * El frontend llama esto cuando alguien abre uno de los 2 links del demo (conductual
 * o integridad). Acciones:
 *   1. Verificar token (demo_conductual o demo_integridad), extraer resultId
 *   2. Chequear si esa sección del demo ya está completa → 410 Gone (link caducado)
 *   3. Upsert Candidate por email
 *   4. Vincular Candidate al Result (si no tenía Candidate todavía)
 *   5. Devolver { result_id, section, candidate_name } para que el frontend lance el test
 */
export async function registerDemoTest(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  const token = typeof body.token === 'string' ? body.token : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!token) throw new ValidationError('token required');
  if (!name || name.length < 2) throw new ValidationError('name required (min 2 chars)');
  if (!email || !EMAIL_REGEX.test(email)) throw new ValidationError('email inválido');

  const { verifyToken, TokenError } = await import('../lib/urlSigning.js');

  // Probar ambos kinds — el frontend manda el token pero no sabemos cuál es
  let claims: { kind: string; ref: string } | null = null;
  let section: 'conductual' | 'integridad' | null = null;
  try {
    const c = verifyToken(token, 'demo_conductual');
    claims = c;
    section = 'conductual';
  } catch (err) {
    if (!(err instanceof TokenError) || err.reason === 'wrong_kind') {
      try {
        const c = verifyToken(token, 'demo_integridad');
        claims = c;
        section = 'integridad';
      } catch {
        sendJson(ctx.res, 401, { error: { code: 'invalid_token', message: 'Link inválido o expirado' } });
        return;
      }
    } else {
      sendJson(ctx.res, 401, { error: { code: 'invalid_token', message: 'Link inválido o expirado' } });
      return;
    }
  }
  if (!claims || !section) {
    sendJson(ctx.res, 401, { error: { code: 'invalid_token', message: 'Link inválido o expirado' } });
    return;
  }

  const resultId = claims.ref;

  // Cargar Result + Scores para chequear si esta sección ya está completa
  const result = unwrapRows<{ ROWID: string; pipeline_stage: string; candidate_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage, candidate_id FROM Results WHERE ROWID = '${escapeSql(resultId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  if (!result) {
    sendJson(ctx.res, 404, { error: { code: 'result_not_found', message: 'Resultado no encontrado' } });
    return;
  }

  // Verificar si la sección ya está completa
  const sectionComplete = await isDemoSectionComplete(ctx, resultId, section);
  if (sectionComplete) {
    sendJson(ctx.res, 410, {
      error: { code: 'section_already_completed', message: 'Esta prueba ya se completó. El link caducó.' },
    });
    return;
  }

  // Upsert Candidate por email
  let candidateId: string;
  const existingCand = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];

  if (existingCand) {
    candidateId = existingCand.ROWID;
  } else {
    const inserted = await datastore(ctx.req).table('Candidates').insertRow({
      name,
      email,
      created_at: now(),
    });
    candidateId = unwrapRow<{ ROWID: string }>(inserted, 'Candidates')?.ROWID ?? '';
  }

  // Vincular Candidate al Result si todavía no tiene uno (primer link abierto)
  if (!result.candidate_id) {
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: resultId,
      candidate_id: candidateId,
    });
  }

  log.info('demo test registered', {
    traceId: ctx.traceId,
    section,
    resultId,
    candidateId,
    email_masked: email.slice(0, 2) + '***',
  });

  // Generar token kind='test' para que el frontend pueda usar los endpoints normales
  // de submit del test. Expira en 24h (suficiente para completar una sección).
  const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
  const testToken = signToken({ kind: 'test', ref: resultId, exp: expiresIn(DAY_SEC) });

  sendJson(ctx.res, 200, {
    result_id: resultId,
    candidate_id: candidateId,
    section,
    candidate_name: name,
    test_token: testToken,
  });
}

/**
 * Chequea si una sección del demo (conductual o integridad) ya está completa para
 * un Result dado. Mira la tabla Scores que tiene los timestamps por sección.
 *
 * Conductual = DISC + VELNA completados. (Emocional pendiente — falta UI en frontend;
 *   cuando se agregue, sumar `emo_completed_at` al check.)
 * Integridad = int_completed_at puesta.
 */
export async function isDemoSectionComplete(
  ctx: RequestContext,
  resultId: string,
  section: 'conductual' | 'integridad',
): Promise<boolean> {
  const scores = unwrapRows<{
    disc_completed_at: string | null;
    velna_completed_at: string | null;
    int_completed_at: string | null;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT disc_completed_at, velna_completed_at, int_completed_at
       FROM Scores WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`,
    )) as unknown[],
    'Scores',
  )[0];

  if (!scores) return false;
  if (section === 'conductual') {
    return !!(scores.disc_completed_at && scores.velna_completed_at);
  }
  return !!scores.int_completed_at;
}

/**
 * Hook llamado desde publicTest cuando un Result transiciona a integridad_completed.
 * Si el Result corresponde a un MarketingLead (vino del funnel), completa el flow:
 *   1. Genera URL pública del reporte (signed token, 30 días)
 *   2. Actualiza el lead: status='eval_completed', eval_completed_at, demo_report_url
 *   3. Publica evento lead.eval_completed (sync CRM con tag 'Demo Completed')
 *   4. Envía email marketing_demo_report_ready al lead con el link al reporte
 *
 * No-op si el Result no pertenece a un MarketingLead (caso normal — candidato regular).
 */
export async function tryCompleteMarketingDemo(ctx: RequestContext, resultId: string): Promise<void> {
  try {
    if (!(await isTableReady(ctx.req))) return;

    const lead = unwrapRows<{
      ROWID: string;
      email: string;
      contact_name: string | null;
      company: string | null;
      status: string;
    }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, email, contact_name, company, status FROM ${TABLE_LEADS}
         WHERE eval_result_id = '${escapeSql(resultId)}' LIMIT 1`,
      )) as unknown[],
      TABLE_LEADS,
    )[0];

    if (!lead) return; // No es un demo del funnel — ignorar
    if (lead.status === 'eval_completed') return; // Ya procesado — idempotente

    // Para disparar el reporte, AMBAS secciones (conductual + integridad) tienen que
    // estar completas. Si solo una está, salimos — esperamos la otra.
    const [conductualOk, integridadOk] = await Promise.all([
      isDemoSectionComplete(ctx, resultId, 'conductual'),
      isDemoSectionComplete(ctx, resultId, 'integridad'),
    ]);
    if (!conductualOk || !integridadOk) {
      log.info('demo partial — waiting for other section', {
        traceId: ctx.traceId,
        resultId,
        conductualOk,
        integridadOk,
      });
      return;
    }

    // Buscar el member (el colaborador que hizo el test).
    // ZCQL no soporta subqueries con ROWID — hacemos 2 queries separadas.
    const resultRow = unwrapRows<{ candidate_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT candidate_id FROM Results WHERE ROWID = '${escapeSql(resultId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    )[0];

    let candidateRow: { name: string; email: string } | undefined;
    if (resultRow?.candidate_id) {
      candidateRow = unwrapRows<{ name: string; email: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT name, email FROM Candidates WHERE ROWID = '${escapeSql(resultRow.candidate_id)}' LIMIT 1`,
        )) as unknown[],
        'Candidates',
      )[0];
    }

    // Signed token al reporte (30 días) — kind='report' apunta al endpoint single-result
    // que devuelve UN candidato (el del demo). El componente DemoReport en frontend
    // consume ese endpoint.
    const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
    const reportToken = signToken({ kind: 'report', ref: resultId, exp: expiresIn(30 * DAY_SEC) });
    const reportUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/app/index.html#/demo-report/${reportToken}`;

    // Actualizar lead
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: lead.ROWID,
      status: 'eval_completed',
      eval_completed_at: now(),
      demo_report_url: reportUrl.slice(0, 1000),
      updated_at: now(),
    });

    log.info('marketing demo completed', {
      traceId: ctx.traceId,
      leadId: lead.ROWID,
      resultId,
      member_email_masked: candidateRow?.email ? candidateRow.email.slice(0, 2) + '***' : 'unknown',
    });

    // Outbox: sync a CRM con tag Demo Completed
    void publishOutboxEvent(ctx.req, 'lead.eval_completed', {
      lead_id: lead.ROWID,
      email: lead.email,
      contact_name: lead.contact_name,
      company: lead.company,
    });

    // URL para agendar reunión comercial post-demo. Env var MARKETING_BOOKING_URL
    // apunta a Zoho Bookings, Calendly, o equivalente. Si no está seteada, el
    // botón se reemplaza por un fallback "responde este email" para no dejar
    // un botón roto.
    const bookingUrl = process.env.MARKETING_BOOKING_URL ?? '';
    const bookingSectionHtml = bookingUrl
      ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
        <tr>
          <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="${bookingUrl}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
              Agendar reunión
            </a>
          </td>
        </tr>
      </table>`
      : `<p style="margin:0; color:#6b7280; font-size:14px;">Responde este email y coordinamos una llamada — llega directo a nuestro equipo.</p>`;

    // Email al lead con el reporte — sincrónico, sale ya
    await publishAndProcessEvent(ctx.req, 'email.send_pending', {
      to: lead.email,
      template: 'marketing_demo_report_ready',
      locale: 'es',
      vars: {
        contact_name_prefix: lead.contact_name ? ` ${lead.contact_name.split(/\s+/)[0]}` : '',
        member_name: candidateRow?.name ?? 'tu colaborador',
        report_url: reportUrl,
        booking_url: bookingUrl || '(responde este email)',
        booking_section_html: bookingSectionHtml,
      },
    });
  } catch (err) {
    log.warn('tryCompleteMarketingDemo failed', {
      traceId: ctx.traceId,
      resultId,
      error: (err as Error).message,
      stack: (err as Error).stack?.slice(0, 600),
    });
    // Re-throw para que callers puedan capturar (simulateCompletion, etc)
    throw err;
  }
}

/**
 * GET /api/marketing/_diagnose?email=<email>
 *
 * Endpoint temporal de diagnóstico. Dado un email de lead, devuelve el estado
 * completo del lead + sus Scores + Result, para entender por qué un reporte
 * no se disparó. Requiere X-Marketing-Site-Key (no es secret pero filtra script kiddies).
 *
 * Eliminar este endpoint una vez resueltos los bugs del demo MVP.
 */
export async function diagnoseLead(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required', message: 'pass ?email=...' } });
    return;
  }

  const lead = unwrapRows<{
    ROWID: string;
    email: string;
    status: string;
    eval_result_id: string | null;
    eval_completed_at: string | null;
    demo_report_url: string | null;
    created_at: string;
    updated_at: string;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, status, eval_result_id, eval_completed_at, demo_report_url, created_at, updated_at FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead) {
    sendJson(ctx.res, 404, { error: { code: 'lead_not_found', email } });
    return;
  }

  // Buscar el Result vinculado
  let result: Record<string, unknown> | null = null;
  let scores: Record<string, unknown> | null = null;
  if (lead.eval_result_id) {
    const r = unwrapRows<Record<string, unknown>>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, pipeline_stage, candidate_id, started_at, completed_at FROM Results WHERE ROWID = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    )[0];
    result = r ?? null;

    const s = unwrapRows<Record<string, unknown>>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT disc_completed_at, velna_completed_at, emo_completed_at, int_completed_at, tec_completed_at FROM Scores WHERE result_id = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
      )) as unknown[],
      'Scores',
    )[0];
    scores = s ?? null;
  }

  // Evaluar si cada sección está completa según las reglas del demo
  const conductualOk = !!(scores && scores.disc_completed_at && scores.velna_completed_at);
  const integridadOk = !!(scores && scores.int_completed_at);

  sendJson(ctx.res, 200, {
    lead,
    result,
    scores,
    demo_state: {
      conductual_complete: conductualOk,
      integridad_complete: integridadOk,
      both_complete: conductualOk && integridadOk,
      report_should_have_been_sent: conductualOk && integridadOk && lead.status !== 'eval_completed',
    },
  });
}

/**
 * POST /api/marketing/_reset?email=<email>
 *
 * Endpoint temporal de reset. Dado un email de lead, borra el Result + Scores
 * asociados y resetea el lead a `status=new`. Permite a un mismo email reusar
 * el flow del demo desde cero (útil para QA).
 *
 * Mantiene el Candidate vivo (puede estar referenciado por otros lugares) y el
 * lead en sí (preserva los datos del quiz).
 *
 * Eliminar este endpoint una vez resueltos los bugs del demo MVP.
 */
export async function resetLead(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required', message: 'pass ?email=...' } });
    return;
  }

  const lead = unwrapRows<{ ROWID: string; eval_result_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, eval_result_id FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead) {
    sendJson(ctx.res, 404, { error: { code: 'lead_not_found', email } });
    return;
  }

  const deletions: string[] = [];
  if (lead.eval_result_id) {
    // Borrar Scores row vinculado al Result
    const scoresRow = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Scores WHERE result_id = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
      )) as unknown[],
      'Scores',
    )[0];
    if (scoresRow) {
      await datastore(ctx.req).table('Scores').deleteRow(scoresRow.ROWID);
      deletions.push(`Scores ${scoresRow.ROWID}`);
    }
    // Borrar el Result
    try {
      await datastore(ctx.req).table('Results').deleteRow(lead.eval_result_id);
      deletions.push(`Results ${lead.eval_result_id}`);
    } catch (err) {
      log.warn('failed to delete result', { error: (err as Error).message, resultId: lead.eval_result_id });
    }
  }

  // Reset lead a status='new'
  await datastore(ctx.req).table(TABLE_LEADS).updateRow({
    ROWID: lead.ROWID,
    status: 'new',
    eval_result_id: null,
    eval_completed_at: null,
    demo_report_url: null,
    updated_at: now(),
  });
  deletions.push(`Lead ${lead.ROWID} reset to status=new`);

  log.info('lead reset for QA', { traceId: ctx.traceId, email_masked: email.slice(0, 2) + '***', deletions });

  sendJson(ctx.res, 200, {
    message: 'Lead reset. Volve a llenar el form de la landing y deberia generar Result + tokens nuevos.',
    email,
    actions: deletions,
  });
}

/**
 * POST /api/marketing/_simulate_completion?email=<email>
 *
 * Endpoint temporal de QA. Inyecta scores válidos en el Result del lead para
 * simular que completó ambas pruebas, sin que el usuario tenga que rehacerlas.
 * Útil cuando el frontend tuvo un bug y no submiteó los scores.
 *
 * Eliminar este endpoint una vez resuelto el bug de upload de ZIP.
 */
export async function simulateCompletion(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required', message: 'pass ?email=...' } });
    return;
  }

  const lead = unwrapRows<{ ROWID: string; eval_result_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, eval_result_id FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead || !lead.eval_result_id) {
    sendJson(ctx.res, 404, {
      error: { code: 'no_result', message: 'Lead sin Result asignado. Llena el form de la landing primero.' },
    });
    return;
  }

  // Borrar Scores anteriores si existen (para que insert no choque por unique)
  const existing = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Scores WHERE result_id = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
    )) as unknown[],
    'Scores',
  )[0];
  if (existing) {
    await datastore(ctx.req).table('Scores').deleteRow(existing.ROWID);
  }

  // Insertar scores sintéticos — valores plausibles para un candidato "promedio alto"
  const ts = now();
  await datastore(ctx.req).table('Scores').insertRow({
    result_id: lead.eval_result_id,
    disc_raw_d: 18, disc_raw_i: 12, disc_raw_s: 14, disc_raw_c: 16,
    disc_norm_d: 30, disc_norm_i: 20, disc_norm_s: 23, disc_norm_c: 27,
    disc_perfil_dominante: 'D',
    disc_completed_at: ts,
    velna_verbal: 75, velna_espacial: 60, velna_logica: 80, velna_numerica: 70, velna_abstracta: 65,
    velna_total: 70, velna_max: 100, velna_indice: 70,
    velna_completed_at: ts,
    int_overall: 'bajo', int_overall_pct: 12, int_recomendacion: 'apto',
    int_buena_impresion: 'normal', int_buena_impresion_pct: 25,
    int_completed_at: ts,
  });

  // Actualizar pipeline_stage del Result
  await datastore(ctx.req).table('Results').updateRow({
    ROWID: lead.eval_result_id,
    pipeline_stage: 'integridad_completed',
    completed_at: ts,
  });

  // Disparar tryCompleteMarketingDemo (genera URL del reporte + manda email)
  let triggerResult: { ok: boolean; detail?: string } = { ok: true };
  try {
    await tryCompleteMarketingDemo(ctx, lead.eval_result_id);
  } catch (err) {
    let detail: string;
    if (err instanceof Error) {
      detail = `${err.name}: ${err.message}\n${err.stack?.slice(0, 700) ?? ''}`;
    } else if (typeof err === 'string') {
      detail = err;
    } else {
      try { detail = JSON.stringify(err, Object.getOwnPropertyNames(err as object)).slice(0, 1500); }
      catch { detail = String(err); }
    }
    triggerResult = { ok: false, detail };
  }

  sendJson(ctx.res, 200, {
    message: 'Scores sintéticos inyectados. tryCompleteMarketingDemo disparado.',
    email,
    result_id: lead.eval_result_id,
    trigger_result: triggerResult,
  });
}

/**
 * POST /api/marketing/_force_crm_sync?email=<email>
 *
 * Endpoint temporal de QA. Dado el email de un lead, fuerza el push al Zoho CRM
 * sincronicamente (sin esperar al outbox dispatcher). Devuelve el resultado
 * directo del CRM (success + lead_id + module, o error con detalle).
 *
 * Eliminar este endpoint una vez validado el wiring CRM en producción.
 */
export async function forceCrmSync(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required', message: 'pass ?email=...' } });
    return;
  }

  const lead = unwrapRows<{
    ROWID: string;
    email: string;
    contact_name: string | null;
    company: string | null;
    score_quality: number | null;
    urgency: string | null;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, company, score_quality, urgency FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead) {
    sendJson(ctx.res, 404, { error: { code: 'lead_not_found', email } });
    return;
  }

  try {
    const { createLead, _internal: crmInternal } = await import('../lib/zohoCrmClient.js');
    const fullName = lead.contact_name ?? '';
    const { first_name, last_name } = crmInternal.splitName(fullName);

    const result = await createLead({
      email: lead.email,
      first_name: first_name || undefined,
      last_name: last_name || undefined,
      company: lead.company ?? undefined,
      lead_source: 'SharkTalents Funnel',
      description: `Score: ${lead.score_quality ?? 'N/A'} | Urgency: ${lead.urgency ?? 'N/A'}`,
      tags: ['SharkTalents'],
    }, ctx.traceId);

    sendJson(ctx.res, result.ok ? 200 : 500, {
      ok: result.ok,
      result,
      lead_id_local: lead.ROWID,
      module_target: process.env.ZOHO_CRM_LEADS_MODULE ?? 'Leads',
      api_url: process.env.ZOHO_CRM_API_URL ?? '(not set)',
    });
  } catch (err) {
    sendJson(ctx.res, 500, {
      error: { code: 'crm_push_failed', message: (err as Error).message },
    });
  }
}

/**
 * GET /api/marketing/_list_crm_modules
 *
 * Endpoint temporal de QA. Lista todos los módulos disponibles en el Zoho CRM
 * de la cuenta autenticada, con sus API names. Permite identificar el API name
 * exacto de un módulo custom cuando difiere del label visible en la UI.
 */
export async function listCrmModules(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  try {
    const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
    const auth = await getZohoAuthHeader(ctx.traceId);
    if (!auth) {
      sendJson(ctx.res, 500, { error: { code: 'no_oauth', message: 'Zoho OAuth no configurado' } });
      return;
    }

    const apiUrl = (process.env.ZOHO_CRM_API_URL || 'https://www.zohoapis.com/crm/v2.1').replace(/\/$/, '');
    const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
    const response = await fetchWithTimeout(`${apiUrl}/settings/modules`, {
      method: 'GET',
      headers: { Authorization: auth },
      timeoutMs: 10_000,
    });
    const text = await response.text();

    if (!response.ok) {
      sendJson(ctx.res, 500, {
        error: { code: 'crm_error', status: response.status, body: text.slice(0, 1000) },
      });
      return;
    }

    const data = JSON.parse(text) as { modules?: Array<{ api_name?: string; module_name?: string; plural_label?: string; singular_label?: string; api_supported?: boolean }> };
    const modules = (data.modules ?? []).map((m) => ({
      api_name: m.api_name,
      plural_label: m.plural_label,
      api_supported: m.api_supported,
    }));

    // Resaltar módulos custom (no del set standard)
    const STANDARD = new Set(['Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Events', 'Calls', 'Products', 'Quotes', 'Sales_Orders', 'Purchase_Orders', 'Invoices', 'Vendors', 'Price_Books', 'Cases', 'Solutions', 'Campaigns', 'Notes', 'Attachments']);
    const customModules = modules.filter((m) => m.api_name && !STANDARD.has(m.api_name));

    sendJson(ctx.res, 200, {
      total: modules.length,
      custom_modules: customModules,
      all_modules: modules,
    });
  } catch (err) {
    sendJson(ctx.res, 500, {
      error: { code: 'failed', message: (err as Error).message },
    });
  }
}

/**
 * POST /api/marketing/_link_marketing_tenant?org_id=<clerk_org_id>
 *
 * Endpoint temporal. Vincula una organización de Clerk al Tenant
 * "SharkTalents Marketing" (el que recibe leads del funnel). Después de
 * llamar esto, los miembros de esa org Clerk pueden acceder al panel admin
 * y ver los leads del funnel.
 *
 * Eliminar este endpoint cuando esté armado el flow de super-admin.
 */
export async function linkMarketingTenant(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const orgId = url.searchParams.get('org_id')?.trim() ?? '';
  if (!orgId || !orgId.startsWith('org_')) {
    sendJson(ctx.res, 400, {
      error: { code: 'invalid_org_id', message: 'pass ?org_id=org_xxx (Clerk organization id)' },
    });
    return;
  }

  const tenant = unwrapRows<{ ROWID: string; clerk_org_id: string; name: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, clerk_org_id, name FROM Tenants WHERE slug = 'sharktalents-marketing' LIMIT 1`,
    )) as unknown[],
    'Tenants',
  )[0];

  if (!tenant) {
    sendJson(ctx.res, 404, {
      error: { code: 'tenant_not_found', message: 'Tenant SharkTalents Marketing no existe. Hacé un lead capture primero para que se auto-cree.' },
    });
    return;
  }

  const previousOrgId = tenant.clerk_org_id;

  await datastore(ctx.req).table('Tenants').updateRow({
    ROWID: tenant.ROWID,
    clerk_org_id: orgId,
    updated_at: now(),
  });

  log.info('marketing tenant linked to clerk org', {
    traceId: ctx.traceId,
    tenant_id: tenant.ROWID,
    previous_org_id: previousOrgId,
    new_org_id: orgId,
  });

  sendJson(ctx.res, 200, {
    message: `Tenant '${tenant.name}' (${tenant.ROWID}) vinculado a Clerk org ${orgId}. Activá esa org en tu navegador y entrá a Settings → Leads.`,
    tenant_id: tenant.ROWID,
    previous_org_id: previousOrgId,
    new_org_id: orgId,
  });
}

/**
 * GET /api/marketing/_whoami
 *
 * Endpoint temporal diagnostic. Requiere auth (cualquier usuario logueado).
 * Devuelve qué ve el backend en el JWT del request — útil para diagnosticar
 * por qué un usuario que está "logueado en el admin" no puede acceder a
 * endpoints `auth: 'tenant'` (típicamente porque el JWT no incluye org_id).
 */
export async function whoami(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  try {
    await requireAuth(ctx);
  } catch (err) {
    sendJson(ctx.res, 401, {
      error: { code: 'no_auth', message: (err as Error).message },
      hint: 'Tu navegador NO mandó un JWT válido. Probablemente no estás logueado o el token expiró.',
    });
    return;
  }

  // Intentar buscar Tenant por la org_id
  let tenantInfo: Record<string, unknown> = { found: false };
  if (ctx.user?.clerk_org_id) {
    const tenant = unwrapRows<{ ROWID: string; clerk_org_id: string; name: string; slug: string; status: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, clerk_org_id, name, slug, status FROM Tenants WHERE clerk_org_id = '${escapeSql(ctx.user.clerk_org_id)}' LIMIT 1`,
      )) as unknown[],
      'Tenants',
    )[0];
    if (tenant) {
      tenantInfo = { found: true, ...tenant };
    } else {
      tenantInfo = { found: false, searched_org_id: ctx.user.clerk_org_id };
    }
  }

  sendJson(ctx.res, 200, {
    user: ctx.user ?? null,
    has_clerk_org_id: !!ctx.user?.clerk_org_id,
    tenant_lookup: tenantInfo,
    diagnostic: {
      can_access_tenant_endpoints: !!ctx.user?.clerk_org_id && tenantInfo.found === true,
      why_blocked: !ctx.user?.clerk_org_id
        ? 'JWT no tiene org_id. Probablemente no hay org activa en el navegador, o Clerk no incluye org_id en el template del JWT.'
        : tenantInfo.found
        ? null
        : `JWT tiene org_id=${ctx.user.clerk_org_id} pero NO existe Tenant con ese clerk_org_id en la DB.`,
    },
  });
}

/**
 * POST /api/marketing/_resend_report?email=<email>
 *
 * Endpoint temporal. Regenera la URL del reporte (apuntando al nuevo /demo-report/)
 * y reenvía el email al lead. Útil cuando el flow ya marcó el demo como completed
 * pero el email original tenía un URL viejo/roto.
 */
export async function resendReport(ctx: RequestContext): Promise<void> {
  verifySiteKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required' } });
    return;
  }

  const lead = unwrapRows<{
    ROWID: string;
    email: string;
    contact_name: string | null;
    eval_result_id: string | null;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, eval_result_id FROM ${TABLE_LEADS} WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];

  if (!lead || !lead.eval_result_id) {
    sendJson(ctx.res, 404, { error: { code: 'no_result', message: 'Lead sin Result' } });
    return;
  }

  const resultId = lead.eval_result_id;

  // Generar URL nueva apuntando a /demo-report/
  const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
  const reportToken = signToken({ kind: 'report', ref: resultId, exp: expiresIn(30 * DAY_SEC) });
  const reportUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/app/index.html#/demo-report/${reportToken}`;

  // Actualizar el lead con la URL nueva
  await datastore(ctx.req).table(TABLE_LEADS).updateRow({
    ROWID: lead.ROWID,
    demo_report_url: reportUrl.slice(0, 1000),
    updated_at: now(),
  });

  // Buscar nombre del candidato para el email
  const resultRow = unwrapRows<{ candidate_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT candidate_id FROM Results WHERE ROWID = '${escapeSql(resultId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];
  let candidateName = 'tu colaborador';
  if (resultRow?.candidate_id) {
    const cand = unwrapRows<{ name: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT name FROM Candidates WHERE ROWID = '${escapeSql(resultRow.candidate_id)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    )[0];
    if (cand?.name) candidateName = cand.name;
  }

  // Email
  const bookingUrl = process.env.MARKETING_BOOKING_URL ?? '';
  const bookingSectionHtml = bookingUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
      <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
        <a href="${bookingUrl}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">Agendar reunión</a>
      </td></tr></table>`
    : `<p style="margin:0; color:#6b7280; font-size:14px;">Responde este email y coordinamos una llamada — llega directo a nuestro equipo.</p>`;

  const emailResult = await publishAndProcessEvent(ctx.req, 'email.send_pending', {
    to: lead.email,
    template: 'marketing_demo_report_ready',
    locale: 'es',
    vars: {
      contact_name_prefix: lead.contact_name ? ` ${lead.contact_name.split(/\s+/)[0]}` : '',
      member_name: candidateName,
      report_url: reportUrl,
      booking_url: bookingUrl || '(responde este email)',
      booking_section_html: bookingSectionHtml,
    },
  });

  sendJson(ctx.res, 200, {
    message: 'Reporte reenviado',
    email,
    new_report_url: reportUrl,
    email_send_result: emailResult,
  });
}

export const _internal = {
  computeLeadScore,
  validateQuizData,
  VALID_PUESTO_TIPOS,
  VALID_URGENCIA,
  VALID_LEAD_STATUSES,
};
