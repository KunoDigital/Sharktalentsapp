# 06 — Troubleshooting

**Errores comunes que vas a encontrar + cómo resolverlos.**

---

## Errores de OAuth

### `invalid_client` o `invalid_grant`

**Síntoma:**
```json
{"error":"invalid_client"}
```

**Causas:**
- Client ID o Secret incorrectos
- Hay espacios al inicio/final del valor (típico al copy-paste)
- El Self-Client fue borrado

**Solución:**
1. Verificá que `client_id` y `client_secret` no tengan espacios
2. Revisá en api-console.zoho.com que el Self-Client siga existiendo
3. Si fue borrado, generá uno nuevo (ver [01_setup_oauth.md](01_setup_oauth.md))

### `invalid_code`

**Síntoma:** después de generar code + curl exchange:
```json
{"error":"invalid_code"}
```

**Causas:**
- El code expiró (>10 min desde que lo generaste)
- Ya lo usaste antes (es single-use)

**Solución:** generá un code nuevo en api-console.zoho.com → Generate Code → repetí el curl.

### `OAUTH_SCOPE_MISMATCH`

**Síntoma:**
```json
{"status":"failure","data":{"error_code":"OAUTH_SCOPE_MISMATCH"}}
```

**Causa:** estás intentando hacer una operación que no está en los scopes del refresh_token (ej: querer listar tablas pero solo tenés scope CREATE).

**Solución:**
1. Volvé a api-console.zoho.com → Generate Code
2. Agregá los scopes que necesitás (ej: `ZohoCatalyst.tables.READ` para listar)
3. Convertí ese nuevo code a un refresh_token nuevo
4. Actualizá `ZOHO_OAUTH_REFRESH_TOKEN`

---

## Errores al crear tabla

### `DUPLICATE_ENTRY`

**Síntoma:**
```json
{"status":"failure","data":{"message":"The given Table name already exists. Please give a different name","error_code":"DUPLICATE_ENTRY"}}
```

**Causas:**

1. **La tabla ya existe** (creada antes, manualmente o por otra corrida) → el script debería detectar esto y saltar
2. **La tabla está huérfana** (creada con timeout, ahora zombie) — aparece en UI Console con 0 columnas

**Solución:**
- Si la tabla legítimamente ya existe: ✅ el script debería saltar. No es error real.
- Si está huérfana en Catalyst Console:
  1. Ir a Catalyst Console → Data Store → buscar la tabla
  2. Click en los 3 puntos → Delete
  3. **Esperar 60 segundos** (delete también tiene eventual consistency)
  4. Re-correr el script

Si después de borrar + esperar sigue dando DUPLICATE_ENTRY → el nombre quedó **envenenado** → renombrar (ver [03_quirks_y_bugs.md §2](03_quirks_y_bugs.md)).

### `400 Bad Request` al crear tabla

**Síntoma:** HTTP 400 con mensaje genérico.

**Causas comunes:**
- El nombre de la tabla tiene caracteres inválidos (guiones, espacios)
- Falta el header `Environment`
- Falta el header `Catalyst-org`

**Solución:** revisar el request — los 4 headers tienen que estar (Authorization, Environment, Catalyst-org, Content-Type).

---

## Errores al crear columnas

### `INVALID_ID` (tabla recién creada)

**Síntoma:** después de crear la tabla, al agregar columnas:
```json
{"status":"failure","data":{"message":"No such Table with the given id exists","error_code":"INVALID_ID"}}
```

**Causa:** eventual consistency — la tabla todavía no se propagó al índice de columns API.

**Solución:**
- Si fue el primer intento: el script va a reintentar 2 veces más (60s + 30s + 30s = 2 min total)
- Si reintentaste manualmente y sigue: la tabla quedó huérfana, ver siguiente sección.

### `INVALID_ID` persistente (tabla huérfana)

**Síntoma:** después de 5+ minutos, sigue dando INVALID_ID con el mismo table_id.

**Causa:** la tabla quedó zombie — existe en UI Console pero su table_id está roto.

**Solución:**
1. Catalyst Console → Data Store → buscar la tabla → Delete
2. Esperar 60s
3. Re-correr el script (creará con nuevo table_id)

Si después de borrar y re-intentar sigue fallando consistentemente → renombrar la tabla (ver [03_quirks_y_bugs.md §2](03_quirks_y_bugs.md)).

### `400 Bad Request` al crear columnas

**Síntoma:** HTTP 400 con mensaje sobre un campo específico.

**Causas comunes:**

| Mensaje | Causa | Solución |
|---|---|---|
| `is_mandatory should be a string` | Mandaste boolean en vez de string | Convertí a `"true"`/`"false"` |
| `max_length required` | varchar sin max_length | Agregá `"max_length": 255` |
| `parent_table required` | foreign key sin padre | Agregá `parent_table` + `parent_column` |
| `Invalid data_type` | Tipo no reconocido | Revisá la lista en [02_endpoints_y_tipos.md](02_endpoints_y_tipos.md) |

---

## Errores del script

### `Cannot find module 'zcatalyst-sdk-node'` o similar

**Causa:** el script importa cosas del SDK que no están instaladas.

**Solución:** este script es **standalone** — no debería importar zcatalyst-sdk-node. Revisá que estés corriendo el script de [templates/](templates/) y no otro.

### `MANIFEST_PATH not found`

**Causa:** el manifest JSON no existe en la ruta esperada.

**Solución:**

```bash
# Verificá que el archivo existe
ls -la $CATALYST_MANIFEST_PATH

# Si no, generá el manifest primero (ver 04_manifest_json.md)
```

### El script se cuelga durante el wait de 60s

**Causa:** el script está esperando intencional — eventual consistency.

**Solución:** **NO Ctrl+C**. Esperá. Si después de 3-4 minutos no avanza, problema diferente (revisá logs).

---

## Estado raro en Catalyst Console

### Tabla aparece en UI pero con 0 columnas

**Diagnóstico:** es una tabla huérfana (eventual consistency timeout).

**Solución:** borrarla manualmente en UI Console + re-correr el script.

### Tabla aparece en UI con algunas columnas faltantes

**Diagnóstico:** el primer batch de columnas tuvo éxito pero el script falló antes de terminar todas (raro).

**Solución:**
1. Borrar la tabla y empezar de nuevo
2. O agregar las columnas faltantes con curl manual (ver "Agregar columnas a tabla existente" en [05_script_paso_a_paso.md](05_script_paso_a_paso.md))

### `Job_Opening_Name` u otra columna mandatoria no aparece

**Causa:** algunos módulos de Catalyst tienen columnas auto-creadas (CREATEDTIME, MODIFIEDTIME, ROWID, CREATORID). Estas NO se crean vía API — Catalyst las agrega automáticamente.

**Solución:** ignorar — son de sistema, no las tocás.

---

## Performance / rate limits

### El script va MUY lento (>5 min por tabla)

**Causas:**
- Catalyst está bajo load (raro)
- Tu conexión es lenta
- El delay del script está mal calibrado para tu caso

**Solución:**
- Verificá con `curl` que el API responde rápido (ej: GET health endpoint)
- Si Catalyst está lento, esperá y reintentá más tarde

### `429 Too Many Requests`

**Causa:** rate limit de Zoho.

**Solución:**
- Esperá 5-10 minutos
- Re-correr el script (las que ya existen se saltean)

---

## Cómo verificar el estado final

Después de correr el script, verificá manualmente:

1. Catalyst Console → Data Store → lista todas las tablas
2. Compará con tu manifest:
   ```bash
   python3 -c "
   import json
   m = json.load(open('docs/SCHEMA_MANIFEST.json'))
   for t in sorted(m['tables'], key=lambda x: x['name']):
       print(t['name'])
   "
   ```
3. Las que falten en Catalyst, re-correr el script con `--only=NombreTabla --execute`.

---

## Cuando todo falla

Si pasaste 2+ horas peleándote con un problema:

1. **Borrá TODAS las tablas huérfanas** en UI Console (las que tengan 0 columnas)
2. **Esperá 5 minutos** para que Catalyst limpie el estado interno
3. **Renombrá las tablas** que estén dando problemas crónicos
4. **Re-corré** el script desde cero
5. **Si sigue fallando**: pone el thread en Zoho Catalyst support — adjuntá el `traceId` de los logs

---

## Siguiente paso

→ [07_para_agentes_ai.md](07_para_agentes_ai.md) — guía especial para Claude Code y otros agentes AI.
