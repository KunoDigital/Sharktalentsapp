#!/bin/bash
# Guide interactivo para rotation de un secret en Catalyst.
# Uso: scripts/rotate-secret.sh INTERNAL_API_KEY

SECRET_NAME=$1
if [ -z "$SECRET_NAME" ]; then
  echo "Uso: $0 SECRET_NAME"
  exit 1
fi

NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "Plan de rotation para $SECRET_NAME"
echo "================================="
echo "Nuevo secret (guardalo seguro AHORA):"
echo "$NEW"
echo ""
echo "Pasos:"
echo "1. En Catalyst Console → Functions → api → Env Vars:"
echo "   - Agregar ${SECRET_NAME}_OLD = (valor actual de $SECRET_NAME)"
echo "   - Cambiar $SECRET_NAME = $NEW"
echo "2. Redeploy backend (scripts/deploy-backend.sh prod)"
echo "3. Código debe aceptar ambos valores temporalmente."
echo "4. Esperar 48h sin errores."
echo "5. Remover ${SECRET_NAME}_OLD + redeploy."
