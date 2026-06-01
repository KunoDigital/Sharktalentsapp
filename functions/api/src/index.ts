import type { IncomingMessage, ServerResponse } from 'http';
import { route } from './router';
import { createContext } from './lib/context';
import { logger } from './lib/logger';
import { applyCors, handlePreflight } from './lib/cors';
import { env } from './lib/env';

const log = logger('API');

function isWebhookOrAdminPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  // Webhooks y endpoints admin son server-to-server, no necesitan CORS.
  return path.startsWith('/api/webhooks/') || path.startsWith('/admin/');
}

export = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const ctx = createContext(req, res);

  // CORS solo para endpoints que el browser llama. Webhooks (Clerk → backend)
  // y admin (curl → backend) son server-to-server, sin Origin header relevante.
  if (!isWebhookOrAdminPath(req.url)) {
    applyCors(req, res, env().ALLOWED_ORIGINS);
    if (req.method === 'OPTIONS') {
      handlePreflight(res);
      return;
    }
  }

  log.info(`${req.method} ${req.url}`, { traceId: ctx.traceId });
  await route(ctx);
  log.info(`${req.method} ${req.url} done`, {
    traceId: ctx.traceId,
    ms: Date.now() - ctx.startedAt,
    status: res.statusCode,
  });
};
