import type { IncomingMessage, ServerResponse } from 'http';
import { getHealth } from './handlers/health';
import { AppError } from './lib/errors';
import { logger } from './lib/logger';

const log = logger('ROUTER');

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: 'GET',
    pattern: /^\/health\/?$/,
    handler: async (_req, res) => {
      const result = await getHealth();
      send(res, result.status === 'ok' ? 200 : 503, result);
    },
  },
];

export async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.split('?')[0];

  try {
    for (const r of routes) {
      if (r.method === method && r.pattern.test(path)) {
        await r.handler(req, res);
        return;
      }
    }
    send(res, 404, { error: { code: 'not_found', message: `No route for ${method} ${path}` } });
  } catch (err) {
    if (err instanceof AppError) {
      log.warn('app error', { code: err.code, message: err.message, status: err.status });
      send(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    log.error('unhandled error', { message: (err as Error).message });
    send(res, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
