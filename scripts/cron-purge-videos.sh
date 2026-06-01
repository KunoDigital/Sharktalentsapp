#!/bin/bash
# Cron job: purga archivos físicos de video de candidatos cerrados (>30d post-cierre).
#
# Schedule recomendado: diario a las 03:00 UTC.
#
# Setup en Catalyst Cron Service:
#   1. Catalyst Console → Cloud Scale → Cron → Create Cron
#   2. Job ID: purge_old_videos
#   3. Cron URL: https://...catalystserverless.com/server/api/admin/gdpr/purge-old-videos
#   4. Method: POST
#   5. Headers: X-Internal-Key: <tu INTERNAL_API_KEY>
#   6. Schedule: 0 3 * * *  (3am UTC daily)
#
# Setup externo (linux cron / GitHub Actions / etc.):
#   Setear env vars CATALYST_API_URL e INTERNAL_API_KEY, después:
#     scripts/cron-purge-videos.sh

set -e

if [ -z "$CATALYST_API_URL" ] || [ -z "$INTERNAL_API_KEY" ]; then
  echo "✕ Faltan CATALYST_API_URL o INTERNAL_API_KEY"
  exit 1
fi

echo "▶ Triggering purge-old-videos..."
RESPONSE=$(curl -s -X POST \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  "${CATALYST_API_URL}/admin/gdpr/purge-old-videos")

if command -v jq >/dev/null 2>&1; then
  echo "$RESPONSE" | jq .
  PURGED=$(echo "$RESPONSE" | jq -r '.purged // 0')
  echo "✓ Purged $PURGED files"
else
  echo "$RESPONSE"
fi
