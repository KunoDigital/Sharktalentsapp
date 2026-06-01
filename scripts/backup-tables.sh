#!/bin/bash
# Dump de todas las tablas de Catalyst Datastore a JSON.
#
# Uso:
#   ./scripts/backup-tables.sh
#   ./scripts/backup-tables.sh /path/to/backups/
#
# Requiere:
#   - catalyst CLI logueado (`catalyst whoami`)
#   - Proyecto activo (`catalyst project:use <name>`)
#
# Output:
#   /backups/2026-05-01_18-30-00/
#     ├── Tenants.csv
#     ├── Jobs.csv
#     ├── ... (10 archivos, uno por tabla)
#
# Catalyst SOLO permite export como CSV. Para JSON, conversión post-export en script aparte.
#
# Recomendación: correr este script desde un cron de tu compu (todas las noches, ej: cron @daily).

set -e

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
TARGET="${OUTPUT_DIR}/${TIMESTAMP}"

mkdir -p "$TARGET"

TABLES=(
  "Tenants"
  "ProcessedEvents"
  "Jobs"
  "Candidates"
  "Results"
  "PipelineTransitions"
  "Scores"
  "IntegrityDimensions"
  "AuditLog"
  "OutboxEvents"
)

echo "▶ Backup target: $TARGET"
echo "▶ Tablas: ${#TABLES[@]}"
echo ""

FAILED=()

for TABLE in "${TABLES[@]}"; do
  echo "  [$TABLE] exportando..."
  if catalyst ds:export "$TABLE" --target "${TARGET}/${TABLE}.csv" 2>&1 | grep -q "Successfully\|✔"; then
    SIZE=$(stat -f%z "${TARGET}/${TABLE}.csv" 2>/dev/null || stat -c%s "${TARGET}/${TABLE}.csv" 2>/dev/null || echo "?")
    echo "    ✓ ${SIZE} bytes"
  else
    echo "    ✕ FALLÓ"
    FAILED+=("$TABLE")
  fi
done

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✓ Backup completo en $TARGET"
  echo ""
  echo "Total:"
  du -sh "$TARGET"
else
  echo "⚠️  Tablas que fallaron: ${FAILED[*]}"
  exit 1
fi
