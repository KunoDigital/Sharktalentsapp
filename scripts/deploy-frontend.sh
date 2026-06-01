#!/bin/bash
# Build + zip del frontend para upload a Catalyst Web Client Hosting.
# Uso: scripts/deploy-frontend.sh
#
# El ZIP que genera tiene en su raíz:
#   client-package.json   (config requerida por Catalyst)
#   index.html            (entry del SPA)
#   assets/               (JS + CSS bundles)
#   ... resto del build de Vite

set -e
cd "$(dirname "$0")/../shark"

VERSION=$(node -p "require('./package.json').version")
echo "▶ Building shark/ version $VERSION..."

npm install
npm run build

# Copiamos client-package.json al dist/ antes de zip-ear
# Catalyst busca este archivo en la raíz del ZIP para identificar la app
cp client-package.json dist/

cd dist
ZIP="../sharktalents-frontend-${VERSION}.zip"
rm -f "$ZIP"
zip -rq "$ZIP" .
cd ..

# Limpiamos el copy del dist (no queremos que queda dentro de dist/ entre builds)
rm -f dist/client-package.json

echo "✓ ZIP listo: shark/sharktalents-frontend-${VERSION}.zip"
echo ""
echo "Siguiente paso:"
echo "  Catalyst Console → Cloud Scale → Web Client Hosting → Upload del zip"
