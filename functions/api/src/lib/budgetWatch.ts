/**
 * Budget watcher por puesto.
 *
 * Regla de negocio (decisión Cris 2026-06-04):
 *   Costos totales del puesto ≤ 20% del precio cobrado al cliente (fee_usd).
 *   Ejemplo: cobra $1500 → presupuesto $300.
 *
 * Política:
 *   - **NUNCA bloquear** ningún flujo. El sistema sigue funcionando aunque se pase.
 *   - 80% → alerta `warning` (aviso para que vos decidas).
 *   - 100% → alerta `critical` + post-mortem en el JobDetail.
 *
 * Tolerancia:
 *   - Si `Jobs.fee_usd` no está cargado (puestos viejos o columna pendiente de crear) →
 *     trackeamos silencioso, sin alertar. Cuando se cargue el fee, la próxima llamada
 *     calcula retroactivamente y dispara alerta si corresponde.
 *   - Si la tabla `SystemAlerts` no existe → log.warn y seguir.
 *
 * Idempotency:
 *   - Una sola alerta por umbral (80% / 100%) por puesto. Si ya hay una alerta abierta
 *     con el mismo `code`, no se duplica (uso `lib/alerting.ts` que ya hace dedup en
 *     ventana 30 min + agrupa por code+resource).
 *
 * Override de emergencia:
 *   - Env var `BUDGET_ALERTS_ENABLED=false` desactiva todas las alertas sin redeploy.
 */
import type { IncomingMessage } from 'http';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';
import { getJobCostSummary } from './costTracking';

const log = logger('BUDGET_WATCH');

/** Porcentaje del fee que define el presupuesto total del puesto. */
const BUDGET_PCT = 0.20;

/** Umbrales (porcentaje del presupuesto consumido) que disparan alerta. */
const WARN_THRESHOLD = 0.80;
const CRIT_THRESHOLD = 1.00;

function alertsEnabled(): boolean {
  return process.env.BUDGET_ALERTS_ENABLED !== 'false';
}

type JobFeeRow = { ROWID: string; tenant_id: string | null; title: string | null; fee_usd: number | null };

async function fetchJobFee(req: IncomingMessage, jobId: string): Promise<JobFeeRow | null> {
  try {
    const rows = unwrapRows<JobFeeRow>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, fee_usd FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    return rows[0] ?? null;
  } catch (err) {
    // Si la columna fee_usd no existe todavía, ZCQL tira error de columna inválida.
    // Tolerante: log debug y devolver null para que el flujo no rompa.
    log.debug('Jobs.fee_usd query failed (column missing?)', { jobId, error: (err as Error).message });
    return null;
  }
}

export type BudgetStatus = {
  job_id: string;
  fee_usd: number | null;
  budget_usd: number | null;
  spent_usd: number;
  pct_consumed: number | null;
  level: 'ok' | 'warn' | 'crit' | 'no_fee';
  by_type: Record<string, number>;
};

/**
 * Snapshot del estado de presupuesto de un Job — usado por el frontend (JobDetail barra).
 */
export async function getBudgetStatus(req: IncomingMessage, jobId: string): Promise<BudgetStatus> {
  const summary = await getJobCostSummary(req, jobId);
  const job = await fetchJobFee(req, jobId);
  const fee = job?.fee_usd ?? null;
  const budget = fee && fee > 0 ? fee * BUDGET_PCT : null;
  const spent = summary.total_usd;
  const pct = budget ? spent / budget : null;
  const level: BudgetStatus['level'] =
    !budget ? 'no_fee'
    : pct! >= CRIT_THRESHOLD ? 'crit'
    : pct! >= WARN_THRESHOLD ? 'warn'
    : 'ok';
  const byType: Record<string, number> = {};
  for (const [type, agg] of Object.entries(summary.by_type)) {
    byType[type] = Math.round(agg.total_usd * 10000) / 10000;
  }
  return {
    job_id: jobId,
    fee_usd: fee,
    budget_usd: budget,
    spent_usd: Math.round(spent * 10000) / 10000,
    pct_consumed: pct === null ? null : Math.round(pct * 1000) / 1000,
    level,
    by_type: byType,
  };
}

/**
 * Chequea presupuesto de un puesto tras un nuevo gasto. Dispara alerta si cruzó umbral.
 * Diseñado para llamarse fire-and-forget desde trackJobCost.
 */
export async function checkJobBudget(
  req: IncomingMessage,
  jobId: string,
  tenantId: string | undefined,
): Promise<void> {
  if (!alertsEnabled()) return;
  const status = await getBudgetStatus(req, jobId);
  if (status.level === 'ok' || status.level === 'no_fee') return;

  // Construir mensaje con post-mortem mini (qué tipo de costo se disparó).
  const topType = Object.entries(status.by_type)
    .sort((a, b) => b[1] - a[1])
    .filter(([, amount]) => amount > 0)[0];
  const breakdown = Object.entries(status.by_type)
    .filter(([, amount]) => amount > 0)
    .map(([type, amount]) => `${type}=$${amount.toFixed(2)}`)
    .join(' · ');

  try {
    const { alertCris } = await import('./alerting.js');
    if (status.level === 'crit') {
      await alertCris(req, {
        severity: 'critical',
        code: 'budget.over_100',
        message: `Puesto pasó 100% del presupuesto ($${status.spent_usd.toFixed(2)} de $${status.budget_usd?.toFixed(2)} = ${Math.round((status.pct_consumed ?? 0) * 100)}%)`,
        context: {
          job_id: jobId,
          fee_usd: status.fee_usd,
          budget_usd: status.budget_usd,
          spent_usd: status.spent_usd,
          pct_consumed: status.pct_consumed,
          breakdown,
          top_cost_type: topType?.[0] ?? null,
          top_cost_amount: topType?.[1] ?? null,
        },
        tenantId,
        resourceType: 'job',
        resourceId: jobId,
      });
    } else if (status.level === 'warn') {
      await alertCris(req, {
        severity: 'warning',
        code: 'budget.over_80',
        message: `Puesto cruzó 80% del presupuesto ($${status.spent_usd.toFixed(2)} de $${status.budget_usd?.toFixed(2)} = ${Math.round((status.pct_consumed ?? 0) * 100)}%)`,
        context: {
          job_id: jobId,
          fee_usd: status.fee_usd,
          budget_usd: status.budget_usd,
          spent_usd: status.spent_usd,
          pct_consumed: status.pct_consumed,
          breakdown,
        },
        tenantId,
        resourceType: 'job',
        resourceId: jobId,
      });
    }
  } catch (err) {
    log.warn('budget alert dispatch failed', { jobId, level: status.level, error: (err as Error).message });
  }
}
