# 14 — Integración con Clerk (Auth + Organizations)

**Objetivo:** reemplazar el auth custom (scrypt + JWT propio + admin único) con [Clerk](https://clerk.com/) — maneja users, sessions, password reset, email verification, MFA, SSO, y **organizations** que son nuestro modelo de tenants.

**Tiempo estimado:** 1.5 semanas.
**Dependencias:** Fase 1 (env vars). Reemplaza parte de [Fase 3 — Seguridad](04_FASE3_SEGURIDAD.md). Se ejecuta junto con [13_MULTITENANT.md](13_MULTITENANT.md).
**Riesgo:** medio. Cambio grande de modelo. Requiere cut-over coordinado del admin actual.

**Referencia oficial:** https://clerk.com/docs/react/getting-started/quickstart

---

## Por qué Clerk (y no auth custom)

**Lo que dejamos:**
- Password management (hashing, reset, forgotten password)
- Email verification
- Multi-factor authentication (MFA)
- Session management
- JWT signing/verification
- User invitations
- Organizations (= tenants)
- Roles y permisos (built-in)
- SSO (Google, Microsoft, SAML futuros)

**Lo que hacemos nosotros:**
- Mapear users de Clerk → datos de dominio (puestos, candidatos)
- Mapear organizations de Clerk → Tenants en nuestra DB
- Enforcement de tenant scope en cada query
- Audit log con actor de Clerk
- Webhooks para sync

**Trade-off:** agregamos dependencia externa. Mitigación:
- Clerk Free tier es suficiente para empezar (10k MAU).
- Plan de migración-out documentado por si alguna vez se decide dejar Clerk.
- Auth se abstrae detrás de un middleware — cambio de provider = cambiar una capa.

---

## Deliverables

- [ ] Frontend integrado con `@clerk/react@latest`
- [ ] Backend verifica JWT de Clerk vía JWKS
- [ ] Middleware `requireAuth` refactoreado a usar Clerk
- [ ] Tabla `Tenants` sincronizada con Clerk Organizations vía webhooks
- [ ] Endpoint webhook `/api/webhooks/clerk` con HMAC verification
- [ ] Usuario admin actual migrado a Clerk
- [ ] Roles via Clerk (org-level): `admin` y `member`
- [ ] Invitations a equipo vía Clerk UI
- [ ] `<OrganizationSwitcher>` en sidebar admin
- [ ] Docs: `docs/INTEGRATIONS/clerk.md`
- [ ] Runbook: `docs/RUNBOOKS/clerk-caido.md`

---

## 1. Setup Frontend

### Instalación

```bash
cd frontend
npm install @clerk/clerk-react@latest
```

**Nota:** el paquete correcto es `@clerk/clerk-react` (no `@clerk/react`).

### Env var

`.env.local` para dev, `.env.production` para prod, `.env.example` commiteable.

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx   # dev: obtener en dashboard.clerk.com
# Producción: pk_live_xxx
```

Obtener la key: https://dashboard.clerk.com/ → API Keys → React.

### Envolver la app con `<ClerkProvider>` en `main.tsx`

```tsx
// shark/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './styles/global.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
    >
      <App />
    </ClerkProvider>
  </StrictMode>
);
```

### Componentes Clerk en el sidebar admin

Reemplaza el login custom actual.

```tsx
// shark/src/components/AdminLayout.tsx
import { UserButton, OrganizationSwitcher, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { NavLink, Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <div>
          <aside style={sidebarStyle}>
            <div style={logoStyle}>SharkTalents</div>

            <div style={{ marginBottom: 20 }}>
              <OrganizationSwitcher
                afterSelectOrganizationUrl="/admin"
                hidePersonal={true}
              />
            </div>

            <nav style={navStyle}>
              <NavLink to="/admin" end style={getLinkStyle}>Puestos</NavLink>
              <NavLink to="/admin/candidates" style={getLinkStyle}>Candidatos</NavLink>
              <NavLink to="/admin/library" style={getLinkStyle}>Biblioteca</NavLink>
              <NavLink to="/admin/reportes" style={getLinkStyle}>Reportes</NavLink>
              <NavLink to="/admin/costos" style={getLinkStyle}>Costos</NavLink>
            </nav>

            <div style={{ marginTop: 'auto', padding: 16 }}>
              <UserButton afterSignOutUrl="/" />
            </div>
          </aside>
          <main style={contentStyle}>
            <Outlet />
          </main>
        </div>
      </SignedIn>
    </>
  );
}
```

### Páginas de Sign-in y Sign-up

Clerk provee componentes hosted. Dos opciones:

**Opción A (más simple):** rutas dedicadas con componentes de Clerk

```tsx
// shark/src/App.tsx
import { SignIn, SignUp } from '@clerk/clerk-react';

// En rutas:
<Route path="/sign-in/*" element={<SignIn routing="path" path="/sign-in" />} />
<Route path="/sign-up/*" element={<SignUp routing="path" path="/sign-up" />} />
```

**Opción B:** usar las páginas hosted por Clerk (`<RedirectToSignIn />` lleva automáticamente). Menos código pero sale del dominio del sitio.

**Recomendación:** Opción A para que sea parte del flow de la app (y se pueda estilizar con el theme).

### Borrar páginas custom

- `shark/src/pages/admin/Login.tsx` — **eliminar**.
- Servicio `login()` en `services/auth.ts` — **eliminar**.
- `RequireAuth.tsx` — reemplazar con `<SignedIn><Outlet /></SignedIn>` + `<SignedOut><RedirectToSignIn /></SignedOut>`.

### Obtener token para llamadas al backend

Clerk provee hooks:

```tsx
import { useAuth } from '@clerk/clerk-react';

function MyComponent() {
  const { getToken } = useAuth();

  const handleCreateJob = async () => {
    const token = await getToken();
    const res = await fetch('/api/admin/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobData),
    });
  };
}
```

### Refactor del fetch wrapper

```tsx
// shark/src/lib/api.ts
let getTokenFn: (() => Promise<string | null>) | null = null;

export function setupApi(getToken: () => Promise<string | null>) {
  getTokenFn = getToken;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Trace-Id': generateTraceId() };

  if (!opts.skipAuth && getTokenFn) {
    const token = await getTokenFn();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  // ... resto igual
}
```

E inicializar en `App.tsx`:

```tsx
import { useAuth } from '@clerk/clerk-react';
import { setupApi } from './lib/api';

function App() {
  const { getToken } = useAuth();
  useEffect(() => { setupApi(getToken); }, [getToken]);
  // ...
}
```

---

## 2. Setup Backend

### Instalación

```bash
cd functions/api
npm install @clerk/backend@latest
```

### Env vars

```
CLERK_PUBLISHABLE_KEY=pk_test_xxx        # igual que frontend (seguro públicamente)
CLERK_SECRET_KEY=sk_test_xxx             # SECRETO — solo backend
CLERK_WEBHOOK_SECRET=whsec_xxx           # para verificar webhooks
```

### Verificación de tokens

```typescript
// functions/api/src/middleware/auth.ts
import { verifyToken } from '@clerk/backend';
import { UnauthorizedError } from '../lib/errors';
import { getEnv } from '../lib/env';

export async function requireAuth(ctx: RequestContext): Promise<void> {
  const authHeader = (ctx.req.headers as any).authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Bearer token');
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: getEnv('CLERK_SECRET_KEY'),
      // o via JWKS directo — Clerk lo cachea:
      // issuer: getEnv('CLERK_ISSUER_URL'),
    });

    ctx.user = {
      id: payload.sub,               // Clerk user ID
      clerk_user_id: payload.sub,
      clerk_org_id: payload.org_id,  // org activa en el JWT (si está)
      clerk_org_role: payload.org_role,  // 'admin' | 'basic_member'
      email: payload.email,
    };
  } catch (err: any) {
    throw new UnauthorizedError(`Invalid token: ${err.message}`);
  }
}
```

Clerk firma JWTs con su clave privada; la verificación usa JWKS público fetched on-demand (el SDK lo cachea).

### Middleware `requireOrgRole`

Equivalente al `requireAdmin` custom:

```typescript
export function requireOrgRole(ctx: RequestContext, allowedRoles: string[]): void {
  if (!ctx.user?.clerk_org_id) {
    throw new ForbiddenError('No active organization');
  }
  if (!allowedRoles.includes(ctx.user.clerk_org_role || '')) {
    throw new ForbiddenError(`Role ${ctx.user.clerk_org_role} not allowed`);
  }
}

// Shortcuts
export function requireAdmin(ctx: RequestContext) {
  requireOrgRole(ctx, ['admin']);
}
```

### Borrar auth custom

- `functions/api/src/lib/password.ts` — **eliminar**
- `functions/api/src/lib/jwt.ts` — **eliminar**
- `functions/api/src/handlers/auth.ts` con `POST /api/admin/login` — **eliminar**
- `ADMIN_USER`, `ADMIN_PASS_HASH`, `JWT_SECRET` env vars — **eliminar**
- `scripts/generate-password-hash.sh` — **eliminar**

El login lo maneja Clerk en el frontend. Backend solo verifica JWT.

---

## 3. Webhooks de Clerk

Clerk manda eventos HTTP cuando pasan cosas importantes (org creada, user actualizado, etc.). Recibimos esos eventos para sincronizar con nuestra DB.

### Eventos que nos interesan

| Evento | Acción |
|---|---|
| `organization.created` | Crear row en `Tenants` |
| `organization.updated` | Actualizar `name`, `slug` en `Tenants` |
| `organization.deleted` | Marcar `Tenants.status = 'deleted'` |
| `organizationMembership.created` | (Opcional) Log en audit: user X se unió a org Y |
| `user.created` | (Opcional) Inicializar profile |
| `user.deleted` | (Opcional) Anonimizar data del user (compliance GDPR) |

### Endpoint

```typescript
// functions/api/src/handlers/clerkWebhooks.ts
import { Webhook } from 'svix';   // Clerk usa Svix para webhooks
import { getEnv } from '../lib/env';
import { readRawBody } from '../lib/http';

export async function handleClerkWebhook(ctx: RequestContext) {
  const rawBody = await readRawBody(ctx.req);
  const secret = getEnv('CLERK_WEBHOOK_SECRET');

  // Verificar signature con Svix
  const wh = new Webhook(secret);
  let event;
  try {
    event = wh.verify(rawBody, {
      'svix-id': ctx.req.headers['svix-id'] as string,
      'svix-timestamp': ctx.req.headers['svix-timestamp'] as string,
      'svix-signature': ctx.req.headers['svix-signature'] as string,
    });
  } catch (err: any) {
    throw new UnauthorizedError(`Invalid webhook signature: ${err.message}`);
  }

  // Idempotencia
  const eventId = (ctx.req.headers['svix-id'] as string) || `${event.type}:${event.data?.id}`;
  const isNew = await processedEventsDb.markProcessed(ctx.req, eventId, 'clerk');
  if (!isNew) {
    return sendJson(ctx.res, 200, { received: true, duplicate: true });
  }

  // Responder 200 rápido antes de procesar
  sendJson(ctx.res, 200, { received: true });

  // Procesar async
  processEventAsync(ctx.req, event).catch(err => {
    console.error(`[CLERK-WH] Processing failed for ${eventId}: ${err.message}`);
  });
}

async function processEventAsync(req: any, event: any): Promise<void> {
  const logger = createLogger('CLERK-WH');
  logger.info('processing', { type: event.type, id: event.data?.id });

  switch (event.type) {
    case 'organization.created':
      await tenantsDb.insert(req, {
        clerk_org_id: event.data.id,
        name: event.data.name,
        slug: event.data.slug || slugify(event.data.name),
        plan: 'free',
        status: 'active',
        max_active_jobs: 5,
        max_candidates_per_month: 50,
        features_enabled: JSON.stringify({ mcp: false, api: false, custom_branding: false }),
        created_at: db.now(),
        updated_at: db.now(),
      });
      break;

    case 'organization.updated':
      const tenant = await tenantsDb.getByClerkOrgId(req, event.data.id);
      if (tenant) {
        await tenantsDb.update(req, tenant.id, {
          name: event.data.name,
          slug: event.data.slug || tenant.slug,
          updated_at: db.now(),
        });
      }
      break;

    case 'organization.deleted':
      const t = await tenantsDb.getByClerkOrgId(req, event.data.id);
      if (t) {
        await tenantsDb.update(req, t.id, { status: 'deleted', updated_at: db.now() });
      }
      break;

    case 'user.deleted':
      // TODO: anonimizar data del user en nuestra DB (audit log, etc.)
      logger.warn('user.deleted — manual cleanup may be required', { userId: event.data.id });
      break;
  }
}
```

### Configuración en Clerk Dashboard

1. Clerk Dashboard → Webhooks → Add endpoint
2. URL: `https://sharktalents.ai/server/api/api/webhooks/clerk`
3. Events: seleccionar los 5 de arriba
4. Copiar el Signing Secret → env var `CLERK_WEBHOOK_SECRET`

---

## 4. Migración del admin actual

Hoy hay un admin único (env vars `ADMIN_USER` + `ADMIN_PASS_HASH`).

### Plan

1. **Crear primer Clerk organization:** "Kuno Digital" (via dashboard manualmente).
2. **Invitar al admin actual** (`cuentas@kunodigital.com`) a esa org con rol `admin`.
3. **Password setup:** el admin recibe email de Clerk con instrucciones para crear password (o login via Google si configura SSO).
4. **Cut-over:** deploy del código nuevo que usa Clerk. El admin hace login con Clerk desde ese momento.
5. **Cleanup:** remover env vars `ADMIN_USER`, `ADMIN_PASS_HASH`, `JWT_SECRET` después de 2 semanas de operación estable.

### Data existente de "admin_user"

Ninguna. El admin no está en una tabla — solo era env var. No hay nada que migrar para el admin en sí.

**Tenant:** al crear la org "Kuno Digital" en Clerk, el webhook crea automáticamente el `Tenants` en nuestra DB. Script de migración ([10_MIGRACION_DATOS.md](10_MIGRACION_DATOS.md)) usa ese `tenant_id` al migrar la data existente.

---

## 5. Roles via Clerk

Clerk Organizations tiene roles built-in:

- **`admin`** — puede gestionar miembros, facturación, settings de la org
- **`basic_member`** — miembro regular (o crear roles custom si plan lo permite)

En SharkTalents inicialmente:
- **`admin`** = operador principal (crea puestos, ve todo)
- **`basic_member`** = colaborador (ve pipeline, no puede borrar puestos)

Custom roles (si el plan de Clerk lo permite):
- `recruiter` — crear puestos, ver candidatos, generar reportes
- `viewer` — solo lectura

### Mapeo en backend

```typescript
export function requireRecruiterOrAdmin(ctx: RequestContext): void {
  const role = ctx.user?.clerk_org_role;
  if (!['admin', 'recruiter'].includes(role || '')) {
    throw new ForbiddenError('Requires recruiter or admin role');
  }
}
```

---

## 6. Invitations

Clerk maneja invitations:

1. Admin va a `<OrganizationProfile>` (componente Clerk) → Members → Invite
2. Envía email al invitado
3. Invitado acepta → se une a la org con el rol asignado

Nosotros no escribimos código de invitations. Solo mostrar el componente:

```tsx
// shark/src/pages/admin/Settings.tsx
import { OrganizationProfile } from '@clerk/clerk-react';

export default function Settings() {
  return <OrganizationProfile />;
}
```

---

## 7. Email verification, password reset, MFA

Todo manejado por Clerk automáticamente. No escribimos código. Configurable en dashboard:
- Email verification: on por default
- Password requirements: 8+ chars, 1 número, 1 mayúscula (configurable)
- MFA: configurable, incluye SMS, TOTP, passkeys

---

## 8. SSO (futuro)

Cuando un cliente enterprise pida SSO con su Google Workspace / Microsoft / SAML:
- Clerk lo soporta en plan Pro+.
- Config per-organization en Clerk dashboard.
- Nada de código extra en SharkTalents.

---

## 9. Runbook `docs/RUNBOOKS/clerk-caido.md`

```markdown
# Runbook — Clerk caído o degradado

## Síntomas
- Usuarios no pueden hacer login
- `/api/admin/*` devuelve 401 uniformemente
- `/health/detailed` muestra `clerk: fail`

## Diagnóstico
1. https://status.clerk.com/ → ver si hay incident público
2. Clerk Dashboard → verificar keys no caducadas
3. Nuestros logs: `[AUTH] Invalid token` repetidos

## Remediación

### Si Clerk confirmó incident
- Comunicar al equipo: login está down.
- Esperar resolución.
- No hay failover posible — Clerk es hard dependency.

### Si es rate limit de Clerk (tier free)
- Plan free tiene 10k MAU. Si se excede: upgrade a Pro.

### Si keys están vencidas / rotadas incorrectamente
- Regenerar en Clerk dashboard.
- Actualizar `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` en Catalyst Console.
- Redeploy.

## Prevención
- Monitoring externo con check de /health que incluye clerk check.
- Alerta cuando failure rate > 5%.
```

---

## 10. Documentación `docs/INTEGRATIONS/clerk.md`

```markdown
# Integración Clerk

## Resumen
SharkTalents usa Clerk para:
- Authentication (login, signup, password, MFA, SSO)
- Organizations = Tenants
- User profiles
- Invitations

## Arquitectura
- Frontend: `@clerk/clerk-react` maneja UI y sesión.
- Backend: `@clerk/backend` verifica JWTs.
- Webhooks: Clerk → /api/webhooks/clerk → sincroniza Tenants en DB.

## Env vars

| Var | Dónde | Descripción |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend | Public key, OK en bundle |
| `CLERK_SECRET_KEY` | Backend | Secreto — solo Catalyst Console |
| `CLERK_WEBHOOK_SECRET` | Backend | Firma de webhooks |

## Flow de auth
1. Usuario va a app → si no logueado, redirige a `/sign-in`
2. Clerk maneja login → redirige a /admin con session activa
3. Frontend llama `getToken()` antes de cada fetch
4. Backend verifica JWT con `verifyToken()` de @clerk/backend

## Organizations (Tenants)
- Cada Clerk Organization = 1 SharkTalents Tenant
- Webhook `organization.created` → INSERT en Tenants
- `<OrganizationSwitcher>` en sidebar para cambiar tenant activo

## Roles
- `admin`: management completo del tenant
- `basic_member` / `recruiter` / `viewer`: scope reducido

## Migración-out (plan de escape)
Si alguna vez se quita Clerk:
1. Export users de Clerk via API
2. Crear tabla Users en nuestra DB
3. Reemplazar middleware auth con auth custom
4. Migrar JWTs (usuarios tendrían que hacer login de nuevo)

No es trivial, pero tampoco imposible. El abstracción del middleware ayuda.
```

---

## 11. Testing de integración

### Smoke test manual

- [ ] Ir a `/sign-up` → crear nueva cuenta → verificar email → entrar
- [ ] Crear organization "Test Org"
- [ ] Backend recibe webhook y crea Tenant en DB (verificar con query)
- [ ] Crear puesto en "Test Org"
- [ ] Invitar a un segundo user → acepta invite → ve los puestos del tenant
- [ ] Cambiar organization en `<OrganizationSwitcher>` → no ve los puestos de "Test Org"

### Logout / Sign out

- [ ] Click en `<UserButton>` → Sign out → redirige a `/` (afterSignOutUrl)
- [ ] Intentar acceder a `/admin` sin session → redirige a `/sign-in`

---

## 12. Checklist de cierre

- [ ] Frontend integrado con `@clerk/clerk-react`
- [ ] `<ClerkProvider>` en `main.tsx` con `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] `<SignedIn>`, `<SignedOut>`, `<RedirectToSignIn>` en rutas admin
- [ ] `<UserButton>` + `<OrganizationSwitcher>` en sidebar
- [ ] `/sign-in` y `/sign-up` accesibles
- [ ] Páginas `Login.tsx` y `RequireAuth.tsx` custom eliminadas
- [ ] Backend usa `@clerk/backend` para verificar JWT
- [ ] Middleware `requireAuth` refactoreado
- [ ] Handler `POST /api/admin/login` eliminado
- [ ] `lib/password.ts` y `lib/jwt.ts` custom eliminados
- [ ] Env vars old (ADMIN_USER, ADMIN_PASS_HASH, JWT_SECRET) marcadas como deprecated
- [ ] Env vars new (CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET) configuradas
- [ ] Tabla `Tenants` creada
- [ ] Endpoint webhook `/api/webhooks/clerk` con Svix verification
- [ ] Clerk Dashboard: webhook endpoint agregado con 5 eventos
- [ ] Admin actual migrado manualmente a Clerk (email invitation enviado y aceptado)
- [ ] Tenant "Kuno Digital" creado en DB vía webhook
- [ ] `docs/INTEGRATIONS/clerk.md` escrito
- [ ] `docs/RUNBOOKS/clerk-caido.md` escrito
- [ ] Smoke tests pasados

---

## Siguiente paso

→ [15_API_PUBLICA.md](15_API_PUBLICA.md) — API pública documentada con OpenAPI + API keys por tenant.
