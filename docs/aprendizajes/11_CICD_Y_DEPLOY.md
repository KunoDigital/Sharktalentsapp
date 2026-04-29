# 11 — Git Workflow, CI/CD y Deploys en Catalyst

El deploy no es un detalle técnico. Un deploy roto puede tirar tu app productiva por horas. Este documento cubre patrones probados.

---

## Git: convenciones básicas

### Branches

```
main                       ← producción, único que se deploya a prod
archive/<descripcion>      ← snapshots históricos (pre-refactor, versiones viejas)
feature/<descripcion>      ← features en desarrollo
fix/<descripcion>          ← bug fixes
perf/<descripcion>         ← optimizaciones
refactor/<descripcion>     ← reorganización sin cambio funcional
docs/<descripcion>         ← documentación
```

### Nombres descriptivos

```
✅ feature/qes-sync-workdrive
✅ fix/webhook-signature-v2
✅ perf/consolidate-cron-queries

❌ feature/new-stuff
❌ fix/bug
❌ my-branch
```

### Commits: imperativo + why

```
✅ Good:
Consolidar queries del cron_function: 7 → 1

- Reduce fetches DataStore en ~67%
- Filtrado por rule ahora en memoria
- Ahorro proyectado: $15/mes

❌ Bad:
"cambios"
"wip"
"fix"
"actualización"
```

---

## Workflow recomendado

### Arrancar feature

```bash
git checkout main
git pull
git checkout -b feature/nueva-cosa
```

### Durante desarrollo

- Commits pequeños y frecuentes
- Push regular para backup

```bash
git push -u origin feature/nueva-cosa
```

### Antes de mergear

1. Rebase contra main para traer cambios:
```bash
git checkout main
git pull
git checkout feature/nueva-cosa
git rebase main   # o git merge main si preferís
```

2. Correr tests + build localmente:
```bash
npm test
cd client && npm run build
```

3. Revisar el diff completo:
```bash
git diff main...feature/nueva-cosa
```

### Merge a main

```bash
git checkout main
git merge --no-ff feature/nueva-cosa
git push origin main
```

`--no-ff` fuerza commit de merge. Visible en historial que vino una feature completa, no commits sueltos.

### Tag el release

```bash
git tag v2.5.3 -m "Feature X + perf Y"
git push origin v2.5.3
```

### Limpiar

```bash
git branch -d feature/nueva-cosa
git push origin --delete feature/nueva-cosa
```

---

## Archive antes de cambios grandes

Antes de refactorizar algo importante o renombrar branches, creá un archivo:

```bash
git branch archive/pre-refactor-$(date +%Y%m%d) main
git push origin archive/pre-refactor-$(date +%Y%m%d)
```

Si el refactor sale mal, siempre tenés un snapshot.

---

## Renombrar default branch

Si tu branch principal no se llama `main`, normalizá. GitHub soporta rename con redirects automáticos.

```bash
# CLI con gh
gh repo edit <owner>/<repo> --default-branch main

# Rename branch en remoto
gh api -X POST repos/<owner>/<repo>/branches/old-name/rename -f new_name=main

# Actualizar local
git fetch --all --prune
git branch -m old-name main
git branch --set-upstream-to=origin/main main
```

---

## Deploy backend (Cloud Scale Functions)

### Opción 1: manual CLI

```bash
catalyst deploy --only functions:api_function
catalyst deploy --only functions                    # todas
```

**Ventaja:** control total.
**Desventaja:** depende de quién tiene el CLI instalado con auth correcta.

### Opción 2: DevOps GitHub Integration

Catalyst tiene GitHub Integration nativa:

1. Catalyst Console → DevOps → GitHub Integration
2. Autorizar GitHub
3. Conectar repo
4. Configurar: al push a `main`, deploy de functions + client

**Ventaja:** `git push = deploy`.
**Desventaja:** menos control sobre timing del deploy.

### Opción 3: Catalyst Pipelines

YAML propio de Catalyst con stages:

```yaml
# catalyst-pipelines.yaml
stages:
  - build:
      runs-on: node20
      steps:
        - name: Install
          run: npm ci
        - name: Test
          run: npm test
  - deploy:
      condition: branch = 'main'
      steps:
        - catalyst-deploy:
            components: functions
```

**Ventaja:** control granular, tests antes del deploy.
**Desventaja:** curva de aprendizaje.

Recomendación: empezar con Opción 1, pasar a Opción 3 cuando equipo crezca.

---

## Deploy frontend (Client Hosting)

En Cloud Scale + Client Hosting, el flujo es:

1. Bumpear versión en `client/package.json` y `client/public/client-package.json`
2. Build: `cd client && npm run build`
3. Zipear `dist/`
4. Upload manual a Catalyst Console

### Script local para automatizar

```bash
# scripts/deploy-frontend.sh
#!/bin/bash
set -e

cd "$(dirname "$0")/../client"

# Extraer versión
VERSION=$(node -p "require('./public/client-package.json').version")
echo "Building version $VERSION..."

# Build
npm install
npm run build

# Zip
cd dist
ZIP_NAME="../didit-panel-${VERSION}.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" .
cd ..

echo ""
echo "✓ Zip listo: client/didit-panel-${VERSION}.zip ($(du -h "didit-panel-${VERSION}.zip" | cut -f1))"
echo ""
echo "Siguiente paso:"
echo "1. Ir a Catalyst Console → Client Hosting"
echo "2. Upload 'client/didit-panel-${VERSION}.zip'"
```

Ejecutá: `./scripts/deploy-frontend.sh`

---

## Orden de deploys (CRÍTICO)

Cuando una release toca DB, backend y frontend, el orden importa para no romper prod:

### ✅ Correcto

```
1. Agregar columnas nuevas en DataStore (Catalyst Console)
   ← ahora la DB tiene campos que el código viejo ignora (OK)
2. Deploy backend con el código nuevo que usa las columnas
   ← ahora el backend escribe/lee las columnas nuevas
3. Verificar en dev environment
4. Deploy frontend con UI que muestra los campos
```

### ❌ Incorrecto

```
1. Deploy frontend con UI que consume /new-endpoint
   ← frontend recibe 404, UI rota
2. Deploy backend con /new-endpoint
   ← ahora frontend funciona pero estuvo roto 10 min
```

**Regla:** cambios de backend deben ser **backward-compatible** con la versión anterior del frontend. Frontend nuevo puede usar campos nuevos, pero backend no debe eliminar campos viejos hasta que todos los clientes estén actualizados.

---

## Rollback

### Rollback de backend

```bash
# Encontrar el commit a revertir
git log --oneline

# Crear un commit que revierte
git revert <sha>
git push origin main

# Redeploy
catalyst deploy --only functions:<nombre>
```

**Evitá `reset --hard`** en main compartido — reescribe historia y confunde a otros.

### Rollback de frontend

Catalyst Client Hosting guarda versiones anteriores. Desde Console:
1. Client Hosting → Deployment History
2. Click en versión anterior
3. "Restore" o "Redeploy"

Si no guarda versiones, volver a buildear desde un tag:

```bash
git checkout v2.5.1
cd client
npm install
npm run build
cd dist && zip -r ../didit-panel-2.5.1-rollback.zip . && cd ..
# Upload manual
```

---

## Ambientes: dev vs prod

### Catalyst tiene 2 environments nativos

- `development`: sandbox para pruebas
- `production`: prod real

Cada uno tiene su URL, sus env vars, su DataStore separado.

### Config por ambiente

```json
// catalyst-config.json
{
    "deployment": {
        "env_variables": {
            // Valores para DEV (se commitea)
            "API_URL": "https://api-sandbox.stripe.com",
            "APP_BASE_URL": "https://myapp.development.catalystserverless.com"
        }
    }
}
```

En Catalyst Console → tu function → Environment Variables, configurás los valores de **prod** manualmente. No se commitean.

### Promote a prod

Siempre en este orden:
1. Deploy a dev environment
2. Smoke test en dev
3. Promote a prod (botón en Catalyst Console) o redeploy explícito con `--env production`

---

## Secrets rotation

### Cuándo rotar

- Sospecha de leak
- Miembro del equipo se va
- Cada N meses como higiene

### Pasos

Para cada secret:

1. **Generar nuevo**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **Desplegar código que acepta AMBOS** (old + new) temporalmente:

```js
function verifyApiKey(provided) {
    const secrets = [process.env.API_KEY, process.env.API_KEY_OLD].filter(Boolean);
    return secrets.some(s => timingSafeCompare(provided, s));
}
```

3. **Actualizar secret en Catalyst Console** (y en los sistemas que lo usan: webhooks externos, clientes).

4. **Esperar 24-48h** para que todos los callers migren al nuevo.

5. **Remover el secret viejo del código y de env vars**.

---

## Versioning del frontend

### Semantic versioning

```
MAJOR.MINOR.PATCH

MAJOR: breaking changes (cambios de UI que rompen flujos, cambios de API contract)
MINOR: features nuevas (retrocompatibles)
PATCH: bug fixes
```

Ejemplo de convención:
- `2.4.X` → versión "estable" con bug fixes
- `2.5.X` → nuevas features (retro-compatibles)
- `3.0.0` → cambios breaking (schema DB, contratos API)

### Visible en UI

```tsx
<footer>v{APP_VERSION}</footer>
```

### Changelog

`client/public/client-package.json` tiene `description` — ponele un one-liner del cambio:

```json
{
    "version": "2.5.2",
    "description": "Polling 30s→90s, cron consolidado"
}
```

Para cambios grandes, mantener `CHANGELOG.md` en la raíz.

---

## Pre-deploy checklist

Antes de mergear a main + deploy:

- [ ] Tests pasan localmente
- [ ] Build del frontend sin errores
- [ ] No hay `console.log` de debug olvidados
- [ ] No hay secrets hardcodeados (revisar con grep)
- [ ] Env vars nuevas documentadas
- [ ] DB migrations aplicadas en el target environment
- [ ] Backend es retro-compatible con frontend actual
- [ ] Feature flags configurados correctamente
- [ ] Runbook actualizado si hay comportamiento nuevo
- [ ] CHANGELOG bumpeado
- [ ] Commit messages descriptivos
- [ ] Tag de release preparado

---

## Post-deploy checklist

En los primeros 15-30 min después de un deploy a prod:

- [ ] Health check de cada function responde OK
- [ ] Smoke test manual del flow crítico
- [ ] Logs no muestran errores nuevos
- [ ] Métricas de request rate / error rate normales
- [ ] Plan de rollback sigue viable si algo aparece

---

## Slate vs Cloud Scale: qué elegir para CI/CD

**Slate** te da git integration "como Vercel": push → deploy. Pero SOLO es útil para:
- Apps nuevas desde cero con Next.js/Astro
- Que NO tengan dependency de Cloud Scale Functions

Para apps Cloud Scale existentes, **no vale la pena migrar a Slate** solo por el CI/CD. Ver doc 01_ARQUITECTURA.md para el análisis completo.

Mejor para Cloud Scale:
1. **Hoy:** script de build local + catalyst deploy CLI
2. **Mañana:** DevOps GitHub Integration
3. **Pasado mañana:** Catalyst Pipelines con YAML

Todo lo cual **mantiene tu arquitectura actual**, solo automatiza la ejecución de lo que ya hacés manual.

---

## Monorepo vs Multi-repo

### Monorepo (recomendado para projects chicos)

```
my-app/
├── client/         ← frontend
├── functions/      ← backends
├── docs/
└── .git
```

Un solo repo, un solo historial. Fácil de navegar.

### Multi-repo

```
my-app-client     ← su propio repo
my-app-backend    ← su propio repo
```

Útil cuando: distintos equipos, ciclos de deploy independientes, compliance.

Para apps chicas-medianas: **monorepo gana** por simplicidad.

---

## Worktrees (git avanzado)

Si alternás entre múltiples features:

```bash
# Clonar main a otro folder
git worktree add ../my-app-feature feature/nueva-cosa

# Ahora tenés /my-app (main) y /my-app-feature (feature) al mismo tiempo
# Cambiar sin `git stash`

# Cuando terminás
git worktree remove ../my-app-feature
```

Útil cuando pivoteás entre bug fixes y features largas.

---

## Checklist de CI/CD

- [ ] `main` es la branch de prod
- [ ] Tags para releases (v2.5.2, etc.)
- [ ] Archive branches para pre-refactors
- [ ] Scripts de build documentados (`scripts/deploy-frontend.sh`)
- [ ] Orden de deploys documentado (DB → backend → frontend)
- [ ] Plan de rollback conocido
- [ ] Environments dev vs prod separados
- [ ] Secrets en env vars de Console, no hardcoded
- [ ] Rotation de secrets documentada
- [ ] Versioning visible en UI
- [ ] Pre/post deploy checklists con el equipo
- [ ] Monitoring externo de health checks
