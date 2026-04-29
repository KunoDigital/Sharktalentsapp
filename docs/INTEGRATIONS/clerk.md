# Clerk

## Resumen
Auth + organizations (= tenants). Reemplaza el auth custom del prototipo. La spec arquitectónica vive en [docs/master-plan/14_CLERK_AUTH.md](../master-plan/14_CLERK_AUTH.md). ADR-005.

- **Frontend SDK:** `@clerk/clerk-react@^5`
- **Backend SDK:** `@clerk/backend@^3`
- **Webhooks:** verificados con `svix`

## Auth (creds)

Setup en [Clerk dashboard](https://dashboard.clerk.com/) → API Keys.

| Key | Tipo | Dónde |
|---|---|---|
| Publishable Key (`pk_test_*` / `pk_live_*`) | público | env: `CLERK_PUBLISHABLE_KEY` (backend) y `VITE_CLERK_PUBLISHABLE_KEY` (frontend). Bundleable. |
| Secret Key (`sk_test_*` / `sk_live_*`) | secreto | env backend: `CLERK_SECRET_KEY`. Solo backend, jamás al cliente. |
| Webhook Signing Secret (`whsec_*`) | secreto | env backend: `CLERK_WEBHOOK_SECRET`. Generado en dashboard al crear el endpoint. |

## Organizations habilitadas

Clerk Dashboard → Organizations → enable. Sin esto, `payload.org_id` siempre es null en el JWT y `requireTenant` falla.

## Endpoints / SDK

### Frontend
- `<ClerkProvider>` envuelve `<App />` en [shark/src/main.tsx](../../shark/src/main.tsx).
- `<SignedIn>` / `<SignedOut>` / `<SignInButton>` / `<UserButton>` / `<OrganizationSwitcher>` en [shark/src/App.tsx](../../shark/src/App.tsx).
- `useAuth()` para obtener token: `await getToken()` → mandar como `Authorization: Bearer <token>`.

### Backend
- `verifyToken(token, { secretKey })` en [functions/api/src/middleware/auth.ts](../../functions/api/src/middleware/auth.ts).
- Lee `payload.sub` (user id), `payload.org_id`, `payload.org_role`.
- Cache JWKS lo maneja el SDK internamente.

## Webhooks entrantes

**Endpoint:** `POST /api/webhooks/clerk` ([handler](../../functions/api/src/handlers/clerkWebhooks.ts)).

**Headers requeridos** (de Svix):
- `svix-id`, `svix-timestamp`, `svix-signature`

**Eventos suscritos:**
| Evento | Acción |
|---|---|
| `organization.created` | Insert row en `Tenants` con plan=free, status=active |
| `organization.updated` | Update name/slug en `Tenants` |
| `organization.deleted` | Set `status=deleted` |
| `user.deleted` | Log warning (TODO: anonimizar audit log) |

**Idempotencia:** se guarda `svix-id` en tabla `ProcessedEvents` antes de procesar. Reintentos de Svix se descartan.

**Procesamiento:** respuesta 200 inmediata, lógica async después (Svix expone retries pero queremos descartar duplicados rápido para no acumular cola).

## Configuración del endpoint en Clerk Dashboard

1. Dashboard → Webhooks → Add endpoint.
2. URL: `https://<tu-dominio>/server/api/api/webhooks/clerk` (en dev: `http://localhost:3002/api/webhooks/clerk` con tunnel ngrok).
3. Events: marcar los 4 de la tabla.
4. Copiar el "Signing Secret" → env `CLERK_WEBHOOK_SECRET`.

## Limits conocidos
- Free tier: 10k MAU. Pro: $25 base + tiered. Para >50 tenants planear costos.
- Webhook latency: Svix reintenta hasta 5x con backoff exponencial. Tolera 30s offline.

## Modos de falla

| Falla | Síntoma | Recovery |
|---|---|---|
| `CLERK_SECRET_KEY` mal copiada | 401 en todos los endpoints autenticados | Verificar en dashboard, rotar via `scripts/rotate-secret.sh` |
| Webhook secret cambió y no se actualizó | 401 en `/api/webhooks/clerk`, eventos sin procesar | Copiar nuevo `whsec_*` desde dashboard, redeploy |
| Org en Clerk pero no existe en `Tenants` | 403 "Tenant not provisioned" | Webhook `organization.created` no llegó. Replay desde Clerk dashboard o crear manualmente |
| User sin org activa | 403 "No active organization" | User debe `<OrganizationSwitcher>` para seleccionar org. Si tiene 1 sola, Clerk la auto-selecciona |

## Cómo debugar

```bash
# Verificar token JWT
echo "<jwt>" | cut -d. -f2 | base64 -d 2>/dev/null

# Replay webhook desde Clerk dashboard
# Webhooks → endpoint → Recent → "..." menu → Replay

# Local dev con webhooks
ngrok http 3002
# Actualizar URL en Clerk dashboard temporalmente
```

## Last updated
2026-04-29 — Setup inicial Fase 2.
