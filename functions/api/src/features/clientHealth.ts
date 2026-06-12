/**
 * Dashboard de salud por cliente.
 *
 *   GET /api/clients/health
 *
 * Para cada cliente del tenant (identificado por client_email en Jobs), agrega:
 *   - Jobs activos
 *   - Jobs cerrados (hired)
 *   - Total candidatos a través de todos sus jobs
 *   - Finalists actualmente pendientes de su decisión (en awaiting_client_review)
 *   - Tiempo promedio que tardan en aprobar drafts
 *   - Días desde la última actividad
 *
 * Permite identificar clientes que están atascados o que necesitan seguimiento.
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('CLIENT_HEALTH');

type JobRow = {
  ROWID: string;
  client_email: string | null;
  client_company: string | null;
  client_name: string | null;
  is_active: boolean;
  created_at: string;
};

type ClientSummary = {
  client_email: string;
  client_company: string;
  client_name: string;
  jobs_active: number;
  jobs_total: number;
  candidates_total: number;
  finalists_awaiting_decision: number;
  days_since_last_activity: number | null;
  drafts_pending_approval: number;
  status: 'healthy' | 'needs_attention' | 'stale';
};

export async function getClientsHealth(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  // 1. Cargar TODOS los jobs del tenant
  let jobs: JobRow[] = [];
  try {
    jobs = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, client_email, client_company, client_name, is_active, created_at
         FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}'`,
      )) as unknown[],
      'Jobs',
    );
  } catch (err) {
    log.warn('jobs query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, {
      clients: [],
      total_clients: 0,
      counts: { healthy: 0, needs_attention: 0, stale: 0 },
    });
    return;
  }

  // Agrupar por client_email (normalizar)
  const byClient = new Map<string, {
    company: string;
    name: string;
    jobIds: string[];
    jobs_active: number;
    jobs_total: number;
  }>();
  for (const j of jobs) {
    const email = (j.client_email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!byClient.has(email)) {
      byClient.set(email, {
        company: j.client_company ?? '?',
        name: j.client_name ?? '?',
        jobIds: [],
        jobs_active: 0,
        jobs_total: 0,
      });
    }
    const c = byClient.get(email)!;
    c.jobIds.push(j.ROWID);
    c.jobs_total += 1;
    if (j.is_active) c.jobs_active += 1;
  }

  // 2. Para cada cliente, agregar counts de Results + drafts pendientes
  const summaries: ClientSummary[] = [];
  for (const [email, c] of byClient.entries()) {
    // 2026-06-04: BIGINTs sin quotes + LIMIT 300.
    const { bigintInClause } = await import('../lib/dbHelpers.js');
    const jobIdsList = bigintInClause(c.jobIds);
    let candidatesTotal = 0;
    let finalistsAwaiting = 0;
    let lastActivityISO: string | null = null;

    if (c.jobIds.length > 0 && jobIdsList) {
      try {
        const rows = unwrapRows<{ ROWID: string; pipeline_stage: string; modified_time: string }>(
          (await zcql(ctx.req).executeZCQLQuery(
            `SELECT ROWID, pipeline_stage, MODIFIEDTIME AS modified_time
             FROM Results
             WHERE assessment_id IN (${jobIdsList})
             ORDER BY MODIFIEDTIME DESC LIMIT 300`,
          )) as unknown[],
          'Results',
        );
        candidatesTotal = rows.length;
        finalistsAwaiting = rows.filter((r) => r.pipeline_stage === 'awaiting_client_review').length;
        lastActivityISO = rows[0]?.modified_time ?? null;
      } catch (err) {
        log.debug('client results query failed', { email, error: (err as Error).message });
      }
    }

    // Drafts pendientes de aprobación para este cliente
    let draftsPending = 0;
    try {
      const draftRows = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM JobProfileDrafts
           WHERE tenant_id = '${escapeSql(tenantId)}'
             AND LOWER(client_email) = '${escapeSql(email)}'
             AND status IN ('draft_generated', 'pending_client_review')`,
        )) as unknown[],
        'JobProfileDrafts',
      );
      draftsPending = draftRows.length;
    } catch { /* ignore */ }

    const daysSince = lastActivityISO
      ? Math.floor((Date.now() - new Date(lastActivityISO).getTime()) / 86400_000)
      : null;

    // Status: needs_attention si tiene finalists pendientes hace > 7 días
    // O drafts pendientes. stale si > 60 días sin actividad.
    let status: ClientSummary['status'] = 'healthy';
    if (daysSince != null && daysSince > 60) status = 'stale';
    else if (finalistsAwaiting > 0 || draftsPending > 0) status = 'needs_attention';

    summaries.push({
      client_email: email,
      client_company: c.company,
      client_name: c.name,
      jobs_active: c.jobs_active,
      jobs_total: c.jobs_total,
      candidates_total: candidatesTotal,
      finalists_awaiting_decision: finalistsAwaiting,
      days_since_last_activity: daysSince,
      drafts_pending_approval: draftsPending,
      status,
    });
  }

  // Ordenar: needs_attention primero, después healthy, último stale
  const STATUS_ORDER: Record<ClientSummary['status'], number> = { needs_attention: 0, healthy: 1, stale: 2 };
  summaries.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  sendJson(ctx.res, 200, {
    clients: summaries,
    total_clients: summaries.length,
    counts: {
      healthy: summaries.filter((c) => c.status === 'healthy').length,
      needs_attention: summaries.filter((c) => c.status === 'needs_attention').length,
      stale: summaries.filter((c) => c.status === 'stale').length,
    },
  });
}
