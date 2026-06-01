#!/bin/bash
# Lee un CSV de migraciones y lo imprime como checklist amigable para Catalyst Console.
#
# Uso:
#   ./scripts/print-migrations-checklist.sh <ruta-al-csv>
#
# Ejemplos:
#   ./scripts/print-migrations-checklist.sh docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv
#   ./scripts/print-migrations-checklist.sh docs/master-plan/MIGRATIONS_AGREGAR_COLUMNAS.csv
#
# Catalyst Console no soporta DDL SQL directo, así que cada columna se crea manualmente
# vía Console (Table → New Column). Este script genera un checklist por tabla con todos
# los settings necesarios — copiás cada bloque y vas creando una a una.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <ruta-al-csv>"
  echo ""
  echo "CSVs disponibles:"
  find docs/master-plan -name 'MIGRATIONS_*.csv' -type f 2>/dev/null | sed 's/^/  /'
  exit 1
fi

CSV_FILE="$1"

if [ ! -f "$CSV_FILE" ]; then
  echo "✕ Archivo no existe: $CSV_FILE" >&2
  exit 1
fi

echo "📋 Migraciones de: $CSV_FILE"
echo "==========================================="
echo ""

# Detectar formato (con o sin columna Notas)
HEADER=$(head -1 "$CSV_FILE")
HAS_NOTES=false
if echo "$HEADER" | grep -q "Notas"; then
  HAS_NOTES=true
fi

# Parsear cada línea (saltar header)
CURRENT_TABLE=""
tail -n +2 "$CSV_FILE" | while IFS=, read -r tabla columna tipo largo obligatorio unico defaultv notas; do
  # Skip empty lines
  [ -z "$tabla" ] && continue

  if [ "$tabla" != "$CURRENT_TABLE" ]; then
    if [ -n "$CURRENT_TABLE" ]; then
      echo ""
    fi
    echo "🗂️  Tabla: $tabla"
    echo "─────────────────────────────"
    CURRENT_TABLE="$tabla"
  fi

  # Construir descripción de la columna
  details="$tipo"
  if [ -n "$largo" ]; then
    details="$details (max $largo)"
  fi
  if [ "$obligatorio" = "Sí" ]; then
    details="$details, mandatory"
  fi
  if [ "$unico" = "Sí" ]; then
    details="$details, unique"
  fi
  if [ -n "$defaultv" ]; then
    details="$details, default=$defaultv"
  fi

  echo "  ☐ $columna — $details"
  if [ "$HAS_NOTES" = true ] && [ -n "$notas" ]; then
    echo "    💡 $notas"
  fi
done

echo ""
echo "==========================================="
echo "Para cada tabla:"
echo "  1. Catalyst Console → Catalyst Datastore → Create Table"
echo "  2. Crear cada columna marcada arriba con sus settings"
echo "  3. Cuando termines, marcar el checkbox como hecho"
echo ""
echo "Después de crear las tablas, verificá con:"
echo "  curl -H \"X-Internal-Key: \$INTERNAL_API_KEY\" \\"
echo "    \"\$CATALYST_API_URL/admin/verify-tables\" | python3 -m json.tool"
