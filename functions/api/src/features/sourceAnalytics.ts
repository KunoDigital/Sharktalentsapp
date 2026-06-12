/**
 * Comparativa de candidatos por fuente.
 *
 *   GET /api/tenant/sources?months_back=6
 *
 * Para cada fuente (Recruit/LinkedIn, Pool histórico, Outbound HeyReach, Directo),
 * agrega counts y conversión a finalist/hired.
 *
 * Heurística de detección de fuente (hasta que haya campo `source` explícito):
 *   - Tiene recruit_candidate_id → 'recruit_linkedin'
 *   - Aparece en CandidatePool → 'pool_internal'
 *   - Tiene heyreach_lead_id o source='heyreach' → 'outbound_heyreach'
 *   - Resto → 'direct'
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('SOURCE_ANALYTICS');

type Source = 'recruit_linkedin' | 'pool_internal' | 'outbound_heyreach' | 'direct';

const SOURCE_LABEL: Record<Source, string> = {
  recruit_linkedin: 'Recruit / LinkedIn',
  pool_internal: 'Pool interno',
  outbound_heyreach: 'Outbound (HeyReach)',
  direct: 'Directo',
};

export async function getSourceAnalytics(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const monthsBack = Math.max(1, Math.min(24, Number(url.searchParams.get('months_back') ?? 6)));
  const cutoffISO = new Date(Date.now() - monthsBack * 30 * 86400_000).toISOString();

  // Cargar applications con datos de candidate
  type Row = {
    ROWID: string;
    pipeline_stage: string;
    candidate_id: string;
    recruit_candidate_id: string | null;
    created_at: string;
  };

  let rows: Row[] = [];
  try {
    rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT R.ROWID, R.pipeline_stage, R.candidate_id,
                C.recruit_candidate_id, R.CREATEDTIME AS created_at
         FROM Results R
         JOIN Candidates C ON C.ROWID = R.candidate_id
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE J.tenant_id = '${escapeSql(tenantId)}'
           AND R.CREATEDTIME >= '${escapeSql(cutoffISO)}'`,
      )) as unknown[],
      'Results',
    );
  } catch (err) {
    log.debug('results query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { sources: [], total: 0, period: { months_back: monthsBack } });
    return;
  }

  // Cargar pool entries para detectar candidatos de pool
  let poolCandidateIds = new Set<string>();
  try {
    const poolRows = unwrapRows<{ candidate_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT candidate_id FROM CandidatePool WHERE tenant_id = '${escapeSql(tenantId)}'`,
      )) as unknown[],
      'CandidatePool',
    );
    poolCandidateIds = new Set(poolRows.map((r) => r.candidate_id));
  } catch { /* tabla puede no existir */ }

  // Determinar source por aplicación
  function detectSource(r: Row): Source {
    if (r.recruit_candidate_id) return 'recruit_linkedin';
    if (poolCandidateIds.has(r.candidate_id)) return 'pool_internal';
    // outbound_heyreach requeriría campo source en Candidate — fallback direct por ahora
    return 'direct';
  }

  // Agregar por source
  type SourceStats = {
    source: Source;
    label: string;
    applied: number;
    passed_prescreening: number;
    completed_tests: number;
    finalists: number;
    hired: number;
    rejected: number;
    finalist_rate_pct: number | null;
    conversion_rate_pct: number | null;
  };

  const FINALIST_STAGES = new Set(['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired']);
  const COMPLETED_TESTS_STAGES = new Set([
    'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance',
    ...FINALIST_STAGES,
  ]);
  const PASSED_PRESC_STAGES = new Set([
    'prefilter_passed', 'tecnica_completed', 'conductual_completed',
    ...COMPLETED_TESTS_STAGES,
  ]);
  const REJECTED_STAGES = new Set(['rejected_by_admin', 'auto_rejected_low_score', 'auto_rejected_disc_mismatch', 'auto_rejected_english_failed', 'auto_rejected_mindset_limiting']);

  const grouped: Record<Source, SourceStats> = {
    recruit_linkedin: emptyStats('recruit_linkedin'),
    pool_internal: emptyStats('pool_internal'),
    outbound_heyreach: emptyStats('outbound_heyreach'),
    direct: emptyStats('direct'),
  };

  function emptyStats(s: Source): SourceStats {
    return {
      source: s,
      label: SOURCE_LABEL[s],
      applied: 0,
      passed_prescreening: 0,
      completed_tests: 0,
      finalists: 0,
      hired: 0,
      rejected: 0,
      finalist_rate_pct: null,
      conversion_rate_pct: null,
    };
  }

  for (const r of rows) {
    const s = detectSource(r);
    grouped[s].applied += 1;
    if (PASSED_PRESC_STAGES.has(r.pipeline_stage)) grouped[s].passed_prescreening += 1;
    if (COMPLETED_TESTS_STAGES.has(r.pipeline_stage)) grouped[s].completed_tests += 1;
    if (FINALIST_STAGES.has(r.pipeline_stage)) grouped[s].finalists += 1;
    if (r.pipeline_stage === 'hired') grouped[s].hired += 1;
    if (REJECTED_STAGES.has(r.pipeline_stage)) grouped[s].rejected += 1;
  }

  // Calcular ratios
  for (const stats of Object.values(grouped)) {
    if (stats.applied > 0) {
      stats.finalist_rate_pct = Math.round((stats.finalists / stats.applied) * 1000) / 10;
      stats.conversion_rate_pct = Math.round((stats.hired / stats.applied) * 1000) / 10;
    }
  }

  // Ordenar por volumen
  const sources = Object.values(grouped)
    .filter((s) => s.applied > 0)
    .sort((a, b) => b.applied - a.applied);

  sendJson(ctx.res, 200, {
    sources,
    total: rows.length,
    period: { months_back: monthsBack, since: cutoffISO },
  });
}
