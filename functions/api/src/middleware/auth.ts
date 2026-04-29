import { createClerkClient, verifyToken } from '@clerk/backend';
import type { RequestContext } from '../lib/context';
import { env } from '../lib/env';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { logger } from '../lib/logger';

const log = logger('AUTH');

let cachedClient: ReturnType<typeof createClerkClient> | null = null;

export function clerk() {
  if (cachedClient) return cachedClient;
  cachedClient = createClerkClient({
    secretKey: env().CLERK_SECRET_KEY,
    publishableKey: env().CLERK_PUBLISHABLE_KEY,
  });
  return cachedClient;
}

export async function requireAuth(ctx: RequestContext): Promise<void> {
  const authHeader = (ctx.req.headers['authorization'] as string | undefined) ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Bearer token');
  }
  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: env().CLERK_SECRET_KEY,
    });

    const sub = payload.sub;
    if (!sub) throw new UnauthorizedError('Token missing sub');

    ctx.user = {
      id: sub,
      clerk_user_id: sub,
      clerk_org_id: (payload as { org_id?: string }).org_id ?? null,
      clerk_org_role: (payload as { org_role?: string }).org_role ?? null,
      email: (payload as { email?: string }).email ?? null,
    };
  } catch (err) {
    log.warn('token verification failed', { error: (err as Error).message });
    throw new UnauthorizedError(`Invalid token: ${(err as Error).message}`);
  }
}

export function requireOrgRole(ctx: RequestContext, allowedRoles: string[]): void {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  if (!ctx.user.clerk_org_id) throw new ForbiddenError('No active organization');
  const role = ctx.user.clerk_org_role ?? '';
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError(`Role "${role}" not allowed`);
  }
}

export function requireAdmin(ctx: RequestContext): void {
  requireOrgRole(ctx, ['admin', 'org:admin']);
}
