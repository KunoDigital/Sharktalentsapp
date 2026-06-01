# 05 — Correr el script paso a paso

**Objetivo:** ejecutar el script `create-catalyst-tables.ts` para crear las tablas del manifest en tu Catalyst Datastore.

---

## Pre-requisitos

Antes de correr el script asegurate de tener:

1. ✅ Setup OAuth listo (ver [01_setup_oauth.md](01_setup_oauth.md))
2. ✅ Manifest JSON armado (ver [04_manifest_json.md](04_manifest_json.md))
3. ✅ Node.js 20+ instalado
4. ✅ `tsx` disponible (`npx tsx ...` lo descarga si no lo tenés)
5. ✅ 5 env vars seteadas en tu shell

---

## El script

Hay 2 scripts en [templates/](templates/):

| Script | Para qué |
|---|---|
| **[create-catalyst-tables.ts](templates/create-catalyst-tables.ts)** | Script principal: lee el manifest, crea tablas + columnas en batch |
| **[create-stubborn-table.ts](templates/create-stubborn-table.ts)** | Fallback para tablas problemáticas: polea cada 15s hasta 5 min antes de dar up |

---

## Setear env vars

En tu terminal:

```bash
export CATALYST_PROJECT_ID=28606000000676053
export CATALYST_ORG_ID=883996440
export CATALYST_OAUTH_CLIENT_ID=1000.PBJFSFM913OR39HJXN8W5LH0CS5CBQ
export CATALYST_OAUTH_CLIENT_SECRET=b610d0c4acdfb958643764769996db3f148ba5f84e
export CATALYST_OAUTH_REFRESH_TOKEN=1000.b242d4b87481ce17973d7e24a153311d.c932278e8efbcd71112c81a9c196f77c

# Opcional: si tu manifest está en otra ruta
export CATALYST_MANIFEST_PATH=docs/SCHEMA_MANIFEST.json

# Opcional: ambiente Catalyst (default Development)
export CATALYST_ENVIRONMENT=Development
```

⚠️ **NO commitear estas env vars.** Solo en shell local.

---

## Modo Dry-Run (ALWAYS PRIMERO)

```bash
./scripts/create-catalyst-tables.ts
```

Sin `--execute`, el script **NO hace cambios reales** — solo te muestra qué haría.

Output esperado:

```
ℹ️ Manifest cargado: 26 tablas, 303 columnas
⚠️ DRY-RUN MODE — no se va a crear nada. Agregá --execute para ejecutar.
ℹ️ Catalyst project 28606000000676053 · org 883996440 · env Development
ℹ️ 
=== Tenants (12 columnas) ===
ℹ️ DRY-RUN would POST https://console.catalyst.zoho.com/baas/v1/project/28606000000676053/table {"body":{"table_name":"Tenants","table_scope":"GLOBAL"}}
ℹ️ DRY-RUN would POST .../table/DRY_RUN_TABLE_ID/column with 12 columns

=== Resumen ===
✅ Creadas: 26
ℹ️ Ya existían (skipped): 0

Para ejecutar de verdad: ./scripts/create-catalyst-tables.ts --execute
```

---

## Test con UNA tabla primero

Antes de lanzar el batch completo, probá con una sola:

```bash
./scripts/create-catalyst-tables.ts --only=Candidates --execute
```

Output esperado (success):

```
ℹ️ Manifest cargado: 26 tablas, 303 columnas
ℹ️ Filtro --only=Candidates → 1 tabla
ℹ️ Catalyst project 28606000000676053 · org 883996440 · env Development
ℹ️ 
=== Candidates (8 columnas) ===
✅ Tabla "Candidates" creada {"table_id":28606000000776012}
ℹ️ Esperando 60s antes de POST /column (intento 1/3)
✅ 8 columnas creadas para "Candidates"

=== Resumen ===
✅ Creadas: 1
ℹ️ Ya existían (skipped): 0
```

**Esperá ~70-90 segundos** (60s wait + creación).

---

## Lanzar batch completo

Si el test funcionó:

```bash
./scripts/create-catalyst-tables.ts --execute
```

Esto procesa **todas las tablas del manifest**. Las que ya existen se saltean automáticamente.

⚠️ **No hagas Ctrl+C en medio.** Si interrumpís, podés dejar tablas a medio crear (huérfanas). Si tenés que cancelar, esperá a que termine la tabla actual.

Tiempo estimado: **~1-2 min por tabla**. 10 tablas ≈ 15-20 min.

---

## Outputs típicos durante el batch

### Success (tabla nueva creada)

```
=== MarketingLeads (16 columnas) ===
✅ Tabla "MarketingLeads" creada {"table_id":28606000000781116}
ℹ️ Esperando 60s antes de POST /column (intento 1/3)
✅ 16 columnas creadas para "MarketingLeads"
```

### Skip (tabla ya existe)

```
=== Tenants (12 columnas) ===
ℹ️ Tabla "Tenants" ya existe — skip create, intentaré agregar columnas que falten
```

> ⚠️ Nota: el script NO agrega columnas faltantes a tablas existentes (porque no tiene un GET endpoint para obtener el table_id de una tabla ya existente, sin scope adicional). Para agregar columnas a tabla existente: hacelo manual (ver "Casos especiales" abajo).

### Failure (eventual consistency timeout)

```
=== MindsetScores (21 columnas) ===
✅ Tabla "MindsetScores" creada {"table_id":28606000000779004}
ℹ️ Esperando 60s antes de POST /column (intento 1/3)
ℹ️ Esperando 30s antes de POST /column (intento 2/3)
ℹ️ Esperando 30s antes de POST /column (intento 3/3)
❌ Falló "MindsetScores" {"error":"... HTTP 404 INVALID_ID"}
```

Esto deja la tabla huérfana. Solución: ver [06_troubleshooting.md](06_troubleshooting.md).

---

## Comandos comunes

### Dry-run completo

```bash
./scripts/create-catalyst-tables.ts
```

### Crear UNA tabla específica

```bash
./scripts/create-catalyst-tables.ts --only=MarketingLeads --execute
```

### Crear todas (batch)

```bash
./scripts/create-catalyst-tables.ts --execute
```

### Re-correr para crear las que faltaron

Las que ya existen se saltean. Solo se crean las nuevas:

```bash
./scripts/create-catalyst-tables.ts --execute
```

### Usar el stubborn-poll para tabla difícil

Si una tabla falla con timeout repetido:

1. Borrar manualmente la tabla huérfana en Catalyst Console
2. Esperar 60s
3. Correr:

```bash
./scripts/create-stubborn-table.ts MindsetScores
```

Este script polea cada 15s hasta 5 min antes de dar up.

---

## Casos especiales

### Agregar columnas a una tabla existente

El script principal NO maneja esto. Hay que hacerlo con curl directo:

```bash
# 1. Conseguir el table_id manualmente (ver UI Console o response anterior)
TABLE_ID=28606000000781116

# 2. Refresh access token
ACCESS=$(curl -sS -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "grant_type=refresh_token" \
  -d "client_id=$CATALYST_OAUTH_CLIENT_ID" \
  -d "client_secret=$CATALYST_OAUTH_CLIENT_SECRET" \
  -d "refresh_token=$CATALYST_OAUTH_REFRESH_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 3. Agregar columnas
curl -sS -X POST \
  "https://console.catalyst.zoho.com/baas/v1/project/$CATALYST_PROJECT_ID/table/$TABLE_ID/column" \
  -H "Authorization: Zoho-oauthtoken $ACCESS" \
  -H "Environment: Development" \
  -H "Catalyst-org: $CATALYST_ORG_ID" \
  -H "Content-Type: application/json" \
  -d '[
    {"column_name":"nueva_columna","data_type":"varchar","max_length":255,"is_mandatory":"false","is_unique":"false","search_index_enabled":"false","audit_consent":"false"}
  ]'
```

### Re-correr cuando se envenenó un nombre

Si después de muchos intentos un nombre quedó "envenenado" (ver [03_quirks_y_bugs.md](03_quirks_y_bugs.md)):

1. Renombrar la tabla en tu manifest JSON (ej: `MiTablaQueFalla` → `MiTabla2`)
2. Renombrar también en tu código fuente (constants, queries ZCQL)
3. Re-correr el script

---

## Output del resumen final

Al final del batch, el script te muestra:

```
=== Resumen ===
✅ Creadas: 7
ℹ️ Ya existían (skipped): 16
❌ Fallaron: 3
```

Si hay fallos, te dice qué tablas fallaron y el motivo. Ver [06_troubleshooting.md](06_troubleshooting.md) para resolverlos.

---

## Siguiente paso

→ [06_troubleshooting.md](06_troubleshooting.md) — errores comunes y cómo resolverlos.
