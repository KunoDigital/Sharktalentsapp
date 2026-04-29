# 22 — Outbound Sourcing (HeyReach + DB propia)

**Objetivo:** dejar de ser "pasivo" esperando que candidatos apliquen. Buscar activamente en LinkedIn (vía HeyReach API) y en la propia DB de SharkTalents (CandidatePool con candidatos históricos). Cris define filtros, sistema sugiere, Cris elige y dispara campañas con templates personalizados.

**Tiempo estimado:** 2 semanas.
**Dependencias:** Fase 13 (multitenant), Fase 18 (pipeline operativo). HeyReach account + cuenta LinkedIn dedicada para sourcing.
**Riesgo:** medio-bajo a tu volumen (10-15 candidatos/puesto). HeyReach es tool comprada con API legítima.

---

## La estrategia en 2 capas

### Capa 1 — Sourcing interno (DB propia)

Construido por nosotros. **Costo: $0/mes.**

Cuando hay puesto nuevo, sistema sugiere candidatos del CandidatePool (candidatos históricos que pasaron pruebas para puestos similares pero fueron descartados o no avanzaron). Cris les escribe.

**Por qué es valioso:** se acumula. Después de 6-12 meses con varios puestos, esta DB es **moat competitivo**. Cada puesto la enriquece.

### Capa 2 — Sourcing externo (HeyReach)

Tool comprada. **Costo: $79/mes.**

LinkedIn outreach automatizado vía API. Cris define filtros, HeyReach busca y manda invites + mensajes de follow-up con sequences. Riesgo de ban de LinkedIn bajo a este volumen.

**Cuenta dedicada:** Cris tiene 2 cuentas LinkedIn:
- Personal (con su network real) — NUNCA conectada a tools
- SharkTalents/Kuno sourcing — conectada a HeyReach

Si HeyReach causa warning, no perdés la red profesional principal.

---

## Deliverables

- [ ] Tabla `CandidatePool` (extiende Candidates con tags + disponibilidad)
- [ ] Algoritmo de matching candidato ↔ puesto nuevo
- [ ] Pantalla "Sugerencias para este puesto" (top 10 del pool)
- [ ] Tabla `OutreachCampaigns` (HeyReach sourcing)
- [ ] Integración con HeyReach API (search, sequence, webhooks)
- [ ] Templates de mensajes (LinkedIn DM + WhatsApp + email) por tipo de puesto
- [ ] Inbox unificado en SharkTalents (respuestas de LinkedIn caen acá)
- [ ] Tracking de outreach (a quién se contactó, cuándo, respuesta)
- [ ] Cuando candidato responde positivo → Cris le manda link de aplicación

---

## 1. Capa 1 — Sourcing interno

### Concepto

```
Cuando se publica un puesto nuevo en SharkTalents:
  ↓
Sistema busca en CandidatePool candidatos:
  - Del mismo tenant
  - Con scores históricos compatibles con el perfil ideal del puesto nuevo
  - Que NO hayan sido aplicados a este puesto todavía
  - Que estén marcados como "disponible para outreach"
  ↓
Devuelve top 10-20 ordenados por match
  ↓
Cris ve la lista, elige los que le interesan
  ↓
Sistema arma mensaje personalizado (con template + IA) con:
  - Por qué se contactó (rationale corto)
  - Detalles del puesto
  - Link de aplicación rápida (con prefiltro skipped — ya pasaron por SharkTalents antes)
  ↓
Mensaje sale por email o WhatsApp (canal de preferencia del candidato)
  ↓
Tracking: quién respondió, abrió, ignoró
```

### Algoritmo de matching

```typescript
// services/internalSourcing.ts
export async function findCandidatesForJob(
  req: any,
  tenantId: string,
  jobId: string,
  limit = 20
): Promise<MatchedCandidate[]> {
  const job = await db.jobs.getFullProfile(req, tenantId, jobId);
  const idealProfile = job.profile;

  // 1. Pull candidates del pool del tenant que NO aplicaron a este puesto
  const candidates = await db.candidatePool.listAvailable(req, tenantId, jobId);

  // 2. Score cada candidato según match con perfil ideal
  const scored = candidates.map(c => ({
    candidate: c,
    matchScore: calculateMatch(c, idealProfile),
  }));

  // 3. Ordenar y limitar
  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit).map(s => ({
    ...s.candidate,
    match_score: s.matchScore,
    match_reasoning: explainMatch(s.candidate, idealProfile),
  }));
}

function calculateMatch(candidate, ideal): number {
  let score = 0;
  
  // DISC similarity (peso: 30)
  if (candidate.disc && ideal.disc) {
    const diff = Object.keys(ideal.disc).reduce((sum, k) => 
      sum + Math.abs(ideal.disc[k] - candidate.disc[k]), 0);
    score += Math.max(0, 30 - diff / 5);
  }
  
  // Cognitive level match (peso: 20)
  if (candidate.cognitive_level === ideal.cognitive_level) score += 20;
  
  // Technical area match (peso: 25)
  if (candidate.tags?.includes(ideal.area_tag)) score += 25;
  
  // Idiomas (peso: 10)
  if (ideal.requires_english && candidate.languages?.includes('en')) score += 10;
  
  // Disponibilidad reciente (peso: 15)
  const monthsSinceLastUpdate = monthsBetween(candidate.last_active, new Date());
  if (monthsSinceLastUpdate < 6) score += 15;
  else if (monthsSinceLastUpdate < 12) score += 8;
  
  return score;
}
```

### Pantalla "Sugerencias del pool"

URL: `https://sharktalents.ai/admin/jobs/<id>/sourcing/internal`

```
┌──────────────────────────────────────────────────────────────┐
│  Sourcing interno · Senior React Developer · Acme Corp        │
├──────────────────────────────────────────────────────────────┤
│  20 candidatos del pool histórico matchean este puesto:        │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ ✓  María López                                Match 94%  │ │
│  │    DISC compatible · Senior dev · React, TS              │ │
│  │    Aplicó a "Senior FE Bancario" hace 4 meses (3rd)     │ │
│  │    Disponible para outreach                              │ │
│  │    Contacto: maria@example.com · WhatsApp ✓              │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ ✓  Juan Pérez                                 Match 87%  │ │
│  │    ...                                                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ...                                                           │
│                                                                │
│  Seleccionados: 8                                              │
│  [Generar mensaje y enviar →]                                  │
└──────────────────────────────────────────────────────────────┘
```

### Generación del mensaje

Template + IA por candidato (o por lotes pequeños):

```typescript
// services/outreachMessageGen.ts
export async function generateOutreachMessage(
  req: any,
  candidate: Candidate,
  job: Job,
  channel: 'email' | 'whatsapp'
): Promise<string> {
  const response = await anthropicCall(req, {
    action: 'generate_outreach_message',
    timeout: 10000,
    system: OUTREACH_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `
CANDIDATO:
- Nombre: ${candidate.name}
- Aplicó previamente a: ${candidate.previous_jobs.join(', ')}
- Scores destacados: ${formatScores(candidate.scores)}

PUESTO NUEVO:
- Título: ${job.title}
- Empresa: ${job.company}
- Por qué le podría interesar: ${job.value_props}

CANAL: ${channel}

Generá un mensaje breve (max 80 palabras para WhatsApp, 120 para email),
personalizado, no spam. Ofrecele aplicar con un link rápido.
      `.trim(),
    }],
  });
  return response.text;
}
```

### Link de aplicación rápida

Como el candidato ya pasó por SharkTalents antes (o por Recruit), tiene un `recruit_candidate_id` y/o un `candidate_id`. Generamos un link especial:

```
sharktalents.ai/apply-quick/<token>
```

Que pre-popula los datos personales y solo le pide:
- Confirmar interés en el puesto específico
- Las 4 preguntas filtradoras del puesto

Si pasa el prefiltro → directamente recibe link de pruebas (skipping registro).

---

## 2. Capa 2 — HeyReach (LinkedIn outbound)

### Cómo funciona

```
Cris quiere buscar para Senior Dev en Panamá:
  ↓
Pantalla "Buscar en LinkedIn" en SharkTalents
  ↓
Cris define filtros (vía form intuitivo):
  - Título: "Senior Developer" OR "Lead Developer" OR "Sr Engineer"
  - Skills: React, TypeScript
  - Ubicación: Panamá City, Panamá
  - Industria: Tech, Software, Banca
  - Experiencia: 5-10 años
  ↓
SharkTalents llama a HeyReach API → busca en LinkedIn
  ↓
HeyReach devuelve 30-50 perfiles que matchean
  ↓
Pantalla muestra los perfiles (foto, título, empresa, ubicación)
  ↓
Cris elige 10-15 (los que mejor le pintan)
  ↓
SharkTalents agrega a "Campaign" en HeyReach con un template
  ↓
HeyReach automatiza:
  - Día 0: invite + mensaje 1 (template + IA personalizada)
  - Día 3: follow-up si aceptó conexión pero no respondió
  - Día 7: último intento si nada
  ↓
Cuando alguien responde:
  → Webhook HeyReach → SharkTalents
  → SharkTalents crea entrada en inbox unificado
  → Cris responde desde SharkTalents (que reenvía via HeyReach API)
  ↓
Cuando candidato muestra interés:
  → Cris le manda link de aplicación
  → Candidato cae en flow normal (cae en SharkTalents apply page)
```

### Integración HeyReach API

```typescript
// integrations/heyReach.ts

const HEY_REACH_API = 'https://api.heyreach.io/v1';

export async function searchLinkedInProfiles(
  filters: HeyReachFilters
): Promise<LinkedInProfile[]> {
  const res = await fetch(`${HEY_REACH_API}/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getEnv('HEYREACH_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        keywords: filters.titleKeywords,
        skills: filters.skills,
        location: filters.location,
        industries: filters.industries,
        experience_years_min: filters.experienceMin,
        experience_years_max: filters.experienceMax,
      },
      limit: 50,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`HeyReach search failed: ${res.status}`);
  const data = await res.json();
  return data.profiles;
}

export async function createCampaign(opts: {
  name: string;
  inboxId: string;
  profileIds: string[];
  sequence: HeyReachSequence;
}): Promise<{ campaignId: string }> {
  const res = await fetch(`${HEY_REACH_API}/campaigns`, {
    method: 'POST',
    headers: { /* ... */ },
    body: JSON.stringify(opts),
  });
  /* ... */
}

export async function getInboxMessages(inboxId: string, since?: Date) {
  /* poll para nuevos mensajes */
}

export async function sendReply(
  inboxId: string,
  conversationId: string,
  message: string
) {
  /* ... */
}
```

### Webhook receiver

HeyReach soporta webhooks para eventos:
- `connection_accepted`
- `message_received`
- `campaign_completed`

Endpoint en SharkTalents:

```typescript
// handlers/webhooks/heyreach.ts
export async function handleHeyReachWebhook(ctx: RequestContext) {
  const rawBody = await readRawBody(ctx.req);
  
  // Verificar firma
  const sig = ctx.req.headers['x-heyreach-signature'];
  if (!verifyHeyReachSignature(rawBody, sig)) {
    throw new UnauthorizedError('Invalid signature');
  }

  const event = JSON.parse(rawBody);

  // Idempotencia
  const isNew = await db.processedEvents.markProcessed(ctx.req, event.id, 'heyreach');
  if (!isNew) return sendJson(ctx.res, 200, { duplicate: true });

  sendJson(ctx.res, 200, { received: true });

  // Procesar async según tipo
  switch (event.type) {
    case 'message_received':
      await handleInboundMessage(ctx.req, event);
      break;
    case 'connection_accepted':
      await handleConnectionAccepted(ctx.req, event);
      break;
    /* ... */
  }
}

async function handleInboundMessage(req: any, event: any) {
  // Crear entry en inbox unificado
  await db.outreachInbox.insert(req, {
    tenant_id: event.tenant_id,
    source: 'heyreach',
    campaign_id: event.campaign_id,
    profile_id: event.profile_id,
    profile_name: event.profile_name,
    message_text: event.message,
    received_at: new Date(event.received_at),
    status: 'unread',
    created_at: db.now(),
  });

  // Notificar a Cris (notif push, email, o solo dashboard)
}
```

### Inbox unificado

URL: `https://sharktalents.ai/admin/outreach/inbox`

```
┌──────────────────────────────────────────────────────────────┐
│  Inbox de outreach · 5 nuevas                                  │
├──────────────────────────────────────────────────────────────┤
│  ● Pedro Gómez (LinkedIn) · Senior Dev Acme                  │
│    "Hola, vi tu mensaje. Me interesa saber más..."           │
│    Hace 2h                                                    │
│  ─────────────────────────────                                │
│    María López (LinkedIn) · Senior FE Bancario               │
│    "Gracias pero no estoy buscando..."                       │
│    Ayer                                                       │
│  ─────────────────────────────                                │
│  ● Juan Pérez (Email — pool) · Senior Dev Acme               │
│    "Sí, me interesa. ¿Cuándo puedo aplicar?"                 │
│    Hace 30 min                                                │
└──────────────────────────────────────────────────────────────┘
```

Click en uno → conversación full + acciones:
- Responder directo (envía via API correspondiente)
- "Mandar link de aplicación" → genera link y manda
- "Marcar interesado / no interesado / standby"

---

## 3. Tablas nuevas

### `CandidatePool`

Extiende `Candidates` con metadata de pool:

```
ROWID                    BigInt
tenant_id                Text (50)
candidate_id             Text (50, unique)
tags                     Text (long)        JSON array (skills, area, language)
disponible_para_outreach Boolean (default true)
last_active              DateTime           (última vez que aplicó o respondió)
contact_preference       Text (10)          ('email' | 'whatsapp' | 'linkedin')
times_contacted          Integer (default 0)
last_contacted_at        DateTime nullable
notes_internal           Text (long, nullable)
created_at               DateTime
updated_at               DateTime
```

(Cuando un Candidate completa un Application, se inserta/updatea en CandidatePool con tags derivados de scores y job.)

### `OutreachCampaigns`

```
ROWID                BigInt
tenant_id            Text (50)
job_id               Text (50)
source               Text (20)         ('internal_pool' | 'heyreach_linkedin')
external_id          Text (100, nullable)   (HeyReach campaign ID)
filters              Text (long)        JSON (filtros usados)
target_count         Integer
contacted_count      Integer
responded_count      Integer
positive_count       Integer
negative_count       Integer
created_by_user      Text (50)
status               Text (20)         ('draft' | 'active' | 'paused' | 'completed')
created_at           DateTime
updated_at           DateTime
```

### `OutreachContacts`

Una row por persona contactada en una campaign:

```
ROWID                BigInt
tenant_id            Text (50)
campaign_id          Text (50)
candidate_id         Text (50, nullable)   (si está en pool propio)
external_profile_id  Text (100, nullable)  (HeyReach profile ID)
profile_name         Text (255)
profile_title        Text (255, nullable)
profile_company      Text (255, nullable)
profile_location     Text (200, nullable)
profile_url          Text (500, nullable)
status               Text (20)         ('queued' | 'sent' | 'connection_accepted' | 'replied' | 'positive' | 'negative' | 'no_response')
sent_at              DateTime nullable
last_message_at      DateTime nullable
applied_at           DateTime nullable
created_at           DateTime
```

### `OutreachInbox`

Mensajes recibidos (de cualquier canal):

```
ROWID            BigInt
tenant_id        Text (50)
campaign_id      Text (50, nullable)
contact_id       Text (50, nullable)
source           Text (20)         ('email' | 'whatsapp' | 'linkedin')
sender_name      Text (255)
sender_id        Text (100)        (email, phone, o LinkedIn profile id)
message_text     Text (long)
received_at      DateTime
status           Text (20)         ('unread' | 'read' | 'replied' | 'archived')
read_at          DateTime nullable
replied_at       DateTime nullable
created_at       DateTime
```

---

## 4. UX en SharkTalents

### Pantalla "Sourcing" en cada puesto

URL: `https://sharktalents.ai/admin/jobs/<id>/sourcing`

Tabs:
- **Pool interno** — sugerencias de la DB propia (Capa 1)
- **LinkedIn (HeyReach)** — buscar afuera (Capa 2)
- **Campañas activas** — ver qué hay en marcha
- **Inbox** — respuestas recibidas

### Flow Cris (operación diaria)

```
1. Abrir SharkTalents → ver dashboard
2. Si hay puesto necesitando sourcing → click "Buscar candidatos"
3. Pestaña "Pool interno": ver sugerencias → elegir 5-8 → enviar (auto)
4. Pestaña "LinkedIn": definir filtros → buscar → elegir 10-15 → enviar campaign
5. Volver mañana → revisar inbox → responder positivos → mandar link aplicación
6. Resto del día: revisar cola del bot, finalizar reportes
```

Tiempo estimado de sourcing: 15-20 min/día.

---

## 5. Templates de mensajes

### Por canal

Tabla `OutreachTemplates`:

```
ROWID            BigInt
tenant_id        Text (50)
template_key     Text (50)         ('linkedin_invite_initial', 'email_initial', 'whatsapp_initial', 'linkedin_followup_1', etc.)
language         Text (10)
subject          Text (200, nullable)
body             Text (long)
variables        Text (long)        JSON: ['candidate_first_name', 'job_title', 'company', 'value_prop']
created_by       Text (50)
created_at       DateTime
updated_at       DateTime
```

### Ejemplo: LinkedIn invite

```
template_key: linkedin_invite_initial
body:
"Hola {{candidate_first_name}}, vi tu perfil y me llamó la atención
tu experiencia en {{relevant_skill}}. Estoy buscando para una vacante
de {{job_title}} en {{company}}. ¿Te interesaría que te cuente más?"
```

### Personalización con IA

Cuando se envía un mensaje, la IA recibe:
- Template
- Datos del candidato (perfil, experiencia)
- Datos del puesto

Y devuelve el mensaje **personalizado** (sustituye variables y refina el lenguaje según contexto). Si la IA no agrega valor (caso simple), simplemente sustituye variables.

---

## 6. Métricas de outreach

Pantalla `/admin/outreach/dashboard`:

- Campañas activas / completadas / paused
- Total contactados (mes / total)
- Reply rate por canal (LinkedIn, email, WhatsApp)
- Conversión a aplicación (de los que respondieron, ¿cuántos aplicaron?)
- Top fuentes de candidatos contratados (pool / HeyReach / etc.)
- Costo promedio por candidato contactado (incluye HeyReach prorrateado)

---

## 7. Riesgo y mitigación

### Cuenta LinkedIn dedicada

- Crear cuenta `sourcing@kunodigital.com` con perfil profesional pero NO la principal de Cris.
- Conectar SOLO esa cuenta a HeyReach.
- Si se banea, no se pierde la red personal de Cris.

### Volumen seguro

A 10-15 candidatos por puesto, máximo 3-5 puestos activos = 30-75 invites/mes. Muy por debajo del threshold de detección (100+/día sostenido).

### Compliance

- Cada mensaje debe tener opción de "no quiero recibir más" (HeyReach lo soporta).
- No insistir más de 2 follow-ups.
- Respetar respuestas negativas (marcar contacto y no reuse en 6 meses).

---

## 8. Future: agregar Apollo (Capa 3 opcional)

Si en mes 6 el reply rate de LinkedIn es bajo, agregar **Apollo.io** (~$60/mes) para:
- Mismas búsquedas pero con email outreach
- Diversificación de canal
- Total stack: Pool ($0) + HeyReach ($79) + Apollo ($60) = **$139/mes**

Apollo se integra similar a HeyReach (API + webhooks). Plug-and-play sobre la arquitectura ya construida.

---

## 9. Checklist de cierre Fase 22

- [ ] Tablas creadas: `CandidatePool`, `OutreachCampaigns`, `OutreachContacts`, `OutreachInbox`, `OutreachTemplates`
- [ ] Algoritmo de matching candidato ↔ puesto en `services/internalSourcing.ts`
- [ ] Pantalla "Sourcing interno" funcional
- [ ] Integración `integrations/heyReach.ts` con search + campaign + reply API
- [ ] Webhook receiver `/api/webhooks/heyreach` con verificación de firma
- [ ] Pantalla "LinkedIn (HeyReach)" con form de filtros + selección
- [ ] Inbox unificado con respuestas de pool + LinkedIn
- [ ] `services/outreachMessageGen.ts` con templates + personalización IA
- [ ] Link "apply-quick" para candidatos del pool con prefiltro skipped
- [ ] Métricas de outreach en dashboard
- [ ] Cuenta LinkedIn dedicada creada y conectada a HeyReach
- [ ] Env var `HEYREACH_API_KEY` + `HEYREACH_WEBHOOK_SECRET` configuradas
- [ ] Smoke tests:
  - [ ] Crear puesto nuevo → ver sugerencias del pool con scores realistas
  - [ ] Buscar en HeyReach → recibir lista de perfiles
  - [ ] Crear campaña con 5 perfiles → HeyReach manda invites
  - [ ] Simular respuesta → llega a inbox de SharkTalents
  - [ ] Cris responde desde inbox → llega via HeyReach → loguea
  - [ ] Candidato del pool recibe email de outreach → click → cae en apply-quick → aplica al puesto

---

## Siguiente paso

→ [23_INTEGRACIONES_ZOHO.md](23_INTEGRACIONES_ZOHO.md) — todas las integraciones con Zoho (Recruit, Meeting, Bookings, Sign, Zia).
