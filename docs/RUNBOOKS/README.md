# Runbooks

Procedimientos operativos para incidents, smoke tests y rotaciones. Cada runbook responde a la pregunta: "esto pasó, ¿qué hago?"

## Convención

Una doc por escenario. Archivo: `<escenario-slug>.md` en minúsculas.

## Runbooks planeados (master plan)

| Escenario | Estado | Archivo |
|---|---|---|
| Cron detenido | TBD | `cron-detenido.md` |
| Anthropic caído / circuit breaker abierto | TBD | `anthropic-caido.md` |
| Reporte público devuelve 404 | TBD | `reporte-publico-404.md` |
| Catalyst Datastore lento | TBD | `data-store-lento.md` |
| Smoke tests manuales | TBD | `smoke-tests.md` |
| Token Zoho refresh falló | TBD | `zoho-token-rotacion.md` |
| HeyReach baneó cuenta LinkedIn | TBD | `heyreach-cuenta-baneada.md` |
| Bot decisor genera demasiados auto-rejects | TBD | `bot-decisor-falsos-positivos.md` |
| Whisper fallback con costo alto | TBD | `whisper-costo-alto.md` |

## Template

```markdown
# <Escenario>

## Síntomas
- Qué se observa: ...
- Qué alertas dispara: ...

## Causa probable
<root cause más común>

## Verificación rápida
```bash
<comando 1>
<comando 2>
```

## Mitigación inmediata
1. ...
2. ...

## Fix permanente
1. ...

## Postmortem checklist
- [ ] Root cause identificado
- [ ] Fix mergeado
- [ ] ADR actualizado si la decisión cambia
- [ ] Runbook actualizado con lo aprendido

## Last updated
<fecha + autor>
```
