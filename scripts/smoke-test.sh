#!/bin/bash
# Smoke test post-deploy.
#
# Pega a los endpoints públicos + admin (con INTERNAL_API_KEY) y valida que cada uno
# responda con un status code esperado. NO testea lógica de negocio — solo "está vivo".
#
# Uso:
#   CATALYST_API_URL=https://...catalystserverless.com/server/api \
#   INTERNAL_API_KEY=... \
#   ./scripts/smoke-test.sh
#
# Exit codes:
#   0 = todo verde
#   1 = al menos 1 endpoint falló
#
# Útil para:
#   - Manual post-deploy ("¿se rompió algo?")
#   - GitHub Actions workflow (ya integrado en deploy.yml para /health + openapi)
#   - Cron de uptime monitoring (cada 5 min)
#
# NO requiere Clerk session — solo prueba endpoints públicos + admin con internal key.
# Endpoints que requieren auth de tenant (Clerk) se reportan como SKIP.

set -uo pipefail

if [ -z "${CATALYST_API_URL:-}" ]; then
  echo "✕ Falta CATALYST_API_URL" >&2
  exit 1
fi

# INTERNAL_API_KEY es opcional — si no está, los admin endpoints se skipean

BASE="${CATALYST_API_URL%/}"
INTERNAL_KEY="${INTERNAL_API_KEY:-}"
TIMEOUT=10

PASS=0
FAIL=0
SKIP=0
FAILED_LIST=()

# Color helpers (off if no TTY)
if [ -t 1 ]; then
  G="\033[32m"; R="\033[31m"; Y="\033[33m"; D="\033[2m"; N="\033[0m"
else
  G=""; R=""; Y=""; D=""; N=""
fi

check() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local extra_headers="${5:-}"
  local body_check="${6:-}"  # opcional: regex que debe matchear en el body

  local url="${BASE}${path}"
  local args=(-s -o /tmp/_st_body -w "%{http_code}" --max-time "$TIMEOUT" -X "$method")
  if [ -n "$extra_headers" ]; then
    # Multi-header support: "H1: V1\nH2: V2"
    while IFS= read -r line; do
      [ -n "$line" ] && args+=(-H "$line")
    done <<< "$(printf '%b' "$extra_headers")"
  fi
  args+=("$url")

  local code
  code=$(curl "${args[@]}" 2>/dev/null || echo "000")

  if [ "$code" = "$expected" ]; then
    if [ -n "$body_check" ]; then
      if grep -qE "$body_check" /tmp/_st_body 2>/dev/null; then
        printf "  ${G}✓${N} %-40s %s %s ${D}(body match)${N}\n" "$name" "$method" "$path"
        PASS=$((PASS + 1))
      else
        printf "  ${R}✕${N} %-40s %s %s ${R}body mismatch${N}\n" "$name" "$method" "$path"
        FAIL=$((FAIL + 1))
        FAILED_LIST+=("$name (body mismatch)")
      fi
    else
      printf "  ${G}✓${N} %-40s %s %s ${D}(${code})${N}\n" "$name" "$method" "$path"
      PASS=$((PASS + 1))
    fi
  else
    printf "  ${R}✕${N} %-40s %s %s ${R}got ${code}, expected ${expected}${N}\n" "$name" "$method" "$path"
    FAIL=$((FAIL + 1))
    FAILED_LIST+=("$name (got $code, expected $expected)")
  fi
}

skip() {
  local name="$1"
  local reason="$2"
  printf "  ${Y}⊘${N} %-40s ${Y}skipped${N} ${D}(${reason})${N}\n" "$name"
  SKIP=$((SKIP + 1))
}

echo ""
echo "▶ Smoke test SharkTalents"
echo "  URL: $BASE"
echo "  Internal key: $([ -n "$INTERNAL_KEY" ] && echo 'configured' || echo 'NOT SET — admin endpoints skipped')"
echo ""

# ============== PÚBLICOS (no auth) ==============
echo "▶ Endpoints públicos:"
check "/health"               GET  "/health"               200 "" '"status"'
check "/api/openapi.json"     GET  "/api/openapi.json"     200 "" '"openapi"'
check "/docs"                 GET  "/docs"                 200

# Apply / test endpoints — sin token válido devuelven 4xx
check "test sin token"        GET  "/test/invalid"         404
check "report sin token"      GET  "/report/invalid"       404
check "portal sin token"      GET  "/portal/invalid"       404

# Tests nuevos del candidato (mindset + english) — sin token válido = 401
check "mindset submit sin token"  POST "/test/invalid/mindset/submit"  401
check "english submit sin token"  POST "/test/invalid/english/submit"  401

# Webhooks sin signature → 401/503
check "clerk webhook (no auth)"     POST "/api/webhooks/clerk"     401
check "heyreach webhook (no auth)"  POST "/api/webhooks/heyreach"  401
check "zia webhook (no auth)"       POST "/api/webhooks/zia"       401
check "zoho-sign webhook (no auth)" POST "/api/webhooks/zoho-sign" 401
check "zoho-recruit webhook"        POST "/api/webhooks/zoho-recruit" 401
check "whatsapp verify (sin token)" GET  "/api/webhooks/whatsapp"  503

# Marketing (público con site key — sin la key debe dar 400)
check "marketing/lead sin key"      POST "/api/marketing/lead"     400
check "marketing/lead-status sin email" GET "/api/marketing/lead-status" 200 "" '"exists":false'

# ============== TENANT (Clerk auth requerido) ==============
echo ""
echo "▶ Endpoints tenant (Clerk auth requerida):"
skip "GET /api/jobs"               "requiere Clerk session"
skip "GET /api/candidates"         "requiere Clerk session"
skip "GET /api/applications"       "requiere Clerk session"
skip "GET /api/notifications"      "requiere Clerk session"
skip "GET /api/integrations/status" "requiere Clerk session"

# Sin token → 401
check "/api/jobs sin auth"     GET  "/api/jobs"             401

# ============== ADMIN (INTERNAL_API_KEY) ==============
echo ""
echo "▶ Endpoints admin (X-Internal-Key):"

if [ -n "$INTERNAL_KEY" ]; then
  HDR="X-Internal-Key: $INTERNAL_KEY"
  check "/admin/verify-tables"   GET  "/admin/verify-tables"   200 "$HDR"
  check "/admin/stats"           GET  "/admin/stats"           200 "$HDR"
  check "/admin/health-check"    GET  "/admin/health-check"    200 "$HDR" '"status"'
  check "/admin/metrics"         GET  "/admin/metrics"         200 "$HDR" '"counters"'
  check "/admin/audit-log"       GET  "/admin/audit-log"       200 "$HDR"
  check "/admin/outbox"          GET  "/admin/outbox"          200 "$HDR"
  check "/admin/anti-cheat"      GET  "/admin/anti-cheat"      200 "$HDR"
  check "/admin/anthropic-ping"  GET  "/admin/anthropic-ping"  200 "$HDR"

  # Admin sin key → 401
  check "/admin/stats sin key"   GET  "/admin/stats"           401
else
  skip "/admin/verify-tables"    "INTERNAL_API_KEY no configurada"
  skip "/admin/stats"            "INTERNAL_API_KEY no configurada"
  skip "/admin/health-check"     "INTERNAL_API_KEY no configurada"
  skip "/admin/metrics"          "INTERNAL_API_KEY no configurada"
fi

# ============== Resumen ==============
echo ""
echo "─────────────────────────────────"
TOTAL=$((PASS + FAIL + SKIP))
printf "  Total:  %d\n" "$TOTAL"
printf "  ${G}✓ Pass:${N} %d\n" "$PASS"
printf "  ${R}✕ Fail:${N} %d\n" "$FAIL"
printf "  ${Y}⊘ Skip:${N} %d\n" "$SKIP"
echo "─────────────────────────────────"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "${R}Failed endpoints:${N}"
  for f in "${FAILED_LIST[@]}"; do
    echo "  • $f"
  done
  echo ""
  exit 1
fi

echo ""
echo "${G}✓ Smoke test passed${N}"
echo ""
exit 0
