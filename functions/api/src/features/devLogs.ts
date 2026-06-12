/**
 * Endpoints de debug que leen logs estructurados desde el bucket Stratus.
 *
 * Auth: X-Internal-Key (admin only). NO exponer al frontend.
 *
 * Endpoints:
 *   GET /api/_dev/logs/:traceId?day=YYYY-MM-DD
 *     → devuelve el JSON del log entero.
 *   GET /api/_dev/logs?day=YYYY-MM-DD&limit=50
 *     → lista los traceIds más recientes del día.
 *
 * Uso típico: el agente (Claude) corre `scripts/read-log.ts <traceId>` que llama
 * a estos endpoints con la INTERNAL_API_KEY.
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { requireInternalKey } from '../lib/internalAuth';

export async function getDevLogByTraceId(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const match = url.pathname.match(/^\/api\/_dev\/logs\/([^/]+)\/?$/);
  const traceId = match?.[1];
  if (!traceId) {
    sendJson(ctx.res, 400, { error: 'traceId missing in path' });
    return;
  }
  // Validación: nuestros traceIds son tipo trc_xxxxxxxxx (alfanuméricos).
  if (!/^trc_[a-z0-9]{6,40}$/i.test(traceId)) {
    sendJson(ctx.res, 400, { error: 'invalid traceId format' });
    return;
  }

  const { downloadLogByTraceId } = await import('../lib/stratusLogger.js');
  let payload: string | null;
  try {
    payload = await downloadLogByTraceId(ctx.req, traceId);
  } catch (err) {
    sendJson(ctx.res, 500, { error: 'log_download_failed', detail: (err as Error).message });
    return;
  }
  if (!payload) {
    sendJson(ctx.res, 404, { error: 'log_not_found', traceId });
    return;
  }
  // Pasamos directo el JSON ya serializado.
  ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
  ctx.res.end(payload);
}

export async function listDevLogs(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));

  const { listRecentTraceIds } = await import('../lib/stratusLogger.js');
  const traceIds = await listRecentTraceIds(ctx.req, undefined, limit);
  sendJson(ctx.res, 200, { count: traceIds.length, traceIds });
}
