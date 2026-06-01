# 04 — Estructura del Schema Manifest JSON

**Objetivo:** armar un archivo JSON con tu schema completo que el script va a consumir.

---

## Estructura

```json
{
  "_generated_at": "2026-05-11",
  "_source": "extraído de functions/api/src/features/admin.ts",
  "_catalyst_api": {
    "create_table_endpoint": "POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table",
    "create_column_endpoint": "POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table/{id}/column",
    "scopes_required": ["ZohoCatalyst.tables.CREATE", "ZohoCatalyst.tables.columns.CREATE"]
  },
  "tables": [
    {
      "name": "Candidates",
      "table_scope": "GLOBAL",
      "columns": [
        {
          "column_name": "name",
          "data_type": "varchar",
          "is_mandatory": "true",
          "is_unique": "false",
          "search_index_enabled": "false",
          "audit_consent": "false",
          "max_length": 255
        },
        {
          "column_name": "email",
          "data_type": "varchar",
          "is_mandatory": "true",
          "is_unique": "true",
          "search_index_enabled": "true",
          "audit_consent": "false",
          "max_length": 255
        }
      ]
    }
  ]
}
```

---

## Reglas del manifest

### Nivel raíz

| Field | Tipo | Para qué |
|---|---|---|
| `_generated_at` | string | Cuándo se generó (auto) |
| `_source` | string | Qué archivo se usó como fuente (auto) |
| `_catalyst_api` | object | Doc para humanos (opcional) |
| `tables` | array | Lista de tablas a crear |

### Por tabla

| Field | Requerido | Valores |
|---|---|---|
| `name` | ✅ | string PascalCase o snake_case sin guiones |
| `table_scope` | ✅ | `GLOBAL`, `ORG`, o `USER` (default `GLOBAL`) |
| `columns` | ✅ | array de objetos column |

### Por columna

| Field | Requerido | Tipo | Notas |
|---|---|---|---|
| `column_name` | ✅ | string snake_case | Sin reserved words SQL |
| `data_type` | ✅ | string | `text`, `varchar`, `int`, `bigint`, `double`, `boolean`, `date`, `datetime`, `encrypted text`, `foreign key` |
| `is_mandatory` | ✅ | string `"true"`/`"false"` | NOTA: STRING no boolean |
| `audit_consent` | ✅ | string `"true"`/`"false"` | Default `"false"` |
| `is_unique` | condicional | string | Req. para varchar/int/bigint/date/datetime/double/boolean |
| `search_index_enabled` | condicional | string | Req. para varchar/int/bigint/date/datetime/double/boolean |
| `max_length` | condicional | int | Req. para varchar (≤255) |
| `decimal_digits` | opcional | int | Solo para double |
| `default_value` | opcional | string | Default cuando se inserta sin valor |
| `description` | opcional | string | Documentación (aparece en UI Console) |
| `parent_table` | foreign key | string | Tabla a la que apunta el FK |
| `parent_column` | foreign key | string | Columna en la tabla padre |
| `constraint_type` | foreign key | string | `ON-DELETE-SET-NULL` o `ON-DELETE-CASCADE` |

---

## Cómo generar el manifest

### Opción A: A mano

Si tu schema es chico (≤5 tablas), escribilo a mano siguiendo la estructura de arriba. Mirá [templates/example-manifest.json](templates/example-manifest.json) como referencia.

### Opción B: Desde TypeScript (recomendado para schema grande)

Si tu backend TypeScript ya tiene los schemas como constants (ej. para `verifyTables` o setup wizards), generá el manifest automáticamente. Ejemplo del caso SharkTalents:

```typescript
// functions/api/src/features/admin.ts
const EXPECTED: ExpectedTable[] = [
  {
    name: 'Candidates',
    columns: [
      { name: 'name', type: 'Var Char', mandatory: true },
      { name: 'email', type: 'Email', mandatory: true, unique: true },
      // ...
    ],
  },
  // ...
];
```

Y un script Python que extrae:

```python
# scripts/extract-schema-to-manifest.py
import re, json
from pathlib import Path

src = Path('functions/api/src/features/admin.ts').read_text()
m = re.search(r'const EXPECTED: ExpectedTable\[\] = (\[.+?\n\]);', src, re.DOTALL)
arr_text = m.group(1)
# Strip comments + single→double quotes + trailing commas + quote keys
arr_text = re.sub(r'//[^\n]*', '', arr_text)
arr_text = re.sub(r'/\*.*?\*/', '', arr_text, flags=re.DOTALL)
arr_text = arr_text.replace("'", '"')
while True:
    new = re.sub(r',(\s*[\]}])', r'\1', arr_text)
    if new == arr_text: break
    arr_text = new
arr_text = re.sub(r'([{,\n]\s*)([a-zA-Z_$][\w$]*)\s*:', r'\1"\2":', arr_text)
tables = json.loads(arr_text)

TYPE_MAP = {
  'Text': 'text', 'Var Char': 'varchar', 'Email': 'varchar',
  'Integer': 'int', 'Int': 'int', 'BigInt': 'bigint',
  'Boolean': 'boolean', 'DateTime': 'datetime', 'Date': 'date',
  'Decimal': 'double',
}
INDEX_HINT = {'tenant_id', 'job_id', 'result_id', 'candidate_id', 'created_at', 'email', 'slug'}

def map_column(c):
    t = TYPE_MAP.get(c['type'], c['type'].lower())
    col = {
        'column_name': c['name'],
        'data_type': t,
        'is_mandatory': 'true' if c.get('mandatory') else 'false',
        'audit_consent': 'false',
    }
    if t in ('varchar', 'int', 'bigint', 'date', 'datetime', 'double', 'boolean'):
        col['is_unique'] = 'true' if c.get('unique') else 'false'
        col['search_index_enabled'] = 'true' if c.get('unique') or c['name'] in INDEX_HINT else 'false'
    if t == 'varchar':
        col['max_length'] = 255
    return col

manifest = {
    '_generated_at': '2026-05-11',
    '_source': 'admin.ts EXPECTED',
    'tables': [
        {'name': t['name'], 'table_scope': 'GLOBAL', 'columns': [map_column(c) for c in t['columns']]}
        for t in tables
    ],
}
Path('docs/SCHEMA_MANIFEST.json').write_text(json.dumps(manifest, indent=2))
print(f'Wrote {len(tables)} tables')
```

Adaptá el TYPE_MAP a tus convenciones.

### Opción C: Desde SQL DDL

Si tu schema vive como SQL `CREATE TABLE ...`, podés parsearlo con `sqlparse` (Python) o `node-sql-parser` (Node) y generar el manifest.

---

## Recomendaciones de naming

### Columnas comunes que suelen necesitar `search_index_enabled: "true"`

- `tenant_id` — para multi-tenancy queries
- `job_id`, `candidate_id`, `result_id` — foreign keys
- `email` — para lookups
- `created_at`, `updated_at` — para ordering
- `status` — para filtering
- `slug`, `cache_key`, `token_hash` — para lookups únicos
- `is_active` — para filtering

### Convenciones recomendadas

- Nombres de tabla: **PascalCase plural** — `Candidates`, `Jobs`, `MarketingLeads`
- Nombres de columna: **snake_case** — `created_at`, `tenant_id`, `is_active`
- FK: nombre de la tabla padre en snake_case + `_id` — `job_id`, `candidate_id`
- Booleans: prefijo `is_` o `has_` — `is_active`, `has_signed`

---

## Validación del manifest antes de correr

Antes de hacer `--execute`, validá que el manifest sea correcto:

```bash
# Verificar que es JSON válido
python3 -m json.tool docs/SCHEMA_MANIFEST.json > /dev/null && echo "OK"

# Contar tablas + columnas
python3 -c "
import json
m = json.load(open('docs/SCHEMA_MANIFEST.json'))
print(f'Tables: {len(m[\"tables\"])}')
print(f'Total columns: {sum(len(t[\"columns\"]) for t in m[\"tables\"])}')
for t in m['tables']:
    print(f'  {t[\"name\"]}: {len(t[\"columns\"])} cols')
"
```

---

## Siguiente paso

→ [05_script_paso_a_paso.md](05_script_paso_a_paso.md) — cómo correr el script principal.
