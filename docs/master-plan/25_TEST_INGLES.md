# 25 — Test de inglés (opcional por puesto)

**Estado:** Diseño cerrado. Banco de preguntas en curso. NO implementado todavía.

**Última actualización:** 2026-05-05

## Objetivo

Filtrar candidatos según el nivel de inglés que el cliente realmente requiere para el puesto. Los puestos NO requieren inglés por defecto — el cliente lo habilita en JobForm cuando aplica.

## Por qué existe

Cris reporta que los candidatos dicen saber inglés en su CV pero en la entrevista con el cliente no pueden hablar. Necesita un filtro previo, calibrado al nivel exacto que el cliente pidió.

## Diseño

### Niveles ofrecidos al cliente

UI muestra descripciones operacionales, no jerga CEFR:

| UX label | CEFR interno | Threshold pase |
|---|---|---|
| Comunicación básica — entiende y se hace entender | A2 | 60% |
| Profesional intermedio — sostiene reuniones simples | B1 | 65% |
| Profesional fluido — maneja discusiones complejas | B2 | 70% |
| Avanzado — negocia, presenta, escribe formal | C1 | 75% |

### Estructura del bloque (orden secuencial)

```
1. 18 preguntas multiple-choice (vocab + grammar + reading)  ~9 min
2. 1 audio del nivel + 2 preguntas sobre el audio            ~3 min
3. 1 prompt de writing (texto del candidato + IA analiza)    ~7-10 min
4. Si pasa los 3 → video 60 seg speaking                     ~2 min
   Si no pasa → fin del bloque (silencioso, sigue resto del test)
```

**Tiempo total:** ~20 minutos.

### Score final = ponderado de los 3 primeros bloques

| Bloque | Peso | Threshold por nivel |
|---|---|---|
| Multiple-choice | 50% | 60/65/70/75% |
| Listening | 25% | mismo |
| Writing (IA) | 25% | mismo |
| **Score total ponderado** | 100% | **mismo umbral aplicado al total** |

Si el total ≥ threshold del nivel pedido → pasa al video.

### Posicionamiento en el flow del candidato

Va **después de la prueba técnica** (si está habilitada) y **antes de los videos abiertos**. Si el puesto no requiere inglés, el bloque se salta entero.

```
1. Datos básicos
2. DISC
3. Sección 2 (test de mentalidades, ver doc 26)
4. VELNA cognitivo
5. Integridad
6. Emocional
7. Técnica (si requerida)
8. INGLÉS (si requerido)              ← ESTE DOC
9. Videos abiertos
```

### Banco de preguntas

**Curado a mano, $0 IA recurrente:**
- 40 preguntas multiple-choice por nivel × 4 niveles = 160 preguntas en repo
- Cada candidato ve 20 al azar del banco de su nivel
- Distribución por banco: 40% vocab + 40% grammar + 20% reading
- Listening: 1 audio + 2 preguntas por nivel = 8 preguntas total
- Writing: 1 prompt por nivel (4 prompts totales)

**Ubicación de assets:**
- Multiple-choice + writing prompts: `shark/src/data/questions/english-{level}.json`
- Audios MP3: Catalyst File Store, folder `english-listening`
  - Generados con script `scripts/generate-english-audios.sh` (ElevenLabs API)

### Writing prompts (1 por nivel)

- **A2** (50 palabras, 5 min): "Describe what you did last weekend..."
- **B1** (100 palabras, 8 min): "Tell us about a job you would like to have..."
- **B2** (150 palabras, 10 min): "Some companies allow employees to work fully remote..."
- **C1** (200 palabras, 15 min): "Describe a recent professional or academic challenge..."

Texto completo: ver `docs/MEJORAS.md` sección 1.

### Análisis IA del writing

**Costo:** ~$0.05 USD por candidato que llegue al writing (1 llamada Claude Haiku 4.5).

**Implementación:** [functions/api/src/lib/englishWritingPrompts.ts](../../functions/api/src/lib/englishWritingPrompts.ts).

**Output esperado:** JSON estructurado con `score_pct`, `level_achieved`, `dimensions` (grammar, vocabulary, coherence, task_completion), `strengths`, `areas_for_improvement`, `evidence_quotes`, `suspicious_patterns`.

### Anti-cheat (writing)

Frontend (al codear el componente):
- `onPaste`, `onCopy`, `onContextMenu` deshabilitados con preventDefault
- Tracking: keystroke count vs word count, focus loss, tab visibility (`document.visibilityState`)
- Eventos sospechosos persistidos en tabla `AntiCheatEvents` (existente)

Backend:
- IA detecta si el estilo es "demasiado alto" para el nivel declarado → flag
- Cris ve los flags en el reporte del candidato

**Realidad:** detenemos cheaters casuales (95%), no determinados. Los determinados quedan flagueados.

### Output al candidato

**Silencio total durante el test.** El candidato no sabe el resultado en el momento. Cris recibe el resultado en el reporte y decide rechazar/avanzar. Si falla pero tiene potencial alto en otras dimensiones, Cris consulta al cliente manualmente.

## Implementación pendiente

### Schema (Catalyst Datastore)

**Tabla nueva: `EnglishTestSessions`** (18 columnas)

Schema completo: ver `docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv`.

**Columnas adicionales en `Jobs`:**
- `english_required` (Boolean, default false)
- `english_min_level` (Var Char A2/B1/B2/C1)

Schema en `docs/master-plan/MIGRATIONS_AGREGAR_COLUMNAS.csv`.

### Backend (functions/api/src/)

- `features/englishTest.ts` — endpoints de test (start, submit answers, submit writing, etc.)
- `lib/englishWritingPrompts.ts` — ya creado (4 prompts CEFR + scoring rubric)
- `lib/englishScoring.ts` — pendiente: lógica de scoring + threshold pass/fail
- Wire al router en `router.ts`

### Frontend (shark/src/)

- `pages/CandidateEnglishTest.tsx` — UI candidato con anti-paste, timer, secciones
- Modificar `JobForm.tsx` — checkbox "Requiere inglés" + dropdown nivel mínimo
- Modificar candidate test journey para incluir/saltar el bloque según `job.english_required`

### Catalyst Console

- Crear folder `english-listening` en File Store + env var `FILESTORE_ENGLISH_AUDIOS_FOLDER_ID`
- Crear tabla `EnglishTestSessions` con schema del CSV
- Agregar columnas `english_required` + `english_min_level` a Jobs

### Audios

- Generar con `scripts/generate-english-audios.sh` (requiere ELEVENLABS_API_KEY)
- Subir los 4 MP3s al folder `english-listening` en Catalyst File Store
- Anotar los File IDs para wirearlos al backend

## Referencias

- Marco CEFR: https://www.coe.int/en/web/common-european-framework-reference-languages
- Doc de mejoras (con detalle de exploración): [docs/MEJORAS.md](../MEJORAS.md) sección 1
