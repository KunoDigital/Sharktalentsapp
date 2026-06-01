/**
 * Listado de reportes del tenant — agregación derivada.
 *
 * Hoy NO leemos `ClientReports` directo (puede no existir todavía). Derivamos del estado
 * actual: para cada Job del tenant que tenga >= 1 finalist, hay potencialmente un reporte
 * para mostrar al cliente. Cuando exista la tabla `ClientReports`, agregamos `opened_count`
 * y `last_opened_at` desde ahí.
 *
 *   GET /api/reports  → listado de "reports candidates" (jobs con finalistas)
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('REPORTS');

const FINALIST_STAGES = ['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired'];

type ReportSummary = {
  job_id: string;
  job_title: string;
  job_company: string;
  job_active: boolean;
  finalists_count: number;
  total_applications: number;
  has_report: boolean; // hay finalists → hay reporte potencial
  // cache_info: cuando ClientReports exista, agregar opened_count, last_opened_at, generated_at
  cache_status: 'unknown' | 'cached' | 'missing';
  last_opened_at: string | null;
  opened_count: number;
};

type JobRow = {
  ROWID: string;
  title: string;
  company: string;
  is_active: number | boolean;
};

type ApplicationCountRow = {
  assessment_id: string;
  pipeline_stage: string;
};

type CachedReportRow = {
  job_id: string;
  generated_at: string;
  opened_count: number;
  last_opened_at: string | null;
};

export async function listReports(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  // 1. Cargar todos los jobs del tenant
  const jobs = unwrapRows<JobRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, title, company, is_active FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' ORDER BY CREATEDTIME DESC`,
    )) as unknown[],
    'Jobs',
  );

  if (jobs.length === 0) {
    sendJson(ctx.res, 200, { reports: [], count: 0 });
    return;
  }

  const jobIds = jobs.map((j) => `'${escapeSql(j.ROWID)}'`).join(', ');

  // 2. Stats de Applications por job: total + finalists
  const apps = unwrapRows<ApplicationCountRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT assessment_id, pipeline_stage FROM Results WHERE assessment_id IN (${jobIds})`,
    )) as unknown[],
    'Results',
  );

  const totalsByJob = new Map<string, number>();
  const finalistsByJob = new Map<string, number>();
  for (const a of apps) {
    totalsByJob.set(a.assessment_id, (totalsByJob.get(a.assessment_id) ?? 0) + 1);
    if (FINALIST_STAGES.includes(a.pipeline_stage)) {
      finalistsByJob.set(a.assessment_id, (finalistsByJob.get(a.assessment_id) ?? 0) + 1);
    }
  }

  // 3. Si ClientReports existe, traer info de cache (opened_count, last_opened_at) por job_id.
  const cachedByJob = new Map<string, CachedReportRow>();
  try {
    const cached = unwrapRows<CachedReportRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT job_id, generated_at, opened_count, last_opened_at
         FROM ClientReports
         WHERE tenant_id = '${escapeSql(tenantId)}' AND status = 'active'`,
      )) as unknown[],
      'ClientReports',
    );
    for (const c of cached) {
      // Si hay múltiples para un mismo job, quedarse con el más reciente
      const existing = cachedByJob.get(c.job_id);
      if (!existing || (c.generated_at > existing.generated_at)) {
        cachedByJob.set(c.job_id, c);
      }
    }
  } catch {
    // Tabla ClientReports no existe — seguimos sin info de cache
  }

  const reports: ReportSummary[] = jobs
    .map((job) => {
      const finalistsCount = finalistsByJob.get(job.ROWID) ?? 0;
      const total = totalsByJob.get(job.ROWID) ?? 0;
      const cache = cachedByJob.get(job.ROWID);
      return {
        job_id: job.ROWID,
        job_title: job.title,
        job_company: job.company,
        job_active: job.is_active === true || job.is_active === 1,
        finalists_count: finalistsCount,
        total_applications: total,
        has_report: finalistsCount > 0,
        cache_status: cache ? 'cached' : (finalistsCount > 0 ? 'missing' : 'unknown') as ReportSummary['cache_status'],
        last_opened_at: cache?.last_opened_at ?? null,
        opened_count: cache?.opened_count ?? 0,
      };
    })
    .filter((r) => r.has_report); // Solo mostrar jobs CON finalistas

  log.info('reports listed', { traceId: ctx.traceId, tenantId, count: reports.length });

  sendJson(ctx.res, 200, {
    reports,
    count: reports.length,
  });
}
