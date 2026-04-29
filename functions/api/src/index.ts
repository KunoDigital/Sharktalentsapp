import type { IncomingMessage, ServerResponse } from 'http';
import { route } from './router';
import { createContext } from './lib/context';
import { logger } from './lib/logger';

const log = logger('API');

export = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const ctx = createContext(req, res);
  log.info(`${req.method} ${req.url}`, { traceId: ctx.traceId });
  await route(ctx);
  log.info(`${req.method} ${req.url} done`, {
    traceId: ctx.traceId,
    ms: Date.now() - ctx.startedAt,
    status: res.statusCode,
  });
};
