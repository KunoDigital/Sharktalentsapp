#!/bin/bash
# Build + zip del frontend para upload a Client Hosting.
# Uso: scripts/deploy-frontend.sh

set -e
cd "$(dirname "$0")/../shark"

VERSION=$(node -p "require('./package.json').version")
echo "▶ Building shark/ version $VERSION..."

npm install
npm run build

cd dist
ZIP="../sharktalents-frontend-${VERSION}.zip"
rm -f "$ZIP"
zip -rq "$ZIP" .
cd ..

echo "✓ ZIP listo: shark/sharktalents-frontend-${VERSION}.zip"
echo ""
echo "Siguiente paso:"
echo "  1. catalyst deploy --only client    (o)"
echo "  2. Catalyst Console → Client Hosting → Upload del zip"
