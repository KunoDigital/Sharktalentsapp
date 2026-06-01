/**
 * JobTrackingSnapshots — audit log de eventos del portal cliente.
 *
 * Cada vez que un cliente abre el portal, consulta un puesto, ve un finalist o aprueba
 * un draft, se registra un snapshot. Sirve para:
 *   - Cris ve: "el cliente abrió el portal hace 2 días pero no aprobó el draft → necesita follow-up"
 *   - Compliance: cuándo el cliente vio cada candidato (importante si hay disputa)
 *   - Métricas: tiempo entre invite y primera vista, % de cliente engagement
 *
 * Tabla `JobTrackingSnapshots` (Block 3 deferred):
 *   ROWID, tenant_id, job_id?, portal_token_hash (nunca el token raw), event_type,
 *   event_data (JSON con info no-PII), client_ip_masked (primer octeto + xx.xx.xx),
 *   user_agent, occurred_at
 *
 * Event types soportados:
 *   - portal.opened      — cliente abrió la landing del portal
 *   - portal.job_viewed  — cliente abrió el detail de un puesto
 *   - portal.report_viewed — cliente abrió un reporte multi-candidato
 *   - portal.draft_approved — cliente aprobó un draft
 *   - portal.draft_rejected — cliente rechazó un draft
 *   - portal.feedback     — cliente dejó comentario
 *
 * Endpoints:
 *   POST /portal/<token>/track       (público, registra evento)
 *   GET  /api/jobs/:id/tracking      (admin, lista snapshots del job)
 *
 * Si tabla no existe, POST devuelve 200 (no rompe el portal cliente) y GET devuelve [].
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { verifyPortalToken } from '../lib/clientPortalTokens';
import { createHash } from 'crypto';

const log = logger('JOB_TRACKING');
const TABLE = 'JobTrackingSnapshots';

const VALID_EVENT_TYPES = [
  'portal.opened',
  'portal.job_viewed',
  'portal.report_viewed',
  'portal.draft_approved',
  'portal.draft_rejected',
  'portal.feedback',
];

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

export function _resetTableReadyForTests() {
  tableReady = null;
}

function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function maskIp(ip: string): string {
  // IPv4: 192.168.1.5 → 192.xx.xx.xx
  // IPv6: 2001:0db8::1 → 2001:xxxx::xxxx
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts[0]}:xxxx::xxxx`;
  }
  const parts = ip.split('.');
  return `${parts[0]}.xx.xx.xx`;
}

function getClientIp(ctx: RequestContext): string {
  const xff = ctx.req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return ctx.req.socket?.remoteAddress ?? 'unknown';
}

function getUserAgent(ctx: RequestContext): string {
  const ua = ctx.req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 500) : 'unknown';
}

/**
 * Helper interno: registra un snapshot del portal sin pasar por el handler HTTP.
 * Usado desde otros handlers (ej: publicReportBundle) cuando ya se sabe el evento
 * a registrar y se quiere logger server-side automático.
 *
 * Best-effort — si la tabla no existe o falla el insert, devuelve false sin throw.
 */
export async function recordPortalSnapshot(
  ctx: RequestContext,
  args: {
    tenantId: string;
    eventType: string;
    jobId?: string | null;
    portalToken?: string | null;  // si está, se hashea y guarda
    eventData?: Record<string, unknown>;
  },
): Promise<boolean> {
  if (!(await isTableReady(ctx.req))) return false;
  try {
    await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: args.tenantId,
      job_id: args.jobId ?? null,
      portal_token_hash: args.portalToken ? hashPortalToken(args.portalToken) : null,
      event_type: args.eventType,
      event_data: args.eventData
        ? stringifyAndTruncate(args.eventData, FIELD_LIMITS.EVENT_DATA, 'JobTrackingSnapshots.event_data')
        : null,
      client_ip_masked: maskIp(getClientIp(ctx)),
      user_agent: getUserAgent(ctx),
      occurred_at: now(),
    });
    return true;
  } catch (err) {
    log.warn('recordPortalSnapshot failed', {
      eventType: args.eventType,
      error: (err as Error).message,
    });
    return false;
  }
}

// ===== Public: cliente trackea evento =====

export async function trackPortalEvent(ctx: RequestContext): Promise<void> {
  // Si tabla no está lista, devolvemos 200 silencioso — no queremos que el portal del
  // cliente reporte error visible solo porque tracking no está configurado.
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { tracked: false, table_ready: false });
    return;
  }

  const match = ctx.req.url?.match(/^\/portal\/([^/]+)\/track/);
  const token = match?.[1];
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyPortalToken(token);
  } catch {
    throw new NotFoundError('Portal not found');
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    throw new ValidationError(`event_type must be one of ${VALID_EVENT_TYPES.join(', ')}`);
  }

  const eventData = typeof body.event_data === 'object' && body.event_data
    ? stringifyAndTruncate(body.event_data, FIELD_LIMITS.EVENT_DATA, 'JobTrackingSnapshots.event_data')
    : null;

  const jobId = typeof body.job_id === 'string' ? body.job_id.slice(0, 50) : null;

  try {
    await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: claims.tenant_id,
      job_id: jobId,
      portal_token_hash: hashPortalToken(token),
      event_type: eventType,
      event_data: eventData,
      client_ip_masked: maskIp(getClientIp(ctx)),
      user_agent: getUserAgent(ctx),
      occurred_at: now(),
    });
  } catch (err) {
    // No queremos romper la UI del cliente por una falla de tracking
    log.warn('failed to insert tracking snapshot', { error: (err as Error).message });
    sendJson(ctx.res, 200, { tracked: false });
    return;
  }

  sendJson(ctx.res, 200, { tracked: true });
}

// ===== Admin: lee snapshots =====

export async function listJobTracking(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, { snapshots: [], table_ready: false });
    return;
  }

  const match = ctx.req.url?.match(/^\/api\/jobs\/([^/]+)\/tracking/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing');

  // Validar ownership
  const job = unwrapRows<{ tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT tenant_id FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!job || job.tenant_id !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));

  const rows = unwrapRows<{
    ROWID: string;
    event_type: string;
    event_data: string | null;
    client_ip_masked: string;
    user_agent: string;
    occurred_at: string;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, event_type, event_data, client_ip_masked, user_agent, occurred_at
       FROM ${TABLE}
       WHERE tenant_id = '${escapeSql(tenantId)}' AND job_id = '${escapeSql(jobId)}'
       ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
    )) as unknown[],
    TABLE,
  );

  sendJson(ctx.res, 200, {
    snapshots: rows,
    count: rows.length,
    table_ready: true,
  });
}

export const _internal = { hashPortalToken, maskIp, VALID_EVENT_TYPES };
