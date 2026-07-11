import { createClerkClient, verifyToken } from '@clerk/backend';
import type { RequestContext } from './context';
import { env } from './env';
import { ForbiddenError, UnauthorizedError } from './errors';
import { logger } from './logger';

const log = logger('AUTH');

let cachedClient: ReturnType<typeof createClerkClient> | null = null;

const roleCache = new Map<string, { role: string | null; expiresAt: number }>();
const ROLE_CACHE_TTL_MS = 60_000;

async function fetchUserRoleCached(sub: string): Promise<string | null> {
  const now = Date.now();
  const hit = roleCache.get(sub);
  if (hit && hit.expiresAt > now) return hit.role;
  try {
    const user = await clerk().users.getUser(sub);
    const meta = (user.publicMetadata ?? {}) as { role?: string };
    const role = typeof meta.role === 'string' && meta.role.length > 0 ? meta.role : null;
    roleCache.set(sub, { role, expiresAt: now + ROLE_CACHE_TTL_MS });
    return role;
  } catch (err) {
    log.warn('fetchUserRole failed', { sub, error: (err as Error).message });
    return null;
  }
}

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
      role: process.env.E2E_TEST_ROLE || null,
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

    // Rol a nivel usuario (independiente de organización). Vive en
    // Clerk publicMetadata.role. Se setea manualmente por el admin desde el
    // dashboard de Clerk (Users → publicMetadata → { "role": "freelance" }).
    //
    // Clerk por default NO incluye publicMetadata en el JWT. Dos caminos:
    //   1) Si el admin configuró un JWT template con {{user.public_metadata}},
    //      el rol viene en el token → lo leemos y salimos.
    //   2) Si NO, hacemos fetch al Backend API de Clerk para leerlo del user.
    // Cacheamos la respuesta 60s por sub para evitar 1 fetch por request.
    const publicMetadata = (payload as { public_metadata?: { role?: string } }).public_metadata;
    let userRole: string | null = publicMetadata?.role ?? null;
    if (!userRole) {
      userRole = await fetchUserRoleCached(sub);
    }

    ctx.user = {
      id: sub,
      clerk_user_id: sub,
      clerk_org_id: orgV2?.id ?? orgIdV1 ?? null,
      clerk_org_role: orgV2?.rol ?? orgRoleV1 ?? null,
      email: (payload as { email?: string }).email ?? null,
      role: userRole,
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

/**
 * Gatea endpoints por rol a nivel usuario (publicMetadata.role).
 * Distinto a requireOrgRole (que gatea por rol dentro de una organización).
 *
 * Uso principal: separar el CRM interno del freelance del ATS del tenant.
 * Ejemplo:
 *   requireUserRole(ctx, 'freelance');  // solo pasa si ctx.user.role === 'freelance'
 *
 * IMPORTANTE: en endpoints `auth: 'tenant'` NO se llama esto — el rechazo del
 * freelance en esos endpoints se maneja en el router para evitar que un freelance
 * acceda por descuido a rutas ATS (donde el gating es implícito).
 */
export function requireUserRole(ctx: RequestContext, requiredRole: string): void {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  if (ctx.user.role !== requiredRole) {
    throw new ForbiddenError(`Role "${requiredRole}" required`);
  }
}

/**
 * Rechazo defensivo: en endpoints `auth: 'tenant'`, un usuario con rol
 * distinto de null (freelance u otro rol futuro) NO debería pasar aunque
 * tenga org activa. Evita que un freelance con org accedente por error
 * al ATS actual.
 */
export function rejectNonTenantRoles(ctx: RequestContext): void {
  if (!ctx.user) return;
  if (ctx.user.role !== null) {
    throw new ForbiddenError(`Role "${ctx.user.role}" cannot access tenant endpoints`);
  }
}
