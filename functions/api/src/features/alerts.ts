/**
 * Endpoints admin para el dashboard de alertas.
 *
 *   GET   /api/admin/alerts?status=open&limit=50  — listar alertas (default abiertas)
 *   POST  /api/admin/alerts/:id/acknowledge       — marcar como vista (no la resuelve)
 *   POST  /api/admin/alerts/:id/resolve           — marcar como resuelta
 */

import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { NotFoundError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('ALERTS');
// 2026-06-04: nombre "Alerts" quedó envenenado tras orphan en Catalyst API; renombrado.
const TABLE = 'SystemAlerts';

type AlertRow = {
  ROWID: string;
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
  context: string | null;
  tenant_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  occurrence_count: number;
  created_at: string;
  last_occurred_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at?: string | null;
};

export async function listAlerts(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));

  const where = status ? ` WHERE status = '${escapeSql(status)}'` : '';
  const query = `SELECT * FROM ${TABLE}${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  try {
    const rows = unwrapRows<AlertRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      TABLE,
    );

    // Counts por status — útil para badge en el menu
    const allRowsRaw = await zcql(ctx.req).executeZCQLQuery(`SELECT status, severity FROM ${TABLE}`);
    const allRows = unwrapRows<{ status: string; severity: string }>(allRowsRaw as unknown[], TABLE);
    const counts: Record<string, number> = {};
    let openCritical = 0;
    for (const r of allRows) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (r.status === 'open' && r.severity === 'critical') openCritical += 1;
    }

    sendJson(ctx.res, 200, {
      alerts: rows,
      counts_by_status: counts,
      open_critical: openCritical,
    });
  } catch (err) {
    log.warn('listAlerts failed (table may not exist)', { error: (err as Error).message });
    sendJson(ctx.res, 200, {
      alerts: [],
      counts_by_status: {},
      open_critical: 0,
      error: 'alerts_table_not_ready',
    });
  }
}

function extractIdFromPath(url: string, suffix: 'acknowledge' | 'resolve'): string | null {
  const re = new RegExp(`^/api/admin/alerts/([^/]+)/${suffix}/?$`);
  const m = url.match(re);
  return m?.[1] ?? null;
}

export async function acknowledgeAlert(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  const alertId = extractIdFromPath(ctx.req.url ?? '/', 'acknowledge');
  if (!alertId) throw new ValidationError('alert id missing in path');

  const existing = unwrapRows<AlertRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, status FROM ${TABLE} WHERE ROWID = '${escapeSql(alertId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError(`Alert ${alertId} not found`);

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: alertId,
    status: 'acknowledged',
    acknowledged_at: now(),
    acknowledged_by: ctx.user!.clerk_user_id ?? 'unknown',
  });
  sendJson(ctx.res, 200, { ok: true });
}

export async function resolveAlert(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  const alertId = extractIdFromPath(ctx.req.url ?? '/', 'resolve');
  if (!alertId) throw new ValidationError('alert id missing in path');

  const existing = unwrapRows<AlertRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE ROWID = '${escapeSql(alertId)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!existing) throw new NotFoundError(`Alert ${alertId} not found`);

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: alertId,
    status: 'resolved',
    resolved_at: now(),
  });
  sendJson(ctx.res, 200, { ok: true });
}
