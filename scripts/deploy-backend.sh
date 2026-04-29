#!/bin/bash
# Deploy del backend a Catalyst.
# Uso: scripts/deploy-backend.sh [dev|prod]

set -e
ENV=${1:-dev}
cd "$(dirname "$0")/.."

echo "▶ Building TypeScript..."
cd functions/api && npm run build && cd ../..

echo "▶ Deploying to Catalyst ($ENV)..."
if [ "$ENV" = "prod" ]; then
  catalyst deploy --only functions:api --env production
else
  catalyst deploy --only functions:api
fi

echo "✓ Deploy completo"
