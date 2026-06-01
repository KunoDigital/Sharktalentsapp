import { createClerkClient, verifyToken } from '@clerk/backend';
import type { RequestContext } from './context';
import { env } from './env';
import { ForbiddenError, UnauthorizedError } from './errors';
import { logger } from './logger';

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
  // Catalyst gateway intercepta `Authorization: Bearer xxx` y lo valida como token
  // de Catalyst — los JWT de Clerk son rechazados antes de llegar acá. Por eso
  // preferimos el header custom `X-Clerk-Token` que no es interceptado. Mantenemos
  // fallback a `Authorization: Bearer` para compatibilidad con clientes legacy
  // o tests que no pasen por el gateway.
  const clerkHeader = (ctx.req.headers['x-clerk-token'] as string | undefined) ?? '';
  const authHeader = (ctx.req.headers['authorization'] as string | undefined) ?? '';

  let token: string;
  if (clerkHeader) {
    token = clerkHeader;
  } else if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length);
  } else {
    throw new UnauthorizedError('Missing token (use X-Clerk-Token header or Authorization: Bearer)');
  }
  try {
    const e = env();
    // authorizedParties limita los JWTs a los que provienen de tu app frontend.
    // Sin esto, JWTs firmados por la misma cuenta Clerk para OTRA app son aceptados acá
    // (relevante si hay otra app del mismo tenant Clerk operando en paralelo).
    const payload = await verifyToken(token, {
      secretKey: e.CLERK_SECRET_KEY,
      authorizedParties: [e.APP_BASE_URL],
    });

    const sub = payload.sub;
    if (!sub) throw new UnauthorizedError('Token missing sub');

    // Clerk JWT v2 (current) usa `o: { id, rol, slg }` para datos de organización.
    // JWT v1 (legacy) usaba `org_id` y `org_role` planos. Soportamos ambos para
    // compatibilidad — leemos primero v2 con fallback a v1.
    const orgV2 = (payload as { o?: { id?: string; rol?: string } }).o;
    const orgIdV1 = (payload as { org_id?: string }).org_id;
    const orgRoleV1 = (payload as { org_role?: string }).org_role;

    ctx.user = {
      id: sub,
      clerk_user_id: sub,
      clerk_org_id: orgV2?.id ?? orgIdV1 ?? null,
      clerk_org_role: orgV2?.rol ?? orgRoleV1 ?? null,
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
