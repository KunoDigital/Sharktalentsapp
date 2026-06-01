#!/bin/bash
# Verifica que las tablas Block 1 existan en Catalyst con sus columnas correctas.
#
# Uso:
#   scripts/verify-tables.sh
#
# Requiere:
#   - Backend deployado (./scripts/deploy-backend.sh dev)
#   - INTERNAL_API_KEY seteado en Catalyst Console como env var
#   - $CATALYST_API_URL en tu shell (ej: https://api-...catalystserverless.com)
#   - $INTERNAL_API_KEY en tu shell (mismo valor que en Catalyst)

set -e

if [ -z "$CATALYST_API_URL" ]; then
  echo "✕ Falta CATALYST_API_URL"
  echo "  Sacalo de Catalyst Console → Functions → api → URL del endpoint"
  echo "  Luego: export CATALYST_API_URL='https://...catalystserverless.com'"
  exit 1
fi

if [ -z "$INTERNAL_API_KEY" ]; then
  echo "✕ Falta INTERNAL_API_KEY"
  echo "  Es la misma key que seteaste en Catalyst Console → Functions → api → Environment Variables"
  echo "  Para generar: ./scripts/generate-secret.sh"
  exit 1
fi

echo "▶ Llamando GET ${CATALYST_API_URL}/admin/verify-tables..."
RESPONSE=$(curl -s -H "X-Internal-Key: ${INTERNAL_API_KEY}" "${CATALYST_API_URL}/admin/verify-tables")

if [ -z "$RESPONSE" ]; then
  echo "✕ Sin respuesta. ¿El backend está deployado?"
  exit 1
fi

# Pretty print con jq si está, plain si no
if command -v jq >/dev/null 2>&1; then
  echo "$RESPONSE" | jq .
  OK=$(echo "$RESPONSE" | jq -r '.ok')
else
  echo "$RESPONSE"
  OK=$(echo "$RESPONSE" | grep -o '"ok":[^,]*' | head -1 | cut -d: -f2 | tr -d ' "')
fi

echo ""
if [ "$OK" = "true" ]; then
  echo "✓ Todas las tablas OK"
  exit 0
else
  echo "✕ Hay tablas faltantes o con columnas incorrectas. Mirá el detalle arriba."
  exit 1
fi
