/**
 * Endpoint público que recibe al candidato cuando llega del email/WP de Recruit.
 *
 *   GET /api/recruit/test-link?recruit_id=<X>&recruit_job_id=<Y>&phase=<disc|tecnica|integridad>
 *
 * Flow:
 *   1. Lee recruit_id + recruit_job_id del query string (los pone Recruit via merge
 *      fields en el link del email/WhatsApp).
 *   2. Resuelve el Job de SharkTalents asociado a recruit_job_id (Jobs.recruit_job_id).
 *   3. Si encuentra Candidate en SharkTalents con ese recruit_id, lo usa. Si no,
 *      llama a Recruit API para traer datos del candidato y lo crea en SharkTalents.
 *   4. Crea (o reusa) un Result/Application para ese candidate+job.
 *   5. Genera token kind='test' con ref=resultId.
 *   6. Redirige (302) a /app/#/test/<token> en el frontend.
 *
 * Auth: público (rate-limited por IP). No requiere Clerk.
 *
 * Si Recruit no está configurado o falla, devuelve HTML con mensaje claro al candidato
 * en lugar de un error técnico.
 */
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { signToken, expiresIn, WEEK_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';

const log = logger('RECRUIT_TEST_LINK');

type JobPick = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  recruit_job_id?: string | null;
};

type CandidatePick = {
  ROWID: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  recruit_candidate_id?: string | null;
};

export async function handleRecruitTestLink(ctx: RequestContext): Promise<void> {
  let recruitCandidateId: string | null = null;
  let recruitJobId: string | null = null;
  let phase: string | null = null;
  try {
    const url = new URL(ctx.req.url ?? '/', 'https://placeholder.local');
    recruitCandidateId = url.searchParams.get('recruit_id')?.trim() || null;
    recruitJobId = url.searchParams.get('recruit_job_id')?.trim() || null;
    phase = url.searchParams.get('phase')?.trim() || null;
  } catch {
    throw new ValidationError('URL inválida');
  }

  if (!recruitCandidateId) throw new ValidationError('recruit_id es requerido en la URL');
  if (!recruitJobId) throw new ValidationError('recruit_job_id es requerido en la URL');

  // 1. Encontrar el Job de SharkTalents que corresponde a recruit_job_id
  let job: JobPick | undefined;
  try {
    job = unwrapRows<JobPick>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, recruit_job_id FROM Jobs
         WHERE recruit_job_id = '${escapeSql(recruitJobId)}' AND is_active = true LIMIT 1`,
      )) as unknown[],
      'Jobs',
    )[0];
  } catch (err) {
    log.warn('failed to query Jobs by recruit_job_id (column may be missing)', { error: (err as Error).message });
  }

  if (!job) {
    throw new NotFoundError(`Puesto no encontrado en SharkTalents para recruit_job_id=${recruitJobId}. Verifica que el puesto fue creado vía draft o que Jobs.recruit_job_id está linkeado.`);
  }

  // 2. Encontrar o crear Candidate
  let candidate: CandidatePick | undefined;
  try {
    candidate = unwrapRows<CandidatePick>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, email, name, phone, recruit_candidate_id FROM Candidates
         WHERE recruit_candidate_id = '${escapeSql(recruitCandidateId)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    )[0];
  } catch (err) {
    log.debug('Candidates.recruit_candidate_id lookup failed (column may be missing)', { error: (err as Error).message });
  }

  if (!candidate) {
    // Candidato no existe en SharkTalents — lo creamos trayendo datos de Recruit
    candidate = await createCandidateFromRecruit(ctx, recruitCandidateId);
  }

  // 3. Encontrar o crear Application (Result) para este candidato + job
  let application = unwrapRows<{ ROWID: string; pipeline_stage: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, pipeline_stage FROM Results
       WHERE candidate_id = '${escapeSql(candidate.ROWID)}'
         AND assessment_id = '${escapeSql(job.ROWID)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  if (!application) {
    // No hay application — crearla. Como el candidato ya pasó el prefilter en Recruit,
    // arranca en `prefilter_passed` directamente.
    const inserted = await datastore(ctx.req).table('Results').insertRow({
      assessment_id: job.ROWID,
      candidate_id: candidate.ROWID,
      answers: null,
      pipeline_stage: 'prefilter_passed',
      started_at: now(),
      completed_at: null,
      report_downloaded_at: null,
      idempotency_key: null,
    });
    const created = unwrapRow<{ ROWID: string; pipeline_stage: string }>(inserted, 'Results');
    if (!created) throw new Error('No se pudo crear Application');
    application = created;
    log.info('application created from recruit link', {
      traceId: ctx.traceId,
      candidateId: candidate.ROWID,
      jobId: job.ROWID,
      applicationId: application.ROWID,
      origin: 'recruit_email_link',
    });
  }

  // 4. Generar token + URL de redirect al test
  const e = env();
  const token = signToken({
    kind: 'test',
    ref: application.ROWID,
    exp: expiresIn(2 * WEEK_SEC),
  });

  // phase determina qué prueba específica abrir. Si no viene, va al entry general.
  const phaseFragment = phase ? `/${phase}` : '';
  const redirectUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/app/#/test/${token}${phaseFragment}`;

  log.info('redirecting candidate from recruit to test', {
    traceId: ctx.traceId,
    applicationId: application.ROWID,
    phase: phase ?? 'entry',
  });

  ctx.res.writeHead(302, { Location: redirectUrl });
  ctx.res.end();
}

async function createCandidateFromRecruit(
  ctx: RequestContext,
  recruitCandidateId: string,
): Promise<CandidatePick> {
  const { getRecruitCandidate } = await import('../lib/zohoRecruitClient.js');
  const result = await getRecruitCandidate(recruitCandidateId, ctx.traceId);
  if (!result.ok) {
    throw new Error(`No se pudo traer datos del candidato desde Recruit: ${result.error}`);
  }
  const recruitData = result.data.data?.[0] ?? {};
  const firstName = String(recruitData.First_Name ?? '').trim();
  const lastName = String(recruitData.Last_Name ?? '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Candidato';
  const email = String(recruitData.Email ?? '').trim().toLowerCase();
  const phone = String(recruitData.Phone ?? recruitData.Mobile ?? '').trim();

  if (!email) {
    throw new Error('El candidato en Recruit no tiene email — no se puede crear en SharkTalents');
  }

  // Dedup por email por si ya existe sin recruit_id linkeado
  const existing = unwrapRows<CandidatePick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, name, phone FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];

  if (existing) {
    // Linkear el recruit_id al candidato existente
    try {
      await datastore(ctx.req).table('Candidates').updateRow({
        ROWID: existing.ROWID,
        recruit_candidate_id: recruitCandidateId,
        updated_at: now(),
      });
    } catch (err) {
      log.warn('failed to link recruit_id to existing candidate', { error: (err as Error).message });
    }
    return { ...existing, recruit_candidate_id: recruitCandidateId };
  }

  // Crear nuevo Candidate
  const insertData: Record<string, unknown> = {
    name: fullName.slice(0, 255),
    email: email.slice(0, 255),
    phone: phone.slice(0, 50) || null,
    age: null,
    salary_expectation: null,
    availability: null,
    interview_file_id: null,
    created_at: now(),
    recruit_candidate_id: recruitCandidateId,
  };
  let inserted;
  try {
    inserted = await datastore(ctx.req).table('Candidates').insertRow(insertData);
  } catch (err) {
    if (/recruit_candidate_id/i.test((err as Error).message)) {
      log.warn('Candidates.recruit_candidate_id column missing — inserting without it');
      delete insertData.recruit_candidate_id;
      inserted = await datastore(ctx.req).table('Candidates').insertRow(insertData);
    } else {
      throw err;
    }
  }
  const newCandidate = unwrapRow<CandidatePick>(inserted, 'Candidates');
  if (!newCandidate) throw new Error('No se pudo crear Candidate desde Recruit');
  log.info('candidate created from recruit', {
    traceId: ctx.traceId,
    candidateId: newCandidate.ROWID,
    recruit_id: recruitCandidateId,
  });
  return { ...newCandidate, recruit_candidate_id: recruitCandidateId };
}
