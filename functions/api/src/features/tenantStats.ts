/**
 * Stats globales del tenant.
 *
 *   GET /api/tenant/stats?months_back=6
 *
 * KPIs principales:
 *   - Jobs creados / cerrados (hired) por mes
 *   - Ratio aplicación → contrato (conversion rate)
 *   - Tiempo promedio de puesto abierto a cerrado
 *   - Total candidatos pool
 *   - Tiempo promedio de primera respuesta del cliente a draft
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('TENANT_STATS');

export async function getTenantStats(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const monthsBack = Math.max(1, Math.min(24, Number(url.searchParams.get('months_back') ?? 6)));
  const cutoffISO = new Date(Date.now() - monthsBack * 30 * 86400_000).toISOString();

  // 1. Jobs creados por mes
  type JobRow = { ROWID: string; created_at: string; is_active: boolean };
  let jobsCreated: JobRow[] = [];
  try {
    jobsCreated = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, created_at, is_active FROM Jobs
         WHERE tenant_id = '${escapeSql(tenantId)}' AND CREATEDTIME >= '${escapeSql(cutoffISO)}'
         ORDER BY CREATEDTIME DESC`,
      )) as unknown[],
      'Jobs',
    );
  } catch (err) {
    log.debug('jobs query failed', { error: (err as Error).message });
  }

  // 2. Results agregados (para ratios y conversiones)
  type ResultRow = { ROWID: string; pipeline_stage: string; created_at: string };
  let allResults: ResultRow[] = [];
  try {
    allResults = unwrapRows<ResultRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT R.ROWID, R.pipeline_stage, R.CREATEDTIME AS created_at
         FROM Results R
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE J.tenant_id = '${escapeSql(tenantId)}'
           AND R.CREATEDTIME >= '${escapeSql(cutoffISO)}'`,
      )) as unknown[],
      'Results',
    );
  } catch (err) {
    log.debug('results query failed', { error: (err as Error).message });
  }

  // Aggregations
  const totalApplied = allResults.length;
  const hired = allResults.filter((r) => r.pipeline_stage === 'hired').length;
  const finalists = allResults.filter((r) => ['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired'].includes(r.pipeline_stage)).length;
  const autoRejected = allResults.filter((r) => r.pipeline_stage.startsWith('auto_rejected')).length;
  const adminRejected = allResults.filter((r) => r.pipeline_stage === 'rejected_by_admin').length;

  const conversionRate = totalApplied > 0 ? Math.round((hired / totalApplied) * 1000) / 10 : null;
  const finalistRate = totalApplied > 0 ? Math.round((finalists / totalApplied) * 1000) / 10 : null;

  // Por mes
  function monthKey(iso: string): string {
    return iso.slice(0, 7); // YYYY-MM
  }
  const byMonth: Record<string, { jobs_created: number; applied: number; hired: number; finalists: number }> = {};
  for (const j of jobsCreated) {
    const m = monthKey(j.created_at);
    if (!byMonth[m]) byMonth[m] = { jobs_created: 0, applied: 0, hired: 0, finalists: 0 };
    byMonth[m].jobs_created += 1;
  }
  for (const r of allResults) {
    const m = monthKey(r.created_at);
    if (!byMonth[m]) byMonth[m] = { jobs_created: 0, applied: 0, hired: 0, finalists: 0 };
    byMonth[m].applied += 1;
    if (r.pipeline_stage === 'hired') byMonth[m].hired += 1;
    if (['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired'].includes(r.pipeline_stage)) byMonth[m].finalists += 1;
  }
  const monthly = Object.entries(byMonth)
    .map(([month, stats]) => ({ month, ...stats }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // 3. Tiempo promedio "puesto abierto → primer hired" (solo jobs con hired)
  let avgFillDays: number | null = null;
  try {
    const fillTimes: number[] = [];
    for (const j of jobsCreated) {
      const firstHired = allResults
        .filter((r) => r.pipeline_stage === 'hired')
        .map((r) => new Date(r.created_at).getTime())
        .sort((a, b) => a - b)[0];
      if (firstHired) {
        const days = (firstHired - new Date(j.created_at).getTime()) / 86400_000;
        if (days > 0 && days < 365) fillTimes.push(days);
      }
    }
    if (fillTimes.length > 0) {
      avgFillDays = Math.round(fillTimes.reduce((s, n) => s + n, 0) / fillTimes.length);
    }
  } catch { /* ignore */ }

  // 4. Pool size
  let poolSize: number | null = null;
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM CandidatePool WHERE tenant_id = '${escapeSql(tenantId)}'`,
      )) as unknown[],
      'CandidatePool',
    );
    poolSize = rows.length;
  } catch { /* tabla puede no existir */ }

  sendJson(ctx.res, 200, {
    period: { months_back: monthsBack, since: cutoffISO },
    summary: {
      jobs_created: jobsCreated.length,
      jobs_active: jobsCreated.filter((j) => j.is_active).length,
      total_applied: totalApplied,
      hired,
      finalists,
      auto_rejected: autoRejected,
      admin_rejected: adminRejected,
      conversion_rate_pct: conversionRate,
      finalist_rate_pct: finalistRate,
      avg_fill_days: avgFillDays,
      pool_size: poolSize,
    },
    monthly,
  });
}
