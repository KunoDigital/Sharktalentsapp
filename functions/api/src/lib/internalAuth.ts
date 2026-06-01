/**
 * Auth para endpoints `/admin/*` — verifica X-Internal-Key contra INTERNAL_API_KEY.
 *
 * Usa timing-safe compare para no exponer un timing oracle. Aunque el riesgo
 * práctico es bajo (endpoint solo es accesible con conocimiento del header completo),
 * vale la pena ser consistente con la práctica que ya usa urlSigning.
 */

import { timingSafeEqual } from 'crypto';
import type { RequestContext } from './context';
import { ForbiddenError } from './errors';

export function requireInternalKey(ctx: RequestContext): void {
  const headerKey = ctx.req.headers['x-internal-key'];
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected || typeof headerKey !== 'string') {
    throw new ForbiddenError('Invalid internal key');
  }

  const a = Buffer.from(headerKey);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenError('Invalid internal key');
  }
}
