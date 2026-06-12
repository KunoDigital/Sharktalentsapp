/**
 * Endpoint del Dashboard: queue agregado de cosas que requieren acción.
 *
 *   GET /api/dashboard/queue
 *
 * Devuelve counts + items principales para mostrar en la "action queue" del
 * Dashboard. Una sola query del frontend en vez de 5 separadas.
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('DASHBOARD');

type QueueItem = {
  type: 'draft_pending' | 'bot_review' | 'finalists_ready_to_send' | 'candidate_stuck' | 'critical_alert' | 'good_news';
  count: number;
  items?: Array<{ id: string; label: string; hint?: string; link: string }>;
};

/** Códigos de SystemAlerts severity='warning' que son eventos POSITIVOS del negocio
 * (no problemas) — se muestran en una sección separada "Novedades" del dashboard. */
const GOOD_NEWS_CODES = ['marketing.contract.signed', 'marketing.contract.sent', 'candidate.offer.signed'];

export async function getDashboardQueue(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const queue: QueueItem[] = [];

  // 1. Drafts pendientes (status='client_approved' o 'draft_generated' que Cris debe revisar)
  try {
    const rows = unwrapRows<{ ROWID: string; client_company: string; status: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, client_company, status FROM JobProfileDrafts
         WHERE tenant_id = '${escapeSql(tenantId)}'
           AND status IN ('draft_generated', 'pending_client_review', 'client_approved')
         ORDER BY CREATEDTIME DESC LIMIT 20`,
      )) as unknown[],
      'JobProfileDrafts',
    );
    if (rows.length > 0) {
      queue.push({
        type: 'draft_pending',
        count: rows.length,
        items: rows.slice(0, 5).map((r) => ({
          id: r.ROWID,
          label: r.client_company || 'Cliente',
          hint: r.status,
          link: `/drafts/${r.ROWID}`,
        })),
      });
    }
  } catch (err) {
    log.debug('drafts query failed', { error: (err as Error).message });
  }

  // 2. Bot decisions en review queue
  try {
    const rows = unwrapRows<{ ROWID: string; result_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, result_id FROM ReviewQueue
         WHERE tenant_id = '${escapeSql(tenantId)}' AND resolved_at IS NULL
         LIMIT 20`,
      )) as unknown[],
      'ReviewQueue',
    );
    if (rows.length > 0) {
      queue.push({
        type: 'bot_review',
        count: rows.length,
        items: rows.slice(0, 5).map((r) => ({
          id: r.ROWID,
          label: `Candidato ${r.result_id.slice(-6)}`,
          link: `/bot/review`,
        })),
      });
    }
  } catch (err) {
    log.debug('bot review query failed', { error: (err as Error).message });
  }

  // 3. Jobs con 3+ finalistas que NO recibieron email finalists_ready
  try {
    type Row = { ROWID: string; title: string; client_company: string; finalist_count: number };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT J.ROWID, J.title, J.client_company, COUNT(R.ROWID) AS finalist_count
         FROM Jobs J
         JOIN Results R ON R.assessment_id = J.ROWID
         WHERE J.tenant_id = '${escapeSql(tenantId)}'
           AND J.is_active = true
           AND R.pipeline_stage = 'finalist'
         GROUP BY J.ROWID, J.title, J.client_company
         HAVING COUNT(R.ROWID) >= 3 LIMIT 20`,
      )) as unknown[],
      'Jobs',
    );
    // Filtrar por jobs que ya recibieron el email (chequear OutboxEvents)
    const pending: typeof rows = [];
    for (const j of rows) {
      try {
        const sent = unwrapRows<{ ROWID: string }>(
          (await zcql(ctx.req).executeZCQLQuery(
            `SELECT ROWID FROM OutboxEvents
             WHERE event_type = 'client.notify.finalists_ready'
               AND payload LIKE '%"job_id":"${escapeSql(j.ROWID)}"%' LIMIT 1`,
          )) as unknown[],
          'OutboxEvents',
        );
        if (sent.length === 0) pending.push(j);
      } catch { pending.push(j); }
    }
    if (pending.length > 0) {
      queue.push({
        type: 'finalists_ready_to_send',
        count: pending.length,
        items: pending.slice(0, 5).map((j) => ({
          id: j.ROWID,
          label: `${j.title} · ${j.client_company}`,
          hint: `${j.finalist_count} finalistas`,
          link: `/jobs/${j.ROWID}`,
        })),
      });
    }
  } catch (err) {
    log.debug('finalists query failed', { error: (err as Error).message });
  }

  // 4. Alertas críticas abiertas
  try {
    const rows = unwrapRows<{ ROWID: string; code: string; message: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, code, message FROM SystemAlerts
         WHERE status = 'open' AND severity = 'critical' LIMIT 10`,
      )) as unknown[],
      'SystemAlerts',
    );
    if (rows.length > 0) {
      queue.push({
        type: 'critical_alert',
        count: rows.length,
        items: rows.slice(0, 3).map((a) => ({
          id: a.ROWID,
          label: a.code,
          hint: a.message,
          link: `/alerts`,
        })),
      });
    }
  } catch (err) {
    log.debug('alerts query failed', { error: (err as Error).message });
  }

  // 4b. Novedades (warnings con códigos positivos: cliente firmó, candidato firmó, etc.)
  try {
    const codeList = GOOD_NEWS_CODES.map((c) => `'${escapeSql(c)}'`).join(', ');
    const rows = unwrapRows<{ ROWID: string; code: string; message: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, code, message FROM SystemAlerts
         WHERE status = 'open' AND severity = 'warning' AND code IN (${codeList})
         ORDER BY CREATEDTIME DESC LIMIT 10`,
      )) as unknown[],
      'SystemAlerts',
    );
    if (rows.length > 0) {
      queue.push({
        type: 'good_news',
        count: rows.length,
        items: rows.slice(0, 5).map((a) => ({
          id: a.ROWID,
          label: a.code === 'marketing.contract.signed' ? 'Cliente firmó contrato' : a.code,
          hint: a.message,
          link: `/alerts`,
        })),
      });
    }
  } catch (err) {
    log.debug('good news query failed', { error: (err as Error).message });
  }

  // 5. Candidatos stuck — en stages activos sin completar hace > 5 días
  try {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000).toISOString();
    type Row = { ROWID: string; candidate_name: string; job_title: string; pipeline_stage: string };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT R.ROWID, C.name AS candidate_name, J.title AS job_title, R.pipeline_stage
         FROM Results R
         JOIN Candidates C ON C.ROWID = R.candidate_id
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE J.tenant_id = '${escapeSql(tenantId)}'
           AND R.pipeline_stage IN ('prefilter_pending', 'prefilter_passed', 'tecnica_completed', 'conductual_completed', 'integridad_completed', 'videos_pending')
           AND R.completed_at IS NULL
           AND R.MODIFIEDTIME <= '${escapeSql(fiveDaysAgo)}'
         ORDER BY R.MODIFIEDTIME ASC LIMIT 20`,
      )) as unknown[],
      'Results',
    );
    if (rows.length > 0) {
      queue.push({
        type: 'candidate_stuck',
        count: rows.length,
        items: rows.slice(0, 5).map((r) => ({
          id: r.ROWID,
          label: r.candidate_name || 'Candidato',
          hint: `${r.job_title} · ${r.pipeline_stage}`,
          link: `/candidates/${r.ROWID}`,
        })),
      });
    }
  } catch (err) {
    log.debug('stuck candidates query failed', { error: (err as Error).message });
  }

  // Total accion items
  const total = queue.reduce((s, q) => s + q.count, 0);

  sendJson(ctx.res, 200, {
    total,
    queue,
    checked_at: new Date().toISOString(),
  });
}
