# Runbook — Configurar crons en Catalyst

## Cuándo

- Después de deploy del backend, hay 2 jobs que deberían correr periódicamente:
  - **`process_outbox`** — cada 5 min, procesa eventos pending del outbox (sync con Recruit, etc.)
  - **`purge_old_videos`** — diario, borra archivos físicos de video de candidatos cerrados >30d (Ley PA / GDPR)

Sin estos crons, los eventos se acumulan en `pending` y los videos no se purgan automáticamente.

## Setup en Catalyst Cron Service

1. **Catalyst Console** → Cloud Scale → Cron → "Create Cron"

### Cron 1: process_outbox

```
Job ID: process_outbox
Schedule: */5 * * * *      (cada 5 minutos)
URL: https://<tu-catalyst-domain>/server/api/admin/outbox/process
Method: POST
Headers:
  - X-Internal-Key: <tu INTERNAL_API_KEY>
  - Content-Type: application/json
Body: {"batch_size": 50}
Timeout: 60 seconds
Retry on failure: yes (max 3)
```

### Cron 2: purge_old_videos

```
Job ID: purge_old_videos
Schedule: 0 3 * * *        (3:00 UTC diario)
URL: https://<tu-catalyst-domain>/server/api/admin/gdpr/purge-old-videos
Method: POST
Headers:
  - X-Internal-Key: <tu INTERNAL_API_KEY>
Body: (vacío)
Timeout: 300 seconds (5 min)
Retry on failure: no (mejor reintentar mañana que duplicar)
```

## Alternativa — cron externo

Si Catalyst Cron Service no está disponible o preferís control directo, podés correr los
scripts desde cualquier servidor con cron (linux/macOS) o desde GitHub Actions:

### Linux cron

```bash
# Editar crontab
crontab -e

# Agregar:
*/5 * * * * CATALYST_API_URL=https://... INTERNAL_API_KEY=... /path/to/sharktalentsapp/scripts/cron-process-outbox.sh >> /var/log/sharktalents-cron.log 2>&1
0 3 * * * CATALYST_API_URL=https://... INTERNAL_API_KEY=... /path/to/sharktalentsapp/scripts/cron-purge-videos.sh >> /var/log/sharktalents-cron.log 2>&1
```

### GitHub Actions

`.github/workflows/cron.yml`:

```yaml
name: SharkTalents Crons

on:
  schedule:
    - cron: '*/5 * * * *'   # process_outbox cada 5 min
    - cron: '0 3 * * *'     # purge_old_videos diario a 3am UTC

jobs:
  process_outbox:
    if: github.event.schedule == '*/5 * * * *'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: scripts/cron-process-outbox.sh
        env:
          CATALYST_API_URL: ${{ secrets.CATALYST_API_URL }}
          INTERNAL_API_KEY: ${{ secrets.INTERNAL_API_KEY }}

  purge_old_videos:
    if: github.event.schedule == '0 3 * * *'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: scripts/cron-purge-videos.sh
        env:
          CATALYST_API_URL: ${{ secrets.CATALYST_API_URL }}
          INTERNAL_API_KEY: ${{ secrets.INTERNAL_API_KEY }}
```

## Verificar funcionamiento

### Después de configurar `process_outbox`:

```bash
# Hacer una transición manual desde admin para enqueue un evento
# Después esperar 5 min y verificar:
curl -H "X-Internal-Key: $INTERNAL_API_KEY" "$URL/admin/outbox?status=pending&limit=10" | jq '.count'
# Debería ser 0 (o muy bajo) si el cron está corriendo.

# También chequear status processed:
curl -H "X-Internal-Key: $INTERNAL_API_KEY" "$URL/admin/outbox?status=processed&limit=10" | jq .
```

### Después de configurar `purge_old_videos`:

```bash
# Triggear manualmente para verificar que el endpoint funciona:
curl -X POST -H "X-Internal-Key: $INTERNAL_API_KEY" "$URL/admin/gdpr/purge-old-videos" | jq .

# Output esperado:
# { "ok": true, "cutoff": "...", "eligible": 0, "purged": 0, ... }
# (0 si no hay candidatos con cierre >30d todavía — normal en build mode)
```

## Troubleshooting

**Cron no se ejecuta en Catalyst:**
- Verificar que el INTERNAL_API_KEY en headers es el actual.
- Verificar Schedule: usar formato cron clásico (5 fields).
- Logs del Cron en Catalyst Console.

**Outbox queda pending:**
- Posible: el consumer (`sync.recruit`) está fallando. Revisar logs `[OUTBOX]`.
- Verificar `last_error` de los rows con status='failed' o `retry_count` alto.

**purge no borra nada:**
- Normal si no hay candidatos cerrados >30d (en build mode siempre será 0).
- En prod, si hay candidatos elegibles pero no se borran: revisar Catalyst File Store
  permissions del SDK en la function.
