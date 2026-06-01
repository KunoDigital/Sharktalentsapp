# Runbook — Rotar un secret

## Cuándo

- Una credencial se filtró (commit accidental, screenshot público, leak en logs).
- Un empleado/colaborador con acceso se va.
- Política regular: rotar cada N meses.
- Después de detectar acceso anómalo en logs.

## Secrets que se pueden rotar

| Secret | Dónde se usa | Impacto al rotar |
|---|---|---|
| `INTERNAL_API_KEY` | endpoints `/admin/*` con header `X-Internal-Key` | Scripts/cron que usen la vieja fallan hasta actualizar |
| `URL_SIGNING_SECRET` | tokens de tests, reportes, portal cliente | **TODOS los links viejos quedan inválidos** — candidatos a mitad de test ven 401 |
| `CLERK_SECRET_KEY` | verificación de JWT del frontend | Sesiones activas se invalidan, users tienen que re-login |
| `CLERK_WEBHOOK_SECRET` | verificación de webhooks de Clerk | Webhooks de Clerk fallan hasta actualizar en Clerk Dashboard |
| `ANTHROPIC_API_KEY` | llamadas a Anthropic | Calls fallan con 401 hasta actualizar |
| `CATALYST_TOKEN` | deploy CI/CD | GitHub Actions deploy falla hasta actualizar |

## Pasos generales

### 1. Generar nuevo secret

Para `INTERNAL_API_KEY` y `URL_SIGNING_SECRET`:

```bash
./scripts/generate-secret.sh
```

Para Clerk: regenerar en https://dashboard.clerk.com → API keys.
Para Anthropic: regenerar en https://console.anthropic.com.
Para Catalyst: `catalyst token:generate` desde CLI.

### 2. Actualizar en TODOS los lugares

```
Catalyst Console → Functions → api → Environment Variables
  → editar el valor → Save
```

Para CI/CD (`CATALYST_TOKEN`):
```
GitHub repo → Settings → Secrets and variables → Actions
  → editar CATALYST_TOKEN → Update
```

### 3. Re-deploy

Re-deployar el backend para que tome el nuevo valor:

```bash
./scripts/deploy-backend.sh dev
```

### 4. Comunicar (si afecta a otros)

- **`URL_SIGNING_SECRET` rotado:** todos los links de tests, reportes y portales de
  clientes anteriores quedan inválidos. Mandarles los nuevos links si todavía están en
  proceso.
- **`CLERK_SECRET_KEY` rotado:** users del admin panel tienen que re-login.
- **`INTERNAL_API_KEY` rotado:** actualizar la nota local de Cris (Apple Notes).
  Actualizar cualquier cron externo o monitoreo que lo use.

### 5. Confirmar funcionamiento

```bash
# Health debe seguir 200
curl $URL/health | jq '.status'

# Endpoints admin con la nueva key
curl -H "X-Internal-Key: $INTERNAL_API_KEY" \
  $URL/admin/verify-tables | jq '.ok'
```

### 6. Auditar uso de la key vieja

Revisar logs de Catalyst últimas 24h por intentos de uso de la key vieja. Si hay tráfico
post-rotación, investigar el origen — alguien todavía tiene la vieja.

## Casos especiales

### `ANTHROPIC_API_KEY`

Anthropic permite tener varias keys activas a la vez. Estrategia segura:

1. Crear key nueva en console.anthropic.com (no borrar la vieja todavía).
2. Actualizar en Catalyst Console → re-deploy.
3. Verificar que `/admin/anthropic-ping` da `ok: true` con la nueva.
4. Esperar 5 min para asegurar que ningún request inflight usaba la vieja.
5. Eliminar la key vieja en console.anthropic.com.

### `URL_SIGNING_SECRET` — caso destructivo

Si NO querés invalidar todos los links viejos, NO rotar este secret. Mejor opción:
- Marcar los links viejos como expired (no se puede hacer hoy con tokens autocontenidos —
  ver ADR-003).
- Esperar a que expiren naturalmente (default 7d para tests, 90d para portals).

Solo rotar `URL_SIGNING_SECRET` si:
- Se filtró públicamente (Github commit, screenshot, etc.) — riesgo > inconveniencia.
- Estás 100% seguro de que no hay tests/reportes/portales activos en proceso.

### Backup del secret viejo

ANTES de rotar, anotar el valor viejo en un lugar seguro temporal. Si algo falla, podés
revertir poniendo el viejo de vuelta. Borrar 24h después.

## Métricas post-rotación

- 0 errores 401 en logs últimas 24h con prefijo `[INTERNAL_AUTH]` o `[URL_SIGNING]`
- `/admin/verify-tables` devuelve 200 con la nueva key
- Webhooks de Clerk siguen procesando OK (chequear `[TENANTS]` en logs)
