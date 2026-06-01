# Cambios al schema durante la migración Block 1

Bitácora de **mejoras y correcciones** que hicimos al CSV original mientras Cris creaba las tablas en consola. Cuando aparezca un cambio acá:

- Si Cris **todavía no creó la columna** → aplicar el nuevo valor.
- Si Cris **ya la creó con el valor viejo** → ver columna "Acción" para saber si conviene editarla en consola o dejarla como está.

---

## 2026-04-30

### 1. Tipos de Catalyst — mapeo correcto

**Por qué:** El CSV inicial usaba nombres de tipos genéricos (`Text`, `Integer`, `Email`, `Phone`) que no existen en Catalyst.

| CSV viejo | Catalyst real |
|---|---|
| `Text` con largo ≤ 255 | `Var Char` con ese largo |
| `Text` con largo > 255 | `Text` (sin largo) |
| `Email` | `Var Char` (255 inicialmente, luego 320) |
| `Phone` | `Var Char` (30 inicialmente, luego 50) |
| `Integer` | `Int` |

**Acción:** ya aplicado en el CSV. Si llegaste a crear alguna columna con tipo equivocado, editarla en consola al tipo correcto.

---

### 2. VarChar máximo es 255, no 4000

**Por qué:** Asumí que VarChar de Catalyst llegaba hasta 4000. La consola rechazó el primer intento con `features_enabled` (2000). Real: max VarChar = 255.

**Columnas afectadas:**

| Tabla | Columna | Antes | Ahora |
|---|---|---|---|
| Tenants | features_enabled | Var Char 2000 | **Text** (sin largo) |
| Tenants | branding_config | Var Char 2000 | **Text** (sin largo) |
| AuditLog | user_agent | Var Char 300 | **Text** |
| OutboxEvents | last_error | Var Char 500 | **Text** |

**Acción:** ya aplicado en el CSV. Tenants se creó OK con los valores corregidos. AuditLog y OutboxEvents todavía no se crean al momento de este registro.

---

### 3. Phone bump: 30 → 50

**Por qué:** Cris recluta en Panamá, Ecuador y Colombia. Quiso confirmar que 30 caracteres alcanzan para todos los formatos.

**Análisis:**
- Estándar E.164 internacional: máximo 16 caracteres con todo (`+593 99 999 9999`).
- 30 alcanza con sobra incluso con extensiones (`ext 1234`).
- 50 da margen extra para formatos con texto adicional o notas, sin costo.

**Columnas afectadas:**

| Tabla | Columna | Antes | Ahora |
|---|---|---|---|
| Candidates | phone | Var Char 30 | **Var Char 50** |

**Acción:** ya aplicado en CSV. Candidates se creó con 30 antes del cambio. **No es necesario editar** — 30 es suficiente para 99.99% de casos. El bump es solo margen.

---

### 5. Consolidación de 5 tablas de scores en 1 sola `Scores`

**Por qué:** Cris detectó que el CSV tenía 5 tablas separadas (DiscScores, CognitiveScores, EmotionalScores, IntegrityScores, TechnicalScores) cuando el master plan doc 03 explícitamente dice "7 score tables → 2". Mi error: seguí el detalle de cada score sin chequear la decisión global.

**Análisis:**
- 5 tablas separadas = 5 JOINs para ver el perfil completo, más complejo de razonar y debuggear
- 1 tabla consolidada = todos los scores del candidato en una sola row, simple para auditar en Catalyst Console
- IntegrityDimensions queda separada porque tiene 15 rows por candidato (no caben en 1 row)

**Decisión:** consolidar en una sola tabla `Scores` con 33 columnas (prefijos `disc_`, `velna_`, `emo_`, `tec_`, `int_` para cada bloque). Total Block 1 baja de 14 → 10 tablas.

**Schema final `Scores`:**
- `result_id` (FK unique 1:1 con Results)
- `disc_*` (10 columnas: raw + normalized + perfil_dominante + pk_id)
- `velna_*` (8 columnas: 5 sub-tests + total + max + indice)
- `emo_*` (2 columnas: score + perfil)
- `tec_*` (4 columnas: score_pct + total_correct + total_questions + passed)
- `int_*` (5 columnas: overall + overall_pct + recomendacion + buena_impresion + buena_impresion_pct)
- `*_completed_at` (5 columnas: timestamp por bloque, para tracking de cuándo se completó cada fase)

**Acción:** las 5 tablas viejas se SALTARON en la creación. Cris crea una sola tabla `Scores`. Total Block 1 = 10 tablas.

---

### 4. Email: se queda en 255 (intentamos 320, Catalyst no lo permite)

**Por qué:** Cris preguntó si emails pueden ser muy largos. Inicialmente bumpeé a 320 (RFC 5321 max), pero Catalyst rechaza VarChar > 255 (mismo límite que ya conocíamos por `features_enabled`).

**Análisis final:**
- Catalyst VarChar max = 255 (límite duro)
- 255 es el estándar de la industria y cubre 99.99% de los emails reales
- Si en algún momento aparece un email > 255 (ultra raro), tu código lo va a rechazar antes de llegar a la BD — perfectamente aceptable

**Conclusión:** se queda en `Var Char 255`. Si en el futuro necesitás soportar emails extremos, habría que cambiar el tipo a `Text`, perdiendo indexación rápida de búsqueda.

**Acción:** Candidates ya está OK con 255.

---

## Cómo agregar un cambio nuevo a esta bitácora

Cada vez que aparece un ajuste al schema durante la migración:

1. **Editá el CSV** (`docs/master-plan/MIGRATIONS_BLOCK1.csv`) con el valor nuevo.
2. **Agregá una entrada acá** con:
   - Fecha
   - Por qué (la causa, no solo el "qué")
   - Tabla y columna afectada
   - Antes / Ahora
   - Acción que tomar si la columna ya se creó con el valor viejo
3. Si el cambio rompe algo del backend (ej: el verifier en `functions/api/src/features/admin.ts`), actualizar también ese archivo.
