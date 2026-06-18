#!/bin/bash
# Deploy del backend a Catalyst (siempre a DEV).
# Uso: scripts/deploy-backend.sh
#
# IMPORTANTE: Catalyst CLI solo despliega a Development. Para promover a Production,
# pasos en Catalyst Console:
#   Settings → Environments → Deployments → "Create Deployment" → Source: Development, Target: Production
# Ver docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md para flujo completo.

set -e
cd "$(dirname "$0")/.."

echo "▶ Building TypeScript..."
cd functions/api && npm run build && cd ../..

echo "▶ Deploying to Catalyst Development..."
catalyst deploy --only functions:api

echo ""
echo "✓ Deploy completo en DEV"
echo ""
echo "  URL DEV: https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/"
echo ""
echo "Para promover a PROD (app.sharktalents.ai):"
echo "  Catalyst Console → Settings → Environments → Deployments → Create Deployment"
echo "  Source: Development → Target: Production → Generate Diff → Deploy"
