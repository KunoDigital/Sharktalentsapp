/**
 * Portal del cliente externo (la empresa que contrata a Cris ve sus puestos abiertos).
 *
 *   GET  /portal/:token            → JSON con todos los jobs del cliente + funnel stats
 *   GET  /portal/:token/jobs/:jobId → JSON con el job + funnel detallado + milestones + report_token
 *
 * Auth: token firmado HMAC con kind='portal'. Ver lib/clientPortalTokens.ts.
 *
 * El cliente NO ve datos de candidatos (nombres, scores). Solo conteos y stages.
 * Excepción: cuando hay finalists_ready, embebemos report_token (que sí muestra el reporte de finalistas).
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { TokenError, signToken, expiresIn, WEEK_SEC } from '../lib/urlSigning';
import { signPortalToken, verifyPortalToken } from '../lib/clientPortalTokens';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import type { PipelineStage } from '../lib/pipelineStateMachine';

const log = logger('CLIENT_PORTAL');

const PASSED_PREFILTER: readonly PipelineStage[] = [
  'prefilter_passed', 'tecnica_completed', 'conductual_completed',
  'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const TECNICA_DONE: readonly PipelineStage[] = [
  'tecnica_completed', 'conductual_completed', 'integridad_completed',
  'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const CONDUCTUAL_DONE: readonly PipelineStage[] = [
  'conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed',
  'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const INTEGRIDAD_DONE: readonly PipelineStage[] = [
  'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const FINALISTS: readonly PipelineStage[] = [
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];

export type PortalJobStage = 'profile_pending' | 'search_started' | 'funnel_active' | 'finalists_ready' | 'closed';

type PortalMilestone = {
  key: 'profile_ready' | 'search_started' | 'funnel_active' | 'finalists_ready';
  label: string;
  completed_at: string | null;
};

type PortalFunnelStats = {
  applied: number;
  prefilter_passed: number;
  tecnica_done: number;
  conductual_done: number;
  integridad_done: number;
  finalists: number;
  estimated_finalists_ready: string;
};

type JobRow = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  is_active: number | boolean;
  CREATEDTIME: string;
};

type ResultStageRow = {
  ROWID: string;
  pipeline_stage: PipelineStage;
  CREATEDTIME: string;
};

// ===== Handlers =====

export async function getClientPortal(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/', /^\/portal\/([^/?]+)\/?$/);
  if (!token) throw new ValidationError('token missing');

  const claims = verifyOrThrow(token);
  const jobs = await fetchJobsForPortal(ctx.req, claims.ref, claims.company);

  const portalJobs = await Promise.all(jobs.map(async (job) => {
    const results = await fetchResultsForJob(ctx.req, job.ROWID);
    return buildPortalJob(job, results);
  }));

  log.info('portal listed', { traceId: ctx.traceId, tenant: claims.ref, company: claims.company, jobs: portalJobs.length });

  sendJson(ctx.res, 200, {
    portal: {
      client_name: claims.client_name,
      client_email: claims.client_email,
      client_company: claims.company,
      agency_name: claims.agency_name,
      recruiter_email: process.env.RECRUITER_NOTIFY_EMAIL || process.env.ZEPTOMAIL_REPLY_TO || 'proyectos@kunodigital.com',
      recruiter_whatsapp: process.env.RECRUITER_WHATSAPP || null,
      jobs: portalJobs,
    },
  });
}

export async function getClientPortalJob(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/portal\/([^/?]+)\/jobs\/([^/?]+)\/?$/);
  if (!match) throw new ValidationError('token or jobId missing');
  const [, token, jobId] = match;

  const claims = verifyOrThrow(token);
  const jobs = await fetchJobsForPortal(ctx.req, claims.ref, claims.company);
  const job = jobs.find((j) => j.ROWID === jobId);

  if (!job) {
    throw new NotFoundError('Job not found in this portal');
  }

  const results = await fetchResultsForJob(ctx.req, job.ROWID);
  const portalJob = buildPortalJob(job, results);

  log.info('portal job listed', { traceId: ctx.traceId, tenant: claims.ref, jobId });

  // Preview de finalistas si está en stage 'finalists_ready' — para que el cliente
  // vea snapshot de los 3 sin tener que ir al reporte completo.
  let finalistsPreview: Array<{ display_name: string; one_liner: string; match_pct: number | null }> | undefined;
  if (portalJob.stage === 'finalists_ready') {
    try {
      const finalistRows = unwrapRows<{ candidate_name: string; final_score_pct: number | null; one_liner: string | null }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT C.name AS candidate_name, R.final_score_pct, R.one_liner
           FROM Results R JOIN Candidates C ON C.ROWID = R.candidate_id
           WHERE R.assessment_id = '${escapeSql(jobId)}' AND R.pipeline_stage = 'finalist'
           ORDER BY R.final_score_pct DESC NULLS LAST LIMIT 3`,
        )) as unknown[],
        'Results',
      );
      finalistsPreview = finalistRows.map((r) => ({
        // Mostrar primer nombre + inicial apellido (privacy)
        display_name: (r.candidate_name ?? '').split(/\s+/).filter(Boolean)
          .map((p: string, i: number) => i === 0 ? p : `${p[0]}.`).join(' '),
        one_liner: (r.one_liner ?? 'Pasó todas las evaluaciones con buen perfil para el puesto.').slice(0, 150),
        match_pct: r.final_score_pct == null ? null : Math.round(Number(r.final_score_pct)),
      }));
    } catch (err) {
      log.debug('finalists preview failed', { error: (err as Error).message });
    }
  }

  sendJson(ctx.res, 200, {
    portal: {
      client_name: claims.client_name,
      client_email: claims.client_email,
      client_company: claims.company,
      agency_name: claims.agency_name,
      recruiter_email: process.env.RECRUITER_NOTIFY_EMAIL || process.env.ZEPTOMAIL_REPLY_TO || 'proyectos@kunodigital.com',
      recruiter_whatsapp: process.env.RECRUITER_WHATSAPP || null,
    },
    job: portalJob,
    finalists_preview: finalistsPreview,
    fetched_at: new Date().toISOString(),
  });
}

// ===== Helpers =====

function extractTokenFromPath(url: string, regex: RegExp): string | null {
  return url.match(regex)?.[1] ?? null;
}

function verifyOrThrow(token: string) {
  try {
    return verifyPortalToken(token);
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw new UnauthorizedError(`Token: ${(err as Error).message}`);
  }
}

async function fetchJobsForPortal(req: IncomingMessage, tenantId: string, company: string): Promise<JobRow[]> {
  const q = `
    SELECT ROWID, tenant_id, title, company, is_active, CREATEDTIME
    FROM Jobs
    WHERE tenant_id = '${escapeSql(tenantId)}'
      AND company = '${escapeSql(company)}'
    ORDER BY CREATEDTIME DESC
  `.replace(/\s+/g, ' ');
  const raw = (await zcql(req).executeZCQLQuery(q)) as unknown[];
  return unwrapRows<JobRow>(raw, 'Jobs');
}

async function fetchResultsForJob(req: IncomingMessage, jobId: string): Promise<ResultStageRow[]> {
  const q = `
    SELECT ROWID, pipeline_stage, CREATEDTIME
    FROM Results
    WHERE assessment_id = '${escapeSql(jobId)}'
  `.replace(/\s+/g, ' ');
  const raw = (await zcql(req).executeZCQLQuery(q)) as unknown[];
  return unwrapRows<ResultStageRow>(raw, 'Results');
}

function buildPortalJob(job: JobRow, results: ResultStageRow[]) {
  const funnel = computeFunnel(results);
  const stage = computeStage(job, funnel);
  const milestones = computeMilestones(stage, job, results);

  const portalJob: {
    id: string;
    job_id: string;
    display_title: string;
    stage: PortalJobStage;
    created_at: string;
    funnel?: PortalFunnelStats;
    report_token?: string;
    milestones: PortalMilestone[];
  } = {
    id: job.ROWID,
    job_id: job.ROWID,
    display_title: job.title,
    stage,
    created_at: typeof job.CREATEDTIME === 'string' ? job.CREATEDTIME.slice(0, 10) : '',
    milestones,
  };

  if (stage === 'search_started' || stage === 'funnel_active') {
    portalJob.funnel = funnel;
  }
  if (stage === 'finalists_ready') {
    portalJob.funnel = funnel;
    // Token apunta al Job ROWID; el endpoint /report/bundle/<token> agrega todos los finalists.
    // Sin narrativas IA todavía (campo `narratives: null` en la respuesta).
    portalJob.report_token = signToken({
      kind: 'report_bundle',
      ref: job.ROWID,
      exp: expiresIn(WEEK_SEC),
    });
  }

  return portalJob;
}

function computeFunnel(results: ResultStageRow[]): PortalFunnelStats {
  const inAny = (s: PipelineStage, set: readonly PipelineStage[]) => set.includes(s);
  const applied = results.length;
  const prefilter_passed = results.filter((r) => inAny(r.pipeline_stage, PASSED_PREFILTER)).length;
  const tecnica_done = results.filter((r) => inAny(r.pipeline_stage, TECNICA_DONE)).length;
  const conductual_done = results.filter((r) => inAny(r.pipeline_stage, CONDUCTUAL_DONE)).length;
  const integridad_done = results.filter((r) => inAny(r.pipeline_stage, INTEGRIDAD_DONE)).length;
  const finalists = results.filter((r) => inAny(r.pipeline_stage, FINALISTS)).length;

  return {
    applied,
    prefilter_passed,
    tecnica_done,
    conductual_done,
    integridad_done,
    finalists,
    estimated_finalists_ready: estimateFinalists({
      applied, prefilter_passed, conductual_done, integridad_done, finalists,
    }),
  };
}

function estimateFinalists(f: { applied: number; prefilter_passed: number; conductual_done: number; integridad_done: number; finalists: number }): string {
  if (f.finalists > 0) return 'Finalistas listos';
  if (f.applied === 0) return 'Esperando candidatos';
  if (f.integridad_done >= 3) return 'En 1-3 días';
  if (f.conductual_done >= 3) return 'En 3-5 días';
  if (f.prefilter_passed >= 5) return 'En 5-7 días';
  return 'En 7-14 días (búsqueda activa)';
}

function computeStage(job: JobRow, funnel: PortalFunnelStats): PortalJobStage {
  const isActive = job.is_active === true || job.is_active === 1;
  if (!isActive) return 'closed';
  if (funnel.finalists > 0) return 'finalists_ready';
  if (funnel.applied > 0) return 'funnel_active';
  return 'search_started';
}

function computeMilestones(stage: PortalJobStage, job: JobRow, results: ResultStageRow[]): PortalMilestone[] {
  const created = typeof job.CREATEDTIME === 'string' ? job.CREATEDTIME.slice(0, 10) : null;
  const firstApplied = results
    .map((r) => (typeof r.CREATEDTIME === 'string' ? r.CREATEDTIME.slice(0, 10) : null))
    .filter((d): d is string => d !== null)
    .sort()[0] ?? null;

  const finalistDate = stage === 'finalists_ready' ? new Date().toISOString().slice(0, 10) : null;

  return [
    { key: 'profile_ready', label: 'Perfil del puesto listo', completed_at: created },
    { key: 'search_started', label: 'Búsqueda iniciada', completed_at: created },
    { key: 'funnel_active', label: 'Candidatos en evaluación', completed_at: firstApplied },
    { key: 'finalists_ready', label: 'Finalistas listos', completed_at: finalistDate },
  ];
}

// ===== Tenant-scoped: emite tokens del portal usando ctx.tenantId (sin X-Internal-Key) =====

export async function issuePortalForTenant(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const body = await readJsonBody<Record<string, unknown>>(ctx.req);

  const company = typeof body.company === 'string' ? body.company.trim() : '';
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const clientEmail = typeof body.client_email === 'string' ? body.client_email.trim() : '';
  const agencyName = typeof body.agency_name === 'string' && body.agency_name.trim()
    ? body.agency_name.trim()
    : (ctx.tenant?.name ?? 'Kuno Digital');
  const ttlDays = Number.isFinite(body.ttl_days) ? Number(body.ttl_days) : 90;

  if (!company) throw new ValidationError('company required');
  if (!clientName) throw new ValidationError('client_name required');
  if (!clientEmail || !clientEmail.includes('@')) throw new ValidationError('client_email required');
  if (ttlDays < 1 || ttlDays > 365) throw new ValidationError('ttl_days must be 1..365');

  const token = signPortalToken({
    ref: tenantId,
    company,
    client_name: clientName,
    client_email: clientEmail,
    agency_name: agencyName,
    ttl_days: ttlDays,
  });

  // Audit fire-and-forget; no expose el token en el log.
  auditLog(ctx, {
    action: 'portal.issued',
    resource_type: 'client_portal',
    resource_id: company,
    changes: { company, client_email: clientEmail, ttl_days: ttlDays },
  });

  log.info('portal token issued (tenant-scoped)', {
    traceId: ctx.traceId,
    tenantId,
    company,
    ttl_days: ttlDays,
  });

  // Notificar al cliente con el link de acceso. Falla suave: si el outbox no
  // está disponible (tabla no creada todavía) no bloquea la emisión del token.
  void (async () => {
    try {
      const { publishOutboxEvent } = await import('./outbox.js');
      const { env } = await import('../lib/env.js');
      const portalUrl = `${env().APP_BASE_URL}/portal/${token}`;
      await publishOutboxEvent(ctx.req, 'email.send_pending', {
        to: clientEmail,
        template: 'client_portal_access',
        locale: 'es',
        vars: {
          client_name: clientName,
          company,
          portal_url: portalUrl,
          agency_name: agencyName,
        },
      });
    } catch (err) {
      log.warn('portal_access email enqueue failed', { error: (err as Error).message });
    }
  })();

  sendJson(ctx.res, 200, {
    token,
    path: `/portal/${token}`,
    expires_in_days: ttlDays,
  });
}
