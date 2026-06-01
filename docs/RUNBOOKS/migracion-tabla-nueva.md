# Runbook — Crear una tabla nueva en Catalyst

## Cuándo

- Cris quiere activar una feature deferred (Block 2) que requiere su tabla.
- Endpoints muestran 503 con `code: 'table_not_ready'` y mensaje `"La tabla X no fue creada"`.
- `verifyTables` o `check-ideal-profile-column.sh` flagean missing.

## Pasos generales

### 1. Identificar qué tabla(s) crear

Consultar:
- Memoria: `project_tablas_pendientes_v2.md` tiene la lista actualizada.
- Doc del schema: `docs/master-plan/MIGRATIONS_BLOCK1.md` o `MIGRATIONS_BLOCK2.md`.
- Endpoint que falló: el mensaje 503 dice exactamente qué tabla y dónde está documentada.

### 2. Crear en Catalyst Console

```
Catalyst Console → Cloud Scale → Data Store → + Create Table
```

Para cada tabla del doc:

1. Click "Create Table".
2. Name: el `Table name` exacto del doc (ej: `JobProfileDrafts`, case-sensitive).
3. Click "Add Column" para cada columna del doc:
   - **Name:** copy-paste exacto del doc.
   - **Data Type:** según doc (`Var Char` para strings cortos, `Text` para largos, `Int`,
     `Boolean`, `DateTime`).
   - **Length:** solo para `Var Char` y `Text`. Si el doc dice "8000" y Catalyst no permite,
     usar `Text` en lugar de `Var Char`.
   - **Mandatory:** marcar Sí/No según doc.
   - **Unique:** marcar Sí/No según doc.
   - **Default:** si el doc tiene un default, ponerlo.
4. Click "Save column" después de cada una.
5. Una vez todas las columnas, click "Create Table".

**Tip:** Catalyst NO soporta `Email` ni `Phone` types — usar `Var Char`. NO crear ROWID,
CREATEDTIME, MODIFIEDTIME, CREATORID — los crea Catalyst solo.

### 3. Verificar

```bash
# Re-correr verify
./scripts/verify-tables.sh

# O para una tabla específica:
curl -H "X-Internal-Key: $INTERNAL_API_KEY" \
  $URL/admin/verify-tables | jq '.tables[] | select(.name == "<TABLA>")'
```

Output esperado: `exists: true, missing_columns: []`.

### 4. Probar el endpoint que estaba en 503

Ahora debería funcionar. Si todavía falla:
- Verificar nombre exacto de columna (case-sensitive en algunos casos).
- Verificar que el tipo en Catalyst sea compatible (Boolean, no Text con "true"/"false").
- Re-deploy backend si hizo falta cambiar config.

### 5. Actualizar memoria

Después de crear, editar `project_tablas_pendientes_v2.md` y borrar la entrada de la
tabla creada (o mover a sección "ya creadas").

## Errores comunes

**"Column type not supported":** Catalyst no acepta `Email`, `Phone`, `Decimal` en algunas
versiones. Usar `Var Char` para email/phone, `Int` (multiplicado por 100 para 2 decimales)
para Decimal.

**"Table already exists":** alguien la creó antes (o vos la abandonaste a medias). Click en
la tabla → ver columnas existentes → agregar las que falten con "Add Column".

**Length 4000 max:** algunas instances de Catalyst tienen `Var Char` limitado a 4000. Si
el doc pide 5000+, usar `Text`.

## Si la tabla la creás y el endpoint sigue 503

El backend cachea el check de "tabla existe" en memoria. Re-deploy de la function fuerza
re-check:

```bash
./scripts/deploy-backend.sh dev
```

O esperar el siguiente cold-start de la function (después de ~15 min sin tráfico).
