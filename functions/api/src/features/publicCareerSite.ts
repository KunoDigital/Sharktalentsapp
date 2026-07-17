/**
 * Career site público — endpoints que consume la web marketing (sharktalents.ai).
 * Reemplaza la necesidad del webhook de Recruit para registro de candidatos.
 *
 * Endpoints:
 *   GET  /api/public/jobs                  → lista jobs publicados (is_active=true) de todos los tenants
 *   GET  /api/public/jobs/:slug            → detalle de UN job (slug derivado del title)
 *   POST /api/public/jobs/:slug/apply      → multipart/form-data: candidato + CV
 *
 * Auth: público (sin Clerk). Rate-limit con `marketing_site_key` opcional para
 * proteger de spam masivo.
 *
 * Slug: generado del title con kebab-case. Si hay colisión entre 2 jobs con el
 * mismo title, el segundo recibe sufijo `-{rowid_short}`.
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { ValidationError, NotFoundError } from '../lib/errors';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows, unwrapRow } from '../lib/dbHelpers';
import { parseIdealProfile } from './jobs';
import { COMPETENCIAS, resolveCompetenciaId } from '../data/competencias';

const COMPETENCIA_NAME_BY_ID = new Map(COMPETENCIAS.map((c) => [c.id, c.nombre]));

const log = logger('PUBLIC_CAREER_SITE');

type JobRow = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  cognitive_level: string;
  is_active: boolean | string;
  company_context: string | null;
  ideal_profile: string | null;
  created_at: string;
};

/**
 * Convierte el ideal_profile interno (JSON con DISC/VELNA/pesos/boss) en un
 * shape PÚBLICO para mostrar al candidato. Filtra todo lo que es configuración
 * interna de evaluación. Solo expone:
 *   - description: texto narrativo del context_summary (lo que el cliente describió del rol)
 *   - competencias: lista de NOMBRES (sin pesos, sin IDs internos)
 *
 * NUNCA expone: DISC, VELNA, tecnica_minimo_pct, boss profile, auto_rejection_rules.
 */
function toPublicJobProfile(idealProfileJson: string | null, companyContext: string | null): {
  description: string | null;
  que_busco: string | null;
  que_debe_hacer: string[];
  que_debe_saber: string[];
  salary_range_usd: { min: number; max: number } | null;
  competencias: string[];
} {
  const empty = {
    description: null,
    que_busco: null,
    que_debe_hacer: [],
    que_debe_saber: [],
    salary_range_usd: null,
    competencias: [],
  };
  const parsed = parseIdealProfile(idealProfileJson);
  if (!parsed) return empty;
  const ctxSummary = parsed.context_summary?.trim() || null;
  // Si el context_summary del ideal_profile es idéntico al company_context (caso típico
  // cuando el draft IA copió textual), evitamos duplicar info al candidato.
  const description = ctxSummary && ctxSummary !== (companyContext?.trim() ?? '') ? ctxSummary : null;
  // Mapear IDs internos del catálogo cerrado → nombres humanos. Si la IA inventó un nombre
  // que no está en el catálogo (no debería, pero defensivo), dejamos pasar el string original.
  const competencias = (parsed.competencias ?? [])
    .map((c) => {
      const id = c.name?.trim();
      if (!id) return null;
      // Resolver alias deprecado (ej. drafts viejos guardaron 'colaboracion'). El
      // candidato/cliente ve el nombre canónico.
      const canonical = resolveCompetenciaId(id);
      return COMPETENCIA_NAME_BY_ID.get(canonical) ?? COMPETENCIA_NAME_BY_ID.get(id) ?? id;
    })
    .filter((n): n is string => !!n);
  return {
    description,
    que_busco: parsed.que_busco?.trim() || null,
    que_debe_hacer: parsed.que_debe_hacer ?? [],
    que_debe_saber: parsed.que_debe_saber ?? [],
    salary_range_usd: parsed.salary_range_usd ?? null,
    competencias,
  };
}

/** Genera slug kebab-case del title. */
function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .replace(/[^a-z0-9\s-]/g, '') // saca chars raros
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/**
 * GET /api/public/jobs — lista jobs publicados (is_active=true).
 * Devuelve solo info útil para el career site, sin datos internos.
 */
export async function listPublicJobs(ctx: RequestContext): Promise<void> {
  try {
    const rows = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, cognitive_level, is_active, company_context, ideal_profile, created_at
         FROM Jobs WHERE is_active = true ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'Jobs',
    );

    // Detectar colisiones de slug y agregar sufijo si hace falta.
    const slugCounts = new Map<string, number>();
    const enriched = rows.map((j) => {
      const baseSlug = makeSlug(j.title);
      const count = slugCounts.get(baseSlug) ?? 0;
      const slug = count === 0 ? baseSlug : `${baseSlug}-${j.ROWID.slice(-6)}`;
      slugCounts.set(baseSlug, count + 1);
      return {
        slug,
        title: j.title,
        company: j.company,
        cognitive_level: j.cognitive_level,
        created_at: j.created_at,
      };
    });

    sendJson(ctx.res, 200, { count: enriched.length, jobs: enriched });
  } catch (err) {
    log.error('listPublicJobs failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: 'failed to list jobs' });
  }
}

/**
 * GET /api/public/jobs/:slug — detalle de UN job para el career site.
 * El slug NO va en la DB (lo derivamos al vuelo). Buscamos por title que matchee
 * el slug. Si hay colisión, también miramos el sufijo `-{rowid_short}`.
 */
export async function getPublicJob(ctx: RequestContext): Promise<void> {
  try {
    const match = ctx.req.url?.match(/^\/api\/public\/jobs\/([^/?]+)/);
    const slug = match?.[1] ? decodeURIComponent(match[1]) : '';
    if (!slug) throw new ValidationError('slug missing');

    // Buscar todos los jobs activos y matchear por slug derivado.
    const rows = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, cognitive_level, is_active, company_context, ideal_profile, created_at
         FROM Jobs WHERE is_active = true ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'Jobs',
    );

    // Match exacto por slug derivado del title, o slug con sufijo `-{rowid_short}`.
    const job = rows.find((j) => {
      const baseSlug = makeSlug(j.title);
      if (baseSlug === slug) return true;
      const withSuffix = `${baseSlug}-${j.ROWID.slice(-6)}`;
      return withSuffix === slug;
    });

    if (!job) throw new NotFoundError(`Job ${slug} not found`);

    const publicProfile = toPublicJobProfile(job.ideal_profile, job.company_context);
    sendJson(ctx.res, 200, {
      slug,
      title: job.title,
      company: job.company,
      cognitive_level: job.cognitive_level,
      company_context: job.company_context,
      description: publicProfile.description,
      que_busco: publicProfile.que_busco,
      que_debe_hacer: publicProfile.que_debe_hacer,
      que_debe_saber: publicProfile.que_debe_saber,
      salary_range_usd: publicProfile.salary_range_usd,
      competencias: publicProfile.competencias,
      created_at: job.created_at,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(ctx.res, 400, { error: err.message });
    } else if (err instanceof NotFoundError) {
      sendJson(ctx.res, 404, { error: err.message });
    } else {
      log.error('getPublicJob failed', { error: (err as Error).message });
      sendJson(ctx.res, 500, { error: 'failed to fetch job' });
    }
  }
}

/**
 * POST /api/public/jobs/:slug/apply — aplica candidato al puesto.
 *
 * Body multipart/form-data:
 *   - first_name (text, required)
 *   - last_name (text, required)
 *   - email (text, required)
 *   - phone (text, required, con código país tipo "+507...")
 *   - age (number, required)
 *   - city (text, required)
 *   - country (text, required)
 *   - zona (text, optional — barrio/zona)
 *   - cv (file, required — PDF)
 *   - consent_terms (text "true", required)
 *
 * Acción:
 *   1. Valida campos + verifica que el job existe
 *   2. Guarda CV en File Store
 *   3. Crea Candidate (o reutiliza si email existe)
 *   4. Crea Application (Result) en stage 'prefilter_pending'
 *   5. Devuelve link de inicio del pipeline (para que el candidato arranque test)
 */
export async function applyToPublicJob(ctx: RequestContext): Promise<void> {
  try {
    const match = ctx.req.url?.match(/^\/api\/public\/jobs\/([^/?]+)\/apply/);
    const slug = match?.[1] ? decodeURIComponent(match[1]) : '';
    if (!slug) throw new ValidationError('slug missing in path');

    // 1. Buscar el Job por slug.
    const jobRows = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, cognitive_level, is_active, company_context, ideal_profile, created_at
         FROM Jobs WHERE is_active = true ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'Jobs',
    );
    const job = jobRows.find((j) => {
      const baseSlug = makeSlug(j.title);
      if (baseSlug === slug) return true;
      const withSuffix = `${baseSlug}-${j.ROWID.slice(-6)}`;
      return withSuffix === slug;
    });
    if (!job) throw new NotFoundError(`Job ${slug} not found`);

    // 2. Parsear multipart/form-data.
    const { parseMultipart } = await import('../lib/multipartParser.js');
    const parsed = await parseMultipart(ctx.req);

    const firstName = (parsed.fields.first_name ?? '').trim();
    const lastName = (parsed.fields.last_name ?? '').trim();
    const email = (parsed.fields.email ?? '').trim().toLowerCase();
    const phone = (parsed.fields.phone ?? '').trim();
    const ageStr = (parsed.fields.age ?? '').trim();
    const city = (parsed.fields.city ?? '').trim();
    const country = (parsed.fields.country ?? '').trim();
    // zona: campo opcional del form. Hoy no se persiste (Candidates no tiene columna `zona`).
    // Si en el futuro se agrega, descomentar acá y en el insert/update.
    // const zona = (parsed.fields.zona ?? '').trim();
    const consentTerms = (parsed.fields.consent_terms ?? '').trim().toLowerCase();

    // Validaciones obligatorias.
    if (!firstName) throw new ValidationError('first_name required');
    if (!lastName) throw new ValidationError('last_name required');
    if (!email) throw new ValidationError('email required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('invalid email');
    if (!phone) throw new ValidationError('phone required');
    if (!ageStr || !/^\d{2,3}$/.test(ageStr)) throw new ValidationError('age required (2-3 digits)');
    const age = parseInt(ageStr, 10);
    if (age < 16 || age > 99) throw new ValidationError('age must be 16-99');
    if (!city) throw new ValidationError('city required');
    if (!country) throw new ValidationError('country required');
    if (consentTerms !== 'true' && consentTerms !== '1' && consentTerms !== 'yes') {
      throw new ValidationError('consent_terms required (must accept terms)');
    }

    const cv = parsed.files.find((f) => f.fieldName === 'cv');
    if (!cv) throw new ValidationError('cv (PDF) required');
    if (!cv.mimeType.includes('pdf')) {
      throw new ValidationError('cv must be a PDF file');
    }
    if (cv.data.length > 10 * 1024 * 1024) {
      throw new ValidationError('cv too large (max 10MB)');
    }

    const candidateName = `${firstName} ${lastName}`.slice(0, 255);
    const tenantId = job.tenant_id;

    // 3. Guardar CV en File Store.
    const { uploadCvToFileStore } = await import('../lib/cvStorage.js');
    const cvFileId = await uploadCvToFileStore(ctx.req, cv.data, `${email}-${Date.now()}.pdf`);

    // 4. Buscar Candidate por email (Candidates NO es multi-tenant — la multi-tenancy
    // se hereda transitiva via Results.assessment_id → Jobs.tenant_id). Si no existe, crear.
    //
    // Schema real Candidates (verificado 2026-06-08): name, email, phone, age,
    // salary_expectation, availability, interview_file_id, created_at, recruit_candidate_id,
    // city (PII), country (PII). NO tiene: tenant_id, cv_file_id, source, consent_terms, zona.
    type CandidateRow = { ROWID: string };
    const existing = unwrapRows<CandidateRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    );
    let candidateId: string;
    if (existing[0]) {
      candidateId = existing[0].ROWID;
      await datastore(ctx.req).table('Candidates').updateRow({
        ROWID: candidateId,
        name: candidateName,
        phone: phone.slice(0, 50),
        city: city.slice(0, 100),
        country: country.slice(0, 60),
        // NO updated_at: Catalyst tiene MODIFIEDTIME auto.
      });
    } else {
      const inserted = await datastore(ctx.req).table('Candidates').insertRow({
        name: candidateName,
        email: email.slice(0, 255),
        phone: phone.slice(0, 50),
        age,
        salary_expectation: null,
        availability: null,
        interview_file_id: null,
        city: city.slice(0, 100),
        country: country.slice(0, 60),
        created_at: now(),
      });
      const row = unwrapRow<{ ROWID: string }>(inserted, 'Candidates');
      if (!row) throw new Error('Candidates insert returned null');
      candidateId = row.ROWID;
    }

    // 5. Crear Application (Result) en stage 'prefilter_pending'.
    // Schema real Results (verificado 2026-06-08): assessment_id, candidate_id, answers,
    // pipeline_stage, started_at (mandatory), completed_at, report_downloaded_at,
    // idempotency_key, sign_request_id, cv_file_id, consent_terms, source.
    // NO tiene: tenant_id, score_total, created_at, updated_at.
    const resultInserted = await datastore(ctx.req).table('Results').insertRow({
      assessment_id: job.ROWID,
      candidate_id: candidateId,
      pipeline_stage: 'prefilter_pending',
      started_at: now(),
      cv_file_id: cvFileId,
      consent_terms: 'true',
      source: 'career_site',
    });
    const resultRow = unwrapRow<{ ROWID: string }>(resultInserted, 'Results');
    if (!resultRow) throw new Error('Results insert returned null');
    const resultId = resultRow.ROWID;

    // 6. Disparar outbox event para email de confirmación + arrancar prefilter.
    // El handler dispatchApplicationCreated espera `application_id` (NO `result_id`) —
    // mismo naming que usa zohoRecruitWebhook. Result.ROWID == application_id por convención.
    try {
      const { publishAndProcessEvent } = await import('./outbox.js');
      const evResult = await publishAndProcessEvent(ctx.req, 'application.created', {
        tenant_id: tenantId,
        application_id: resultId,
        candidate_id: candidateId,
        job_id: job.ROWID,
        candidate_email: email,
        candidate_name: candidateName,
        candidate_phone: phone,
        job_title: job.title,
        company: job.company,
        source: 'career_site',
      });
      // Chequear si el dispatch interno falló. publishAndProcessEvent retorna {ok:false}
      // cuando el handler dispatchApplicationCreated falla (ej: email service inactivo,
      // template missing, network). Sin este log el fallo queda silenciado.
      if (!evResult.ok) {
        log.error('application.created dispatched but FAILED', {
          eventId: evResult.id,
          error: evResult.error ?? '(no error msg)',
          to: email.slice(0, 3) + '***',
          application_id: resultId,
        });
      } else {
        log.info('application.created dispatched OK', {
          eventId: evResult.id,
          to: email.slice(0, 3) + '***',
          application_id: resultId,
        });
      }
    } catch (err) {
      log.warn('application.created event publish threw', { error: (err as Error).message });
    }

    log.info('public career site application created', {
      slug, candidateId, resultId, job_id: job.ROWID,
      email_masked: email.slice(0, 3) + '***',
    });

    sendJson(ctx.res, 201, {
      ok: true,
      result_id: resultId,
      candidate_id: candidateId,
      next_step: 'check_email',
      message: 'Solicitud recibida. Te enviamos un correo con los próximos pasos del proceso.',
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(ctx.res, 400, { error: err.message });
    } else if (err instanceof NotFoundError) {
      sendJson(ctx.res, 404, { error: err.message });
    } else {
      // Errors de Catalyst datastore vienen como objetos planos sin .message.
      // Serializar TODO con getOwnPropertyNames + raw_serialized para diagnóstico.
      const e = err as Error & Record<string, unknown>;
      const detail: Record<string, unknown> = {};
      try {
        for (const k of Object.getOwnPropertyNames(e ?? {})) {
          detail[k] = (e as Record<string, unknown>)[k];
        }
        detail.raw_serialized = JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})).slice(0, 1000);
      } catch { /* ignore */ }
      log.error('applyToPublicJob failed', {
        message: e?.message ?? '(no message)',
        name: e?.name ?? '(no name)',
        stack: e?.stack?.slice(0, 500) ?? '(no stack)',
        detail,
      });
      sendJson(ctx.res, 500, {
        error: 'failed to submit application',
        debug: {
          message: e?.message ?? '(no message)',
          name: e?.name ?? '(no name)',
          detail,
        },
      });
    }
  }
}
