# 19 — Prueba Técnica de Doble Eje

**Objetivo:** evolucionar la prueba técnica actual (25 preguntas → 1 puntaje) a un modelo de **dos puntajes independientes** (técnico + situacional) con un eje adicional de **estilo de trabajo** que se cruza con el estilo del jefe directo.

**Tiempo estimado:** 2 semanas.
**Dependencias:** Fase 17 (perfil del jefe se captura en onboarding), Fase 5 (Anthropic ya integrado para generar preguntas).
**Riesgo:** medio — psicometría más sofisticada, requiere calibración.

---

## El cambio conceptual

### Hoy
- 25 preguntas (12 técnicas + 13 situacionales)
- Una sola respuesta correcta por pregunta
- Un solo puntaje de salida (% de aciertos)

### Después
- 25 preguntas (12 técnicas + 13 situacionales)
- **Técnicas:** una sola respuesta correcta (igual que hoy)
- **Situacionales:** **2 respuestas válidas + 2 inválidas**, donde las 2 válidas son aceptables profesionalmente pero revelan **estilos distintos**
- **Dos puntajes de salida:** técnico + situacional (validez)
- **Tercer eje:** perfil de estilo de trabajo del candidato, que se cruza con el estilo del jefe directo del puesto

### Por qué importa

Reclutar no es solo "sabe o no sabe". Dos candidatos pueden ser igual de competentes y aún así fitear distinto con jefes distintos. Un puesto bajo un jefe controlador necesita perfiles que consultan antes de actuar; un puesto bajo un jefe que da autonomía necesita perfiles proactivos.

Hoy el sistema no captura esa dimensión. La nueva prueba SÍ.

---

## Deliverables

- [ ] Schema actualizado: preguntas situacionales con `option_validity[]` (cuáles son válidas) y `option_style[]` (qué estilo revela cada una)
- [ ] Captura del estilo del jefe en el onboarding del cliente (DISC opcional + survey corto)
- [ ] Algoritmo de generación de preguntas situacionales con doble eje (modificar prompt existente)
- [ ] Cálculo de scores doble en `services/scoring.ts`
- [ ] Match candidato ↔ jefe en `services/candidateScoring.ts`
- [ ] Output extendido en reporte: técnico % + situacional validez % + alineación de estilo con jefe %
- [ ] Migración de preguntas viejas (regenerar al publicar puesto v2)

---

## 1. El nuevo schema de preguntas situacionales

### Hoy

```json
{
  "id": "tb1",
  "text": "Tu equipo enfrenta una crisis...",
  "options": [
    "Actúo de inmediato",
    "Tomo un momento para evaluar",
    "Pido unos minutos",
    "Reúno toda la información"
  ],
  "correct": 2
}
```

### Después

```json
{
  "id": "tb1",
  "kind": "situational",
  "text": "Un cliente clave reporta un bug crítico en producción a las 5pm de un viernes. ¿Qué hacés?",
  "options": [
    "Convoco al equipo y empezamos a debugear inmediatamente, le aviso al cliente que estamos en eso.",
    "Le aviso a mi jefe primero, le explico la situación, y espero su lineamiento antes de actuar.",
    "Le digo al cliente que se espere al lunes, no es momento para tocar producción.",
    "Hago un patch rápido sin avisar para no preocupar a nadie."
  ],
  "option_validity": [true, true, false, false],
  "option_style": [
    { "axis": "autonomy_vs_consult", "value": "autonomy" },
    { "axis": "autonomy_vs_consult", "value": "consult" },
    null,
    null
  ]
}
```

**Reglas:**
- Cada pregunta tiene 4 opciones
- `option_validity` marca cuáles son profesionalmente aceptables (true) e inválidas (false)
- Las inválidas son objetivamente malas (no atender al cliente, ocultar info, mentir, procrastinar, ignorar)
- Las válidas SIEMPRE son 2 (una para cada lado del eje de estilo)
- `option_style` mapea cada opción válida a un punto del eje de estilo (las inválidas son `null`)

### Ejes de estilo (empezar con 1)

**Para v1, un solo eje: `autonomy_vs_consult`**
- `autonomy` — el candidato actúa primero, informa después
- `consult` — el candidato consulta antes de actuar

Razón: un solo eje es fácil de calibrar y comunicar al cliente. Si funciona bien, se agregan más ejes en v2 (`speed_vs_thoroughness`, `direct_vs_diplomatic`, `risk_vs_caution`).

---

## 2. Captura del estilo del jefe

### En el onboarding del cliente (Fase 17)

Cuando Cris construye el perfil del puesto desde la transcripción del meeting con el cliente, una de las cosas que la IA extrae es el **estilo del jefe directo**.

Pantalla del builder de perfil (extiende lo de Fase 17):

```
┌─────────────────────────────────────────────────────────────┐
│  Estilo del jefe directo                                     │
│                                                              │
│  Nombre:  [Carlos Pérez]                                    │
│  Cargo:   [Director de Tecnología]                          │
│                                                              │
│  Estilo de delegación:                                       │
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━━○                              │
│  Da autonomía              Quiere que consulten            │
│                                                              │
│  Detectado en transcripción (cita):                          │
│  > "Yo no soy de los que estoy encima de cada decisión.     │
│  >  Si me trae el problema ya con una propuesta, mejor."    │
│                                                              │
│  Resultado: estilo "autonomy" (alto)                         │
│                                                              │
│  [✏ Editar manualmente] [Importar DISC del jefe (opcional)] │
└─────────────────────────────────────────────────────────────┘
```

### Datos guardados

Tabla `JobBossProfile` (o columnas en `JobProfiles`):

```
job_id                  Text (50)
boss_name               Text (255)
boss_role               Text (255)
boss_disc_d             Integer nullable
boss_disc_i             Integer nullable
boss_disc_s             Integer nullable
boss_disc_c             Integer nullable
style_autonomy_consult  Decimal (3,2)        -- 0.0 a 1.0; 0 = consult, 1 = autonomy
style_evidence_quote    Text (long, nullable)   -- cita de la transcripción que justifica
```

Cris puede editar el slider antes de aprobar el perfil. La IA pone un valor inicial basado en lo que extrajo de la transcripción.

### Si no hay info del jefe

Default: middle (0.5). El match con el candidato es neutral en ese eje (no penaliza ni premia).

---

## 3. Cálculo de scores

### Score técnico (sin cambios)

```typescript
function scoreTechnical(questions, answers) {
  const techQuestions = questions.filter(q => q.kind === 'technical');
  const correct = techQuestions.filter(q => answers[q.id] === q.correct).length;
  const total = techQuestions.length;
  return {
    score_pct: Math.round((correct / total) * 100),
    correct,
    total,
  };
}
```

### Score situacional (validez)

```typescript
function scoreSituationalValidity(questions, answers) {
  const sitQuestions = questions.filter(q => q.kind === 'situational');
  let validCount = 0;
  for (const q of sitQuestions) {
    const sel = answers[q.id];
    if (sel != null && q.option_validity[sel] === true) validCount++;
  }
  return {
    score_pct: Math.round((validCount / sitQuestions.length) * 100),
    valid: validCount,
    total: sitQuestions.length,
  };
}
```

### Score de estilo (eje autonomy_vs_consult)

```typescript
function scoreStyleAxis(questions, answers, axis = 'autonomy_vs_consult') {
  const sitQuestions = questions.filter(q => q.kind === 'situational');
  let autonomyCount = 0;
  let consultCount = 0;
  for (const q of sitQuestions) {
    const sel = answers[q.id];
    if (sel == null) continue;
    const style = q.option_style?.[sel];
    if (!style || style.axis !== axis) continue;
    if (style.value === 'autonomy') autonomyCount++;
    else if (style.value === 'consult') consultCount++;
  }
  const total = autonomyCount + consultCount;
  if (total === 0) return null;
  // Normalizado: 0.0 = puro consult, 1.0 = puro autonomy
  return autonomyCount / total;
}
```

**Output ejemplo:**

```
{
  technical_score: { score_pct: 80, correct: 10, total: 12 },
  situational_validity: { score_pct: 92, valid: 12, total: 13 },
  style: {
    autonomy_vs_consult: 0.69  // tiende a autonomy
  }
}
```

---

## 4. Match con jefe

```typescript
function matchStyleWithBoss(candidateStyle, bossStyle) {
  // candidateStyle: 0.0-1.0 (su tendencia)
  // bossStyle: 0.0-1.0 (lo que prefiere el jefe — del onboarding)
  
  const distance = Math.abs(candidateStyle - bossStyle);
  // 0 = match perfecto. 1 = polos opuestos.
  
  // Convertir a score 0-100 donde 100 = match perfecto
  const matchPct = Math.round((1 - distance) * 100);
  
  return {
    candidate_style: candidateStyle,
    boss_style: bossStyle,
    match_pct: matchPct,
    interpretation: interpretMatch(candidateStyle, bossStyle, matchPct),
  };
}

function interpretMatch(cand, boss, pct) {
  if (pct >= 75) {
    return cand > 0.5 
      ? "Candidato proactivo, jefe da autonomía. Match natural."
      : "Candidato consultivo, jefe quiere que consulten. Match natural.";
  }
  if (pct >= 50) {
    return "Match parcial. Candidato puede adaptarse pero requiere ajuste.";
  }
  return cand > 0.5
    ? "RIESGO: Candidato proactivo bajo jefe controlador. Posible fricción."
    : "RIESGO: Candidato consultivo bajo jefe que da autonomía. Posible parálisis.";
}
```

---

## 5. Generación de preguntas con doble eje

Modificar el prompt existente en `integrations/anthropic.ts` (función `generateTechnicalQuestions`) para el bloque de situacionales:

### Cambios al system prompt

Agregar sección al system prompt actual:

```
═══ NUEVO REQUISITO PARA TIPO B (situacionales) ═══

Cada pregunta situacional debe tener:
- 2 opciones válidas (PROFESIONALMENTE ACEPTABLES) marcadas con axis style
- 2 opciones inválidas (objetivamente malas — NO incluyas verbos de la lista negra)

Las 2 opciones válidas deben revelar ESTILOS DISTINTOS en el eje "autonomy_vs_consult":
- Una opción tiende a "autonomy" — el candidato actúa primero, decide solo, informa después
- La otra tiende a "consult" — el candidato consulta antes de actuar, busca alineación

EJEMPLO:
Situación: "Un cliente reporta un bug crítico a las 5pm de un viernes."

Opciones válidas (2):
- "Convoco al equipo y empezamos inmediatamente, le aviso al cliente que estamos en eso."
  → axis: autonomy_vs_consult, value: autonomy
- "Le aviso a mi jefe primero, espero lineamiento antes de actuar."
  → axis: autonomy_vs_consult, value: consult

Opciones inválidas (2):
- "Le digo al cliente que se espere al lunes" (procrastinar — verbo prohibido)
- "Hago un patch rápido sin avisar" (ocultar — verbo prohibido)

CRÍTICO: las dos válidas DEBEN ser igualmente defendibles para un colega senior.
NO hay una "más correcta" que la otra. La diferencia es de estilo, no de calidad.
```

### Output JSON esperado

```json
[
  {
    "id": "tb1",
    "kind": "situational",
    "text": "...",
    "options": ["...", "...", "...", "..."],
    "option_validity": [true, true, false, false],
    "option_style": [
      { "axis": "autonomy_vs_consult", "value": "autonomy" },
      { "axis": "autonomy_vs_consult", "value": "consult" },
      null,
      null
    ]
  }
]
```

### Validación post-generación

```typescript
function validateSituationalQuestion(q: any): boolean {
  // Debe tener exactamente 4 opciones
  if (q.options?.length !== 4) return false;
  // option_validity debe ser array de 4 booleans
  if (!Array.isArray(q.option_validity) || q.option_validity.length !== 4) return false;
  // Exactamente 2 válidas y 2 inválidas
  const validCount = q.option_validity.filter(v => v === true).length;
  if (validCount !== 2) return false;
  // option_style debe tener style en las válidas y null en las inválidas
  for (let i = 0; i < 4; i++) {
    const valid = q.option_validity[i];
    const style = q.option_style?.[i];
    if (valid && (!style || !style.axis || !style.value)) return false;
    if (!valid && style != null) return false;
  }
  // Las 2 válidas deben tener distinto valor en el mismo eje
  const validStyles = q.option_style.filter(s => s != null);
  const axes = new Set(validStyles.map(s => s.axis));
  if (axes.size !== 1) return false;  // mismo eje
  const values = new Set(validStyles.map(s => s.value));
  if (values.size !== 2) return false;  // distintos valores
  return true;
}
```

Si la validación falla, regenerar la pregunta (con feedback al modelo).

---

## 6. Output en el reporte al cliente

Sección "Prueba técnica" del reporte se rediseña:

```
┌─────────────────────────────────────────────────────────────┐
│  Prueba técnica                                              │
│                                                              │
│  Conocimiento técnico        ███████████████████░ 80%       │
│  Criterio profesional        ████████████████████ 92%       │
│                                                              │
│  Estilo de trabajo                                           │
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━○━━━━━━━━━━━○                  │
│  Consulta antes      Decide y actúa     Decide              │
│  de actuar           informando         autónomamente       │
│                                                              │
│  Match con estilo del jefe directo                           │
│  María tiende a decidir y actuar (autonomy 0.69).           │
│  Carlos prefiere que el equipo tenga autonomía (0.75).      │
│  Match: 94% — alineación natural.                            │
└─────────────────────────────────────────────────────────────┘
```

Para casos de fricción:

```
┌─────────────────────────────────────────────────────────────┐
│  Match con estilo del jefe directo                           │
│  Juan tiende a decidir autónomamente (0.85).                │
│  Carlos prefiere que se le consulte (0.20).                  │
│  Match: 35% — RIESGO de fricción operativa.                 │
│                                                              │
│  Recomendación: validar en entrevista cómo Juan se          │
│  maneja con jefes que requieren más control.                │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Migración de preguntas existentes

Las preguntas técnicas hoy en `AssessmentQuestions` siguen el modelo viejo (1 correcta). Estrategia:

- **Puestos viejos (existentes):** quedan con preguntas viejas, se siguen usando.
- **Puestos nuevos (post-deploy v2):** al generar técnica, se usa el nuevo modelo.
- **No regenerar preguntas viejas masivamente** — costo y poco valor.

Cuando un job legacy quiera adoptar el nuevo modelo, Cris hace click en "Regenerar técnica con doble eje" → el sistema regenera con el prompt nuevo.

---

## 8. Schema DB — cambios

### Tabla `AssessmentQuestions` — agregar columnas

```
option_validity    Text (long, nullable)     JSON array of booleans (solo para situacionales)
option_style       Text (long, nullable)     JSON array of {axis, value} (solo para situacionales)
```

Para preguntas técnicas (kind='ta'), ambos campos quedan null. Para situacionales (kind='tb'), populated con la nueva info.

### Tabla `JobBossProfiles` (NUEVA)

```
ROWID                   BigInt
tenant_id               Text (50)
job_id                  Text (50, unique check)
boss_name               Text (255)
boss_role               Text (255)
boss_disc_d             Integer nullable
boss_disc_i             Integer nullable
boss_disc_s             Integer nullable
boss_disc_c             Integer nullable
style_autonomy_consult  Decimal (3,2)
style_evidence_quote    Text (long, nullable)
created_at              DateTime
updated_at              DateTime
```

### Tabla `TechnicalScores` — extender

```
ROWID                            BigInt
tenant_id                        Text (50)
result_id                        Text (50, unique check)
technical_score_pct              Integer (0-100)        -- preguntas técnicas
technical_correct                Integer
technical_total                  Integer
situational_validity_pct         Integer (0-100)        -- preguntas situacionales
situational_valid                Integer
situational_total                Integer
style_autonomy_consult           Decimal (3,2, nullable) -- 0-1, NULL si no respondió situacionales
style_match_with_boss_pct        Integer (0-100, nullable)
passed                           Boolean                 -- score_pct >= min_technical_score del job
```

(Renombrar campos de tabla actual o agregar columnas según el schema en Fase 2.)

---

## 9. Checklist de cierre Fase 19

- [ ] Schema actualizado: `AssessmentQuestions.option_validity` + `option_style`
- [ ] Tabla `JobBossProfiles` creada
- [ ] Tabla `TechnicalScores` extendida con campos nuevos
- [ ] Prompt actualizado en `generateTechnicalQuestions` (situacionales con doble eje)
- [ ] Validación post-generación de shape situacional
- [ ] `services/scoring.ts` actualizado: `scoreTechnical`, `scoreSituationalValidity`, `scoreStyleAxis`
- [ ] `services/candidateScoring.ts` actualizado: match candidato ↔ jefe
- [ ] Captura del estilo del jefe en builder de perfil (Fase 17)
- [ ] Output extendido en reporte cliente (sección Prueba técnica)
- [ ] Smoke tests:
  - [ ] Generar técnica para puesto nuevo → 12 técnicas + 13 situacionales con doble eje válidas
  - [ ] Candidato responde → output con 3 scores (técnico + situacional + estilo)
  - [ ] Match con jefe se calcula correctamente para 3 casos: alto match, bajo match, sin info de jefe
  - [ ] Reporte cliente muestra ambos scores + interpretación de estilo

---

## Siguiente paso

→ [20_VIDEOS_DINAMICOS.md](20_VIDEOS_DINAMICOS.md) — los 7 videos personalizados que reemplazan la entrevista presencial.
