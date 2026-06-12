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
  // E2E test backdoor — si el caller pasa X-E2E-Test-Key con el valor de la env var
  // E2E_TEST_KEY (random secret), se setea un user fake con el tenant configurado en
  // E2E_TEST_CLERK_ORG_ID. Permite que Playwright corra el flujo completo sin necesidad
  // de un JWT real de Clerk.
  //
  // 2026-06-04 fix #1 (revisado): SharkTalents corre TODO el tráfico en el ambiente
  // Development de Catalyst (regla de Cris — no se usa Production). Por eso NO podemos
  // gatear el backdoor por `CATALYST_ENVIRONMENT === 'Production'` (esa rama nunca
  // matchea y dejaría el backdoor abierto en su entorno real).
  //
  // **Diseño correcto:** el backdoor es OPT-IN explícito. Requiere DOS cosas
  // simultáneas:
  //   1. E2E_BACKDOOR_ALLOWED === 'true'  (flag explícito en Catalyst Console)
  //   2. E2E_TEST_KEY seteada con un secret real (≥32 chars)
  //
  // Si falta (1), aunque E2E_TEST_KEY exista por accidente, el backdoor queda cerrado.
  // Cris setea (1) solo cuando va a correr Playwright contra el ambiente desde fuera,
  // y lo borra después. (1) ausente por default = seguro por default.
  const backdoorAllowed = process.env.E2E_BACKDOOR_ALLOWED === 'true';
  const e2eKey = backdoorAllowed ? (process.env.E2E_TEST_KEY ?? '') : '';
  const e2eHeader = (ctx.req.headers['x-e2e-test-key'] as string | undefined) ?? '';
  // Defensa adicional: si el key es corto (<32 chars), no aceptarlo nunca aunque matchee.
  // Evita el escenario "alguien dejó E2E_TEST_KEY=test123 por descuido".
  if (e2eKey && e2eKey.length >= 32 && e2eHeader && e2eHeader === e2eKey) {
    ctx.user = {
      id: process.env.E2E_TEST_USER_ID || 'e2e_test_user',
      clerk_user_id: process.env.E2E_TEST_USER_ID || 'e2e_test_user',
      clerk_org_id: process.env.E2E_TEST_CLERK_ORG_ID || null,
      clerk_org_role: 'admin',
      email: 'e2e@kunodigital.com',
    };
    log.info('e2e test auth granted', { traceId: ctx.traceId, path: ctx.req.url });
    return;
  }
  // Aviso ruidoso si alguien intenta usar el backdoor (señal de scanning).
  if (!backdoorAllowed && e2eHeader) {
    log.warn('e2e backdoor attempted but disabled (E2E_BACKDOOR_ALLOWED!=true) — ignored', {
      traceId: ctx.traceId,
      path: ctx.req.url,
      ip: ctx.req.headers['x-forwarded-for'],
    });
  }

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
