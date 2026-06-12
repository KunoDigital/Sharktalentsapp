/**
 * Operations endpoints — vistas operativas/financieras del tenant.
 *
 *   GET /api/operations/expenses?month=YYYY-MM
 *     → desglose de gastos del mes: por servicio, por puesto, por cliente.
 *
 * Auth: tenant. Cada admin ve solo los gastos de su tenant (multi-tenancy
 * heredada via JobCostEvents.tenant_id).
 *
 * Limitaciones conocidas (anotadas en docs/MEJORAS.md):
 *   - Storage no se mide automático (gap <2%)
 *   - WhatsApp no integrado todavía (Twilio diferido)
 *   - Anthropic sin job_id queda sin atribuir
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { ValidationError } from '../lib/errors';

const log = logger('OPERATIONS');

type CostEventRow = {
  ROWID: string;
  job_id: string;
  cost_type: 'anthropic' | 'email' | 'whatsapp' | 'storage' | 'ads';
  amount_usd: number;
  count: number;
  occurred_at: string;
};

type JobInfo = {
  ROWID: string;
  title: string;
  company: string;
  fee_usd: number | null;
};

type ServiceBreakdown = {
  service: 'anthropic' | 'email' | 'whatsapp' | 'storage' | 'ads';
  total_usd: number;
  events_count: number;
};

type JobBreakdown = {
  job_id: string;
  title: string;
  company: string;
  fee_usd: number | null;
  total_usd: number;
  ratio_pct: number | null;
  by_service: Record<string, number>;
};

type ClientBreakdown = {
  company: string;
  total_usd: number;
  jobs_count: number;
  by_service: Record<string, number>;
};

type ExpensesResponse = {
  month: string;
  range: { from_iso: string; to_iso: string };
  total_usd: number;
  total_fee_usd: number;
  ratio_overall_pct: number | null;
  by_service: ServiceBreakdown[];
  by_job: JobBreakdown[];
  by_client: ClientBreakdown[];
  warnings: string[];
};

/**
 * Devuelve el primer día del mes (00:00:00 UTC) y el primer día del mes siguiente.
 * Usa formato "YYYY-MM-DD HH:MM:SS" compatible con Catalyst datetime queries.
 */
function monthRange(monthStr: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) throw new ValidationError('month must be in format YYYY-MM');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2020 || year > 2100) throw new ValidationError('month year out of range');
  if (month < 1 || month > 12) throw new ValidationError('month out of range');
  const fromDate = `${m[1]}-${m[2]}-01 00:00:00`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const toDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`;
  return { from: fromDate, to: toDate };
}

export async function getOperationsExpenses(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const monthParam = url.searchParams.get('month') ?? '';
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = monthParam || defaultMonth;
  const { from, to } = monthRange(month);

  const warnings: string[] = [];

  // 1. Cargar JobCostEvents del tenant para el rango. Tolerante: si la tabla no existe,
  // devolvemos response vacío con warning explicativo (mismo patrón que costTracking.ts).
  let events: CostEventRow[] = [];
  try {
    events = unwrapRows<CostEventRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, job_id, cost_type, amount_usd, count, occurred_at
         FROM JobCostEvents
         WHERE tenant_id = '${escapeSql(tenantId)}'
           AND occurred_at >= '${escapeSql(from)}'
           AND occurred_at < '${escapeSql(to)}'
         ORDER BY occurred_at DESC LIMIT 300`,
      )) as unknown[],
      'JobCostEvents',
    );
  } catch (err) {
    const msg = (err as Error).message ?? '';
    log.warn('JobCostEvents query failed (tabla no existe o columna missing)', { error: msg.slice(0, 200) });
    warnings.push('Tabla JobCostEvents no disponible — el tracking de costos no está activo.');
    sendJson(ctx.res, 200, emptyResponse(month, from, to, warnings));
    return;
  }

  if (events.length === 0) {
    sendJson(ctx.res, 200, emptyResponse(month, from, to, warnings));
    return;
  }

  // 2. Resolver info de los puestos involucrados (title, company, fee_usd).
  const jobIds = Array.from(new Set(events.map((e) => e.job_id).filter(Boolean)));
  const jobsById = new Map<string, JobInfo>();
  if (jobIds.length > 0) {
    const inClause = jobIds.map((id) => `'${escapeSql(id)}'`).join(', ');
    try {
      const jobRows = unwrapRows<JobInfo>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, title, company, fee_usd FROM Jobs WHERE ROWID IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        'Jobs',
      );
      for (const j of jobRows) jobsById.set(j.ROWID, j);
    } catch (err) {
      // Fallback: si la columna fee_usd no existe (en transición), reintento sin ella.
      log.warn('Jobs query with fee_usd failed, retrying without', { error: (err as Error).message });
      try {
        const jobRows = unwrapRows<Omit<JobInfo, 'fee_usd'>>(
          (await zcql(ctx.req).executeZCQLQuery(
            `SELECT ROWID, title, company FROM Jobs WHERE ROWID IN (${inClause}) LIMIT 300`,
          )) as unknown[],
          'Jobs',
        );
        for (const j of jobRows) jobsById.set(j.ROWID, { ...j, fee_usd: null });
        warnings.push('Columna fee_usd no disponible — no se puede calcular ratio costos/facturación.');
      } catch {
        warnings.push('Tabla Jobs no disponible — no se puede resolver info de puestos.');
      }
    }
  }

  // 3. Agregaciones.
  const byService = aggregateByService(events);
  const byJob = aggregateByJob(events, jobsById);
  const byClient = aggregateByClient(events, jobsById);

  const totalUsd = byService.reduce((sum, s) => sum + s.total_usd, 0);
  const totalFeeUsd = byJob.reduce((sum, j) => sum + (j.fee_usd ?? 0), 0);
  const ratioOverall = totalFeeUsd > 0 ? round2((totalUsd / totalFeeUsd) * 100) : null;

  const response: ExpensesResponse = {
    month,
    range: { from_iso: from, to_iso: to },
    total_usd: round4(totalUsd),
    total_fee_usd: round2(totalFeeUsd),
    ratio_overall_pct: ratioOverall,
    by_service: byService,
    by_job: byJob,
    by_client: byClient,
    warnings,
  };

  sendJson(ctx.res, 200, response);
}

function emptyResponse(month: string, from: string, to: string, warnings: string[]): ExpensesResponse {
  return {
    month,
    range: { from_iso: from, to_iso: to },
    total_usd: 0,
    total_fee_usd: 0,
    ratio_overall_pct: null,
    by_service: [],
    by_job: [],
    by_client: [],
    warnings,
  };
}

function aggregateByService(events: CostEventRow[]): ServiceBreakdown[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const cur = map.get(e.cost_type) ?? { total: 0, count: 0 };
    cur.total += Number(e.amount_usd) || 0;
    cur.count += Number(e.count) || 1;
    map.set(e.cost_type, cur);
  }
  return Array.from(map.entries())
    .map(([service, v]) => ({
      service: service as ServiceBreakdown['service'],
      total_usd: round4(v.total),
      events_count: v.count,
    }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

function aggregateByJob(events: CostEventRow[], jobsById: Map<string, JobInfo>): JobBreakdown[] {
  const map = new Map<string, JobBreakdown>();
  for (const e of events) {
    if (!e.job_id) continue;
    const job = jobsById.get(e.job_id);
    const cur = map.get(e.job_id) ?? {
      job_id: e.job_id,
      title: job?.title ?? '(puesto eliminado)',
      company: job?.company ?? '—',
      fee_usd: job?.fee_usd ?? null,
      total_usd: 0,
      ratio_pct: null,
      by_service: {},
    };
    const amt = Number(e.amount_usd) || 0;
    cur.total_usd += amt;
    cur.by_service[e.cost_type] = (cur.by_service[e.cost_type] ?? 0) + amt;
    map.set(e.job_id, cur);
  }
  // Calcular ratio final por puesto.
  for (const j of map.values()) {
    j.total_usd = round4(j.total_usd);
    for (const k of Object.keys(j.by_service)) j.by_service[k] = round4(j.by_service[k]);
    j.ratio_pct = j.fee_usd && j.fee_usd > 0 ? round2((j.total_usd / j.fee_usd) * 100) : null;
  }
  return Array.from(map.values()).sort((a, b) => b.total_usd - a.total_usd);
}

function aggregateByClient(events: CostEventRow[], jobsById: Map<string, JobInfo>): ClientBreakdown[] {
  const map = new Map<string, { total: number; jobIds: Set<string>; byService: Record<string, number> }>();
  for (const e of events) {
    if (!e.job_id) continue;
    const job = jobsById.get(e.job_id);
    const company = job?.company ?? '(cliente desconocido)';
    const cur = map.get(company) ?? { total: 0, jobIds: new Set<string>(), byService: {} };
    const amt = Number(e.amount_usd) || 0;
    cur.total += amt;
    cur.jobIds.add(e.job_id);
    cur.byService[e.cost_type] = (cur.byService[e.cost_type] ?? 0) + amt;
    map.set(company, cur);
  }
  return Array.from(map.entries())
    .map(([company, v]) => ({
      company,
      total_usd: round4(v.total),
      jobs_count: v.jobIds.size,
      by_service: Object.fromEntries(Object.entries(v.byService).map(([k, val]) => [k, round4(val)])),
    }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
