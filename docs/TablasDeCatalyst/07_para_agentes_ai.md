# 07 — Guía para agentes AI (Claude Code, etc.)

**Si sos un agente AI (Claude Code, otra IA), leé esto primero.**

Este doc te da el playbook condensado para ejecutar la creación de tablas vía API sin perder tiempo.

---

## Tu objetivo

El usuario te pidió crear tablas en Catalyst Datastore vía API (no manual). Tu camino es:

1. **Confirmar que tenés todo lo necesario** (sin pedirle al usuario más de lo que ya hizo)
2. **Generar el manifest JSON** desde el código existente (probablemente TypeScript con schema)
3. **Verificar dry-run** antes de ejecutar
4. **Ejecutar y manejar los quirks** sin abandonar al primer error

---

## Decision tree para vos

```
¿Tenés acceso al refresh_token de OAuth Zoho con scopes Catalyst?
│
├─ NO → Pedirle al usuario que genere el Self-Client (paso a paso de 01_setup_oauth.md)
│        ⚠️ Asegúrate de darle el comando curl EXACTO con sus values
│
└─ SÍ → Continuar

¿Tenés el manifest JSON del schema?
│
├─ NO, pero hay schema en TypeScript → Generar manifest desde TypeScript (ver Script abajo)
├─ NO, ni tampoco TS → Pedirle al usuario que defina las tablas que quiere
└─ SÍ → Continuar

¿Ya corriste dry-run?
│
├─ NO → Correr dry-run, mostrar resumen al usuario
└─ SÍ y todo OK → Ejecutar batch con --execute

¿Alguna tabla falló?
│
├─ INVALID_ID después de retries → orphan → pedile al usuario que la borre + reintentá
├─ DUPLICATE_ENTRY persistente → nombre envenenado → renombrar en código + manifest
└─ Otro error → ver 06_troubleshooting.md
```

---

## Lo que NO debés hacer

❌ **NO ejecutes el script sin dry-run primero.** Va a crear tablas reales en Catalyst.

❌ **NO pidas permiso al usuario** entre cada tabla del batch. Es muy molesto. Hacé el batch entero después del primer go.

❌ **NO le digas al usuario "esperá 60 segundos"** cada vez — el script lo hace solo.

❌ **NO intentes borrar tablas huérfanas vía API** sin tener scope DELETE explícito. **El delete es destructivo** y debe hacerlo el usuario en UI Console o con confirmación explícita.

❌ **NO inventes scopes.** Si te falta uno, pedile al usuario que genere un code nuevo con scopes correctos.

❌ **NO commitees credentials al repo.** Refresh tokens, client secrets, etc. van SOLO en env vars locales o Catalyst Console.

---

## Comandos que vos podés ejecutar

### Generar manifest desde TypeScript (Python)

```bash
cd /path/to/project
python3 << 'PYEOF'
import re, json
from pathlib import Path

src = Path('functions/api/src/features/admin.ts').read_text()
m = re.search(r'const EXPECTED: ExpectedTable\[\] = (\[.+?\n\]);', src, re.DOTALL)
arr_text = m.group(1)
arr_text = re.sub(r'//[^\n]*', '', arr_text)
arr_text = re.sub(r'/\*.*?\*/', '', arr_text, flags=re.DOTALL)
arr_text = arr_text.replace("'", '"')
while True:
    new = re.sub(r',(\s*[\]}])', r'\1', arr_text)
    if new == arr_text: break
    arr_text = new
arr_text = re.sub(r'([{,\n]\s*)([a-zA-Z_$][\w$]*)\s*:', r'\1"\2":', arr_text)
tables = json.loads(arr_text)

TYPE_MAP = {'Text': 'text', 'Var Char': 'varchar', 'Email': 'varchar', 'Integer': 'int', 'Int': 'int', 'BigInt': 'bigint', 'Boolean': 'boolean', 'DateTime': 'datetime', 'Date': 'date', 'Decimal': 'double'}
INDEX_HINT = {'tenant_id', 'job_id', 'result_id', 'candidate_id', 'created_at', 'email', 'slug', 'clerk_org_id'}

def map_col(c):
    t = TYPE_MAP.get(c['type'], c['type'].lower())
    col = {'column_name': c['name'], 'data_type': t, 'is_mandatory': 'true' if c.get('mandatory') else 'false', 'audit_consent': 'false'}
    if t in ('varchar', 'int', 'bigint', 'date', 'datetime', 'double', 'boolean'):
        col['is_unique'] = 'true' if c.get('unique') else 'false'
        col['search_index_enabled'] = 'true' if c.get('unique') or c['name'] in INDEX_HINT else 'false'
    if t == 'varchar': col['max_length'] = 255
    return col

manifest = {
    '_generated_at': 'auto',
    '_source': 'admin.ts EXPECTED',
    'tables': [{'name': t['name'], 'table_scope': 'GLOBAL', 'columns': [map_col(c) for c in t['columns']]} for t in tables],
}
Path('docs/SCHEMA_MANIFEST.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
print(f'Wrote {len(tables)} tables, {sum(len(t["columns"]) for t in tables)} columns')
PYEOF
```

Adaptá el TYPE_MAP a las convenciones del proyecto.

### Dry-run

```bash
export CATALYST_PROJECT_ID=...
export CATALYST_ORG_ID=...
export CATALYST_OAUTH_CLIENT_ID=...
export CATALYST_OAUTH_CLIENT_SECRET=...
export CATALYST_OAUTH_REFRESH_TOKEN=...

npx tsx scripts/create-catalyst-tables.ts
```

### Ejecutar UNA tabla (test)

```bash
npx tsx scripts/create-catalyst-tables.ts --only=NombreTabla --execute
```

### Ejecutar batch completo

```bash
npx tsx scripts/create-catalyst-tables.ts --execute
```

### Para tabla problemática (stubborn poll)

```bash
npx tsx scripts/create-stubborn-table.ts NombreTabla
```

---

## Manejo de quirks (qué hacer cuando)

### Si el script reporta "table already exists" para X tablas

Pasalas al usuario como "ya existían":

```
✅ Creadas: 3
ℹ️ Ya existían (skipped): 16
```

Esto NO es error. Es esperado en proyectos que mezclan tablas viejas (creadas manualmente antes) con nuevas.

### Si una tabla falla con INVALID_ID después de retries

1. Decirle al usuario: "La tabla X quedó huérfana en Catalyst. Necesito que la borres manualmente desde Catalyst Console → Data Store → X → Delete. Después decime 'listo' y reintento."
2. Esperar confirmación
3. Reintentar con `--only=X --execute`

### Si una tabla falla 2+ veces con el mismo nombre

Es un nombre envenenado. Decirle al usuario:

"El nombre `X` parece estar envenenado en Catalyst. Te sugiero renombrarla a `Y` (más corto/distinto). Voy a actualizar todas las referencias en el código: admin.ts (schema), features/x.ts (queries), manifest. ¿Confirmás el rename?"

Después del OK:
1. Actualizar TODAS las referencias en código
2. Regenerar manifest
3. Reintentar

### Si el manifest tiene tipos incompatibles

Si tu TYPE_MAP no cubre un tipo del schema TypeScript, el script puede fallar. Agregalo al TYPE_MAP o pedile al usuario que aclare cómo mapear.

---

## Cómo presentar resultados al usuario

Después de cada batch, presentale un resumen claro:

```
📊 Resultado:

✅ 7 tablas nuevas creadas:
   - EnglishTestSessions (18 columnas)
   - JobTrackingSnapshots (8)
   - TokenUsage (10)
   - ...

⚠️ 3 tablas fallaron (huérfanas para borrar):
   - MindsetScores (table_id 28606000000779004)
   - PrefilterQuestions (table_id ...)

ℹ️ 16 tablas ya existían (skipped):
   - Tenants, Jobs, Candidates, Results, ...

Próximo paso: borrá las 3 huérfanas en Catalyst Console → Data Store, después decime "listo" y reintento.
```

---

## Memoria/contexto para futuras sesiones

Si vas a guardar memoria del trabajo:

✅ Guardar:
- Que se usó OAuth Self-Client (con qué scopes)
- Quirks descubiertos (eventual consistency, naming, etc.)
- Tablas que se envenenaron y se renombraron (mapping viejo→nuevo)

❌ NO guardar:
- Refresh tokens, client secrets (sensibles)
- IDs de tablas (efímeros, cambian si recreás)

---

## Referencias

- [01_setup_oauth.md](01_setup_oauth.md) — setup OAuth
- [02_endpoints_y_tipos.md](02_endpoints_y_tipos.md) — endpoints + tipos
- [03_quirks_y_bugs.md](03_quirks_y_bugs.md) — quirks
- [04_manifest_json.md](04_manifest_json.md) — manifest structure
- [05_script_paso_a_paso.md](05_script_paso_a_paso.md) — script usage
- [06_troubleshooting.md](06_troubleshooting.md) — errores
- [templates/](templates/) — scripts y ejemplos
