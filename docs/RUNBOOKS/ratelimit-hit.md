# Runbook — Rate limit golpea legítimo

## Síntomas

- User reporta error `rate_limited` con 429 en respuesta.
- En logs `[RATE_LIMITER] denied` con detalles `tenantId/ip` + `bucket_full`.
- Cola de candidatos completando submit en simultáneo (ej: día de cierre del puesto).

## Diagnóstico rápido

```bash
# 1. Health → ver contadores actuales
curl $URL/health | jq '.checks.rate_limiter'

# Output esperado en estado normal:
# { "status": "ok", "buckets": 12 }

# Si hay > 100 buckets activos: hay tráfico orgánico alto, no abuso.
# Si hay > 500 buckets: posible scraping o ataque.
```

## Causas comunes

### 1. Tráfico legítimo en spike (día de evento)

**Ej:** 50 candidatos completando técnica + DISC simultáneo el mismo día porque enviaste
los links a todos juntos.

**Acción:** subir el rate limit temporalmente:
```
Catalyst Console → Functions → api → Environment Variables
  → editar RATE_LIMIT_PER_MIN_TENANT (default 60) → 200
  → Save → re-deploy
```

Bajarlo a 60 al día siguiente.

### 2. Bot scraping o abuso desde una IP

**Síntoma:** mismo `ip` con cientos de hits/min, varios `tenantId` o ninguno.

**Acción:**
- Si es claramente abuso: bloquear la IP en Catalyst Console (Functions → Security).
- Si es ambiguo: bajar rate limit per-IP `RATE_LIMIT_PER_MIN_IP` a 30 (default 100) — el
  abuso se corta, los users normales no lo notan.

### 3. Bug en el rate limiter (false positive)

Si user dice "no hice nada raro y me limitó":

```bash
# Reset manual del bucket (endpoint admin si existe, o reiniciar function)
# Cleanup automático ocurre después de 5 min sin tráfico al bucket.

# Workaround: el user espera 60s y reintenta — el bucket se reabastece.
```

Si pasa frecuentemente: bug en `lib/rateLimiter.ts`. Revisar `cleanupOld()` y el cálculo
de `tokens_remaining`.

## Mitigación temporal

Si querés que el user específico pueda seguir SIN bajar el rate limit global:
- Agregarlo a una whitelist (no implementado todavía — feature request si es recurrente).
- O subir su rate limit por API key (en `ApiKeys.rate_limit_per_min` si está autenticado
  por API key).

## Verificación post-fix

```bash
# Volver a chequear health
curl $URL/health | jq '.checks.rate_limiter'

# El user afectado debe poder operar
```

## Configuración de defaults

En `.env` (Catalyst Console env vars):

| Variable | Default | Sentido |
|---|---|---|
| `RATE_LIMIT_PER_MIN_TENANT` | 60 | Por tenant autenticado |
| `RATE_LIMIT_PER_MIN_IP` | 100 | Por IP cuando no hay tenant (público) |
| `RATE_LIMIT_BURST_FACTOR` | 1.5 | Multiplicador de burst (60 → permite 90 en 1s) |

## Rate limit en API keys (granular)

Si una API key específica está saturando, su límite es `ApiKeys.rate_limit_per_min`
(default 60). Editable via:

```bash
curl -X PATCH \
  -H "Authorization: Bearer st_admin_..." \
  -d '{"rate_limit_per_min": 200}' \
  $URL/api/api-keys/<id>
```

O desde Settings → API keys → Editar.

## Alertas

Hoy NO hay alertas automáticas de rate limit. Métrica de éxito futura: dashboard que
muestra "% de requests rechazados por rate limit" — si pasa de 1%, alerta.
