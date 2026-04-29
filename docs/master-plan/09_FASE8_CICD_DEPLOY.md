# 09 — Fase 8: CI/CD y Deploy

**Objetivo:** establecer el workflow de git, scripts automatizados, orden de deploys seguro, plan de rollback, ambientes dev/prod separados.

**Tiempo estimado:** 1 semana.
**Dependencias:** todo el refactor anterior puede arrancar sin esta fase, pero antes del primer deploy productivo hay que cerrarla.
**Riesgo:** medio — si los scripts fallan, podés pisar prod con data de dev.

**Referencias teóricas:** [11_CICD_Y_DEPLOY.md](../aprendizajes/11_CICD_Y_DEPLOY.md).

---

## Deliverables

- [ ] Git workflow documentado (main, feature branches, tags)
- [ ] Scripts de deploy funcionales y probados
- [ ] Orden de deploy documentado (DB → backend → frontend)
- [ ] Plan de rollback escrito
- [ ] Environments dev/prod separados en Catalyst
- [ ] CHANGELOG.md mantenido
- [ ] Pre/post deploy checklist ejecutados al menos 1 vez manualmente

---

## 1. Git workflow

### Branches

```
main                          ← producción (protegida)
feature/<descripcion-corta>   ← features
fix/<descripcion>             ← bug fixes
refactor/<descripcion>        ← refactors sin cambio funcional
perf/<descripcion>            ← optimizaciones
docs/<descripcion>            ← solo docs
archive/pre-refactor-YYYYMMDD ← snapshots pre-cambios grandes
```

### Convención de commits

Imperativo + contexto. Una línea corta (50 chars) seguida de bullets opcionales si el cambio es complejo.

```
✓ Good:
Consolidar queries de getComparison: 1001 → 12

- Batch fetch de Results, Candidates, Scores
- Agregado Map<id, Score> en services/comparisonService.ts
- Reducción proyectada: 98.8% de DB fetches en este endpoint

✗ Bad:
"cambios", "wip", "fix", "update"
```

### Arrancar feature

```bash
git checkout main
git pull
git checkout -b feature/centralizar-api-base
# ... trabajo ...
git add .
git commit -m "Centralizar API_BASE en config.ts para todo el frontend"
git push -u origin feature/centralizar-api-base
```

### Antes de mergear a main

```bash
# Rebase sobre main para traer cambios
git checkout main
git pull
git checkout feature/centralizar-api-base
git rebase main

# Correr tests (smoke manual) + build
cd functions/api && npm run build
cd ../../frontend && npm run build

# Revisar diff completo
git diff main...feature/centralizar-api-base
```

### Merge

```bash
git checkout main
git merge --no-ff feature/centralizar-api-base
git push origin main
```

`--no-ff` fuerza un merge commit que agrupa los commits de la feature. Historial más legible.

### Tag de release

Solo para releases significativos (finaliza una fase del master plan, o después de un cambio user-visible):

```bash
git tag v1.1.0 -m "Fase 4 completa: backend modularizado, N+1 eliminado"
git push origin v1.1.0
```

Versionado semántico:
- MAJOR: breaking changes (cambios de schema que requieren migración, cambios en contratos API).
- MINOR: features retrocompatibles.
- PATCH: bug fixes.

---

## 2. Scripts de deploy

### `scripts/deploy-backend.sh`

```bash
#!/bin/bash
# Deploy backend a Catalyst.
# Uso: scripts/deploy-backend.sh [dev|prod]

set -e

ENV=${1:-dev}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Verificar que estamos en main para prod
if [ "$ENV" = "prod" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ]; then
    echo "✗ Error: debés estar en main para deploy a prod (actual: $BRANCH)"
    exit 1
  fi

  # Verificar que no hay cambios sin commitear
  if ! git diff-index --quiet HEAD --; then
    echo "✗ Error: hay cambios sin commitear"
    git status --short
    exit 1
  fi

  # Confirmación
  read -p "⚠ Deploy a PROD. Continuar? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Abortado."
    exit 0
  fi
fi

echo "▶ Building TypeScript..."
cd functions/api
npm install --silent
npm run build
cd "$ROOT"

echo "▶ Deploying functions to Catalyst ($ENV)..."
CLAUDE_BIN=~/.vscode/extensions/anthropic.claude-code-*-darwin-arm64/resources/native-binary/claude
# Usamos catalyst CLI si está en PATH; si no, buscamos el binario del extension
if command -v catalyst >/dev/null 2>&1; then
  if [ "$ENV" = "prod" ]; then
    catalyst deploy --only functions:api --env production
  else
    catalyst deploy --only functions:api
  fi
else
  echo "✗ catalyst CLI no encontrado. Instalar con: npm install -g zcatalyst-cli"
  exit 1
fi

echo "✓ Backend deployado a $ENV"

# Post-deploy smoke test
if [ "$ENV" = "prod" ]; then
  BASE_URL="${APP_BASE_URL:-https://sharktalents.ai}"
else
  BASE_URL="https://sharktalents-development.catalystserverless.com"
fi

echo "▶ Health check en $BASE_URL..."
STATUS=$(curl -s -o /tmp/health.json -w "%{http_code}" "$BASE_URL/server/api/api/health")
if [ "$STATUS" = "200" ]; then
  echo "✓ /health OK"
  cat /tmp/health.json | head -5
else
  echo "✗ /health falló (HTTP $STATUS)"
  cat /tmp/health.json
  exit 1
fi
```

### `scripts/deploy-frontend.sh`

```bash
#!/bin/bash
# Build + zip frontend para Client Hosting.
# Uso: scripts/deploy-frontend.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

VERSION=$(node -p "require('./package.json').version")
echo "▶ Building SharkTalents frontend v$VERSION..."

# Limpiar build anterior
rm -rf build/
rm -f sharktalents-frontend-*.zip

# Install + build
npm install --silent
npm run build

# Zip
cd build
ZIP_NAME="../sharktalents-frontend-${VERSION}.zip"
zip -rq "$ZIP_NAME" .
cd ..

SIZE=$(du -h "sharktalents-frontend-${VERSION}.zip" | cut -f1)
echo ""
echo "✓ ZIP listo: shark/sharktalents-frontend-${VERSION}.zip ($SIZE)"
echo ""
echo "Siguiente paso:"
echo "  1. Abrir Catalyst Console → Client Hosting"
echo "  2. Upload del zip"
echo "  3. Verificar en el ambiente correspondiente"
echo ""
```

### `scripts/generate-secret.sh`

```bash
#!/bin/bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `scripts/generate-password-hash.sh`

```bash
#!/bin/bash
if [ -z "$1" ]; then
  echo "Uso: $0 'password'"
  exit 1
fi

node <<EOF
const crypto = require('crypto');
const password = '$1';
const salt = crypto.randomBytes(16).toString('hex');
crypto.scrypt(password, salt, 64, (err, hash) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(salt + ':' + hash.toString('hex'));
});
EOF
```

### `scripts/migrate-schema.sh`

Wrapper para el script de migración de Fase 2 → ver [10_MIGRACION_DATOS.md](10_MIGRACION_DATOS.md).

### Permisos

```bash
chmod +x scripts/*.sh
```

Y agregar nota en README para que `scripts/` esté en el git check (`chmod +x` se preserva en git).

---

## 3. Orden de deploys

### Regla de oro

**DB changes → Backend → Frontend.**

### ¿Por qué?

- Backend nuevo no puede romper frontend actual (usuarios con tab abierta).
- Frontend nuevo no puede consultar endpoints que aún no existen.

### Casos concretos

**Release 1.1.0: Fase 2 (schema DB) — alto riesgo**

```
1. Crear nuevas tablas en DataStore (Catalyst Console)
2. Correr script de migración (paralelo: schema viejo sigue existiendo)
3. Deploy backend v1.1.0
   - Dual-read: lee del schema nuevo si existe, fallback al viejo
   - Dual-write: escribe en ambos
4. Verificar dual-write OK en dev por 24h
5. Deploy a prod con mismo dual-read/write
6. Después de 7 días sin issues → deploy v1.2.0
   - Solo-nuevo: ignora schema viejo
7. Después de 14 días → eliminar columnas viejas
```

**Release 1.3.0: Fase 6 (access token en reportes públicos) — riesgo medio**

```
1. Backend:
   - Campo access_token agregado a ClientReports (nulable)
   - Al crear reporte nuevo, se genera token
   - Endpoint /public/report acepta token=<x> O sin token (transición)
2. Frontend: al publicar, muestra URL con token
3. Backend v1.4.0 (2 semanas después): solo acepta URLs con token válido
4. Actualizar reportes viejos: script que genera token para los publicados sin token
```

**Release 1.4.0: bump menor de features sin breaking — bajo riesgo**

```
1. Backend (primero siempre, por si el frontend necesita endpoints)
2. Frontend
```

---

## 4. Plan de rollback

### Backend

Opción 1 — revert del commit + redeploy:
```bash
git revert <sha-del-deploy-roto>
git push origin main
./scripts/deploy-backend.sh prod
```

Opción 2 — checkout del tag anterior + redeploy:
```bash
git checkout v1.1.0
cd functions/api && npm install && npm run build
catalyst deploy --only functions:api --env production
git checkout main
```

### Frontend

Catalyst Client Hosting mantiene versiones anteriores. Desde Console:
1. Client Hosting → Deployment History
2. Click en versión anterior
3. "Restore"

O re-buildear desde tag:
```bash
git checkout v1.1.0
cd frontend && npm install && npm run build
cd build && zip -r ../sharktalents-frontend-1.1.0-rollback.zip . && cd ..
# Upload manual
```

### DB

Catalyst no tiene "undo" de cambios de schema. Hay que:
- Hacer backup de data antes de la migración (export CSV).
- Tener un script inverso que rehidrate schema viejo desde el nuevo.
- **Mejor: no hacer cambios irreversibles en un solo deploy.** Usar el patrón dual (leer/escribir en ambos durante N días) para minimizar necesidad de rollback.

### Documentación

Crear `docs/RUNBOOKS/rollback.md`:

```markdown
# Runbook — Rollback

## Cuándo rollback
- Errores HTTP 500 > 10% del tráfico
- Flow crítico roto (login, crear puesto, generar reporte)
- Security issue detectado post-deploy

## Quién decide
- Si impact > 50% users: cualquiera puede gatillar
- Si impact < 50% users: consultar al dueño del proyecto

## Pasos

### Backend
1. Identificar tag del último deploy OK: `git tag -l | tail -5`
2. Checkout + rebuild + redeploy (ver sección arriba)
3. Verificar health check

### Frontend
1. Catalyst Console → Client Hosting → Deployment History
2. Restore versión anterior

### Combinado (backend + frontend + schema)
1. Frontend primero (hacia atrás): restore versión vieja
2. Backend: rollback
3. Schema: solo si es reversible

## Post-rollback
- Comunicar al equipo
- Investigar root cause
- Hacer fix en feature branch (no rush a main)
```

---

## 5. Environments dev vs prod

### Catalyst soporta 2 environments

- `development`: sandbox — URL `xxxxx.development.catalystserverless.com`
- `production`: prod — URL custom (`sharktalents.ai` con DNS apuntando a Catalyst) o default

### Configurar

1. Catalyst Console → Environment → crear/seleccionar "production"
2. Cada env var se configura independiente por ambiente
3. `catalyst deploy --env production` para prod, sin flag para dev

### Env vars distintas por ambiente

| Env var | Dev | Prod |
|---|---|---|
| `APP_BASE_URL` | `https://dev-sharktalents.catalystserverless.com` | `https://sharktalents.ai` |
| `ANTHROPIC_API_KEY` | key de sandbox (si aplica) o mismo que prod | key principal |
| `ANTHROPIC_CACHING_ENABLED` | `false` (más fácil debuggear) | `true` |
| `LOG_LEVEL` | `debug` | `info` |

### Flow de promoción

1. Dev feature en branch
2. Deploy a dev environment
3. Smoke tests en dev
4. Merge a main
5. Deploy a prod (manual, con confirmación)

---

## 6. CHANGELOG.md

Crear `/CHANGELOG.md` y mantener:

```markdown
# Changelog

## [1.4.0] — 2026-06-15
### Added
- Access tokens en URLs públicas de reportes (Fase 3 del refactor)
- Versión visible en UI

### Changed
- Prompt caching habilitado en Anthropic (ahorro ~60% tokens)
- Polling frontend removido (no se usaba)

### Fixed
- N+1 query en /admin/candidates (1001 → 3 queries)

### Security
- Password hashing migrado de SHA256 a scrypt

## [1.3.0] — 2026-05-01
### Added
- Circuit breaker para integración Anthropic
- Retry con backoff exponencial

## [1.2.0] — ...
```

Update por cada release significativo. Referenciar PRs / tags.

---

## 7. Pre-deploy checklist

En cada deploy a prod, checklist manual:

```
Pre-deploy prod — SharkTalents
================================

- [ ] Estoy en branch main
- [ ] git pull origin main ejecutado
- [ ] Sin cambios sin commitear (git status limpio)
- [ ] Tests de smoke en dev pasados
- [ ] Build local ok (functions/api + frontend)
- [ ] CHANGELOG.md actualizado
- [ ] Version bumpeada en shark/package.json
- [ ] Env vars nuevas configuradas en Catalyst Console (prod)
- [ ] DB migrations aplicadas (si hay)
- [ ] Backend es backward-compatible con frontend actual
- [ ] Window apropiada (no viernes 5pm salvo emergencia)
- [ ] Team notificado (al menos: "voy a deployar a prod en 5 min")
- [ ] Plan de rollback claro
```

---

## 8. Post-deploy checklist

Primeros 30 min después del deploy:

```
Post-deploy — SharkTalents
================================

- [ ] /health devuelve 200
- [ ] /health/detailed muestra todos los checks "ok"
- [ ] Smoke test: login admin ok
- [ ] Smoke test: crear puesto + generar técnica
- [ ] Smoke test: submit test como candidato
- [ ] Smoke test: generar reporte + publicar + abrir URL público
- [ ] Logs: sin errores nuevos en 30 min
- [ ] Métricas: request rate normal
- [ ] Métricas: error rate < 1%
- [ ] Tag git creado y pushed: git tag v<version> && git push --tags
- [ ] CHANGELOG commitea
```

---

## 9. Catalyst Pipelines (opcional, futuro)

Cuando el equipo crezca o la frecuencia de deploys suba, migrar a Catalyst Pipelines (YAML):

```yaml
# catalyst-pipelines.yaml (ejemplo futuro)
stages:
  - build:
      runs-on: node20
      steps:
        - name: Install backend
          run: cd functions/api && npm ci
        - name: Build backend
          run: cd functions/api && npm run build
        - name: Install frontend
          run: cd frontend && npm ci
        - name: Build frontend
          run: cd frontend && npm run build

  - test:
      runs-on: node20
      steps:
        - name: Smoke tests (manuales por ahora)
          run: echo "TODO: cuando haya tests automatizados"

  - deploy-dev:
      condition: branch = 'main'
      steps:
        - catalyst-deploy:
            components: functions
            env: development

  - deploy-prod:
      condition: tag ~= 'v*'
      approval: required
      steps:
        - catalyst-deploy:
            components: functions
            env: production
```

No hace falta en el refactor inicial — evaluar post-refactor si hay fricción con el deploy manual.

---

## 10. Checklist de cierre Fase 8

- [ ] `scripts/deploy-backend.sh` probado en dev
- [ ] `scripts/deploy-frontend.sh` probado
- [ ] `scripts/generate-secret.sh`, `generate-password-hash.sh`, `rotate-secret.sh` funcionales
- [ ] `.gitignore` actualizado con todas las build artifacts + secrets
- [ ] CHANGELOG.md creado con entry inicial
- [ ] `docs/RUNBOOKS/rollback.md` escrito
- [ ] 2 environments separados en Catalyst (dev + prod)
- [ ] Env vars configuradas en ambos
- [ ] Branch `main` protegido en GitHub (opcional pero recomendado)
- [ ] Tags usados: al menos 1 tag creado (ej. `v1.0.0` = estado pre-refactor, `v2.0.0` = post-refactor)
- [ ] Deploy a prod ejecutado con pre/post checklist
- [ ] 1 rollback ensayado en dev (para saber que funciona)

---

## Siguiente paso

→ [10_MIGRACION_DATOS.md](10_MIGRACION_DATOS.md) — cómo migrar la data existente al schema nuevo sin downtime.
