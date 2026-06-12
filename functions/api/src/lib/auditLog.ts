/**
 * Helper para escribir filas de auditoría a la tabla AuditLog.
 *
 * Diseño:
 * - Fire-and-forget: si falla, NO se rompe la operación principal (loggea warn).
 * - Snapshot mínimo: action + resource + actor + IP. Sin PII completa.
 * - `changes` recibe un objeto con campos modificados (truncado a 5KB).
 *
 * Uso:
 *   import { auditLog } from '../lib/auditLog';
 *   await auditLog(ctx, { action: 'job.create', resource_type: 'job', resource_id: job.ROWID, changes: { title } });
 */

import type { RequestContext } from './context';
import { datastore, now } from './db';
import { logger } from './logger';

const log = logger('AUDIT');
const TABLE = 'AuditLog';

export type AuditAction =
  | 'job.create' | 'job.update' | 'job.archive'
  | 'candidate.create' | 'candidate.update'
  | 'application.create' | 'application.transition'
  | 'scores.write' | 'integrity.write'
  | 'bot.review_applied' | 'bot.review_only'
  | 'draft.generate' | 'draft.refine' | 'draft.iterate' | 'draft.send_to_client'
  | 'tenant.create' | 'tenant.update' | 'tenant.delete'
  | 'admin.outbox_process' | 'admin.anthropic_ping'
  | 'portal.issued'
  | 'client.notify_report_ready'
  | 'outreach.campaign_create' | 'outreach.reply';

export type AuditEntry = {
  action: AuditAction;
  resource_type: string; // 'job' | 'candidate' | 'application' | etc
  resource_id?: string | null;
  changes?: Record<string, unknown>;
};

const MAX_CHANGES_BYTES = 5000;

function getClientIp(ctx: RequestContext): string | null {
  const xff = ctx.req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return ctx.req.socket?.remoteAddress ?? null;
}

function getUserAgent(ctx: RequestContext): string | null {
  const ua = ctx.req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

/**
 * Escribe a AuditLog. Fire-and-forget — si falla, loggea warn y sigue.
 *
 * Retorna la promesa para casos donde el caller quiera await (ej: testing),
 * pero la convención es no awaitearla en producción para no agregar latency.
 */
export async function auditLog(ctx: RequestContext, entry: AuditEntry): Promise<void> {
  const actorUser = ctx.user?.clerk_user_id ?? 'system';

  let changesStr: string | null = null;
  if (entry.changes) {
    try {
      const json = JSON.stringify(entry.changes);
      changesStr = json.length > MAX_CHANGES_BYTES ? json.slice(0, MAX_CHANGES_BYTES) : json;
    } catch (err) {
      log.warn('failed to serialize changes', { error: (err as Error).message });
    }
  }

  try {
    await datastore(ctx.req).table(TABLE).insertRow({
      actor_user: actorUser,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id ?? null,
      changes: changesStr,
      ip: getClientIp(ctx),
      user_agent: getUserAgent(ctx),
      created_at: now(),
    });
  } catch (err) {
    log.warn('audit write failed (non-blocking)', {
      traceId: ctx.traceId,
      action: entry.action,
      resource_type: entry.resource_type,
      error: (err as Error).message,
    });
  }
}
