import type { IncomingMessage, ServerResponse } from 'http';
import { route } from './router';
import { logger } from './lib/logger';

const log = logger('API');

export = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const started = Date.now();
  log.info(`${req.method} ${req.url}`);
  await route(req, res);
  log.info(`${req.method} ${req.url} done`, { ms: Date.now() - started, status: res.statusCode });
};
