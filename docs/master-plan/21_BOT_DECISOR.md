# 21 — Bot Decisor

**Objetivo:** automatizar las transiciones del pipeline (cambios de etapa) usando un bot entrenado para razonar como Cris. Cris pasa de operador a supervisor: revisa cola de baja confianza y decide top 3, todo lo demás lo hace el bot.

**Tiempo estimado:** 2 semanas (implementación inicial cold start) + iteración continua.
**Dependencias:** Fase 18 (state machine + transitions), Fase 19 (scores normalizados), Fase 20 (videos analizados).
**Riesgo:** medio-alto. Bot que se equivoca = candidatos buenos descartados o malos avanzados. Mitigación: cold start gradual + override siempre posible.

---

## Filosofía

Reclutar **NO es blanco/negro**. Hay candidatos "no ideales" que igual fitean por contexto, y "ideales" que generan ruido. El bot debe replicar el criterio matizado de Cris, no reglas rígidas por umbral.

**Reglas duras** (auto-rechazo por integridad alta, score bajísimo, salario fuera de rango ±15%) las maneja el sistema directo (Fase 18 sección 5). El **bot decisor solo entra para casos con margen**.

**Cris siempre puede overridear cualquier decisión del bot.**

---

## Deliverables

- [ ] Tabla `BotDecisions` con rationale + confidence + casos similares
- [ ] Tabla `BotTrainingExamples` (curated por Cris)
- [ ] Servicio `botDecisor` con few-shot + RAG
- [ ] Endpoint interno `POST /api/internal/applications/:id/bot-decide`
- [ ] Cron worker que evalúa applications listas para decisión
- [ ] Threshold de confianza configurable por etapa
- [ ] UI: "Cola de revisión" para Cris (baja confianza)
- [ ] UI: detail de decisión del bot (rationale, similar cases)
- [ ] Override + feedback loop (Cris marca decisiones equivocadas)
- [ ] Audit completo: cada decisión logueada

---

## 1. Cold start gradual

El bot **no funciona bien al día 1**. Se entrena con uso. Tres fases:

### Fase Cold (mes 1-2)

- Bot **SUGIERE** decisiones, NO ejecuta automáticamente
- Cris ve la sugerencia + rationale, hace click "✓ aceptar" o "✗ rechazar"
- Cada decisión humana queda como `BotTrainingExample`
- Confidence threshold: **100%** (todo va a queue)

**Tiempo de Cris en Cold:** ~10 min/día revisando sugerencias. Mismo que hoy pero con asistencia.

### Fase Warm (mes 3-4)

- Bot decide AUTO si confidence > **85%** (configurable)
- Resto va a queue
- Cris solo revisa la queue
- Decisiones equivocadas se reportan → bot las usa como anti-ejemplos

**Tiempo de Cris en Warm:** ~5 min/día. Solo revisa la cola.

### Fase Hot (mes 5+)

- Bot decide AUTO si confidence > **75%** (configurable)
- Cola más corta
- Cris revisa solo casos ambiguos + decide top 3
- Threshold ajustable según error rate

**Tiempo de Cris en Hot:** ~2-3 min/día.

### Cómo se sube el threshold

Métrica: **% de overrides sobre decisiones auto del bot.**

- Si en última semana, > 10% de las decisiones auto fueron overrideadas → bajar threshold (más a queue)
- Si < 5% → subir threshold (menos a queue)

Cris ajusta manualmente o el sistema lo sugiere.

---

## 2. Cómo razona el bot

### Few-shot prompting con RAG

NO se hace fine-tuning de Claude (Anthropic no expone fine-tuning con todas las features). En su lugar:

```
Para cada decisión:
1. Buscar en BotTrainingExamples 5-10 casos SIMILARES al actual
2. Construir prompt con esos ejemplos como few-shot
3. Pasar el caso actual al modelo
4. Recibir decisión + confidence + rationale
```

### Search de casos similares (RAG)

Similaridad calculada con:
- Mismo `tenant_id` (decisiones del mismo equipo)
- Job similar (mismo `cognitive_level`, `area` similar)
- Stage similar (mismo `from_stage` → `to_stage`)
- Scores similares (DISC similarity, technical score range)

Implementación pragmática (sin embeddings vectoriales en v1):

```typescript
// services/similarCases.ts
export async function findSimilarCases(
  req: any,
  tenantId: string,
  newCase: {
    job_id: string;
    from_stage: string;
    candidate_scores: any;
  },
  limit = 8
): Promise<TrainingExample[]> {
  const job = await db.jobs.getById(req, tenantId, newCase.job_id);
  
  // Buscar examples del mismo tenant + stage
  const examples = await db.botTrainingExamples.listByTenantAndStage(
    req, tenantId, newCase.from_stage
  );
  
  // Score cada example por similitud
  const scored = examples.map(ex => ({
    example: ex,
    similarity: calculateSimilarity(newCase, ex, job),
  }));
  
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit).map(s => s.example);
}

function calculateSimilarity(newCase, example, job): number {
  let score = 0;
  // Mismo cognitive level del job: +30
  if (example.job_cognitive_level === job.cognitive_level) score += 30;
  // DISC similarity (sum of |diff| inverted): up to +40
  if (newCase.candidate_scores.disc && example.candidate_disc) {
    const diff = Math.abs(newCase.candidate_scores.disc.D - example.candidate_disc.D)
              + Math.abs(newCase.candidate_scores.disc.I - example.candidate_disc.I)
              + Math.abs(newCase.candidate_scores.disc.S - example.candidate_disc.S)
              + Math.abs(newCase.candidate_scores.disc.C - example.candidate_disc.C);
    score += Math.max(0, 40 - diff / 10);
  }
  // Technical score range similar: +20
  if (Math.abs(newCase.candidate_scores.technical_pct - example.candidate_technical_pct) < 15) {
    score += 20;
  }
  // Same to_stage decision: +10
  // (no sirve para similarity per se, pero es buena referencia)
  return score;
}
```

(En v2, considerar embeddings vectoriales con pgvector o un servicio externo si volumen lo justifica.)

### Prompt al modelo

```
SYSTEM:
Sos un reclutador senior con 10+ años de experiencia. Tu trabajo es decidir si un candidato avanza o no en el pipeline. Replicás el criterio de Cris (operador del sistema).

REGLAS:
- Confidence honesta: si dudás, dilo (confidence < 0.7).
- Rationale corto y específico (2-3 frases).
- NO decidas "rechazar" por una sola dimensión sin contexto holístico.
- Considerá los casos similares para calibrar.

OUTPUT JSON:
{
  "decision": "advance" | "reject" | "review_cv" | "needs_human",
  "to_stage": "<stage_id>",
  "confidence": 0.0-1.0,
  "rationale": "...",
  "similar_cases_consulted": ["case_id_1", ...]
}

USER:
CONTEXTO DEL PUESTO:
[descripción + perfil ideal + competencias]

CANDIDATO ACTUAL:
[scores normalizados, claims CV, flags]

ETAPA ACTUAL: disc_completed
DECISIÓN A TOMAR: pasar a technical_pending o rechazar?

CASOS SIMILARES (decisiones pasadas de Cris):

Caso 1 (job: Senior Dev, stage: disc_completed → technical_pending):
- Candidato: DISC D=70 I=40 S=20 C=80, technical aún sin hacer
- Score técnico expectativa: alto (CV menciona 8 años React)
- Cris decidió: advance. Razón: "Perfil C alto + CV sólido, falta validar técnica"

Caso 2 (job: Senior Dev, stage: disc_completed → technical_pending):
- Candidato: DISC D=20 I=80 S=60 C=20, ...
- Cris decidió: reject. Razón: "Perfil más comercial que técnico, no encaja"

[6 casos más]

Decidí ahora.
```

### Implementación

```typescript
// services/botDecisor.ts
export async function decideTransition(
  req: any,
  applicationId: string,
  fromStage: string,
  candidateStage: 'cold' | 'warm' | 'hot' = 'cold'
): Promise<BotDecision> {
  const app = await db.jobApplications.getById(req, applicationId);
  const job = await db.jobs.getFullProfile(req, app.tenant_id, app.job_id);
  const scores = await db.scores.getAllForApp(req, applicationId);
  const similarCases = await findSimilarCases(req, app.tenant_id, {
    job_id: app.job_id, from_stage: fromStage, candidate_scores: scores,
  });

  const response = await anthropicCall(req, {
    action: 'bot_decision',
    timeout: 20000,
    system: BOT_DECISOR_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildDecisionPrompt({ job, scores, fromStage, similarCases, app }),
    }],
  });

  const decision = parseDecision(response);

  // Persistir
  const decisionRecord = await db.botDecisions.insert(req, {
    tenant_id: app.tenant_id,
    application_id: applicationId,
    job_id: app.job_id,
    from_stage: fromStage,
    to_stage_proposed: decision.to_stage,
    decision: decision.decision,
    confidence: decision.confidence,
    rationale: decision.rationale,
    similar_cases: JSON.stringify(decision.similar_cases_consulted),
    auto_executed: false,  // se setea después si confidence > threshold
    created_at: db.now(),
  });

  // Decidir si ejecutar auto o mandar a queue
  const threshold = await getConfidenceThreshold(req, app.tenant_id, fromStage, candidateStage);
  
  if (decision.confidence >= threshold && decision.decision !== 'needs_human') {
    // Auto-execute
    await applicationStateMachine.transition(
      req,
      applicationId,
      decision.to_stage,
      { type: 'bot', id: decisionRecord.id },
      decision.rationale,
      decision.confidence
    );
    await db.botDecisions.update(req, decisionRecord.id, {
      auto_executed: true,
      executed_at: db.now(),
    });
  } else {
    // Queue para Cris
    await db.reviewQueue.insert(req, {
      tenant_id: app.tenant_id,
      application_id: applicationId,
      bot_decision_id: decisionRecord.id,
      reason: decision.confidence < threshold 
        ? `Low confidence (${decision.confidence})` 
        : 'Bot escalated',
      priority: 'normal',
      created_at: db.now(),
    });
  }

  return decisionRecord;
}
```

---

## 3. Threshold configurable

Tabla `Config` con keys:

```
bot_threshold:tenant_<id>:phase_cold        →  1.0   (todo a queue)
bot_threshold:tenant_<id>:phase_warm        →  0.85
bot_threshold:tenant_<id>:phase_hot         →  0.75
bot_threshold:tenant_<id>:stage:disc_completed  →  0.85   (override por stage)
bot_threshold:tenant_<id>:stage:integrity_completed  →  0.95   (más estricto)
```

Pantalla admin: pantalla "Configurar bot decisor" con sliders por etapa.

---

## 4. Cola de revisión

URL: `https://sharktalents.ai/admin/bot/review-queue`

```
┌──────────────────────────────────────────────────────────────┐
│  Cola de revisión del bot — 7 pendientes                     │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Juan Pérez · Senior Dev Acme · DISC completed             │
│  │ Confidence: 62% — Bot sugiere: REJECT                     │
│  │ Razón: "DISC C alto + S alto, pero D bajo. Perfil cauto.│ │
│  │ Puesto requiere D mid-high. Casos similares: 3 rechazos. │ │
│  │ Pero técnica aún no hecha — podría sorprender."           │ │
│  │                                                           │ │
│  │ [✓ Confirmar reject]  [✗ Override → advance]             │ │
│  │ [Ver perfil completo →]                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                │
│  [...más rows...]                                             │
└──────────────────────────────────────────────────────────────┘
```

### Acciones en cada row

- **Confirmar:** ejecuta la decisión que sugirió el bot. Marca `BotDecisions.confirmed_by_human = true` y crea `BotTrainingExample`.
- **Override:** Cris elige otra acción. Pide motivo. Crea `BotTrainingExample` con la decisión correcta + el motivo del override.
- **Ver perfil:** drilldown al detalle completo del candidato.

---

## 5. Tabla `BotTrainingExamples`

Cada decisión humana (sea confirmando bot o overrideando) genera una row aquí. Es el dataset.

```
ROWID                          BigInt
tenant_id                      Text (50)
application_id                 Text (50)
job_id                         Text (50)
job_cognitive_level            Text (10)
job_title_hash                 Text (16)         (para anonymizar parcialmente)
candidate_disc_d/i/s/c         Integer
candidate_cognitive_indice     Integer
candidate_technical_pct        Integer nullable
candidate_integrity_overall    Text (10) nullable
from_stage                     Text (50)
to_stage_chosen                Text (50)
chosen_by                      Text (50)         (clerk user_id)
rationale_human                Text (long)
bot_had_suggested              Text (50, nullable)
bot_confidence                 Decimal (3,2, nullable)
was_override                   Boolean
created_at                     DateTime
```

### Curado de examples

No todos los examples son buenos. Cris puede marcar examples como:
- `quality: 'high'` — caso clásico, bueno como referencia
- `quality: 'noise'` — Cris se equivocó después o el caso era ambiguo
- `quality: 'standard'` — uso normal

Solo los `high` y `standard` se usan en few-shot. Los `noise` se ignoran.

---

## 6. Override + feedback loop

Cuando Cris ve una decisión auto del bot que estuvo mal:

```
1. Va al detalle del candidato
2. Click "Reportar decisión incorrecta"
3. Cris explica qué debió decidir el bot
4. Sistema:
   - Crea BotTrainingExample con la decisión correcta
   - Marca la decisión vieja del bot como overrideada
   - Si era una transición, revierte la etapa
   - Considera bajar el threshold automáticamente
```

```typescript
// services/botFeedback.ts
export async function reportIncorrectDecision(
  req: any,
  decisionId: string,
  correctDecision: { to_stage: string; rationale: string },
  reportedBy: string
): Promise<void> {
  const decision = await db.botDecisions.getById(req, decisionId);
  
  // Marcar como overrideada
  await db.botDecisions.update(req, decisionId, {
    overridden: true,
    overridden_by: reportedBy,
    overridden_at: db.now(),
    overridden_reason: correctDecision.rationale,
  });

  // Revertir state si fue auto-ejecutada
  if (decision.auto_executed && decision.to_stage_proposed !== correctDecision.to_stage) {
    await applicationStateMachine.transition(
      req,
      decision.application_id,
      correctDecision.to_stage,
      { type: 'admin', id: reportedBy },
      `Override de bot: ${correctDecision.rationale}`
    );
  }

  // Crear training example correcto
  await db.botTrainingExamples.insert(req, {
    /* ... datos ... */
    to_stage_chosen: correctDecision.to_stage,
    rationale_human: correctDecision.rationale,
    bot_had_suggested: decision.to_stage_proposed,
    bot_confidence: decision.confidence,
    was_override: true,
    chosen_by: reportedBy,
    quality: 'high',  // override = buena señal
    created_at: db.now(),
  });

  // Métrica: incrementar override count
  await incrementOverrideCount(req, decision.tenant_id);
}
```

---

## 7. Cris decide top 3 (siempre)

Esto NO se automatiza. Después del paso de video y análisis:

- Bot puede sugerir un ranking inicial (top 5).
- Cris ve los 5 con todos los reportes.
- Cris elige 3 manualmente.
- El bot logea el ranking sugerido vs el final para feedback.

Pantalla:

```
┌──────────────────────────────────────────────────────────────┐
│  Selección de finalistas — Senior Dev Acme                    │
├──────────────────────────────────────────────────────────────┤
│  Bot sugiere top 5 (ordenado por overall_score):              │
│                                                                │
│  1. María López    — overall 89% — DISC perfecto, técnica 88%│
│     [✓ Incluir en top 3]                                      │
│  2. Juan Pérez     — overall 84% — fuerte criterio situacional│
│     [✓ Incluir en top 3]                                      │
│  3. Pedro García   — overall 81% — match con jefe 92%        │
│     [  Incluir]                                               │
│  4. Ana Sánchez    — overall 78% — generalista              │
│     [✓ Incluir en top 3]                                      │
│  5. Luis Méndez    — overall 75% — riesgo bajo               │
│     [  Incluir]                                               │
│                                                                │
│  Top 3 actual: María, Juan, Ana                              │
│  [Generar reporte para cliente]                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Tablas nuevas

### `BotDecisions`

```
ROWID                  BigInt
tenant_id              Text (50)
application_id         Text (50)
job_id                 Text (50)
from_stage             Text (50)
to_stage_proposed      Text (50)
decision               Text (20)        ('advance' | 'reject' | 'review_cv' | 'needs_human')
confidence             Decimal (3,2)
rationale              Text (long)
similar_cases          Text (long)      JSON array de IDs
auto_executed          Boolean
executed_at            DateTime nullable
overridden             Boolean
overridden_by          Text (50, nullable)
overridden_at          DateTime nullable
overridden_reason      Text (long, nullable)
confirmed_by_human     Boolean nullable
confirmed_by           Text (50, nullable)
created_at             DateTime
```

### `BotTrainingExamples`

(Definida arriba sección 5.)

### `ReviewQueue`

```
ROWID            BigInt
tenant_id        Text (50)
application_id   Text (50)
bot_decision_id  Text (50, nullable)
reason           Text (200)
priority         Text (10)         ('low' | 'normal' | 'high')
status           Text (20)         ('pending' | 'reviewed')
reviewed_at      DateTime nullable
reviewed_by      Text (50, nullable)
created_at       DateTime
```

---

## 9. Métricas del bot (dashboard)

Pantalla `/admin/bot/dashboard`:

- Decisiones tomadas (auto + manual) últimos 7/30 días
- Tasa de override (overrideadas / total auto-ejecutadas)
- Confidence promedio
- Casos por stage (heatmap)
- Errores tipo I (rechazó a alguien que Cris hubiera pasado)
- Errores tipo II (pasó a alguien que Cris hubiera rechazado)
- Tiempo ahorrado estimado a Cris

---

## 10. Checklist de cierre Fase 21

- [ ] Tablas creadas: `BotDecisions`, `BotTrainingExamples`, `ReviewQueue`
- [ ] System prompt `BOT_DECISOR_SYSTEM_PROMPT` definido
- [ ] `services/botDecisor.ts` implementado
- [ ] `services/similarCases.ts` con scoring de similitud
- [ ] Endpoint interno `/api/internal/applications/:id/bot-decide`
- [ ] Worker que evalúa applications con scores nuevos
- [ ] UI: cola de revisión con confirmar/override
- [ ] UI: detalle de decisión con rationale + casos similares
- [ ] Tabla `Config` con thresholds por tenant + stage
- [ ] Pantalla admin de configuración del bot
- [ ] Servicio `botFeedback.reportIncorrectDecision`
- [ ] Pantalla "Selección de finalistas" para top 3 manual
- [ ] Dashboard de métricas del bot
- [ ] Smoke tests:
  - [ ] Candidato termina pruebas → bot evalúa transición
  - [ ] Confidence < threshold → cae en queue → Cris confirma o overridea
  - [ ] Override → BotTrainingExample creado → próxima decisión similar usa ese ejemplo
  - [ ] Confidence > threshold → auto-execute → app cambia stage → sync Recruit
  - [ ] Cris reporta decisión auto incorrecta → revierte etapa + crea example

---

## Siguiente paso

→ [22_OUTBOUND_SOURCING.md](22_OUTBOUND_SOURCING.md) — sourcing activo con HeyReach + DB propia.
