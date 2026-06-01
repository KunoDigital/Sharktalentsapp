#!/bin/bash
# Pre-deploy validation — chequea que TODO esté listo antes de deployar.
# Detecta los bugs típicos: env vars con placeholders, archivos faltantes, etc.
#
# Uso:
#   ./scripts/validate-deploy.sh
#
# Exit codes:
#   0 = todo OK, podés deployar
#   1 = al menos 1 problema encontrado, no deployar todavía
#
# Pensado para correr ANTES de:
#   ./scripts/deploy-backend.sh
#   ./scripts/deploy-frontend.sh
#
# Encuentra:
#   - Placeholders en .env.production del frontend (pk_live_replace, etc.)
#   - Variables críticas faltantes en .env.production
#   - Build artifacts viejos
#   - TypeScript errors no commiteados
#   - Tests rotos

set -uo pipefail

cd "$(dirname "$0")/.."

ROOT=$(pwd)
PROBLEMS=0
WARNINGS=0

# Color helpers (off if no TTY)
if [ -t 1 ]; then
  G="\033[32m"; R="\033[31m"; Y="\033[33m"; B="\033[36m"; D="\033[2m"; N="\033[0m"
else
  G=""; R=""; Y=""; B=""; D=""; N=""
fi

err() {
  printf "  ${R}✕${N} %s\n" "$1"
  PROBLEMS=$((PROBLEMS + 1))
}

warn() {
  printf "  ${Y}⚠${N} %s\n" "$1"
  WARNINGS=$((WARNINGS + 1))
}

ok() {
  printf "  ${G}✓${N} %s\n" "$1"
}

section() {
  printf "\n${B}▶ %s${N}\n" "$1"
}

# ============== Validación 1: archivos requeridos ==============
section "Archivos requeridos"

if [ -f "$ROOT/shark/.env.production" ]; then
  ok "shark/.env.production existe"
else
  err "shark/.env.production NO existe — creá uno desde .env.example"
fi

if [ -f "$ROOT/shark/client-package.json" ]; then
  ok "shark/client-package.json existe (requerido por Catalyst Web Hosting)"
else
  err "shark/client-package.json NO existe — Catalyst Web Hosting lo requiere en el ZIP"
fi

if [ -f "$ROOT/functions/api/index.js" ]; then
  ok "functions/api/index.js existe (entry point compilado)"
else
  warn "functions/api/index.js no existe — corré 'npm run build' en functions/api/"
fi

# ============== Validación 2: placeholders en .env.production ==============
section "Frontend env vars (shark/.env.production)"

if [ -f "$ROOT/shark/.env.production" ]; then
  ENV_FILE="$ROOT/shark/.env.production"

  # Variables obligatorias
  REQUIRED_VARS=(
    "VITE_API_BASE"
    "VITE_CLERK_PUBLISHABLE_KEY"
    "VITE_APP_BASE_URL"
  )

  for var in "${REQUIRED_VARS[@]}"; do
    line=$(grep "^${var}=" "$ENV_FILE" || echo "")
    value="${line#*=}"
    if [ -z "$value" ]; then
      err "$var: faltante o vacío"
    elif [[ "$value" == *"replace"* ]] || [[ "$value" == *"REPLACE"* ]] || [[ "$value" == *"xxxxx"* ]] || [[ "$value" == *"YOUR_"* ]] || [[ "$value" == *"localhost"* ]]; then
      err "$var: tiene placeholder ($value) — pegá el valor real antes de buildear"
    else
      ok "$var: configurado"
    fi
  done

  # Validación específica: VITE_CLERK_PUBLISHABLE_KEY debe empezar con pk_
  CLERK_KEY=$(grep "^VITE_CLERK_PUBLISHABLE_KEY=" "$ENV_FILE" | cut -d'=' -f2-)
  if [ -n "$CLERK_KEY" ]; then
    if [[ "$CLERK_KEY" == sk_* ]]; then
      err "VITE_CLERK_PUBLISHABLE_KEY: tenés una SECRET key (sk_*) en el frontend — riesgo de seguridad. Cambiala por la PUBLISHABLE (pk_*)"
    elif [[ "$CLERK_KEY" != pk_* ]]; then
      warn "VITE_CLERK_PUBLISHABLE_KEY: no empieza con 'pk_' — verificá que sea publishable key real"
    fi
  fi

  # VITE_API_BASE debe ser HTTPS en producción y no localhost
  API_BASE=$(grep "^VITE_API_BASE=" "$ENV_FILE" | cut -d'=' -f2-)
  if [ -n "$API_BASE" ]; then
    if [[ "$API_BASE" == http://* ]]; then
      warn "VITE_API_BASE: usa HTTP (no HTTPS) — solo OK si es testing local"
    fi
  fi
fi

# ============== Validación 3: build artifacts ==============
section "Build artifacts"

# Backend
if [ -f "$ROOT/functions/api/index.js" ]; then
  TS_TIME=$(stat -f "%m" "$ROOT/functions/api/src/index.ts" 2>/dev/null || echo "0")
  JS_TIME=$(stat -f "%m" "$ROOT/functions/api/index.js" 2>/dev/null || echo "0")
  if [ "$TS_TIME" -gt "$JS_TIME" ]; then
    warn "Backend: src/index.ts es más nuevo que index.js — corré 'cd functions/api && npm run build'"
  else
    ok "Backend: build artifacts actualizados"
  fi
fi

# Frontend dist
if [ -d "$ROOT/shark/dist" ]; then
  DIST_TIME=$(stat -f "%m" "$ROOT/shark/dist" 2>/dev/null || echo "0")
  ENV_TIME=$(stat -f "%m" "$ROOT/shark/.env.production" 2>/dev/null || echo "0")
  if [ "$ENV_TIME" -gt "$DIST_TIME" ]; then
    warn "Frontend: .env.production es más nuevo que dist/ — re-buildeá antes de deployar"
  else
    ok "Frontend: dist/ existe y está actualizado vs env.production"
  fi
else
  warn "Frontend: shark/dist/ no existe — corré 'cd shark && npm run build'"
fi

# ============== Validación 4: tests ==============
section "Tests"

if command -v npx >/dev/null 2>&1; then
  echo "  Backend tests..."
  cd "$ROOT/functions/api"
  if npx vitest run >/tmp/_validate_backend_tests 2>&1; then
    PASS_LINE=$(grep -E "Tests +[0-9]+ passed" /tmp/_validate_backend_tests | head -1 || echo "")
    ok "Backend: $PASS_LINE"
  else
    err "Backend: tests fallan — revisá /tmp/_validate_backend_tests"
  fi

  echo "  Frontend tests..."
  cd "$ROOT/shark"
  if npx vitest run >/tmp/_validate_frontend_tests 2>&1; then
    PASS_LINE=$(grep -E "Tests +[0-9]+ passed" /tmp/_validate_frontend_tests | head -1 || echo "")
    ok "Frontend: $PASS_LINE"
  else
    err "Frontend: tests fallan — revisá /tmp/_validate_frontend_tests"
  fi
  cd "$ROOT"
fi

# ============== Validación 5: TypeScript ==============
section "TypeScript checks"

cd "$ROOT/functions/api"
if npx tsc --noEmit >/tmp/_validate_backend_ts 2>&1; then
  ok "Backend: type check OK"
else
  err "Backend: type errors — revisá /tmp/_validate_backend_ts"
fi

cd "$ROOT/shark"
if npx tsc --noEmit >/tmp/_validate_frontend_ts 2>&1; then
  ok "Frontend: type check OK"
else
  err "Frontend: type errors — revisá /tmp/_validate_frontend_ts"
fi
cd "$ROOT"

# ============== Resumen ==============
echo ""
echo "─────────────────────────────────"
if [ $PROBLEMS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  printf "  ${G}✓ Todo en orden — listo para deployar${N}\n"
elif [ $PROBLEMS -eq 0 ]; then
  printf "  ${Y}⚠ %d warning(s) — podés deployar pero revisá${N}\n" "$WARNINGS"
else
  printf "  ${R}✕ %d problema(s) — NO deployar hasta arreglar${N}\n" "$PROBLEMS"
  [ $WARNINGS -gt 0 ] && printf "  ${Y}⚠ %d warning(s)${N}\n" "$WARNINGS"
fi
echo "─────────────────────────────────"

[ $PROBLEMS -gt 0 ] && exit 1
exit 0
