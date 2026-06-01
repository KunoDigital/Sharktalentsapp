# Runbook — Anthropic API caída o lenta

## Síntomas

- `/admin/anthropic-ping` devuelve `ok: false` o tarda > 10s
- Endpoints que generan IA (drafts, bot, video questions, narrativas reporte) devuelven
  502 con `code: 'upstream_error'` o tardan mucho
- Logs `[ANTHROPIC]` muestran error 5xx, timeout, o `Circuit breaker is OPEN`
- Cliente final ve "Cargando..." infinito en pages que dependen de IA (PublicReport bundle,
  drafts post-meeting, bot decisor)

## Diagnóstico rápido

```bash
# 1. Health check del backend
curl -H "X-Internal-Key: $INTERNAL_API_KEY" \
  $URL/admin/anthropic-ping | jq .
```

Output esperado:
- `ok: true, latency_ms: <2000`: todo bien
- `ok: false, error: "401"`: API key inválida → revisar `ANTHROPIC_API_KEY` en Catalyst Console
- `ok: false, error: "402"`: sin créditos → recargar en console.anthropic.com
- `ok: false, error: "429"`: rate limit → esperar 1 min, no es nuestro problema
- `ok: false, error: "Circuit breaker is OPEN"`: nuestro circuit breaker se abrió por fallas
  consecutivas → esperar el cooldown (default 60s) y reintentar

## Causas comunes

### 1. API key inválida o sin créditos

**Síntoma:** errores 401/402.

**Acción:**
- Verificar `ANTHROPIC_API_KEY` en Catalyst Console → Functions → api → Environment Variables.
- Verificar saldo en https://console.anthropic.com/settings/billing.
- Si fue rotada en Anthropic, copiar la nueva al Catalyst Console y re-deploy.

### 2. Circuit breaker abierto

**Síntoma:** "Circuit breaker is OPEN" en logs y el ping.

Cómo funciona: después de 5 fallas consecutivas a Anthropic, el breaker se abre y rechaza
todos los requests por 60s (cooldown). En `half_open` deja pasar 1 request — si funciona,
cierra; si falla, vuelve a abrir.

**Acción:**
- Esperar 60-120s y re-pingear. Si se cierra solo, todo bien.
- Si sigue abierto > 5 min, hay problema upstream. Revisar https://status.anthropic.com.

### 3. Rate limit de Anthropic (429)

**Síntoma:** error 429 con `retry-after` header.

**Acción:**
- Esperar el tiempo indicado en `retry-after` (típicamente 30-60s).
- Si pasa frecuentemente, nuestro `BOT_MODE='hot'` puede estar quemando demasiadas calls.
  Pasar a `warm` temporalmente.

### 4. Timeout (request tarda > 25s)

**Síntoma:** logs muestran `[ANTHROPIC] timeout` y el cliente ve error genérico.

**Acción:**
- Verificar el modelo en `ANTHROPIC_MODEL` env var. Haiku 4.5 es rápido (~2-5s); si
  cambiaste a Opus por error, cambiar de vuelta.
- Si el prompt es muy largo (>8K tokens input), el modelo puede tardar más. Revisar
  `lib/anthropic.ts` para ver tamaño promedio.

## Mitigación temporal mientras se resuelve

- **Para drafts:** Cris puede armar el job manualmente desde JobForm sin llamar IA
  (`/api/drafts/generate` falla → ella escribe los campos directo).
- **Para bot decisor:** modo `cold` solo recomienda — los items van a `ReviewQueue` y Cris
  decide manualmente. Pasar a cold via env var `BOT_MODE=cold` + redeploy.
- **Para reportes (publicReportBundle con narrativas):** el `ClientReports` cache persiste
  reportes generados antes — re-aperturas funcionan. Reportes nuevos quedan con
  `narratives.status='failed'` pero el frontend muestra los scores reales y un banner
  amarillo explicando.

## Recuperación

Una vez resuelto Anthropic:
1. `curl /admin/anthropic-ping` → debe ser `ok: true`.
2. Re-disparar manualmente las features que fallaron (regenerate draft, generate video
   questions, etc.).
3. Si el circuit breaker estaba persistente, considerar `POST /admin/circuit-breaker/reset`
   (si existe) o reiniciar la function (re-deploy).

## Métrica de éxito

- `/admin/anthropic-ping` consistente con `latency_ms < 3000`.
- Logs `[ANTHROPIC]` sin warnings/errors en últimas 100 requests.
- `breaker_state: closed` en `/health`.

## Si nada de esto funciona

Mandar email a `support@anthropic.com` con tu organization ID de Anthropic y trace_id de
una request fallida (lo ves en `/health` → `traceId` o en cualquier respuesta de error).
