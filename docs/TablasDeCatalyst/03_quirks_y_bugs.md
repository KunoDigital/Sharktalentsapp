# 03 — Quirks y bugs de Catalyst Schema API

**Objetivo:** prepararte para los 4 comportamientos no documentados de Catalyst que te van a hacer perder tiempo si no los conocés.

Estos están escritos con sangre — descubiertos en producción real durante el proyecto SharkTalents.

---

## 🔴 Quirk 1: Eventual consistency 5-60 segundos

### El problema

Catalyst API responde **inmediatamente** con `status: success` y un `table_id` cuando creás una tabla. Pero el `table_id` **NO está propagado todavía** en el índice del endpoint de columnas.

Si intentás agregar columnas inmediatamente:

```
POST /table/{tableId}/column
→ 404 {"status":"failure","data":{"message":"No such Table with the given id exists","error_code":"INVALID_ID"}}
```

Aunque la tabla SÍ aparece en la UI de Catalyst Console.

### El tiempo real

| Tiempo después de crear | Probabilidad de éxito |
|---|---|
| 1 segundo | ~10% |
| 5 segundos | ~50% |
| 15 segundos | ~75% |
| 30 segundos | ~90% |
| **60 segundos** | **~98%** |
| 90 segundos | ~99% |

### La solución

**Esperar SIEMPRE mínimo 60 segundos** entre `POST /table` y `POST /table/{id}/column`.

```javascript
const createRes = await fetch('/baas/v1/project/X/table', { ... });
const { table_id } = createRes.data;

// ⚠️ ESPERA OBLIGATORIA
await new Promise(r => setTimeout(r, 60_000));

// Ahora sí, columnas
const colRes = await fetch(`/baas/v1/project/X/table/${table_id}/column`, { ... });
```

**Si el primer intento falla, reintentar con backoff:**

```javascript
for (let attempt = 1; attempt <= 4; attempt++) {
  const delay = attempt === 1 ? 60_000 : 30_000;
  await new Promise(r => setTimeout(r, delay));
  const result = await tryAddColumns(table_id);
  if (result.success) break;
}
```

---

## 🔴 Quirk 2: Tablas huérfanas (nombres envenenados)

### El problema

Si una tabla se crea pero las columnas no se pegan dentro del tiempo de consistencia (~5 min), Catalyst la marca como "huérfana":

- ✅ Aparece en la UI de Catalyst Console (con 0 columnas)
- ❌ El `table_id` queda **permanentemente roto** — devuelve `INVALID_ID` para siempre
- ❌ El **nombre queda reservado** — intentar crear otra tabla con el mismo nombre devuelve `DUPLICATE_ENTRY`

**Es un estado zombie:** la tabla existe pero no es queryable, y no podés crear una nueva con ese nombre.

### Caso real (SharkTalents 2026-05-11)

Intenté crear `PrefilterQuestions` 5 veces:
- Intento 1: timeout, quedó huérfana
- Intento 2 (después de borrar la huérfana manualmente): timeout, otra huérfana
- Intentos 3-5: idem

**El nombre `PrefilterQuestions` quedó "envenenado"** — incluso con 5 minutos de polling, Catalyst seguía rechazando esa combinación de nombre.

### La solución

**Si un nombre se envenena, renombralo en tu código.** Cambié `PrefilterQuestions` → `PrefQuestions` y funcionó al primer intento.

```typescript
// admin.ts antes
const TABLE_QUESTIONS = 'PrefilterQuestions';

// admin.ts después
const TABLE_QUESTIONS = 'PrefQuestions';
```

También actualizar todas las referencias en:
- Schema constants
- Queries ZCQL hardcoded
- Migration manifests
- Docs

### Cómo evitar el problema en primer lugar

1. **Esperar 60s** entre create y columns (Quirk 1)
2. **Usar el script con polling** (`templates/create-stubborn-table.ts`) que polea cada 15s hasta 5 min antes de dar up
3. **Si el script falla**, borrar la tabla huérfana **inmediatamente** desde UI Console — no la dejes ahí
4. **Si después de borrar sigue fallando con el mismo nombre**, renombrar

---

## 🔴 Quirk 3: Boolean fields como strings

### El problema

En la docu de Catalyst dice "boolean fields: `is_mandatory`, `is_unique`, etc." y uno asumiría que se mandan como booleans:

```json
{"column_name": "email", "is_mandatory": true}
```

**Esto falla con `400 Bad Request`.** Catalyst quiere strings:

```json
{"column_name": "email", "is_mandatory": "true"}
```

### Por qué

No se sabe. Probablemente quedó así por compatibilidad legacy con SOAP/XML donde todo es string.

### La solución

Al generar el JSON del request, convertí explícitamente:

```javascript
{
  column_name: c.name,
  data_type: c.type,
  is_mandatory: c.mandatory ? 'true' : 'false',  // STRING
  is_unique: c.unique ? 'true' : 'false',
  search_index_enabled: c.indexed ? 'true' : 'false',
  audit_consent: 'false',
}
```

Esto aplica a los 4 campos boolean del request:
- `is_mandatory`
- `is_unique`
- `search_index_enabled`
- `audit_consent`

---

## 🔴 Quirk 4: Restricciones de naming

### Folders del File Store

**Los nombres NO pueden tener guiones ni espacios.**

❌ `candidate-videos` → rechazado
✅ `candidatevideos` → OK
✅ `englishlistening` → OK

(Catalyst File Store es el storage de blobs separado del Datastore — pero la regla es la misma.)

### Tablas

Las tablas SÍ permiten:
- ✅ PascalCase: `MarketingLeads`, `JobOpenings`
- ✅ Underscores: `marketing_leads`, `job_openings`
- ❌ Guiones: `marketing-leads` (lo rechaza)

### Columnas

- ✅ snake_case: `email_address`, `created_at`
- ❌ camelCase: `emailAddress` (técnicamente permite pero rompe ZCQL queries — siempre `snake_case`)
- ❌ Reserved keywords de SQL: `type`, `order`, `from`, etc. (a veces los acepta pero después no podés filtrar en ZCQL)

### Env vars con prefijo CATALYST_

Cuando setás env vars en Catalyst Console → Functions → Environment Variables, **NO podés usar nombres que empiecen con `CATALYST_`** — Catalyst los reserva.

❌ `CATALYST_VIDEO_FOLDER_ID` → rechazado
✅ `FILESTORE_VIDEO_FOLDER_ID` → OK

---

## ⚠️ Lecciones generales

1. **Confiar en la docu pero verificar.** Catalyst docs no documentan los quirks. Lo que descubrís en producción es lo que vale.

2. **Siempre dry-run primero.** Antes de `--execute`, mostrá lo que el script haría. Te ahorra crear huérfanas.

3. **Borrar huérfanas inmediatamente.** Si una tabla falla, no la dejes en estado zombie — la borrás de UI Console antes del siguiente intento.

4. **Renombrar > debuggear nombres envenenados.** Pelearte con un nombre rechazado puede llevar horas. Cambiá el nombre y seguí.

5. **Mantener un manifest JSON sincronizado con tu código.** Si tu schema vive en un lugar (TypeScript), el manifest se genera de ahí. Sin sincronía, las tablas en Catalyst divergen del modelo del código.

6. **Logear todo.** Cuando crees una huérfana, vas a querer saber `table_id` para reintentar. Loguealo.

---

## Siguiente paso

→ [04_manifest_json.md](04_manifest_json.md) — cómo armar el JSON manifest de tu schema.
