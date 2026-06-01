#!/bin/bash
# Verifica que la columna `ideal_profile` (Text 8000) exista en la tabla Jobs.
#
# Esta columna se agrega manualmente en Catalyst Console:
#   Catalyst Console → Cloud Scale → Data Store → Jobs → Add Column
#   Name: ideal_profile · Type: Text · Length: 8000 · Mandatory: No · Unique: No
#
# Uso:
#   scripts/check-ideal-profile-column.sh
#
# Requiere CATALYST_API_URL e INTERNAL_API_KEY en el shell.

set -e

if [ -z "$CATALYST_API_URL" ]; then
  echo "✕ Falta CATALYST_API_URL"
  echo "  Sacalo de Catalyst Console → Functions → api → URL del endpoint"
  exit 1
fi

if [ -z "$INTERNAL_API_KEY" ]; then
  echo "✕ Falta INTERNAL_API_KEY"
  exit 1
fi

echo "▶ Llamando ${CATALYST_API_URL}/admin/verify-tables..."
RESPONSE=$(curl -s -H "X-Internal-Key: ${INTERNAL_API_KEY}" "${CATALYST_API_URL}/admin/verify-tables")

if [ -z "$RESPONSE" ]; then
  echo "✕ Sin respuesta. ¿El backend está deployado?"
  exit 1
fi

# Buscar el reporte de Jobs y chequear ideal_profile en missing_columns
if command -v jq >/dev/null 2>&1; then
  JOBS_REPORT=$(echo "$RESPONSE" | jq -c '.tables[] | select(.name == "Jobs")')
  if [ -z "$JOBS_REPORT" ] || [ "$JOBS_REPORT" = "null" ]; then
    echo "✕ La tabla Jobs no aparece en el reporte. ¿Existe?"
    exit 1
  fi

  HAS_IDEAL_MISSING=$(echo "$JOBS_REPORT" | jq -r '.missing_columns[] | select(. == "ideal_profile")' || true)

  if [ "$HAS_IDEAL_MISSING" = "ideal_profile" ]; then
    echo "✕ La columna 'ideal_profile' NO existe en la tabla Jobs."
    echo ""
    echo "  Para agregarla:"
    echo "  1. Catalyst Console → Cloud Scale → Data Store → Jobs"
    echo "  2. Click 'Add Column' (botón arriba a la derecha)"
    echo "  3. Name: ideal_profile"
    echo "     Type: Text"
    echo "     Length: 8000"
    echo "     Mandatory: No"
    echo "     Unique: No"
    echo "  4. Save"
    echo ""
    echo "  El backend YA tolera que la columna no exista (los CREATE/UPDATE de jobs"
    echo "  funcionan sin el campo). Pero los reportes salen sin afinidad ideal y las"
    echo "  narrativas IA no tienen contexto del puesto. Recomendado crear cuando"
    echo "  vayas a usar la feature."
    exit 1
  fi

  echo "✓ La columna 'ideal_profile' existe en Jobs."
  echo ""
  echo "  Próximos pasos:"
  echo "  - Editar un puesto desde Jobs/<id>/edit y completar el perfil ideal."
  echo "  - O via curl PATCH /api/jobs/<id> con \"ideal_profile\": {...}"
  exit 0
else
  # Sin jq: grep ingenuo
  if echo "$RESPONSE" | grep -q '"missing_columns"\s*:\s*\[[^]]*"ideal_profile"'; then
    echo "✕ La columna 'ideal_profile' NO existe en la tabla Jobs. Ver instrucciones del README."
    exit 1
  fi
  echo "✓ La columna 'ideal_profile' parece existir (instalá jq para reporte preciso)."
  exit 0
fi
