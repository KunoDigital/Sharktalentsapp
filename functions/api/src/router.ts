import type { RequestContext } from './lib/context';
import { AppError } from './lib/errors';
import { sendJson } from './lib/http';
import { logger } from './lib/logger';
import { getHealth } from './features/health';
import { handleClerkWebhook } from './features/tenants';

const log = logger('ROUTER');

type Handler = (ctx: RequestContext) => Promise<void>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: 'GET', pattern: /^\/health\/?$/, handler: getHealth },
  { method: 'POST', pattern: /^\/api\/webhooks\/clerk\/?$/, handler: handleClerkWebhook },
];

export async function route(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? '/';
  const method = (ctx.req.method ?? 'GET').toUpperCase();
  const path = url.split('?')[0];

  try {
    for (const r of routes) {
      if (r.method === method && r.pattern.test(path)) {
        await r.handler(ctx);
        return;
      }
    }
    sendJson(ctx.res, 404, {
      error: { code: 'not_found', message: `No route for ${method} ${path}` },
    });
  } catch (err) {
    if (err instanceof AppError) {
      log.warn('app error', {
        traceId: ctx.traceId,
        code: err.code,
        message: err.message,
        status: err.status,
      });
      sendJson(ctx.res, err.status, {
        error: { code: err.code, message: err.message, details: err.details },
        trace_id: ctx.traceId,
      });
      return;
    }
    log.error('unhandled error', {
      traceId: ctx.traceId,
      message: (err as Error).message,
      stack: (err as Error).stack,
    });
    sendJson(ctx.res, 500, {
      error: { code: 'internal_error', message: 'Internal server error' },
      trace_id: ctx.traceId,
    });
  }
}
