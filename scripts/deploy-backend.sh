#!/bin/bash
# Deploy del backend a Catalyst.
# Uso: scripts/deploy-backend.sh
#
# El environment activo (Development/Production) se controla desde la Catalyst Console
# en cada proyecto. Este script asume que ya seleccionaste el env correcto en .catalystrc
# o vía 'catalyst use:project'.

set -e
cd "$(dirname "$0")/.."

echo "▶ Building TypeScript..."
cd functions/api && npm run build && cd ../..

echo "▶ Deploying to Catalyst..."
catalyst deploy --only functions:api

echo "✓ Deploy completo"
