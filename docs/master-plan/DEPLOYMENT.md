# Deployment — guía paso a paso

Cómo deployar SharkTalents desde tu compu a Catalyst (Development environment).

## Prerrequisitos

- ✅ Catalyst CLI instalado (`brew install zoho/tap/catalyst-cli` o equivalente)
- ✅ Logueada (`catalyst whoami` debe mostrar tu email)
- ✅ Proyecto activo: `Sharktalentsapp` (ID `28606000000676053`)
- ✅ Las 14 tablas creadas (ver [MIGRATIONS_BLOCK1.md](MIGRATIONS_BLOCK1.md))

## Paso 1 — Generar secrets

Algunos secrets deben existir antes del primer deploy. Generalos con:

```bash
./scripts/generate-secret.sh
```

Te tira 3 strings random (HEX/Base64). Necesitás:

- `INTERNAL_API_KEY` — usado para `/admin/verify-tables` y futuros endpoints internos
- `URL_SIGNING_SECRET` — para firmar URLs públicas (reportes, tests de candidatos)
- `CRYPTO_MASTER_KEY` — para encrypt at-rest de transcripts y datos sensibles

**Guardalos en tu password manager.** Si los perdés, los rotás con `./scripts/rotate-secret.sh <KEY>`, pero algunas cosas firmadas dejan de validar.

## Paso 2 — Configurar env vars en Catalyst Console

Console → Functions → `api` → Environment Variables. Llená:

### Auth (Clerk)
- `CLERK_PUBLISHABLE_KEY` — de tu Clerk dashboard, app SharkTalents
- `CLERK_SECRET_KEY` — Clerk dashboard → API Keys
- `CLERK_WEBHOOK_SECRET` — Clerk dashboard → Webhooks → tu endpoint → Signing Secret

### IA (Anthropic)
- `ANTHROPIC_API_KEY` — console.anthropic.com → API Keys → Generate

### Internos (los del paso 1)
- `INTERNAL_API_KEY`
- `URL_SIGNING_SECRET`
- `CRYPTO_MASTER_KEY`

### Resto
Todas las otras (`ANTHROPIC_MODEL`, `RATE_LIMIT_*`, `BOT_MODE`, etc.) ya tienen defaults razonables en `catalyst-config.json`. Las podés override desde la consola si querés.

📚 Lista completa con descripciones: [ENV_VARS.md](ENV_VARS.md).

## Paso 3 — Deploy del backend

```bash
./scripts/deploy-backend.sh dev
```

Esto:
1. Compila TypeScript (`tsc`)
2. Sube los `.js` a Catalyst Development
3. Te tira la URL del endpoint, ej: `https://api-1234567890.development.catalystserverless.com`

Anotá esa URL — la necesitás para el siguiente paso.

## Paso 4 — Verificar tablas

Asumiendo que ya creaste las 14 tablas:

```bash
export CATALYST_API_URL='https://api-XXXX.development.catalystserverless.com'
export INTERNAL_API_KEY='<el del paso 1>'
./scripts/verify-tables.sh
```

Output esperado:
```
✓ Tenants
✓ ProcessedEvents
✓ Jobs
... (las 14)

✓ Todas las tablas OK
```

Si hay alguna ✕ o ⚠️ → falta alguna columna o no existe la tabla. Volvé a la consola Catalyst y completalo.

## Paso 5 — Configurar webhook de Clerk

En Clerk dashboard:
1. → Webhooks → Add Endpoint
2. URL: `${CATALYST_API_URL}/api/webhooks/clerk`
3. Subscribe to: `organization.created`, `organization.updated`, `organization.deleted`, `user.deleted`
4. Copiá el Signing Secret → es tu `CLERK_WEBHOOK_SECRET` (paso 2)
5. Re-deploy backend si cambiaste env vars: `./scripts/deploy-backend.sh dev`

## Paso 6 — Probar end-to-end

### Health check
```bash
curl ${CATALYST_API_URL}/health
# Esperado: { "ok": true, "version": "0.1.0" }
```

### Crear org en Clerk → ver Tenant en BD
1. En tu app frontend (localhost:3000 o donde esté), creá una org desde el OrganizationSwitcher de Clerk.
2. Esto dispara `organization.created` → webhook → backend → fila en `Tenants`.
3. Verificá: Catalyst Console → Data Store → Tenants → debería tener la nueva row.

### Crear un job (autenticada como user de la org)
```bash
# Saca un JWT desde tu app (usás Clerk getToken() en consola del browser)
TOKEN='ey...'

curl -X POST ${CATALYST_API_URL}/api/jobs \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Desarrollador Senior Test",
    "company": "Empresa Demo",
    "cognitive_level": "senior"
  }'
```

Si te tira 200 con el job creado → todo el stack funciona.

## Paso 7 — Deploy del frontend

```bash
./scripts/deploy-frontend.sh
```

Esto:
1. Build con Vite (`npm run build` en `shark/`)
2. Sube `dist/` a Catalyst Slate (web hosting)
3. Te da la URL pública

## Troubleshooting

### "Missing required env var: CLERK_PUBLISHABLE_KEY"
Las env vars no están seteadas en consola. Volvé al paso 2.

### "verify-tables falla con 401"
- `INTERNAL_API_KEY` en tu shell no coincide con el de Catalyst Console.
- O el endpoint `/admin/verify-tables` no se deployó. Revisá `catalyst deploy --only functions:api` salió OK.

### "Webhook devuelve 401 Invalid svix signature"
- El `CLERK_WEBHOOK_SECRET` en consola no coincide con el de Clerk dashboard.
- Cuidado: cada endpoint en Clerk tiene su propio secret. Si tenés varios, asegurate de copiar el correcto.

### "CORS bloqueando requests del frontend"
- Agregá tu URL de frontend a `ALLOWED_ORIGINS` (comma-separated) en Catalyst Console → env vars.
- Re-deploy: `./scripts/deploy-backend.sh dev`.

### "Function timeout (30s)"
- Anthropic puede tardar. Aumentá `ANTHROPIC_TIMEOUT_MS` en consola (max 25_000 para dejar buffer).
- Considerar `BOT_MODE=cold` para evitar llamadas Anthropic en hot path.

## Promoción a Production

Cuando todo funcione en Development:

```bash
./scripts/deploy-backend.sh prod
```

⚠️ Tablas se crean separadamente en Production environment (no se promueven automáticamente). Tenés que repetir el flujo de [MIGRATIONS_BLOCK1.md](MIGRATIONS_BLOCK1.md) en el ambiente Production.
