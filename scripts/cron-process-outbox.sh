#!/bin/bash
# Cron job: procesa la cola del outbox (eventos pending → consumers).
#
# Schedule recomendado: cada 5 minutos.
#
# Setup en Catalyst Cron Service:
#   1. Catalyst Console → Cloud Scale → Cron → Create Cron
#   2. Job ID: process_outbox
#   3. Cron URL: https://...catalystserverless.com/server/api/admin/outbox/process
#   4. Method: POST
#   5. Body: {"batch_size": 50}
#   6. Headers: X-Internal-Key: <tu INTERNAL_API_KEY>, Content-Type: application/json
#   7. Schedule: */5 * * * *  (cada 5 min)
#
# Setup externo:
#   Setear CATALYST_API_URL e INTERNAL_API_KEY, después:
#     scripts/cron-process-outbox.sh

set -e

if [ -z "$CATALYST_API_URL" ] || [ -z "$INTERNAL_API_KEY" ]; then
  echo "✕ Faltan CATALYST_API_URL o INTERNAL_API_KEY"
  exit 1
fi

BATCH_SIZE="${OUTBOX_BATCH_SIZE:-50}"

echo "▶ Processing outbox (batch=$BATCH_SIZE)..."
RESPONSE=$(curl -s -X POST \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"batch_size\": ${BATCH_SIZE}}" \
  "${CATALYST_API_URL}/admin/outbox/process")

if command -v jq >/dev/null 2>&1; then
  echo "$RESPONSE" | jq .
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // 0')
  echo "✓ Processed $PROCESSED events"
else
  echo "$RESPONSE"
fi
