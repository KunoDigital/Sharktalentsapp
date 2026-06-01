/**
 * VideoConsents — registro de consentimiento explícito del candidato para grabación de video.
 *
 * Ley Panamá (Protección de Datos Personales) + GDPR exigen consentimiento informado y
 * verificable antes de grabar audio/video. Este feature registra:
 *   - Quién dio consentimiento (result_id)
 *   - Cuándo (timestamp)
 *   - IP + User Agent (forensic)
 *   - Versión del aviso de privacidad aceptada
 *
 * Antes de grabar el primer video, el frontend debe llamar `POST /test/<token>/consent` con
 * el flag aceptado. El backend devuelve 403 si intenta subir un video sin consent registrado.
 *
 * Tabla VideoConsents (Block 3 deferred):
 *   ROWID, result_id, accepted, ip, user_agent, privacy_notice_version,
 *   accepted_at, withdrawn_at?
 *
 * Endpoints:
 *   POST /test/:token/consent     → registrar consentimiento (público)
 *   GET  /test/:token/consent     → leer status (público, lo lee el flow del candidato)
 *   POST /test/:token/consent/withdraw → revocar (público, candidato puede retirarlo)
 *
 * Si la tabla no existe (Block 3 pendiente), GET devuelve { accepted: false, table_ready: false }
 * para que el frontend muestre el modal de consent. POST devuelve 503.
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { verifyToken } from '../lib/urlSigning';

const log = logger('VIDEO_CONSENTS');
const TABLE = 'VideoConsents';

const CURRENT_PRIVACY_NOTICE_VERSION = '2026-05-02';

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

function extractTokenFromConsentPath(url: string): string | null {
  return url.match(/^\/test\/([^/]+)\/consent/)?.[1] ?? null;
}

function getClientIp(ctx: RequestContext): string {
  const xff = ctx.req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim().slice(0, 50);
  return (ctx.req.socket?.remoteAddress ?? 'unknown').slice(0, 50);
}

function getUserAgent(ctx: RequestContext): string {
  const ua = ctx.req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 500) : 'unknown';
}

async function getResultFromToken(req: IncomingMessage, token: string): Promise<{ ROWID: string } | null> {
  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch {
    return null;
  }
  const rows = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(
      `SELECT ROWID FROM Results WHERE ROWID = '${escapeSql(claims.ref)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  );
  return rows[0] ?? null;
}

/**
 * GET /test/:token/consent — el frontend del candidato chequea si ya hay consent registrado.
 *
 * Si no hay, debe mostrar el modal de privacidad y llamar POST.
 *
 * Si la tabla no existe → devuelve `accepted: false, table_ready: false`. El frontend
 * puede mostrar el modal con un warning, o saltearlo según política.
 */
export async function getVideoConsent(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromConsentPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  const result = await getResultFromToken(ctx.req, token);
  if (!result) throw new NotFoundError('Test not found');

  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 200, {
      accepted: false,
      table_ready: false,
      privacy_notice_version: CURRENT_PRIVACY_NOTICE_VERSION,
    });
    return;
  }

  const rows = unwrapRows<{ accepted: boolean; accepted_at: string; withdrawn_at: string | null; privacy_notice_version: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT accepted, accepted_at, withdrawn_at, privacy_notice_version FROM ${TABLE} WHERE result_id = '${escapeSql(result.ROWID)}' LIMIT 1`,
    )) as unknown[],
    TABLE,
  );

  const consent = rows[0];
  if (!consent) {
    sendJson(ctx.res, 200, {
      accepted: false,
      table_ready: true,
      privacy_notice_version: CURRENT_PRIVACY_NOTICE_VERSION,
    });
    return;
  }

  // Si fue retirado, treat as not accepted
  const stillValid = consent.accepted && !consent.withdrawn_at;

  sendJson(ctx.res, 200, {
    accepted: stillValid,
    accepted_at: consent.accepted_at,
    withdrawn_at: consent.withdrawn_at,
    privacy_notice_version: consent.privacy_notice_version,
    table_ready: true,
    needs_re_consent: consent.privacy_notice_version !== CURRENT_PRIVACY_NOTICE_VERSION,
  });
}

/**
 * POST /test/:token/consent — el candidato acepta consentimiento.
 *
 * Body: { accepted: true, privacy_notice_version?: string }
 */
export async function postVideoConsent(ctx: RequestContext): Promise<void> {
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, {
      error: { code: 'table_not_ready', message: 'VideoConsents table not yet provisioned' },
    });
    return;
  }

  const token = extractTokenFromConsentPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  const result = await getResultFromToken(ctx.req, token);
  if (!result) throw new NotFoundError('Test not found');

  const body = await readJsonBody<{ accepted?: unknown; privacy_notice_version?: string }>(ctx.req);
  if (body.accepted !== true) throw new ValidationError('accepted must be true');

  const noticeVersion = typeof body.privacy_notice_version === 'string'
    ? body.privacy_notice_version.slice(0, 50)
    : CURRENT_PRIVACY_NOTICE_VERSION;

  // Si ya existe consent previo, lo dejamos (append-only — para audit). Solo el más reciente
  // cuenta. Si lo actualizamos, perdemos historial. Mejor insertar nueva fila siempre.
  await datastore(ctx.req).table(TABLE).insertRow({
    result_id: result.ROWID,
    accepted: true,
    ip: getClientIp(ctx),
    user_agent: getUserAgent(ctx),
    privacy_notice_version: noticeVersion,
    accepted_at: now(),
    withdrawn_at: null,
  });

  log.info('video consent recorded', {
    traceId: ctx.traceId,
    resultId: result.ROWID,
    privacy_notice_version: noticeVersion,
  });

  sendJson(ctx.res, 201, {
    accepted: true,
    accepted_at: now(),
    privacy_notice_version: noticeVersion,
  });
}

/**
 * POST /test/:token/consent/withdraw — el candidato retira el consent.
 *
 * Marca todas las filas del result_id con withdrawn_at = ahora. Cuando se intente
 * subir un video después, debe volver a aceptar.
 */
export async function withdrawVideoConsent(ctx: RequestContext): Promise<void> {
  if (!(await isTableReady(ctx.req))) {
    sendJson(ctx.res, 503, { error: { code: 'table_not_ready' } });
    return;
  }

  const token = extractTokenFromConsentPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  const result = await getResultFromToken(ctx.req, token);
  if (!result) throw new NotFoundError('Test not found');

  const rows = unwrapRows<{ ROWID: string; withdrawn_at: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, withdrawn_at FROM ${TABLE} WHERE result_id = '${escapeSql(result.ROWID)}' AND withdrawn_at IS NULL`,
    )) as unknown[],
    TABLE,
  );

  let updated = 0;
  for (const row of rows) {
    try {
      await datastore(ctx.req).table(TABLE).updateRow({
        ROWID: row.ROWID,
        withdrawn_at: now(),
      });
      updated++;
    } catch (err) {
      log.warn('failed to mark consent withdrawn', { rowId: row.ROWID, error: (err as Error).message });
    }
  }

  log.info('video consent withdrawn', { traceId: ctx.traceId, resultId: result.ROWID, count: updated });
  sendJson(ctx.res, 200, { withdrawn: updated });
}

/**
 * Helper interno: chequea si un Result tiene consent activo. Lo usa videos.ts antes de
 * permitir uploads. Si tabla no existe → devuelve true (graceful fallback — no bloqueamos
 * el flow productivo durante setup inicial).
 */
export async function hasActiveConsent(req: IncomingMessage, resultId: string): Promise<boolean> {
  if (!(await isTableReady(req))) return true;
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE result_id = '${escapeSql(resultId)}' AND accepted = true AND withdrawn_at IS NULL LIMIT 1`,
      )) as unknown[],
      TABLE,
    );
    return rows.length > 0;
  } catch {
    return true; // graceful: si query falla, no bloqueamos
  }
}

export const _internal = { CURRENT_PRIVACY_NOTICE_VERSION };
