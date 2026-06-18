#!/bin/bash
# Build + deploy del frontend a Catalyst Web Client Hosting (siempre a DEV).
# 2026-06-18: deploy automático con `catalyst deploy --only client`.
#
# Uso: scripts/deploy-frontend.sh
#
# IMPORTANTE: este script despliega a DEV. Para promover a PROD (app.sharktalents.ai):
#   Catalyst Console → Settings → Environments → Deployments → Create Deployment
#   Source: Development → Target: Production → Generate Diff → Deploy
# Ver docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md

set -e
cd "$(dirname "$0")/../shark"

VERSION=$(node -p "require('./package.json').version")
echo "▶ Building shark/ version $VERSION..."

npm install
npm run build

# Catalyst busca client-package.json en el dist/ para identificar la app.
cp client-package.json dist/

# Mantenemos el ZIP también — útil como artifact / backup.
cd dist
ZIP="../sharktalents-frontend-${VERSION}.zip"
rm -f "$ZIP"
zip -rq "$ZIP" .
cd ..

echo "✓ ZIP listo: shark/sharktalents-frontend-${VERSION}.zip"
echo ""
echo "▶ Deploying client to Catalyst..."
cd ..  # raíz del proyecto (donde está catalyst.json)
catalyst deploy --only client

# Cleanup
rm -f shark/dist/client-package.json
echo ""
echo "✓ Deploy completo — el cliente ya está en producción"
