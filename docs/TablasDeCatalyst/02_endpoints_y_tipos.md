# 02 — Endpoints del API + Mapping de tipos

**Objetivo:** entender los 2 únicos endpoints que necesitás + cómo mapear tipos TypeScript/SQL → tipos Catalyst.

---

## Los 2 endpoints

### 1. Crear tabla

```
POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table
```

**Headers:**

| Header | Valor |
|---|---|
| `Authorization` | `Zoho-oauthtoken <access_token>` |
| `Environment` | `Development` o `Production` |
| `Catalyst-org` | tu org_id |
| `Content-Type` | `application/json` |

**Body:**

```json
{
  "table_name": "MiTablaNueva",
  "table_scope": "GLOBAL"
}
```

**Response success (200/201):**

```json
{
  "status": "success",
  "data": {
    "table_id": 28606000000770368,
    "table_name": "MiTablaNueva",
    "project_id": { ... },
    "modified_by": { ... }
  }
}
```

**Lo importante:** `data.table_id` — lo necesitás para agregar columnas después.

### 2. Crear columnas (bulk)

```
POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table/{tableId}/column
```

**Headers:** mismos que arriba.

**Body:** **array** de columnas:

```json
[
  {
    "column_name": "email",
    "data_type": "varchar",
    "max_length": 255,
    "is_mandatory": "true",
    "is_unique": "true",
    "search_index_enabled": "true",
    "audit_consent": "false"
  },
  {
    "column_name": "age",
    "data_type": "int",
    "is_mandatory": "false",
    "is_unique": "false",
    "search_index_enabled": "false",
    "audit_consent": "false"
  }
]
```

---

## ⚠️ Reglas críticas del payload

### 1. Boolean fields van como STRING

Estos 4 campos los recibe como string `"true"` o `"false"`, NO como boolean real:

- `is_mandatory`
- `is_unique`
- `search_index_enabled`
- `audit_consent`

**Si mandás `true` (boolean) Catalyst te rechaza el request.**

### 2. Campos requeridos por tipo

No todos los tipos necesitan los mismos campos. Esto está en la docu pero suele ser causa de errores:

| data_type | Campos requeridos |
|---|---|
| `text` | column_name, data_type, is_mandatory, audit_consent |
| `varchar` | column_name, data_type, **max_length**, is_mandatory, is_unique, search_index_enabled, audit_consent |
| `int`, `bigint`, `double` | column_name, data_type, is_mandatory, is_unique, search_index_enabled, audit_consent |
| `boolean` | column_name, data_type, is_mandatory, search_index_enabled, audit_consent |
| `date`, `datetime` | column_name, data_type, is_mandatory, search_index_enabled, audit_consent |
| `encrypted text` | column_name, data_type, is_mandatory, audit_consent |
| `foreign key` | column_name, data_type, **parent_table**, **parent_column**, is_mandatory, audit_consent, search_index_enabled |

### 3. `text` vs `varchar`

- **`text`:** sin max_length explícito. **Pero ojo: Catalyst limita Text a 10,000 chars** (descubrimiento real, no documentado oficialmente). Para >10K usar File Store + guardar el `file_id` en la columna.
- **`varchar`:** requiere `max_length`. **Máximo 255 chars.** Para más usar `text`.

---

## Tipos de Catalyst (lista completa)

Según la docu oficial:

- `text` — texto largo (hasta 10K chars)
- `varchar` — string corto (hasta 255 chars)
- `int` — entero 32-bit
- `bigint` — entero 64-bit
- `double` — número decimal
- `boolean` — true/false
- `date` — solo fecha
- `datetime` — fecha + hora ISO 8601
- `encrypted text` — texto encriptado at rest
- `foreign key` — referencia a otra tabla

**Tipos que NO soporta el API directo:**
- `Email` (en UI Console existe pero la API lo trata como `varchar` con validación)
- `URL` (lo mismo)
- `Phone` (idem)
- `JSON` (no existe — usar `text` y serializar/deserializar en código)

---

## Mapping recomendado desde TypeScript/SQL

Si tu schema vive en TypeScript o SQL, usá este mapping para convertir:

| Tu definición | data_type Catalyst | Notas |
|---|---|---|
| `Text` (TypeScript) | `text` | Largo, hasta 10K |
| `Var Char`, `string(N)` | `varchar` | max_length obligatorio (≤255) |
| `Email` | `varchar` | max_length 255 |
| `Integer`, `Int`, `number` | `int` | |
| `BigInt`, `int64` | `bigint` | |
| `Decimal`, `float`, `Double` | `double` | usar `decimal_digits` si querés precisión |
| `Boolean`, `bool` | `boolean` | |
| `DateTime`, `timestamp` | `datetime` | ISO 8601 |
| `Date` | `date` | YYYY-MM-DD |
| `JSON`, `object` | `text` | serializar a string en código |
| `FK reference` | `foreign key` | Necesita parent_table + parent_column |

---

## Campos opcionales útiles

Estos no son requeridos pero pueden mejorar tu schema:

| Campo | Tipo | Para qué |
|---|---|---|
| `description` | string | Documentación del campo (queda en UI Console) |
| `default_value` | string | Valor default cuando se inserta sin valor |
| `max_length` | int | Solo para varchar |
| `decimal_digits` | int | Solo para double — cantidad de decimales |
| `constraint_type` | string | Para foreign key: `ON-DELETE-SET-NULL` o `ON-DELETE-CASCADE` |

---

## Indexes (`search_index_enabled`)

Setear `search_index_enabled: "true"` agrega un índice a la columna. **Importante** para columnas que se usan en `WHERE`/`ORDER BY` (queries ZCQL).

Recomendado para:
- ✅ Foreign keys (`tenant_id`, `job_id`, `result_id`, etc.)
- ✅ Columnas únicas (siempre tener `is_unique: "true"` + `search_index_enabled: "true"`)
- ✅ Columnas que filtras: `email`, `status`, `created_at`
- ❌ Columnas grandes (`text`) — Catalyst no permite indexar `text` igual
- ❌ Columnas que nunca filtras

---

## Ejemplo completo: crear tabla Candidates

```bash
# 1. Refresh access token
ACCESS=$(curl -sS -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "grant_type=refresh_token" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "refresh_token=$REFRESH_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Crear la tabla
CREATE_RESPONSE=$(curl -sS -X POST \
  "https://console.catalyst.zoho.com/baas/v1/project/$PROJECT_ID/table" \
  -H "Authorization: Zoho-oauthtoken $ACCESS" \
  -H "Environment: Development" \
  -H "Catalyst-org: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"table_name": "Candidates", "table_scope": "GLOBAL"}')

TABLE_ID=$(echo $CREATE_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['table_id'])")
echo "Tabla creada con table_id=$TABLE_ID"

# 3. ⚠️ ESPERAR 60s — eventual consistency (ver 03_quirks_y_bugs.md)
sleep 60

# 4. Agregar columnas
curl -sS -X POST \
  "https://console.catalyst.zoho.com/baas/v1/project/$PROJECT_ID/table/$TABLE_ID/column" \
  -H "Authorization: Zoho-oauthtoken $ACCESS" \
  -H "Environment: Development" \
  -H "Catalyst-org: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '[
    {"column_name":"name","data_type":"varchar","max_length":255,"is_mandatory":"true","is_unique":"false","search_index_enabled":"false","audit_consent":"false"},
    {"column_name":"email","data_type":"varchar","max_length":255,"is_mandatory":"true","is_unique":"true","search_index_enabled":"true","audit_consent":"false"},
    {"column_name":"phone","data_type":"varchar","max_length":50,"is_mandatory":"false","is_unique":"false","search_index_enabled":"false","audit_consent":"false"},
    {"column_name":"age","data_type":"int","is_mandatory":"false","is_unique":"false","search_index_enabled":"false","audit_consent":"false"},
    {"column_name":"is_active","data_type":"boolean","is_mandatory":"false","search_index_enabled":"false","audit_consent":"false"},
    {"column_name":"created_at","data_type":"datetime","is_mandatory":"true","search_index_enabled":"true","audit_consent":"false"}
  ]'
```

---

## Siguiente paso

→ [03_quirks_y_bugs.md](03_quirks_y_bugs.md) — **CRÍTICO**: eventual consistency + nombres envenenados.
