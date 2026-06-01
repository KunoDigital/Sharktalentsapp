#!/usr/bin/env python3
"""
Extrae un schema de tablas desde TypeScript y genera SCHEMA_MANIFEST.json.

Uso:
  ./extract-schema-from-typescript.py SOURCE.ts OUTPUT.json

Espera que el archivo TypeScript tenga una constante con esta estructura:

    const EXPECTED: ExpectedTable[] = [
      {
        name: 'Customers',
        columns: [
          { name: 'email', type: 'Var Char', mandatory: true, unique: true },
          { name: 'created_at', type: 'DateTime', mandatory: true },
        ],
      },
      // ...
    ];

Mapping de tipos default:
  Text → text             Boolean → boolean
  Var Char → varchar       DateTime → datetime
  Email → varchar          Date → date
  Integer / Int → int      Decimal → double
  BigInt → bigint

Modificá TYPE_MAP y INDEX_HINT si tus convenciones son distintas.
"""

import re
import json
import sys
from pathlib import Path

# Mapping de tipos TypeScript → tipos Catalyst API
TYPE_MAP = {
    'Text': 'text',
    'Var Char': 'varchar',
    'Email': 'varchar',
    'Integer': 'int',
    'Int': 'int',
    'BigInt': 'bigint',
    'Boolean': 'boolean',
    'DateTime': 'datetime',
    'Date': 'date',
    'Decimal': 'double',
}

# Columnas que casi siempre necesitan search_index_enabled
INDEX_HINT_NAMES = {
    'tenant_id', 'job_id', 'result_id', 'candidate_id', 'created_at',
    'email', 'slug', 'clerk_org_id', 'event_id', 'cache_key', 'token_hash',
    'key_hash', 'status', 'is_active',
}

# Constante a buscar (cambialo si tu schema tiene otro nombre)
SCHEMA_CONSTANT_NAME = 'EXPECTED'
TYPE_DECL_HINT = 'ExpectedTable[]'


def extract_array_text(src: str) -> str:
    """Extrae el cuerpo del array literal desde el archivo TS."""
    pattern = rf'const {SCHEMA_CONSTANT_NAME}: {re.escape(TYPE_DECL_HINT)} = (\[.+?\n\]);'
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        raise ValueError(f'No se encontró `const {SCHEMA_CONSTANT_NAME}: {TYPE_DECL_HINT} = [...];` en el source')
    return m.group(1)


def ts_to_json(arr_text: str) -> str:
    """Convierte literal de array TypeScript → JSON parseable."""
    # 1. Quitar comentarios
    arr_text = re.sub(r'//[^\n]*', '', arr_text)
    arr_text = re.sub(r'/\*.*?\*/', '', arr_text, flags=re.DOTALL)
    # 2. Single quotes → double quotes
    arr_text = arr_text.replace("'", '"')
    # 3. Trailing commas
    while True:
        new = re.sub(r',(\s*[\]}])', r'\1', arr_text)
        if new == arr_text:
            break
        arr_text = new
    # 4. Unquoted keys
    arr_text = re.sub(r'([{,\n]\s*)([a-zA-Z_$][\w$]*)\s*:', r'\1"\2":', arr_text)
    return arr_text


def map_column(c: dict) -> dict:
    """Mapea una column TypeScript a column Catalyst API."""
    raw_type = c['type']
    api_type = TYPE_MAP.get(raw_type, raw_type.lower())

    col = {
        'column_name': c['name'],
        'data_type': api_type,
        'is_mandatory': 'true' if c.get('mandatory') else 'false',
        'audit_consent': 'false',
    }

    if api_type in ('varchar', 'int', 'bigint', 'date', 'datetime', 'double', 'boolean'):
        col['is_unique'] = 'true' if c.get('unique') else 'false'
        col['search_index_enabled'] = (
            'true' if c.get('unique') or c['name'] in INDEX_HINT_NAMES else 'false'
        )

    if api_type == 'varchar':
        col['max_length'] = c.get('max_length', 255)

    return col


def main():
    if len(sys.argv) != 3:
        print(f'Uso: {sys.argv[0]} SOURCE.ts OUTPUT.json')
        sys.exit(1)

    src_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    src = src_path.read_text()
    arr_text = extract_array_text(src)
    arr_json = ts_to_json(arr_text)

    try:
        tables = json.loads(arr_json)
    except json.JSONDecodeError as e:
        print(f'ERROR parseando: {e}')
        # Mostrar contexto
        lines = arr_json.split('\n')
        if e.lineno <= len(lines):
            start = max(0, e.lineno - 3)
            for i, line in enumerate(lines[start:e.lineno + 2], start + 1):
                marker = ' >>>' if i == e.lineno else '    '
                print(f'{marker}{i}: {line}')
        sys.exit(1)

    manifest = {
        '_generated_at': '__AUTO__',
        '_source': str(src_path),
        '_catalyst_api': {
            'create_table_endpoint': 'POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table',
            'create_column_endpoint': 'POST https://console.catalyst.zoho.com/baas/v1/project/{projectId}/table/{id}/column',
            'scopes_required': [
                'ZohoCatalyst.tables.CREATE',
                'ZohoCatalyst.tables.columns.CREATE',
            ],
            'type_mapping_applied': TYPE_MAP,
            'notes': [
                'Eventual consistency 5-60s entre POST /table y poder POSTear /column',
                'Boolean fields van como STRING ("true"/"false")',
                'Si timeout, la tabla queda huérfana — borrar manual y reintentar',
                'Si un name queda envenenado, renombrar y actualizar referencias en código',
            ],
        },
        'tables': [
            {
                'name': t['name'],
                'table_scope': 'GLOBAL',
                'columns': [map_column(c) for c in t['columns']],
            }
            for t in tables
        ],
    }

    out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    total_cols = sum(len(t['columns']) for t in manifest['tables'])
    print(f'✓ Manifest generado: {len(manifest["tables"])} tablas, {total_cols} columnas → {out_path}')


if __name__ == '__main__':
    main()
