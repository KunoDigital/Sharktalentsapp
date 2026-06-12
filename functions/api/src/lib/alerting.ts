/**
 * Sistema centralizado de alertas para Cris.
 *
 * Cuando algo falla en SharkTalents (outbox event con retries agotados, circuit
 * breaker abre, OAuth token expirado, etc.) llamar `alertCris({ severity, code, message })`.
 *
 * Comportamiento por severity:
 *   - 'critical': persiste + manda email (y WhatsApp si está configurado) inmediato
 *   - 'warning':  persiste para dashboard, NO manda email
 *   - 'info':     solo log
 *
 * Idempotencia: si llega la misma `code` + `resource_id` con status='open' y <30 min
 * de antigüedad, NO re-manda el email — solo incrementa `occurrence_count`. Evita
 * floodear el inbox de Cris cuando un servicio cae y dispara 100 errores/min.
 *
 * La tabla Alerts puede no existir todavía (Block 2 deferred). En ese caso la función
 * loggea y sigue — no rompe el flow del caller. Cris la crea en Catalyst Console
 * cuando le toque (ver project_tablas_pendientes_v2.md).
 */

import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';

const log = logger('ALERT');
// 2026-06-04: ver costTracking.ts; "Alerts" envenenado, renombrado a SystemAlerts.
const TABLE = 'SystemAlerts';
const DEDUP_WINDOW_MIN = 30;

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertInput = {
  severity: AlertSeverity;
  /** Identifier estable que agrupa instancias del mismo problema. */
  code: string;
  /** Mensaje human-readable que Cris ve. */
  message: string;
  /** Contexto adicional para debug. */
  context?: Record<string, unknown>;
  tenantId?: string;
  resourceType?: string;
  resourceId?: string;
};

type AlertRow = {
  ROWID: string;
  severity: string;
  code: string;
  status: 'open' | 'acknowledged' | 'resolved';
  occurrence_count: number;
  created_at: string;
};

let tableReady: boolean | null = null;

async function isAlertsTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

/**
 * Punto de entrada principal. Fire-and-forget desde el caller: no bloquea, no rompe.
 */
export async function alertCris(req: IncomingMessage, input: AlertInput): Promise<void> {
  const { severity, code, message, context, tenantId, resourceType, resourceId } = input;

  // 1. Loggear siempre, sin importar si la tabla existe.
  const logFn = severity === 'critical' ? log.error : severity === 'warning' ? log.warn : log.info;
  logFn.call(log, `[${severity.toUpperCase()}] ${code}: ${message}`, {
    tenantId, resourceType, resourceId, context,
  });

  if (severity === 'info') return;

  // 2. Buscar alerta activa duplicada (dedup window 30 min).
  if (!(await isAlertsTableReady(req))) {
    log.warn('Alerts table not ready — alert only logged', { code, message });
    return;
  }

  try {
    const cutoff = minutesAgo(DEDUP_WINDOW_MIN);
    const resourceFilter = resourceId
      ? ` AND resource_id = '${escapeSql(resourceId)}'`
      : '';
    const existing = unwrapRows<AlertRow>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, occurrence_count FROM ${TABLE}
         WHERE code = '${escapeSql(code)}'
           AND status = 'open'
           AND created_at >= '${escapeSql(cutoff)}'${resourceFilter}
         ORDER BY CREATEDTIME DESC LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];

    if (existing) {
      // Misma alerta dentro de la ventana → solo bump counter, NO re-mandar email
      await datastore(req).table(TABLE).updateRow({
        ROWID: existing.ROWID,
        occurrence_count: (existing.occurrence_count ?? 1) + 1,
        last_occurred_at: now(),
      });
      log.debug('alert deduped (within window)', { code, occurrence_count: (existing.occurrence_count ?? 1) + 1 });
      return;
    }

    // 3. Persistir alerta nueva
    const ctxJson = context ? JSON.stringify(context).slice(0, 4000) : null;
    const inserted = await datastore(req).table(TABLE).insertRow({
      severity,
      code: code.slice(0, 100),
      message: message.slice(0, 500),
      context: ctxJson,
      tenant_id: tenantId ?? null,
      resource_type: resourceType ?? null,
      resource_id: resourceId ?? null,
      status: 'open',
      occurrence_count: 1,
      created_at: now(),
      last_occurred_at: now(),
    });

    // 4. Si critical, mandar email a Cris (fire-and-forget)
    if (severity === 'critical') {
      void sendCriticalAlertEmail(req, input, (inserted as { ROWID?: string }).ROWID);
    }
  } catch (err) {
    log.warn('alertCris persistence failed (continuing)', { code, error: (err as Error).message });
  }
}

async function sendCriticalAlertEmail(
  req: IncomingMessage,
  input: AlertInput,
  alertId: string | undefined,
): Promise<void> {
  try {
    const { publishAndProcessEvent } = await import('../features/outbox.js');
    const to = process.env.RECRUITER_NOTIFY_EMAIL || 'proyectos@kunodigital.com';
    await publishAndProcessEvent(req, 'email.send_pending', {
      to,
      template: 'recruiter_alert',
      locale: 'es',
      vars: {
        severity: input.severity.toUpperCase(),
        code: input.code,
        message: input.message,
        context_str: input.context ? JSON.stringify(input.context, null, 2).slice(0, 1000) : 'sin contexto adicional',
        alert_id: alertId ?? 'n/a',
        resource: input.resourceType && input.resourceId ? `${input.resourceType}:${input.resourceId}` : 'n/a',
      },
    });
  } catch (err) {
    log.warn('failed to send critical alert email', { error: (err as Error).message });
  }
}

/**
 * Helper para Catalyst Console debugging: limpia el cache de "table ready".
 * Usar después de crear la tabla Alerts para no esperar al reinicio del proceso.
 */
export function _resetAlertsTableCache(): void {
  tableReady = null;
}
