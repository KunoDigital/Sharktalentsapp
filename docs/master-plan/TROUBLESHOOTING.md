# Troubleshooting — qué hacer si algo falla

Casos comunes de fallo y cómo diagnosticar/resolver.

## 🔴 Backend no responde

**Síntoma:** `curl /health` no devuelve nada o tarda mucho.

**Diagnóstico:**
```bash
curl -v https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/health
```

**Causas:**
1. **Backend no deployado** — `./scripts/deploy-backend.sh dev`
2. **Catalyst caído** — chequear [status.zoho.com](https://status.zoho.com)
3. **Function freezeada** — Catalyst hace cold-start si no tiene tráfico. Primer request tarda 2-5 seg, después es rápido.

## 🟡 `/health` devuelve `degraded`

Mirá el campo `checks` para ver qué falla:

```json
{
  "status": "degraded",
  "checks": {
    "process": { "status": "ok" },
    "database": { "status": "fail", "reason": "..." },
    "env_vars": { "status": "fail", "reason": "Missing: ANTHROPIC_API_KEY" },
    "anthropic_breaker": { "status": "fail", "reason": "Open since ..." }
  }
}
```

### `database: fail`
- Tabla `Tenants` no existe → crear (ver MIGRATIONS_BLOCK1.md)
- Conexión Catalyst caída → reintentar en 30 seg
- Permisos del SDK → verificar que la función tiene acceso a Datastore

### `env_vars: fail (Missing: X)`
Setear la env var faltante en Catalyst Console → Functions → api → Environment Variables.

### `anthropic_breaker: fail (Open)`
El circuit breaker está abierto porque Anthropic devolvió errores 5+ veces seguidas.
- Esperá el cooldown (default 60 seg) y reintentá
- Verificar créditos en console.anthropic.com
- Si persiste, revisar logs en Catalyst Console

## 🟡 Webhook de Clerk no crea Tenants

**Síntoma:** Te registrás en Clerk con una nueva org pero `GET /admin/tenants` no la lista.

**Diagnóstico:**
1. Clerk dashboard → Webhooks → tu endpoint → Logs. ¿Se mandó? ¿Qué status code?
2. Backend logs: buscar `[TENANTS]` con el `eventId` del webhook

**Causas:**
1. **URL del webhook incorrecta** — debe ser `https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/api/webhooks/clerk` (atención al doble `/api`)
2. **`CLERK_WEBHOOK_SECRET` no coincide** — el de Catalyst Console debe ser idéntico al de Clerk dashboard. Si lo regeneraste en Clerk, hay que copiarlo de nuevo.
3. **Backend devolvió 503** — reintentos de Clerk. Mirá logs por errores en `processEventAsync`.

## 🟡 Submit de candidato falla

**Síntoma:** Candidato termina test, ve "✓ Respuestas guardadas" pero en BD no aparece.

**Diagnóstico:**
1. Browser console (F12) buscar `[DISC]`, `[VELNA]`, etc. con `submit falló`
2. Si hay `code: token_error` → token expirado o secret rotado
3. Si hay `code: validation_error` → payload mal armado
4. Si hay `code: conflict` → ya se submiteó antes (idempotencia)

**Causas comunes:**
1. **Token URL signed expiró** (default 7 días). Generar nuevo link.
2. **Application no existe** — el candidato_id o assessment_id no es válido
3. **`URL_SIGNING_SECRET` rotado** — todos los tokens viejos fallan. Regenerar links.

## 🟡 Anthropic IA no responde

**Diagnóstico:**
```bash
curl -H "X-Internal-Key: $INTERNAL_API_KEY" https://....catalystserverless.com/server/api/admin/anthropic-ping
```

**Output esperado:**
```json
{
  "ok": true,
  "latency_ms": 1234,
  "response_text": "OK"
}
```

**Si falla:**
- **`ok: false, error: "401"`** → API key inválida. Verificar `ANTHROPIC_API_KEY` en Catalyst Console.
- **`ok: false, error: "402"`** → sin créditos. Recargar en console.anthropic.com.
- **`ok: false, error: "429"`** → rate limit de Anthropic. Esperar 1 min.
- **`ok: false, error: "Circuit breaker is OPEN"`** → mucho fallo reciente. Esperar cooldown 60 seg.

## 🟡 Frontend muestra "Cargando..." forever

**Diagnóstico:** browser console → Network tab. Ver si la request al backend devuelve 401, 403, 500 o CORS error.

**CORS error en console:**
- Tu dominio frontend NO está en `ALLOWED_ORIGINS` del backend
- Solución: Catalyst Console → Functions → api → Environment Variables → editar `ALLOWED_ORIGINS` agregando tu dominio

**401 Unauthorized:**
- JWT de Clerk expiró. Cris debería re-loguearse.
- O `CLERK_SECRET_KEY` está incorrecto en Catalyst.

## 🔴 Tabla con datos incorrectos / corruptos

Si una row quedó con valores inválidos:

1. **Catalyst Console → Data Store → tabla → Browse Data** — editás manualmente
2. **Si necesitás revertir a backup:**
   ```bash
   ./scripts/backup-tables.sh ./backups
   # buscar el dump anterior al daño en ./backups/
   # importar manualmente vía Catalyst Console (Data Store → Import)
   ```

## 🔴 Borrar candidato definitivamente (GDPR)

```bash
curl -X POST \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "candidato@email.com", "confirm": "YES_DELETE_ALL"}' \
  https://....catalystserverless.com/server/api/admin/gdpr/candidate-delete
```

Borra: Candidate + Results + Scores + IntegrityDimensions + PipelineTransitions.
Persiste: AuditLog (rastro de la operación).

## 🟢 Ver actividad reciente del sistema

```bash
curl -H "X-Internal-Key: $INTERNAL_API_KEY" \
  "https://....catalystserverless.com/server/api/admin/audit-log?limit=50"
```

Filtros opcionales:
- `?resource_type=job` — solo cambios de jobs
- `?actor_user=user_xxx` — solo acciones de un usuario

## 🟢 Generar link del portal del cliente

Para mandarle a un cliente externo (ej: Banco Pacífico) un link a SU portal donde ve sus puestos y funnel:

```bash
curl -X POST \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "<tu_tenant_rowid>",
    "company": "Banco Pacífico",
    "client_name": "Carolina Aguilar",
    "client_email": "caguilar@bancopacifico.com",
    "agency_name": "Kuno Digital",
    "ttl_days": 90
  }' \
  https://...catalystserverless.com/server/api/admin/portals/issue
```

Devuelve:
```json
{
  "token": "...",
  "path": "/portal/...",
  "expires_in_days": 90
}
```

Concatená al frontend: `https://app.sharktalents.ai/#/portal/<token>`. Mandá ese link al cliente.

**⚠️ Hoy:** revocar un link puntual implica rotar `URL_SIGNING_SECRET` (afecta TODOS los tokens). Cuando se cree la tabla `ClientPortals` (Block 2), habrá revocación granular.

## 🟢 Stats del sistema

```bash
curl -H "X-Internal-Key: $INTERNAL_API_KEY" \
  https://....catalystserverless.com/server/api/admin/stats
```

Devuelve conteos por tabla + outbox pending.

## 🟢 Rotar secrets

Si un secret se compromete (ej: alguien tiene acceso a tu compu):

```bash
./scripts/rotate-secret.sh INTERNAL_API_KEY
```

Te da un nuevo secret. Actualizalo en:
1. Tu nota Apple (reemplazar el viejo)
2. Catalyst Console → Functions → api → Environment Variables
3. Re-deploy: `./scripts/deploy-backend.sh dev`
4. Si tenés CI/CD con `CATALYST_TOKEN`, regenerar también con `catalyst token:generate`

## Logs del backend

Catalyst Console → Functions → api → Logs. Buscar por:
- `[TRACE]` + traceId del error
- `[SEVERITY=ERROR]` para errores críticos
- `[ANTHROPIC]` para llamadas IA
- `[AUDIT]` para acciones de admin

## Cuando todo lo demás falla

1. **Revisar último deploy:** ¿qué cambió? `git log --oneline -10`
2. **Rollback si necesario:** revertir el último commit + re-deploy
3. **Pedir ayuda:** [Catalyst support](mailto:support@zohocatalyst.com) — incluir tu trace_id del error

## Comandos útiles

```bash
# Health
curl ${URL}/health | jq .

# Verify tablas existen
./scripts/verify-tables.sh

# Backup todas las tablas
./scripts/backup-tables.sh

# Stats admin
curl -H "X-Internal-Key: $KEY" ${URL}/admin/stats | jq .

# Audit log últimas 50
curl -H "X-Internal-Key: $KEY" "${URL}/admin/audit-log?limit=50" | jq '.entries[] | {action, resource_type, created_at}'

# Anthropic ping
curl -H "X-Internal-Key: $KEY" ${URL}/admin/anthropic-ping | jq .

# Process outbox manualmente
curl -X POST -H "X-Internal-Key: $KEY" ${URL}/admin/outbox/process | jq .
```
