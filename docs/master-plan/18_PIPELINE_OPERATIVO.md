# 18 — Pipeline Operativo (Plan B)

**Objetivo:** SharkTalents absorbe el pipeline operativo del candidato (registro, prefiltro, etapas, decisiones, auto-rechazo). Zoho Recruit queda como **publicador en bolsas + ejecutor de notifs (email + WhatsApp)**. Sync unidireccional SharkTalents → Recruit en cada cambio de etapa para disparar workflows.

**Tiempo estimado:** 3 semanas.
**Dependencias:** Fase 13 (multitenant), Fase 14 (Clerk), Fase 23 (integraciones Zoho — Recruit API).
**Riesgo:** alto — cambio operativo grande para Cris. Requiere migración cuidadosa.

---

## Contexto: hoy vs después

### Hoy (Recruit-centric)
```
Candidato aplica en bolsa → cae en talento.kunodigital.com (Recruit)
  ↓
Llena form de Recruit con 4 preguntas filtradoras
  ↓
Recruit auto-filtra
  ↓
Cris cambia etapa MANUAL en Recruit → workflow → email + WhatsApp con link de prueba
  ↓
Candidato hace prueba en SharkTalents
  ↓
Cris se mete a SharkTalents a ver scores → decide
  ↓
Vuelve a Recruit, cambia etapa → next workflow
  ↓
... (manual, repetitivo, doble click constante)
```

### Después (SharkTalents-centric, Recruit como ejecutor)
```
Candidato aplica → cae en SharkTalents directamente (LinkedIn paga)
  o cae en Recruit landing → webhook → SharkTalents (hub gratis)
  ↓
SharkTalents maneja registro + prefiltro + auto-rechazo
  ↓
Bot decisor analiza scores y cambia etapa AUTO en SharkTalents
  ↓
SharkTalents → API call a Recruit → Recruit dispara workflow
  ↓
Recruit envía email + WhatsApp con link de siguiente prueba (templates ya existentes)
  ↓
Cris solo revisa cola de bajos confianza + decide top 3 finalistas
```

**Cris pasó de operador a supervisor.**

---

## Deliverables

- [ ] Página pública de aplicación (`sharktalents.ai/apply/<job-slug>`)
- [ ] Webhook receiver `/api/webhooks/recruit/candidate-created`
- [ ] Sync unidireccional SharkTalents → Recruit (cambio de etapa)
- [ ] Mapeo configurable de etapas SharkTalents ↔ Recruit
- [ ] Auto-rechazo automático por reglas (score técnico, salario, screen exits)
- [ ] Pipeline view operativa para Cris (kanban + filtros + cola de revisión)
- [ ] Endpoint para que Bot Decisor cambie etapas con confidence + rationale
- [ ] Idempotencia + retry en sync con Recruit
- [ ] Auditoría: cada cambio de etapa loguea origen (bot / Cris / sistema)

---

## 1. Páginas públicas de aplicación

### URL pattern

```
https://sharktalents.ai/apply/<tenant-slug>/<job-slug>
ej: https://sharktalents.ai/apply/kuno/senior-react-dev-acme
```

(Multi-tenant — tenant slug obligatorio en path. Después de v1 se puede agregar `<tenant>.sharktalents.ai/apply/<job-slug>` con custom domain por tenant.)

### Dos puntos de entrada

**1. Directo (LinkedIn paga, otros canales premium):**
- Cris configura el "Apply URL" del job en LinkedIn paga = `sharktalents.ai/apply/kuno/senior-dev`
- Candidato cae directo, llena registro completo en SharkTalents

**2. Vía Recruit (hub gratis: Google Jobs, etc.):**
- Recruit publica con su Apply URL default = `talento.kunodigital.com/...`
- Candidato registra en Recruit (form mínimo: nombre, email, teléfono, CV)
- Recruit dispara webhook → SharkTalents
- SharkTalents crea Candidate y le manda email: _"Hola Juan, completá tu aplicación acá → [link sharktalents.ai/continue/<token>]"_
- Candidato click → completa los pasos restantes en SharkTalents

### UX del registro directo

```
┌─────────────────────────────────────────────────────────────┐
│  SharkTalents · Senior React Developer · Acme Corp          │
├─────────────────────────────────────────────────────────────┤
│  Aplicar al puesto                                           │
│                                                              │
│  Tus datos                                                   │
│  Nombre completo *  [_______________________]               │
│  Email *            [_______________________]               │
│  Teléfono           [_______________________]               │
│  Edad *             [__]                                    │
│  Aspiración salarial mensual (USD) * [______]               │
│  Disponibilidad *   ( ) Inmediata                           │
│                     ( ) Necesito 15 días                    │
│                     ( ) Debo negociar con mi empresa        │
│                                                              │
│  Currículum (PDF, max 5MB) *  [Seleccionar archivo]         │
│                                                              │
│  Términos                                                    │
│  [✓] Acepto que mis respuestas sean analizadas con IA       │
│      para evaluación. Doy consent expreso al procesamiento  │
│      según política de privacidad.                          │
│                                                              │
│  [Continuar →]                                              │
└─────────────────────────────────────────────────────────────┘
```

Después del registro, pasa a las **4-7 preguntas filtradoras** del puesto (configuradas por Cris al crear el puesto).

```
┌─────────────────────────────────────────────────────────────┐
│  Senior React Developer · Acme Corp                          │
│                                                              │
│  Paso 2 de 3: Preguntas iniciales                           │
│                                                              │
│  1. ¿Manejás React 18 con TypeScript? *                     │
│     ( ) Sí, > 2 años                                        │
│     ( ) Sí, < 1 año                                         │
│     ( ) No                                                  │
│                                                              │
│  2. ¿Estás disponible en Panamá City? *                     │
│     ( ) Sí, presencial                                      │
│     ( ) Solo remoto                                         │
│     ( ) Híbrido                                             │
│                                                              │
│  3. ¿Tu rango salarial está entre USD 2500-3500? *          │
│     ( ) Sí, dentro del rango                                │
│     ( ) Más alto                                            │
│     ( ) Más bajo                                            │
│                                                              │
│  4. ¿Tenés experiencia liderando equipos de 3+? *           │
│     ( ) Sí                                                  │
│     ( ) No                                                  │
│                                                              │
│  [Continuar →]                                              │
└─────────────────────────────────────────────────────────────┘
```

Si **falla** alguna pregunta deal-breaker → auto-rechazo + email cortés:

```
"Gracias por aplicar a Senior React Developer. En esta oportunidad
no encontramos un match con los requisitos del puesto. Te tendremos
en cuenta para otros puestos compatibles con tu perfil. Saludos,
SharkTalents."
```

Si **pasa** → mensaje "te enviamos un email con el siguiente paso (prueba conductual)" + email automático con link DISC.

---

## 2. Webhook Recruit → SharkTalents

### Setup en Recruit

```
Setup → Automation → Workflow Rules
  → New rule
  → Module: Candidates
  → Trigger: On Create
  → Action: Webhook
  → URL: https://sharktalents.ai/api/webhooks/recruit/candidate-created
  → Method: POST
  → Auth: Custom Header X-Recruit-Webhook-Secret = <secret>
  → Body (JSON):
    {
      "candidate_id": "${Candidates.ID}",
      "name": "${Candidates.First_Name} ${Candidates.Last_Name}",
      "email": "${Candidates.Email}",
      "phone": "${Candidates.Mobile}",
      "applied_to_job_id": "${Candidates.Posting_Title}",
      "cv_attachment_url": "${Candidates.Resume}",
      "applied_at": "${Candidates.Created_Time}"
    }
```

### Endpoint receiver

```typescript
// handlers/webhooks/recruit.ts
export async function handleCandidateCreated(ctx: RequestContext) {
  const rawBody = await readRawBody(ctx.req);

  // Verificar secret (HMAC ideal, pero Recruit a veces solo soporta shared secret)
  const providedSecret = ctx.req.headers['x-recruit-webhook-secret'];
  const expectedSecret = getEnv('RECRUIT_WEBHOOK_SECRET');
  if (!timingSafeCompare(providedSecret, expectedSecret)) {
    throw new UnauthorizedError('Invalid webhook secret');
  }

  const payload = JSON.parse(rawBody);

  // Idempotencia
  const eventId = `recruit_candidate:${payload.candidate_id}`;
  const isNew = await db.processedEvents.markProcessed(ctx.req, eventId, 'recruit');
  if (!isNew) {
    return sendJson(ctx.res, 200, { received: true, duplicate: true });
  }

  // Responder 200 rápido
  sendJson(ctx.res, 200, { received: true });

  // Procesar async
  processCandidateCreatedAsync(ctx.req, payload).catch(err => {
    logger.error('Failed to process recruit webhook', { eventId, error: err.message });
  });
}

async function processCandidateCreatedAsync(req: any, payload: any): Promise<void> {
  // Lookup tenant y job (mapeo por nombre del puesto en Recruit)
  const job = await db.jobs.findByRecruitJobName(req, payload.applied_to_job_id);
  if (!job) {
    logger.warn('Recruit candidate for unknown job', { recruitJob: payload.applied_to_job_id });
    return;
  }

  // Crear candidato en SharkTalents
  const candidate = await db.candidates.upsertByEmail(req, job.tenant_id, {
    name: payload.name,
    email: payload.email,
    phone: payload.phone || '',
    recruit_candidate_id: payload.candidate_id,
    cv_url_recruit: payload.cv_attachment_url || '',
    created_at: db.now(),
  });

  // Crear "JobApplication" en estado initial
  await db.jobApplications.insert(req, {
    tenant_id: job.tenant_id,
    job_id: job.id,
    candidate_id: candidate.id,
    source: 'recruit_hub',
    current_stage: 'recruit_registered',
    created_at: db.now(),
  });

  // Mandar email al candidato con link para completar
  const continueToken = generateAccessToken();
  await db.continueTokens.insert(req, {
    candidate_id: candidate.id,
    job_id: job.id,
    token: continueToken,
    expires_at: addDays(db.now(), 7),
  });

  await db.outboxEvents.insert(req, {
    tenant_id: job.tenant_id,
    event_type: 'candidate.notify.continue_application',
    payload: JSON.stringify({
      candidate_id: candidate.id,
      job_id: job.id,
      continue_link: `${getEnv('APP_BASE_URL')}/continue/${continueToken}`,
    }),
    status: 'pending',
    created_at: db.now(),
  });
}
```

### Endpoint "continue application"

URL: `https://sharktalents.ai/continue/<token>`

Carga el candidate + job, lo lleva a las preguntas filtradoras (paso 2), y de ahí en adelante todo flow normal.

---

## 3. State machine del JobApplication

Tabla nueva `JobApplications` que representa la aplicación de un candidato a un puesto. Reemplaza/complementa la lógica de `Results`.

### Estados (enum)

```
applied                  -- aplicó (aún no completó preguntas filtradoras)
prefiltered_pending      -- esperando que conteste preguntas
prefiltered_pass         -- pasó prefiltro
prefiltered_failed       -- rechazado por prefiltro
disc_pending             -- email enviado, esperando que haga DISC
disc_completed           -- DISC hecho, esperando análisis
disc_passed              -- bot/Cris aprobó por DISC
review_cv_kudert         -- Cris revisa CV (estado intermedio)
disc_rejected            -- rechazado por DISC

technical_pending        -- esperando técnica
technical_completed
technical_passed
technical_rejected
technical_salary_oor     -- salario fuera de rango (separado de rechazo)

integrity_pending
integrity_completed
integrity_passed
integrity_rejected

video_pending            -- esperando 7 videos
video_completed
video_analyzed

finalist_proposed        -- bot sugirió como finalist
finalist_confirmed       -- Cris confirmó top 3
interview_scheduled
interview_completed
hired
declined_offer
withdrew                 -- candidato se bajó solo
```

### Transiciones (subset clave)

```
applied → prefiltered_pending → prefiltered_pass | prefiltered_failed
prefiltered_pass → disc_pending → disc_completed → disc_passed | disc_rejected | review_cv_kudert
disc_passed → technical_pending → technical_completed → technical_passed | technical_rejected | technical_salary_oor
technical_passed → integrity_pending → ... → integrity_passed
integrity_passed → video_pending → video_completed → video_analyzed
video_analyzed → finalist_proposed → finalist_confirmed → interview_scheduled → interview_completed → hired | declined_offer
```

(Cualquier estado puede ir a `withdrew` si el candidato abandona.)

### Implementación

`services/applicationStateMachine.ts`:

```typescript
const TRANSITIONS = {
  applied: ['prefiltered_pending', 'withdrew'],
  prefiltered_pending: ['prefiltered_pass', 'prefiltered_failed', 'withdrew'],
  prefiltered_pass: ['disc_pending', 'withdrew'],
  // ... resto del enum
};

export async function transition(
  req: any,
  applicationId: string,
  newStage: string,
  actor: { type: 'bot' | 'admin' | 'system' | 'webhook'; id?: string },
  reason?: string,
  confidence?: number
): Promise<void> {
  const app = await db.jobApplications.getById(req, applicationId);
  const current = app.current_stage;

  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(newStage)) {
    throw new ValidationError(`Invalid transition: ${current} → ${newStage}`);
  }

  if (current === newStage) return;

  await db.jobApplications.update(req, applicationId, {
    current_stage: newStage,
    last_transition_at: db.now(),
  });

  await db.applicationTransitions.insert(req, {
    tenant_id: app.tenant_id,
    application_id: applicationId,
    candidate_id: app.candidate_id,
    job_id: app.job_id,
    from_stage: current,
    to_stage: newStage,
    actor_type: actor.type,
    actor_id: actor.id || '',
    reason: reason || '',
    confidence: confidence || null,
    transitioned_at: db.now(),
  });

  // Sync con Recruit (outbox event)
  await db.outboxEvents.insert(req, {
    tenant_id: app.tenant_id,
    event_type: 'recruit.sync_stage',
    payload: JSON.stringify({
      application_id: applicationId,
      candidate_id: app.candidate_id,
      recruit_candidate_id: app.recruit_candidate_id,
      from_stage: current,
      to_stage: newStage,
    }),
    status: 'pending',
    created_at: db.now(),
  });

  logger.info(`Application transition`, {
    applicationId, from: current, to: newStage, actor: actor.type
  });
}
```

---

## 4. Sync unidireccional SharkTalents → Recruit

### Mapeo de etapas

Configurable en tabla `RecruitStageMappings`:

```
ROWID                     BigInt
tenant_id                 Text (50)
sharktalents_stage        Text (50)        ('disc_passed', 'technical_passed', etc.)
recruit_stage_name        Text (100)       ("Pasó DISC", "Pasó Técnica", etc.)
recruit_stage_id          Text (50, nullable)   (Recruit Stage ROWID si lo expone)
notification_template     Text (100, nullable)   (template de Recruit que se debe disparar)
```

### Worker outbox para `recruit.sync_stage`

```typescript
// services/outboxWorkers.ts
export async function processRecruitStageSync(req: any, event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload);
  const { recruit_candidate_id, to_stage, application_id } = payload;

  if (!recruit_candidate_id) {
    // Candidato vino de LinkedIn paga directo, no existe en Recruit todavía
    // Crearlo primero
    const created = await createInRecruit(req, payload);
    await db.candidates.update(req, payload.candidate_id, {
      recruit_candidate_id: created.id,
    });
    payload.recruit_candidate_id = created.id;
  }

  // Obtener mapeo de etapa
  const mapping = await db.recruitStageMappings.get(
    req, event.tenant_id, to_stage
  );
  if (!mapping) {
    logger.warn(`No Recruit mapping for stage ${to_stage}, skipping sync`);
    return;
  }

  // Update en Recruit
  await callRecruitApi(req, {
    method: 'PUT',
    path: `/Candidates/${payload.recruit_candidate_id}`,
    body: {
      data: [{
        Status: mapping.recruit_stage_name,
        // El cambio de Status en Recruit dispara su workflow asociado
      }],
    },
  });

  logger.info(`Synced to Recruit`, {
    recruit_candidate_id: payload.recruit_candidate_id,
    new_stage: mapping.recruit_stage_name,
  });
}
```

### Idempotencia

Cada `recruit.sync_stage` event tiene un `transition_id`. Si Recruit recibe el mismo update dos veces (raro), no dispara dos workflows porque internamente Recruit ve "ya estás en esa etapa".

Si el sync falla, outbox retry con backoff exponencial. Hasta 5 intentos.

### Crear candidato en Recruit (cuando vino directo de SharkTalents)

```typescript
async function createInRecruit(req: any, payload: any): Promise<{ id: string }> {
  const candidate = await db.candidates.getById(req, payload.candidate_id);
  const job = await db.jobs.getById(req, payload.tenant_id, payload.job_id);

  const result = await callRecruitApi(req, {
    method: 'POST',
    path: '/Candidates',
    body: {
      data: [{
        First_Name: candidate.name.split(' ')[0],
        Last_Name: candidate.name.split(' ').slice(1).join(' '),
        Email: candidate.email,
        Mobile: candidate.phone,
        Posting_Title: { id: job.recruit_posting_id },
        Source: 'SharkTalents Direct',
        Status: 'Aplicó',
      }],
    },
  });

  return { id: result.data[0].details.id };
}
```

---

## 5. Auto-rechazo automático

Reglas duras, ejecutadas por el sistema sin pasar por Bot Decisor:

| Condición | Acción |
|---|---|
| Salario expectativa > rango_max + 15% | → `technical_salary_oor` |
| Salario expectativa < rango_min - 20% | → `technical_salary_oor` (también, sospecha de mentira) |
| Score técnico < min_technical_score - 5% | → `technical_rejected` |
| Screen exits en técnica >= 5 | → `technical_rejected` (presunto trampa) |
| Screen exits en técnica >= 3 | → flag, NO auto-reject. Bot decisor lo evalúa con contexto. |
| Buena Impresión integridad > 70% | → flag, NO auto-reject. Bot decisor evalúa con contexto. |
| Cualquier dimensión integridad = 'alto' | → flag, NO auto-reject. Bot decisor evalúa. |

**Cris configura los thresholds** en cada job (`auto_reject_rules` JSON).

---

## 6. Pipeline view operativa para Cris

URL: `https://sharktalents.ai/admin/jobs/<id>/pipeline`

Reutiliza la vista actual pero ampliada con:
- Filtro adicional: "Cola de revisión del bot" (apps con `confidence < threshold`)
- Cada card muestra: rationale del bot, confidence%, auto-decisión propuesta
- Cris puede aceptar / overridear con un click

```
┌──────────────────────────────────────────────────────────────┐
│  Pipeline · Senior React Developer                            │
│                                                                │
│  [Todos] [Cola revisión (3)] [Auto-decididos (47)]             │
├──────────────────────────────────────────────────────────────┤
│  Aplicó (47) │ Prefilt (28) │ DISC (18) │ Técnica (12) │ ... │
│  ┌─────────┐ │  ┌──────────┐ │ ┌────────┐ │ ┌──────────┐│    │
│  │ Juan P. │ │  │ María L. │ │ │ Pedro G│ │ │ Ana S.   ││    │
│  │ ⚠ rev   │ │  │ Bot ✓   │ │ │ Bot ✓ │ │ │ Bot ?    ││    │
│  │ conf 42%│ │  │ conf 88%│ │ │ conf 95│ │ │ conf 65% ││    │
│  └─────────┘ │  └──────────┘ │ └────────┘ │ └──────────┘│    │
└──────────────────────────────────────────────────────────────┘
```

Cards en "Cola de revisión" tienen un click expandible:

```
┌─────────────────────────────────────────────────────────────┐
│  Juan Pérez · Confidence 42%                                  │
│  Bot sugiere: REJECT (DISC)                                   │
│                                                                │
│  Rationale:                                                    │
│  "DISC similar al ideal en D y C, pero S=85 muy alto vs       │
│   ideal=30. Perfil estable/cauteloso, no encaja con puesto    │
│   senior dev que requiere proactividad. Sin embargo, técnica  │
│   altísima (92%) sugiere capacidad. Caso ambiguo."             │
│                                                                │
│  Casos similares:                                             │
│  - Candidato #421 (puesto similar): Cris pasó a siguiente    │
│  - Candidato #523 (puesto similar): Cris rechazó              │
│                                                                │
│  [✓ Confirmar reject]   [✗ Override → Pasar a Técnica]       │
│  [↻ Devolver a etapa anterior]   [Ver perfil completo →]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Tablas nuevas

### `JobApplications`

```
ROWID                    BigInt
tenant_id                Text (50)
job_id                   Text (50)
candidate_id             Text (50)
source                   Text (30)         ('linkedin_paid' | 'recruit_hub' | 'manual' | 'outbound_sourcing')
recruit_candidate_id     Text (50, nullable)   (si pasó por Recruit)
current_stage            Text (50)
auto_reject_reason       Text (200, nullable)
last_transition_at       DateTime
created_at               DateTime
updated_at               DateTime
```

### `ApplicationTransitions` (append-only)

```
ROWID            BigInt
tenant_id        Text (50)
application_id   Text (50)
candidate_id     Text (50)
job_id           Text (50)
from_stage       Text (50, nullable)
to_stage         Text (50)
actor_type       Text (15)         ('bot' | 'admin' | 'system' | 'webhook')
actor_id         Text (50, nullable)
reason           Text (500)
confidence       Decimal (3,2, nullable)   (si fue bot)
transitioned_at  DateTime
```

### `PrefQuestions` (ex-`PrefilterQuestions` — renombrada 2026-05-11 por bug intermitente de Catalyst Schema API que dejó el nombre original "envenenado")

```
ROWID                BigInt
tenant_id            Text (50)
job_id               Text (50)
sort_order           Integer
question_text        Text (500)
question_type        Text (20)        ('single_choice' | 'multi_choice' | 'numeric' | 'boolean' | 'text')
options              Text (long)       JSON array (si es choice)
is_dealbreaker       Boolean           (si falla → reject)
correct_answer       Text (200, nullable)
weight               Integer           (1-10, opcional)
```

### `PrefilterAnswers`

```
ROWID            BigInt
tenant_id        Text (50)
application_id   Text (50)
question_id      Text (50)
answer           Text (500)
is_correct       Boolean nullable
weighted_score   Integer nullable
created_at       DateTime
```

### `RecruitStageMappings`

```
ROWID                     BigInt
tenant_id                 Text (50)
sharktalents_stage        Text (50)
recruit_stage_name        Text (100)
notification_template     Text (100, nullable)
```

### `ContinueTokens`

```
ROWID            BigInt
candidate_id     Text (50)
job_id           Text (50)
token            Text (64, unique check)
expires_at       DateTime
used_at          DateTime nullable
created_at       DateTime
```

---

## 8. Bot decisor — gancho

Las decisiones automáticas las toma el **bot decisor** (ver [21_BOT_DECISOR.md](21_BOT_DECISOR.md)). Este doc solo expone la API que el bot consume:

```
POST /api/internal/applications/:id/transition
  body: {
    to_stage: 'disc_passed',
    actor: 'bot',
    confidence: 0.88,
    rationale: "...",
    similar_cases: [123, 456]
  }
  
GET /api/internal/applications/needs-review
  query: ?confidence_max=0.7&job_id=...
```

Solo accesible con `INTERNAL_API_KEY`.

---

## 9. Migración: NO migración de data legacy

Confirmado en el brief: "todo esto comienza de 0 nada de lo que había me interesa en este nivel". 

Implicación:
- No se importan candidatos viejos de Recruit/SharkTalents previo
- Sistema arranca limpio el día 1
- Cris hace cleanup de candidatos viejos en Recruit por su cuenta si quiere

---

## 10. Checklist de cierre Fase 18

- [ ] Tablas creadas: `JobApplications`, `ApplicationTransitions`, `PrefilterQuestions`, `PrefilterAnswers`, `RecruitStageMappings`, `ContinueTokens`
- [ ] Página pública `/apply/<tenant>/<job>` funcional
- [ ] Página `/continue/<token>` funcional
- [ ] Webhook `/api/webhooks/recruit/candidate-created` con verificación HMAC/secret
- [ ] Idempotencia en webhook (ProcessedEvents)
- [ ] Servicio `applicationStateMachine.transition()` con validación
- [ ] Worker outbox `recruit.sync_stage` que llama a Recruit API
- [ ] `Recruit API client` en `integrations/zohoRecruit.ts` con auth OAuth
- [ ] Mapeo de etapas configurable en pantalla admin
- [ ] Auto-rechazo por reglas duras
- [ ] Cola de revisión del bot en pipeline view
- [ ] Smoke tests:
  - [ ] Candidato aplica directo (LinkedIn paga simulated) → cae en SharkTalents → pasa prefiltro → email DISC enviado
  - [ ] Candidato aplica via Recruit (webhook simulated) → email continue → completa SharkTalents
  - [ ] Bot cambia etapa → Recruit recibe update → workflow Recruit dispara email simulado
  - [ ] Sync con Recruit falla 1 vez → retry exitoso
  - [ ] Sync fail definitivo → loguea + alerta
  - [ ] Rechazo automático por salario fuera de rango → email apropiado al candidato

---

## Siguiente paso

→ [19_PRUEBA_TECNICA_DOBLE_EJE.md](19_PRUEBA_TECNICA_DOBLE_EJE.md) — la prueba técnica con doble puntaje y match de estilo.
