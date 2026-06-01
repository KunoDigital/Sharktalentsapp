/**
 * Endpoints públicos para candidatos aplicando a un puesto (Doc 18).
 *
 *   GET  /apply/:tenantSlug/:jobIdentifier  → info pública del puesto (sin scores ni internal)
 *   POST /apply/:tenantSlug/:jobIdentifier  → crea Candidate + Application en prefilter_pending
 *
 * `jobIdentifier` puede ser ROWID o slug — el backend prueba ambos en orden.
 *
 * Auth: público (rate-limited por IP). NO Clerk, NO API key.
 *
 * Validaciones:
 *   - Tenant existe + status='active'
 *   - Job existe + tenant_id matches + is_active=true
 *   - Email válido
 *   - Consent obligatorio
 *
 * Idempotencia: si el candidato (por email) ya tiene Application al mismo job,
 * devuelve la existente con 200 (no crea duplicada).
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { signToken, expiresIn, WEEK_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';

const log = logger('PUBLIC_APPLY');

type TenantPick = {
  ROWID: string;
  name: string;
  slug: string;
  status: string;
};

type JobPick = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  cognitive_level: string;
  is_active: boolean | number;
  company_context: string | null;
};

type CandidatePick = {
  ROWID: string;
  email: string;
  recruit_candidate_id?: string | null;
};

type ResultPick = {
  ROWID: string;
  pipeline_stage: string;
};

function extractFromPath(url: string): { tenantSlug: string; jobIdentifier: string } | null {
  const match = url.match(/^\/apply\/([^/]+)\/([^/?]+)/);
  if (!match) return null;
  return { tenantSlug: match[1], jobIdentifier: match[2] };
}

async function fetchTenant(req: IncomingMessage, slug: string): Promise<TenantPick | null> {
  const q = `SELECT ROWID, name, slug, status FROM Tenants WHERE slug = '${escapeSql(slug)}' LIMIT 1`;
  const rows = unwrapRows<TenantPick>((await zcql(req).executeZCQLQuery(q)) as unknown[], 'Tenants');
  return rows[0] ?? null;
}

async function fetchJob(req: IncomingMessage, tenantId: string, identifier: string): Promise<JobPick | null> {
  // Probar primero ROWID, después slug (si la columna slug existe).
  const byRowid = unwrapRows<JobPick>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID, tenant_id, title, company, cognitive_level, is_active, company_context
       FROM Jobs WHERE ROWID = '${escapeSql(identifier)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  );
  if (byRowid[0]) return byRowid[0];

  // Slug fallback. Si la columna `slug` no existe en Catalyst todavía, este SELECT falla
  // silenciosamente y devolvemos null.
  try {
    const bySlug = unwrapRows<JobPick>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, cognitive_level, is_active, company_context
         FROM Jobs WHERE slug = '${escapeSql(identifier)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    return bySlug[0] ?? null;
  } catch {
    return null;
  }
}

// ===== GET /apply/:tenantSlug/:jobIdentifier =====

export async function getPublicJobInfo(ctx: RequestContext): Promise<void> {
  const params = extractFromPath(ctx.req.url ?? '/');
  if (!params) throw new ValidationError('path inválido');

  const tenant = await fetchTenant(ctx.req, params.tenantSlug);
  if (!tenant || tenant.status !== 'active') {
    throw new NotFoundError(`Tenant ${params.tenantSlug} no encontrado o inactivo`);
  }

  const job = await fetchJob(ctx.req, tenant.ROWID, params.jobIdentifier);
  if (!job || (!job.is_active && job.is_active !== 1)) {
    throw new NotFoundError(`Puesto ${params.jobIdentifier} no encontrado o cerrado`);
  }

  log.info('public job info served', {
    traceId: ctx.traceId,
    tenant: tenant.slug,
    jobId: job.ROWID,
  });

  sendJson(ctx.res, 200, {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
    },
    job: {
      id: job.ROWID,
      title: job.title,
      company: job.company,
      cognitive_level: job.cognitive_level,
      // company_context truncado por si tiene info sensible — el plan dice "público"
      // pero no exponemos perfil ideal ni umbrales.
      context: job.company_context ? job.company_context.slice(0, 1500) : null,
    },
  });
}

// ===== POST /apply/:tenantSlug/:jobIdentifier =====

export async function submitApplication(ctx: RequestContext): Promise<void> {
  const params = extractFromPath(ctx.req.url ?? '/');
  if (!params) throw new ValidationError('path inválido');

  const tenant = await fetchTenant(ctx.req, params.tenantSlug);
  if (!tenant || tenant.status !== 'active') {
    throw new NotFoundError(`Tenant ${params.tenantSlug} no encontrado o inactivo`);
  }

  const job = await fetchJob(ctx.req, tenant.ROWID, params.jobIdentifier);
  if (!job || (!job.is_active && job.is_active !== 1)) {
    throw new NotFoundError(`Puesto ${params.jobIdentifier} no encontrado o cerrado`);
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const consentData = body.consent_data === true;
  const salaryUsd = Number(body.salary_aspiration_usd);

  if (!fullName) throw new ValidationError('full_name required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('email inválido');
  }
  if (!phone) throw new ValidationError('phone required');
  if (!consentData) throw new ValidationError('Consent obligatorio (consent_data=true)');

  // Identidad cross-sistema: si el candidato llegó vía link de Recruit, viene `recruit_id`
  // en query string o body. Ese es el matching key autoritativo — NO el email, porque
  // los candidatos suelen poner emails distintos / mal escritos en Recruit vs SharkTalents.
  // Si NO viene recruit_id, fallback al matching por email (caso landing público sin Recruit).
  const recruitIdFromUrl = (() => {
    try {
      const url = new URL(ctx.req.url ?? '/', 'https://placeholder.local');
      return url.searchParams.get('recruit_id')?.trim() || null;
    } catch { return null; }
  })();
  const recruitIdFromBody = typeof body.recruit_id === 'string' ? body.recruit_id.trim() : null;
  const recruitCandidateId = recruitIdFromUrl || recruitIdFromBody;

  // Match: 1) por recruit_id si vino, 2) por email como fallback
  let candidate: CandidatePick;
  let existingCandidate: CandidatePick | undefined;
  if (recruitCandidateId) {
    try {
      existingCandidate = unwrapRows<CandidatePick>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, email, recruit_candidate_id FROM Candidates WHERE recruit_candidate_id = '${escapeSql(recruitCandidateId)}' LIMIT 1`,
        )) as unknown[],
        'Candidates',
      )[0];
    } catch (err) {
      // La columna puede no existir todavía — caemos al match por email
      log.debug('recruit_candidate_id lookup failed (column may be missing)', { error: (err as Error).message });
    }
  }
  if (!existingCandidate) {
    existingCandidate = unwrapRows<CandidatePick>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, email FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    )[0];
  }

  if (existingCandidate) {
    candidate = existingCandidate;
    // Si encontramos por email pero el candidato vino con recruit_id y no estaba guardado,
    // updateamos. Idempotente: si ya estaba, el update no hace nada distinto.
    if (recruitCandidateId && !existingCandidate.recruit_candidate_id) {
      try {
        await datastore(ctx.req).table('Candidates').updateRow({
          ROWID: existingCandidate.ROWID,
          recruit_candidate_id: recruitCandidateId,
          updated_at: now(),
        });
        log.info('linked existing candidate to recruit_id', {
          traceId: ctx.traceId, candidateId: existingCandidate.ROWID, recruit_id: recruitCandidateId,
        });
      } catch (err) {
        log.warn('failed to link recruit_id (column may be missing)', { error: (err as Error).message });
      }
    }
  } else {
    const insertData: Record<string, unknown> = {
      name: fullName.slice(0, 255),
      email: email.slice(0, 255),
      phone: phone.slice(0, 50),
      age: typeof body.age === 'number' ? Math.round(body.age) : null,
      salary_expectation: Number.isFinite(salaryUsd) ? Math.round(salaryUsd) : null,
      availability: typeof body.disponibilidad === 'string' ? body.disponibilidad.slice(0, 100) : null,
      interview_file_id: null,
      created_at: now(),
    };
    if (recruitCandidateId) insertData.recruit_candidate_id = recruitCandidateId;
    let inserted;
    try {
      inserted = await datastore(ctx.req).table('Candidates').insertRow(insertData);
    } catch (err) {
      // Si la columna recruit_candidate_id no existe, reintentamos sin ella
      if (recruitCandidateId && /recruit_candidate_id/i.test((err as Error).message)) {
        log.warn('Candidates.recruit_candidate_id column missing, inserting without it', { recruit_id: recruitCandidateId });
        delete insertData.recruit_candidate_id;
        inserted = await datastore(ctx.req).table('Candidates').insertRow(insertData);
      } else {
        throw err;
      }
    }
    const newCandidate = unwrapRow<CandidatePick>(inserted, 'Candidates');
    if (!newCandidate) throw new Error('No se pudo crear Candidate');
    candidate = newCandidate;
    log.info('candidate created from apply', {
      traceId: ctx.traceId, candidateId: candidate.ROWID,
      origin: recruitCandidateId ? 'recruit_linked' : 'direct',
    });
  }

  // Idempotencia: ¿ya hay Application del mismo candidato a este job?
  const existing = unwrapRows<ResultPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage FROM Results
       WHERE candidate_id = '${escapeSql(candidate.ROWID)}'
         AND assessment_id = '${escapeSql(job.ROWID)}'
       LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0] ?? null;

  if (existing) {
    log.info('application already exists, returning existing', {
      traceId: ctx.traceId,
      applicationId: existing.ROWID,
      stage: existing.pipeline_stage,
    });
    sendJson(ctx.res, 200, {
      application_id: existing.ROWID,
      candidate_id: candidate.ROWID,
      pipeline_stage: existing.pipeline_stage,
      created_now: false,
      message: 'Ya tenés una aplicación a este puesto. Revisá tu email para los próximos pasos.',
    });
    return;
  }

  const inserted = await datastore(ctx.req).table('Results').insertRow({
    assessment_id: job.ROWID,
    candidate_id: candidate.ROWID,
    answers: null,
    pipeline_stage: 'prefilter_pending',
    started_at: now(),
    completed_at: null,
    report_downloaded_at: null,
    idempotency_key: null,
  });

  const application = unwrapRow<ResultPick>(inserted, 'Results');
  if (!application) {
    throw new Error('No se pudo crear Application');
  }

  log.info('application created from public apply', {
    traceId: ctx.traceId,
    tenant: tenant.slug,
    jobId: job.ROWID,
    candidateId: candidate.ROWID,
    applicationId: application.ROWID,
  });

  // Fire-and-forget: enqueue welcome email con link a las pruebas. No bloqueamos el response
  // del apply si la queue falla — el candidato igual puede pedir el link de recovery después.
  void enqueueCandidateWelcomeEmail(ctx.req, {
    candidateEmail: candidate.email,
    candidateName: typeof body.name === 'string' ? body.name.trim() : candidate.email.split('@')[0],
    jobTitle: job.title,
    company: job.company,
    applicationId: application.ROWID,
  });

  // Fire-and-forget: sync con Recruit.
  //
  // 2 caminos según de dónde vino el candidato:
  //   A) Llegó con `recruit_id` en el link (caso normal: vino de Recruit) →
  //      action=transition; Recruit actualiza el status del candidato YA existente y
  //      dispara las reglas de email/WhatsApp configuradas en el workflow.
  //   B) Llegó SIN recruit_id (caso fallback: aterrizó en SharkTalents directo, sin pasar
  //      por Recruit) → action=create; creamos al candidato en Recruit y guardamos su ID.
  void (async () => {
    try {
      const { publishRecruitSync } = await import('../lib/recruitSyncPublisher.js');
      const candidateName = fullName || candidate.email.split('@')[0];
      await publishRecruitSync(ctx.req, {
        application_id: application.ROWID,
        job_id: job.ROWID,
        tenant_id: tenant.ROWID,
        // Si tenemos recruit_id, marcamos from_stage no-null para que el publisher
        // genere action='transition' (ya existe en Recruit). Sin recruit_id, queda
        // null → action='create'.
        from_stage: recruitCandidateId ? 'external_recruit' : null,
        to_stage: 'prefilter_pending',
        actor: 'public_apply',
        transitioned_at: now(),
        candidate_id: candidate.ROWID,
        candidate_email: candidate.email,
        candidate_name: candidateName,
        job_title: job.title,
        company: job.company,
        recruit_candidate_id: recruitCandidateId ?? null,
      });
    } catch (err) {
      log.warn('publishRecruitSync failed on apply', { applicationId: application.ROWID, error: (err as Error).message });
    }
  })();

  sendJson(ctx.res, 201, {
    application_id: application.ROWID,
    candidate_id: candidate.ROWID,
    pipeline_stage: 'prefilter_pending',
    created_now: true,
    message: 'Aplicación recibida. Te enviamos un email con el link para comenzar tus pruebas.',
  });
}

async function enqueueCandidateWelcomeEmail(
  req: IncomingMessage,
  input: { candidateEmail: string; candidateName: string; jobTitle: string; company: string; applicationId: string },
): Promise<void> {
  try {
    const e = env();
    const testToken = signToken({
      kind: 'test',
      ref: input.applicationId,
      exp: expiresIn(2 * WEEK_SEC),
    });
    const testUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/app/#/test/${testToken}`;

    await datastore(req).table('OutboxEvents').insertRow({
      event_type: 'email.send_pending',
      payload: JSON.stringify({
        to: input.candidateEmail,
        template: 'candidate_application_received',
        locale: 'es',
        vars: {
          candidate_name: input.candidateName,
          job_title: input.jobTitle,
          company: input.company,
          test_url: testUrl,
        },
      }),
      status: 'pending',
      retry_count: 0,
      created_at: now(),
    });
    log.info('welcome email enqueued', { applicationId: input.applicationId, to: input.candidateEmail.split('@')[0] + '@…' });
  } catch (err) {
    log.warn('failed to enqueue welcome email', { error: (err as Error).message, applicationId: input.applicationId });
  }
}
