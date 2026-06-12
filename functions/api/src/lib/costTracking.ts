/**
 * Tracking de costos por puesto.
 *
 * Por cada gasto atribuible a un Job (llamada Anthropic, email enviado, WhatsApp,
 * storage de videos), registra una línea en `JobCosts`. El dashboard de JobDetail
 * agrega por tipo y muestra el costo total al recruiter.
 *
 * **Diseño tolerante:** si la tabla JobCosts no existe (Block 3 deferred), las
 * llamadas no rompen — solo loggean warning. Cuando Cris crea la tabla en Catalyst
 * Console, automáticamente empieza a tracking.
 */

import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';

const log = logger('COST_TRACKING');
// 2026-06-04: nombre original "JobCosts" quedó envenenado tras orphan en Catalyst API; renombrado.
const TABLE = 'JobCostEvents';

// 2026-06-04: agregado 'ads' para tracking manual de pauta LinkedIn (regla 20% por puesto).
export type CostType = 'anthropic' | 'email' | 'whatsapp' | 'storage' | 'ads';

export type TrackCostInput = {
  jobId: string;
  tenantId?: string;
  type: CostType;
  amountUsd: number;
  count?: number;
  /** Contexto para debugging: feature, recipient, file_id, etc. */
  metadata?: Record<string, unknown>;
};

// 2026-06-04 (audit fix #26): TTL en el cache "table not ready" para que detecte la tabla
// cuando Cris la cree en Catalyst sin requerir cold-start. Si la última vez dijo "ready",
// cache duro para siempre (las tablas no se borran). Si dijo "no ready", re-checkea en 60s.
let tableReady: boolean | null = null;
let tableReadyCheckedAt = 0;
const NOT_READY_TTL_MS = 60_000;

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady === true) return true;
  if (tableReady === false && Date.now() - tableReadyCheckedAt < NOT_READY_TTL_MS) return false;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
    tableReadyCheckedAt = Date.now();
  }
  return tableReady;
}

export function _resetJobCostsCache(): void {
  tableReady = null;
  tableReadyCheckedAt = 0;
}

/**
 * Registra un gasto atribuible a un job. Fire-and-forget — no bloquea ni rompe el caller.
 */
export async function trackJobCost(req: IncomingMessage, input: TrackCostInput): Promise<void> {
  if (!input.jobId) return;
  if (!(await isTableReady(req))) {
    log.debug('JobCosts table not ready — cost not persisted', { type: input.type, amount: input.amountUsd });
    return;
  }

  try {
    await datastore(req).table(TABLE).insertRow({
      job_id: input.jobId,
      tenant_id: input.tenantId ?? null,
      cost_type: input.type,
      amount_usd: input.amountUsd,
      count: input.count ?? 1,
      occurred_at: now(),
      metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 2000) : null,
    });
  } catch (err) {
    log.warn('trackJobCost persistence failed', { type: input.type, error: (err as Error).message });
    return;
  }

  // Después de cada gasto: chequear si el puesto cruzó el umbral del 80% o 100% del presupuesto.
  // No bloquea, solo alerta. Tolerante a fee_usd ausente (no alerta si no hay precio cargado).
  try {
    const { checkJobBudget } = await import('./budgetWatch.js');
    void checkJobBudget(req, input.jobId, input.tenantId);
  } catch { /* tolerar */ }
}

export type CostSummary = {
  by_type: Record<CostType, { total_usd: number; count: number }>;
  total_usd: number;
  total_events: number;
  first_event_at: string | null;
  last_event_at: string | null;
};

/**
 * Devuelve el resumen agregado de costos de un Job para mostrar en el dashboard.
 * Devuelve summary vacío si la tabla no existe — el dashboard muestra "$0.00".
 */
export async function getJobCostSummary(req: IncomingMessage, jobId: string): Promise<CostSummary> {
  const empty: CostSummary = {
    by_type: {
      anthropic: { total_usd: 0, count: 0 },
      email: { total_usd: 0, count: 0 },
      whatsapp: { total_usd: 0, count: 0 },
      storage: { total_usd: 0, count: 0 },
      ads: { total_usd: 0, count: 0 },
    },
    total_usd: 0,
    total_events: 0,
    first_event_at: null,
    last_event_at: null,
  };
  if (!(await isTableReady(req))) return empty;

  try {
    const rows = unwrapRows<{
      cost_type: CostType;
      amount_usd: number;
      count: number;
      occurred_at: string;
    }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT cost_type, amount_usd, count, occurred_at FROM ${TABLE}
         WHERE job_id = '${escapeSql(jobId)}'`,
      )) as unknown[],
      TABLE,
    );

    let totalUsd = 0;
    let totalEvents = 0;
    let firstAt: string | null = null;
    let lastAt: string | null = null;

    for (const r of rows) {
      const type = r.cost_type;
      const amt = Number(r.amount_usd) || 0;
      const cnt = Number(r.count) || 1;
      empty.by_type[type].total_usd += amt;
      empty.by_type[type].count += cnt;
      totalUsd += amt;
      totalEvents += cnt;
      if (!firstAt || r.occurred_at < firstAt) firstAt = r.occurred_at;
      if (!lastAt || r.occurred_at > lastAt) lastAt = r.occurred_at;
    }

    empty.total_usd = Math.round(totalUsd * 10000) / 10000;
    empty.total_events = totalEvents;
    empty.first_event_at = firstAt;
    empty.last_event_at = lastAt;
    return empty;
  } catch (err) {
    log.warn('getJobCostSummary query failed', { jobId, error: (err as Error).message });
    return empty;
  }
}

/**
 * Tarifas de costo por unidad para servicios donde hay un costo monetario claro.
 */
export const SERVICE_COSTS = {
  /** ZeptoMail: free tier 6000 emails/mes, después $0.80 cada 1000 = $0.0008/email */
  email_per_send_usd: 0,  // dentro de free tier hasta superar 6000/mes
  /** WhatsApp Twilio: $0.005 por mensaje */
  whatsapp_per_send_usd: 0.005,
  /** Catalyst File Store: ~$0.02/GB-mes. Storage cost por video estimado en runtime. */
  storage_per_mb_usd: 0.00002,
} as const;
