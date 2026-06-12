/**
 * Notifications backend — reemplaza el localStorage del NotificationCenter.
 *
 * Cuando pasa algo importante en el sistema (draft pendiente, bot review, finalist ready,
 * inbox, feedback de cliente), se inserta una notificación. El frontend la lee + marca como
 * read.
 *
 * Endpoints:
 *   GET    /api/notifications?status=unread&limit=50  → lista
 *   PATCH  /api/notifications/:id/read                → marca leída
 *   POST   /api/notifications/mark-all-read           → marca todas leídas
 *
 * Si la tabla `Notifications` (Block 2) no existe, GET devuelve [] y POST/PATCH no-op.
 * Patron similar a otras tablas deferred.
 *
 * Para INSERTAR notificaciones se llama internamente desde otros features:
 *   import { enqueueNotification } from './notifications';
 *   await enqueueNotification(req, { tenantId, type: 'bot_review', resource_id, message });
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('NOTIFICATIONS');
const TABLE = 'Notifications';

export type NotificationType =
  | 'draft_pending'
  | 'bot_review'
  | 'finalist_ready'
  | 'inbox_message'
  | 'client_feedback'
  | 'new_candidate'
  | 'candidate_auto_rejected'
  | 'candidate_stage_advanced'
  | 'system';

export type NotificationRow = {
  ROWID: string;
  tenant_id: string;
  type: NotificationType;
  message: string;
  resource_type: string | null;
  resource_id: string | null;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

let tableReady: boolean | null = null;

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

// ===== Helper para INSERT desde otros features =====

export async function enqueueNotification(
  req: IncomingMessage,
  input: {
    tenantId: string;
    type: NotificationType;
    message: string;
    resourceType?: string;
    resourceId?: string;
    link?: string;
  },
): Promise<void> {
  if (!(await isTableReady(req))) return;
  try {
    await datastore(req).table(TABLE).insertRow({
      tenant_id: input.tenantId,
      type: input.type,
      message: input.message.slice(0, 500),
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      link: input.link ?? null,
      is_read: false,
      read_at: null,
      created_at: now(),
    });
  } catch (err) {
    log.warn('enqueueNotification failed', { type: input.type, error: (err as Error).message });
  }
}

// ===== Handlers =====

export async function listNotifications(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { notifications: [], count: 0, table_ready: false });
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));

  const filters = [`tenant_id = '${escapeSql(tenantId)}'`];
  if (status === 'unread') filters.push('is_read = false');
  if (status === 'read') filters.push('is_read = true');

  const q = `SELECT * FROM ${TABLE} WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  const rows = unwrapRows<NotificationRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE);

  // Stats: total unread
  let unread = 0;
  try {
    const allRaw = await zcql(ctx.req).executeZCQLQuery(
      `SELECT is_read FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}' AND is_read = false`,
    );
    unread = unwrapRows<{ is_read: boolean }>(allRaw as unknown[], TABLE).length;
  } catch {
    // Si falla el conteo, devolvemos 0
  }

  sendJson(ctx.res, 200, {
    notifications: rows,
    count: rows.length,
    unread_total: unread,
    table_ready: true,
  });
}

export async function markNotificationRead(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { updated: false, table_ready: false });
    return;
  }
  const id = ctx.req.url?.match(/^\/api\/notifications\/([^/]+)\/read/)?.[1];
  if (!id) throw new ValidationError('id missing');

  // Verificar ownership
  const row = unwrapRows<{ ROWID: string; tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id FROM ${TABLE} WHERE ROWID = '${escapeSql(id)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  )[0];
  if (!row || row.tenant_id !== tenantId) throw new NotFoundError('Notification not found');

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: id,
    is_read: true,
    read_at: now(),
  });

  sendJson(ctx.res, 200, { updated: true });
}

export async function markAllNotificationsRead(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { updated: 0, table_ready: false });
    return;
  }

  // Listar las unread y actualizar una por una (Catalyst no tiene UPDATE WHERE batch)
  const unread = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}' AND is_read = false`,
    )) as unknown[],
    TABLE,
  );

  let updated = 0;
  for (const r of unread) {
    try {
      await datastore(ctx.req).table(TABLE).updateRow({
        ROWID: r.ROWID,
        is_read: true,
        read_at: now(),
      });
      updated++;
    } catch {
      // continuar con el resto
    }
  }

  log.info('marked all notifications read', { traceId: ctx.traceId, tenantId, updated });
  sendJson(ctx.res, 200, { updated });
}

export function _resetTableReadyForTests() {
  tableReady = null;
}

// Re-export para tests
export type { NotificationRow as Notification };
