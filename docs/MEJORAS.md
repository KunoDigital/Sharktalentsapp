# Mejoras en exploración — SharkTalents v2

Documento vivo donde Cris + AI capturan ideas que están en discusión **antes de codear**. Cuando una idea queda lista para implementar, se mueve al master plan o roadmap. Cuando queda descartada, se archiva con la razón.

**Regla:** acá se piensa, no se codea. El paso de "exploración → implementación" requiere un OK explícito.

---

## 1. Prueba de inglés (opcional por puesto)

**Estado:** Diseño cerrado, banco en curso de redacción. NO implementar todavía.

**Última actualización:** 2026-05-05

### Decisiones cerradas

**Estructura del bloque (orden secuencial, ~20 min):**

```
1. 18 preguntas multiple-choice (vocab + grammar + reading)  ~9 min
2. 1 audio del nivel + 2 preguntas sobre el audio            ~3 min
3. 1 prompt de writing (texto del candidato)                 ~7-10 min
4. Si pasa los 3 → video 60 seg speaking                     ~2 min
   Si no pasa → fin del bloque (silencioso, sigue resto del test)
```

**Score final** = ponderado de los 3 primeros bloques: 50% multiple-choice + 25% listening + 25% writing.

**Thresholds diferenciados por nivel:** A2: 60% / B1: 65% / B2: 70% / C1: 75%.

**Niveles ofrecidos al cliente** (UI con descripción operacional, no jerga CEFR):

| UX label | CEFR interno |
|---|---|
| Comunicación básica — entiende y se hace entender | A2 |
| Profesional intermedio — sostiene reuniones simples | B1 |
| Profesional fluido — maneja discusiones complejas | B2 |
| Avanzado — negocia, presenta, escribe formal | C1 |

**Audios:** 1 por nivel, generados con TTS Google/Azure (acento americano).
- A2: ~30 seg (conversación cotidiana)
- B1: ~45 seg (conversación cotidiana)
- B2: ~60 seg (contexto profesional)
- C1: ~90 seg (contexto profesional)

**Writing prompts (1 por nivel):**

- **A2** (50 palabras, 5 min): "Describe what you did last weekend. Tell us who you were with, where you went, and what you ate. Write at least 50 words."
- **B1** (100 palabras, 8 min): "Tell us about a job you would like to have in the future. Why does it interest you? What skills do you think you need? What would you do in your first month? Write at least 100 words."
- **B2** (150 palabras, 10 min): "Some companies allow employees to work fully remote, while others require people in the office every day. What are the benefits and drawbacks of each option? Which would you prefer for your career, and why? Write at least 150 words."
- **C1** (200 palabras, 15 min): "Describe a recent professional or academic challenge you faced. Explain what made it difficult, what specific actions you took to address it, what the outcome was, and — looking back — what you would do differently next time. Write at least 200 words."

**Anti-cheat (writing):**
- Frontend: `onPaste` + `onCopy` + `onContextMenu` deshabilitados con preventDefault
- Tracking: keystroke count vs word count, focus loss, tab visibility
- IA: detecta si el estilo es "demasiado alto" para el nivel declarado → flag
- Eventos sospechosos van a tabla `AntiCheatEvents` (existente)

**Output al candidato:** silencio total. No sabe el resultado en el momento. Cris recibe el resultado y decide rechazar/avanzar. Si falla pero tiene potencial alto en otras dimensiones, Cris consulta al cliente.

**Banco de preguntas (todo curado a mano, $0 IA recurrente):**
- 40 preguntas multiple-choice por nivel × 4 niveles = 160 preguntas
- Cada candidato ve **20 al azar** del banco de su nivel
- Distribución por banco: 40% vocab + 40% grammar + 20% reading
- Listening: 1 audio + 2-3 preguntas por nivel = 8-12 preguntas total
- Writing: 1 prompt por nivel (ya redactados arriba)

**Schema implications:**

Nueva tabla `EnglishTestSessions` (15 columnas):

```
- ROWID (auto)
- result_id (FK a Results)
- level_required (Var Char A2/B1/B2/C1)
- started_at, completed_at (DateTime)
- mc_score_pct, listening_score_pct, writing_score_pct, total_score_pct (Int 0-100)
- passed (Boolean)
- writing_text (Text — lo que escribió)
- writing_word_count, writing_time_seconds, writing_paste_attempts, writing_focus_lost_count (Int)
- audio_listening_id (Var Char — referencia al audio)
- video_response_id (Var Char — null si no llegó al video)
- writing_analysis_json (Text — output IA)
```

**Catalyst File Store folders necesarios:**
- `english-audios` → env var `FILESTORE_ENGLISH_AUDIOS_FOLDER_ID`
- `videos` (ya pendiente de antes) → env var `FILESTORE_VIDEO_FOLDER_ID`

**Costo IA recurrente:** ~$0.05/candidato que llegue al writing (1 llamada Claude por análisis). Aprobado.

### Problema que resuelve

Cris reporta que candidatos dicen saber inglés pero en la entrevista con el cliente no pueden hablar. Necesita un filtro previo que evalúe inglés **al nivel exacto que el cliente requiere**.

### Diseño actual (en discusión)

**Por qué NO usar IA-generation per-job:**
- Costo recurrente por cada job (~$0.05–0.10) que no aporta sobre un banco curado.
- Calidad de IA en preguntas de inglés es impredecible (riesgo de preguntas ambiguas o mal calibradas al CEFR).
- Test de inglés es STANDARD, no necesita contexto del puesto.
- Curar una sola vez en español-arg, validamos que estén bien, las usamos para siempre.

**Decisión:** **banco fijo de preguntas por nivel CEFR**, en código (TypeScript const o JSON estático en repo). Costo $0 recurrente.

### Estructura del banco

```
4 bancos separados, uno por nivel:

A2 — 60 preguntas (cliente requiere "se defiende")
B1 — 60 preguntas (cliente requiere "comunicación profesional básica")
B2 — 60 preguntas (cliente requiere "puede llevar reuniones")
C1 — 60 preguntas (cliente requiere "negocia contratos en inglés")

Total: ~240 preguntas curadas una sola vez.
```

**Cliente elige el nivel mínimo en JobForm.** El candidato responde **20 preguntas randomizadas del banco del nivel solicitado** (no escalonado, no mixto — todas al nivel exacto).

### Resultado

**Pass/fail binario al nivel solicitado**, no score graduado:
- Threshold: 70% correctas en ese nivel = passes
- < 70% = fails

Si pasa → se le pide grabar **video introducción de 60 segundos en inglés** (categoría `english_intro`, NO IA-scored, solo archivado para que recruiter/cliente escuche pronunciación).

Si falla → fin del test de inglés (sin video).

### Por qué NO scoring graduado (CEFR achieved)

Si el cliente pidió B2 y el candidato saca 90% → "passes". No importa si "podría haber sacado C1" — el cliente no lo necesita. Mantenemos el output simple.

### Preguntas abiertas

- ¿Algunas con audio embed para evaluar listening, o solo texto? (Audio agrega validez pero requiere alojar mp3 + reproductor — más trabajo).
- ¿Cris tiene un banco propio (de su certificación o de otra fuente) o lo armamos desde cero?
- ¿El video se le muestra al cliente directamente en el reporte, o solo a Cris para ella decidir si compartir?

### Schema implications (si avanzamos)

**Jobs (3 columnas nuevas):**
- `english_required` (Boolean, default false)
- `english_min_level` (Var Char — A2/B1/B2/C1)
- (sin `english_questions_cache` — banco está en código)

**Scores (3 columnas nuevas):**
- `english_score_pct` (Int)
- `english_passed` (Boolean)
- `english_video_response_id` (Var Char — FK a VideoResponses)

**VideoQuestions:**
- Nueva categoría: `english_intro` (no IA-scored)

---

## 2. Test de Mentalidades — Adaptabilidad y Resiliencia

**Estado:** En diseño avanzado. Aprobado el approach. Banco de preguntas pendiente de redactar.

**Última actualización:** 2026-05-05

### Contexto

Cris está certificándose en McKinsey Forward — Adaptabilidad y Resiliencia. El marco identifica **7 pares de mentalidades** (limitante ↔ adaptable):

| Limitante | Adaptable |
|---|---|
| Fija | Crecimiento |
| Experto/a | Curiosa |
| Reactiva | Creativa |
| Víctima | Agente |
| Escasez | Abundancia |
| Certeza | Exploración |
| Protección | Oportunidad |

**Punto central del marco:** no hay mentalidad "buena/mala" — hay mentalidad **adecuada al contexto**. Lo que importa es la **autoconciencia** y poder elegir deliberadamente.

### Objetivo del test

Detectar el **perfil de mentalidades por defecto del candidato** — qué mentalidades tiende a usar primero cuando enfrenta una situación nueva o desafiante.

### Diseño aprobado

**Formato:** 10 preguntas situacionales con **6 opciones cada una** = 3 ejes × 2 polos (limitante + adaptable de cada eje). Esto fuerza al candidato a elegir explícitamente entre limitante y adaptable del mismo eje, dando señal psicométrica más fuerte que mostrar 1 polo aleatorio por eje.

**Tiempo estimado al candidato:** ~7 minutos (40 seg/pregunta promedio).

**Por qué 10 preguntas (no 21):**
- Cris priorizó **output binario "adaptable / no adaptable"** sobre perfil fino por eje
- Con 10 preguntas × 3 ejes/pregunta = 30 axis-slots → cada eje aparece 4-5 veces
- 4-5 reps/eje = mínimo aceptable para detectar tendencia; el score global de adaptabilidad mantiene buena confiabilidad
- Drill-down por eje sigue disponible pero con menos precisión (es información secundaria de todos modos)
- Menor fatiga del candidato — el bloque ya está después de DISC, antes de VELNA

**Output del test:**

**Métrica principal (lo que más le importa a Cris):** ¿es adaptable o no?

```
Score global de adaptabilidad = (elecciones de polos adaptables) / 21 × 100
```

| Score | Categoría |
|---|---|
| 70-100% | Adaptable |
| 50-69% | Mixto |
| 0-49% | Limitante |

**Métrica secundaria (drill-down disponible):** perfil de los 14 polos.
- 7 ejes × 2 polos cada uno
- % por polo (suma 100% en total)
- Citas textuales del candidato como evidencia

Esto se muestra a Cris/recruiter; al cliente puede mostrársele el score global + breve narrativa.

### Principios de diseño del banco de preguntas

Estos principios son **críticos para validez psicométrica**. Si se rompen, el test no mide lo que dice medir.

**1. Ninguna opción suena "mala"**

La mentalidad limitante NO es "perezoso/a o ignorante/a" — es una respuesta legítima pero por defecto distinto. Si una opción se delata como "la mala respuesta", el candidato la evita por **deseabilidad social** y el test no captura su mentalidad real.

❌ **Mal:** "Espero que la empresa me dé más recursos antes de comprometerme" — suena a queja pasiva.
✅ **Bien:** "Con la semana que tuve, no había manera de meter práctica" — suena razonable, pero revela locus de control externo (Víctima).

**2. Escenarios del DÍA A DÍA, no del trabajo**

Cuando el escenario es laboral, el candidato se pone en "modo entrevista" → respuesta curada, performativa. Bajar los stakes con escenarios cotidianos (relaciones, hobbies, salud, hogar, aprendizaje) revela el patrón auténtico.

Categorías de situaciones cotidianas a usar:
- Aprender una habilidad nueva (idioma, instrumento, deporte)
- Reuniones familiares / sociales
- Salud y rutinas (ejercicio, alimentación, sueño)
- Logística doméstica (mudanzas, reparaciones, compras)
- Relaciones (conflictos, planes con amigos, citas)
- Tiempo libre (hobbies, viajes, eventos)
- Improvistos (clima, transporte, demoras)

**3. Las 7 opciones distribuidas equitativamente**

A lo largo de las 21 preguntas, cada mentalidad aparece **exactamente 3 veces** como opción. Esto evita que candidatos sesgados por una mentalidad ganen "puntos" solo porque su preferida aparece más.

**4. Limitantes y adaptables mezcladas en cada pregunta**

Cada pregunta de las 21 tiene una mezcla de las 7 mentalidades. La distribución varía por pregunta para cubrir los 14 polos a lo largo del banco.

**5. No hay "respuesta correcta"** — el orden de las opciones es randomizado por candidato.

### Ejemplo de pregunta refinada

**Escenario:** Hace 4 clases que querés aprender a tocar guitarra y seguís trabándote en los acordes básicos. Hoy tenés clase y no practicaste durante la semana.

| Opción | Mentalidad |
|---|---|
| a) Voy a la clase y le pido a la profe que repasemos lo básico hasta que me salga bien. | Experto/a (limitante) |
| b) Cada vez que me trabo siento que algo nuevo se está acomodando en mi cabeza. | Crecimiento (adaptable) |
| c) Busco un método más estructurado, capaz el que sigo no es para mí. | Reactiva (limitante) |
| d) ¿Y si pongo música mientras cocino y voy practicando sin clase? | Creativa (adaptable) |
| e) Con la semana que tuve, no había manera de meter práctica. | Víctima (limitante) |
| f) Voy 15 min antes a la clase y aprovecho ese rato para ir entrando en clima. | Agente (adaptable) |
| g) Voy igual y veo qué pasa, total cada clase aprendo algo nuevo. | Curiosa (adaptable) |

### Schema implications (cuando se implemente)

**Tabla nueva `MindsetScores` o columnas en `Scores`:**

| Columna | Tipo | Descripción |
|---|---|---|
| `mindset_growth_pct` | Int 0-100 | % de elecciones de Crecimiento (vs Fija) |
| `mindset_curious_pct` | Int | % Curiosa (vs Experto/a) |
| `mindset_creative_pct` | Int | % Creativa (vs Reactiva) |
| `mindset_agent_pct` | Int | % Agente (vs Víctima) |
| `mindset_abundance_pct` | Int | % Abundancia (vs Escasez) |
| `mindset_exploration_pct` | Int | % Exploración (vs Certeza) |
| `mindset_opportunity_pct` | Int | % Oportunidad (vs Protección) |
| `mindset_dominant_pattern` | Var Char | "adaptable" / "mixto" / "limitante" |
| `mindset_evidence` | Text JSON | citas + análisis de las 21 elecciones |

### Posicionamiento dentro del test del candidato

**Posición:** entre DISC y VELNA. **No reemplaza ni modifica nada** de lo existente.

**Flow completo del candidato:**

```
1. Datos básicos (registración)
2. DISC                              ← existente, NO se toca
3. Sección 2 — Preguntas extras      ← NUEVA (test de mentalidades)
4. VELNA cognitivo                   ← existente
5. Integridad                        ← existente
6. Emocional                         ← existente
7. Técnica (si requerida)            ← existente
8. Inglés (si requerido)             ← futuro
9. Videos abiertos                   ← existente
```

**Framing diferenciado por audiencia:**

| Audiencia | Cómo se llama | Mensaje |
|---|---|---|
| Candidato (UI) | "Sección 2 — Preguntas extras" | "Sobre cómo abordás situaciones cotidianas. No hay respuestas correctas — elegí la que más te represente." |
| Cris / cliente (reporte) | "Test de Mentalidades" | Detalle completo del marco McKinsey + perfil de los 7 ejes |
| Código backend | `mindset_test` | Identificador técnico interno |

**Por qué esta diferenciación:** el marco McKinsey dice que las mentalidades **se manifiestan**, no se declaran. Si el candidato sabe que le están midiendo "adaptabilidad", se autoreporta como "adaptable". Al presentarlo neutramente, su mentalidad real aparece en las elecciones.

### Banco completo de preguntas

**TODO** — pendiente de redactar las 21 preguntas en el chat (sin costo de IA en producción). Cris valida en tandas de 5-7 para corregir tono temprano.

### Decisión pendiente

Cris debe confirmar arranque del banco. Diseño actual:
- 21 preguntas, 7 opciones cada una
- Escenarios cotidianos (NO trabajo)
- 7 categorías: aprender, social, salud, hogar, relaciones, tiempo libre, imprevistos
- Mezcla de polos limitantes/adaptables en cada pregunta
- Ninguna opción suena "mala" — todas plausibles
- Posición: entre DISC y VELNA, sin nombre revelador

---

## Tracking de costos — gaps de precisión (no urgente)

**Estado:** En exploración. La página Operaciones → Gastos se va a construir SIN estos cierres. Anthropic y Ads manuales son lo más realista hoy y representan ~95% del costo real.

**Última actualización:** 2026-06-08

### Problema que resuelve

Hoy el tracking de costos por puesto tiene 3 gaps que distorsionan ~5% del total. No bloquean operar pero limitan la precisión absoluta del reporte de gastos.

### Gaps identificados

**1. Storage de videos NO se mide automáticamente**
- Tarifa configurada en [costTracking.ts:172](functions/api/src/lib/costTracking.ts#L172): `storage_per_mb_usd: 0.00002`
- Comentario dice "estimado en runtime" pero NO hay call que mida el peso del archivo subido y registre el costo.
- Para arreglar: en el handler de upload de video, después de persistir en File Store, llamar `trackJobCost({ type: 'storage', amountUsd: fileBytes * SERVICE_COSTS.storage_per_mb_usd / 1024 / 1024 })`.
- Impacto estimado: <2% del costo total por puesto.

**2. WhatsApp NO está integrado en el flujo productivo**
- Tarifa parametrizada $0.005/mensaje pero Twilio sigue diferido (memoria: `project_arquitectura_post_recruit.md`).
- Cuando se integre Twilio, ya está el `trackJobCost` listo — solo hay que llamarlo desde el handler de envío.
- Impacto estimado: <5% del costo total (no activo hoy).

**3. Anthropic "sin atribuir" (sin job_id)**
- Algunas llamadas a Anthropic se hacen sin vincular `jobId` (ej: drafts antiguos, narrativas multi-job, bot decisor cross-tenant).
- Esas llamadas SÍ se registran en `TokenUsage` pero NO disparan `trackJobCost` (línea [tokenUsage.ts:127](functions/api/src/lib/tokenUsage.ts) bajo `if (record.jobId)`).
- Resultado: vista de gastos puede mostrar menos consumo Anthropic del real.
- Para arreglar: agregar en la página Gastos una métrica "Anthropic sin atribuir = SUM(TokenUsage.cost_usd) - SUM(JobCostEvents.amount_usd WHERE type='anthropic')". Si es >5% de Anthropic total, mostrar warning.

### Decisión pendiente

Cris decidió 2026-06-08: NO hacer estos cierres ahora. La página Gastos se monta con lo que hay (Anthropic real + email gratis + ads manuales). Reabrir si el costo real desviado se vuelve material (>10%).

---

## Plantilla para nuevas mejoras

```markdown
## N. <Título de la mejora>

**Estado:** En exploración / En diseño / Aprobada para implementar / Descartada

**Última actualización:** YYYY-MM-DD

### Problema que resuelve

### Diseño actual (en discusión)

### Preguntas abiertas

### Schema implications (si avanzamos)

### Decisión pendiente
```
