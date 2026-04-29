# 17 — Portal del Cliente

**Objetivo:** experiencia premium del cliente que contrata a SharkTalents. Onboarding via reunión grabada con Zia → IA construye perfil → cliente aprueba → tracking en vivo del embudo (Uber Eats style) → notificaciones por hito → entrega de 3 finalistas.

**Tiempo estimado:** 3 semanas.
**Dependencias:** Fase 13 (multitenant), Fase 14 (Clerk), Fase 23 (integraciones Zoho).
**Riesgo:** medio — UI nueva extensa + integraciones Zoho críticas.

---

## Filosofía del portal

El cliente NO es un usuario operativo de SharkTalents. Es un comprador de un servicio premium. Su experiencia debe sentirse como un servicio personal, no como "te dimos acceso a una herramienta".

Cris hace todo el trabajo pesado (definir perfil, evaluar candidatos, decidir top 3). El portal del cliente expone **solo el resultado y el progreso**, nunca la complejidad operativa.

**Reglas duras:**
- ❌ El cliente NO ve candidatos individuales hasta los 3 finalistas
- ❌ El cliente NO ve scores crudos, solo análisis comparativo
- ❌ El cliente NO opera el sistema (no cambia etapas, no rechaza, no revisa)
- ✅ El cliente SÍ ve progreso del embudo en tiempo real
- ✅ El cliente SÍ aprueba el perfil de cargo antes de que arranque la búsqueda
- ✅ El cliente SÍ recibe notificaciones por hito (correo + WhatsApp)

---

## Deliverables

- [ ] Integración Zoho Bookings con auto-record obligatorio (camino TBD según verificación de settings)
- [ ] Webhook/polling para detectar meetings de onboarding completados
- [ ] Descarga programática de transcript de Zia
- [ ] Servicio "Construir perfil" — Claude procesa transcript con system prompt portado del proyecto actual de Cris
- [ ] Pantalla admin: revisar/editar borrador del perfil generado
- [ ] Email al cliente con link al portal para aprobar/comentar el perfil
- [ ] Vista pública del portal del cliente:
  - Aprobación de perfil
  - Tracking embudo en vivo
  - Vista de finalistas (cuando estén)
- [ ] Sistema de notificaciones por hito (email + WhatsApp via Recruit/proveedor)
- [ ] 4 hitos definidos con templates: perfil_listo, busqueda_iniciada, embudo_lleno, finalistas_listos

---

## 1. Flujo completo del cliente

```
DÍA 0 — Cliente contacta a Kuno por puesto nuevo
  ↓
Cris le manda link de Zoho Bookings: "Onboarding cliente — Definición de puesto"
  ↓
Cliente reserva → recibe confirmación con texto de consent ("Esta reunión será grabada...")
  ↓
DÍA 1 — Reunión Cris + Cliente (Zoho Meeting, auto-record activado)
  ↓
Termina meeting → Zia transcribe automáticamente (5-10 min)
  ↓
Cris entra a SharkTalents → "Nuevo puesto" → "Importar de Zoho Meeting"
  ↓
Sistema lista meetings recientes que matchean título "Onboarding"
  ↓
Cris elige el correcto → designa cliente/empresa
  ↓
Sistema descarga transcript via API Zoho Meeting
  ↓
Claude procesa con system prompt portado → genera borrador del perfil
  ↓
DÍA 1-2 — Cris edita el borrador hasta que esté bien
  ↓
Aprueba → email automático al cliente:
  "Hola [Cliente], el perfil de [Puesto] está listo para tu revisión.
   Entrá al portal para aprobarlo o comentar: [link]"
  ↓
Cliente entra al portal → ve el perfil estructurado
  - Título y descripción del puesto
  - Responsabilidades
  - Competencias clave
  - Perfil DISC ideal del candidato
  - Salario / disponibilidad / requisitos
  ↓
Cliente puede:
  - "Aprobar" → arranca la búsqueda
  - "Solicitar cambios" → comentarios puntuales → Cris ajusta → vuelve al cliente
  ↓
Aprobado → SharkTalents publica en LinkedIn / Recruit / etc.
  ↓
Email al cliente: "Tu búsqueda arrancó. Te avisaremos en cada hito."
  ↓
DÍAS 3-15 — Embudo se llena
  ↓
Cliente puede entrar al portal cuando quiera y ver tracking en vivo (Uber Eats style)
  ↓
Email al cliente cuando se llena el embudo (X candidatos en pruebas):
  "Tu embudo tiene 12 candidatos en evaluación. Te avisamos cuando tengamos finalistas."
  ↓
DÍA 15-25 — Bot decide finalistas, Cris valida top 3
  ↓
Email + WhatsApp al cliente:
  "¡Tus 3 finalistas están listos! Entrá al portal para revisar el reporte."
  ↓
Cliente entra al portal → ve reporte completo (existente, ya cubierto en plan original)
  ↓
Cris agenda entrevistas presenciales con los 3 (en otro tool — TBD si Bookings o Calendly)
  ↓
Cobro 100% al entregar 3 finalistas (trigger del state machine)
```

---

## 2. Construcción del perfil desde transcript

### Pantalla admin "Construir perfil"

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│  Construir perfil del puesto — [Cliente: Acme Corp]         │
├─────────────────────────────────────────────────────────────┤
│  Source: Meeting "Onboarding cliente Acme - 28/04/2026"     │
│  Transcript original: [Ver / Descargar]                     │
├─────────────────────────────────────────────────────────────┤
│  Borrador generado por IA (editable):                       │
│                                                              │
│  Título: [Senior React Developer                ]           │
│  Empresa cliente: [Acme Corp                    ]           │
│  Nivel cognitivo: ( ) básico ( ) medio (•) senior          │
│                                                              │
│  Descripción del puesto:                                     │
│  [textarea con texto generado, editable]                    │
│                                                              │
│  Responsabilidades clave (editables):                        │
│  - [✏ Liderar el frontend de la nueva plataforma]          │
│  - [✏ Definir arquitectura de componentes]                 │
│  - [+ Agregar]                                              │
│                                                              │
│  Perfil DISC ideal:                                          │
│  D [====    ] 60   I [======  ] 70                          │
│  S [==      ] 30   C [======  ] 70                          │
│  PK detectado: PK-04 — Perfeccionista/Planificado/Resultado │
│                                                              │
│  Datos del jefe directo:                                     │
│  Nombre: [Carlos Pérez                          ]           │
│  Estilo (DISC opcional): [✏ Importar / Nuevo]              │
│                                                              │
│  Competencias clave (max 5):                                 │
│  - [Liderazgo (75)]   [✏] [×]                              │
│  - [Comunicación digital (80)]                              │
│  - [+ Agregar]                                              │
│                                                              │
│  Salario rango: [USD 2500] — [USD 3500]                     │
│  Disponibilidad requerida: [Inmediata]                      │
│  Modalidad: [Presencial Panamá City]                        │
│                                                              │
│  Prompt técnico para generación de pruebas:                  │
│  [textarea con prompt generado]                             │
│                                                              │
│  Preguntas filtradoras (4):                                 │
│  - [✏ ¿Manejás React 18 con TypeScript?]                   │
│  - [✏ ¿Estás disponible en Panamá City?]                   │
│  - [✏ ¿Tu rango salarial está entre USD 2500-3500?]        │
│  - [✏ ¿Tenés experiencia liderando equipos de 3+?]         │
├─────────────────────────────────────────────────────────────┤
│  [Volver a generar con IA]  [Guardar borrador]              │
│  [Aprobar y enviar al cliente para revisión] →              │
└─────────────────────────────────────────────────────────────┘
```

### Servicio de generación

`services/profileBuilder.ts`:

```typescript
export async function buildProfileFromTranscript(
  req: any,
  tenantId: string,
  meetingId: string,
  transcript: string,
  clientName: string
): Promise<JobProfileDraft> {
  // System prompt portado del proyecto Claude actual de Cris
  const systemPrompt = await loadSystemPromptFromConfig(req, 'profile_builder');

  const response = await anthropicCall(req, {
    action: 'build_profile_from_transcript',
    timeout: 30000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `
TRANSCRIPT DE LA REUNIÓN CON EL CLIENTE "${clientName}":

${transcript}

Genera un perfil de cargo estructurado siguiendo el formato JSON acordado.
      `.trim(),
    }],
  });

  // Validar shape del output
  const profile = parseAndValidate(response, JobProfileSchema);

  // Guardar como draft
  const draft = await db.jobProfileDrafts.insert(req, {
    tenant_id: tenantId,
    meeting_id: meetingId,
    client_name: clientName,
    raw_transcript_hash: hash(transcript),
    profile_json: JSON.stringify(profile),
    status: 'draft',
    created_at: db.now(),
  });

  return draft;
}
```

### System prompt — portado del proyecto Claude actual

Hoy Cris tiene un proyecto de Claude.ai con un system prompt que sabe construir perfiles. Hay que **portarlo tal cual** a una constante en `lib/prompts/profileBuilder.ts` o a `Config` (tabla) para que sea editable sin redeploy.

**Decisión:** lo guardamos en tabla `Config` con clave `prompt:profile_builder`. Cris puede editarlo desde un panel admin si quiere afinarlo.

---

## 3. Pantalla cliente: aprobar perfil

URL: `https://sharktalents.ai/cliente/perfil/<job_id>?token=<access_token>`

```
┌─────────────────────────────────────────────────────────────┐
│  SharkTalents · Acme Corp · 28 Abr 2026                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Tu perfil está listo para revisión                         │
│                                                              │
│  Senior React Developer                                      │
│                                                              │
│  Tipo de persona buscada                                     │
│  Profesional perfeccionista, orientado a resultados, con     │
│  capacidad de planificación. Combina pensamiento técnico     │
│  detallista con orientación a entregables.                   │
│                                                              │
│  Responsabilidades                                           │
│  • Liderar el frontend de la nueva plataforma                │
│  • Definir arquitectura de componentes reutilizables         │
│  • Mentorear a 2 devs junior                                 │
│                                                              │
│  Habilidades técnicas evaluadas                              │
│  • React 18 + TypeScript                                     │
│  • Patrones de estado complejo                               │
│  • Testing (Jest, Playwright)                                │
│  • Arquitectura de componentes                               │
│                                                              │
│  Capacidades cognitivas requeridas (alto)                    │
│  Lógica · Abstracta                                          │
│                                                              │
│  Inversión y duración estimada                               │
│  Salario rango: USD 2500 — USD 3500                          │
│  Modalidad: Presencial Panamá City                           │
│  Tiempo estimado de búsqueda: 15-25 días                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ¿Querés ajustar algo del perfil?                     │   │
│  │                                                       │   │
│  │ [Solicitar cambios] — escribí qué ajustar           │   │
│  │                                                       │   │
│  │      o                                                │   │
│  │                                                       │   │
│  │ [Aprobar y arrancar la búsqueda] →                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Detalles de UX:**
- NO se muestra el prompt técnico (es interno).
- NO se muestra DISC numérico (cliente no entiende el lenguaje).
- SÍ se muestra "tipo de persona buscada" en lenguaje humano.
- Botón "Solicitar cambios" abre textarea simple → email a Cris.

---

## 4. Tracking del embudo en vivo (Uber Eats style)

URL: `https://sharktalents.ai/cliente/seguimiento/<job_id>?token=<access_token>`

```
┌─────────────────────────────────────────────────────────────┐
│  SharkTalents · Senior React Developer · Acme Corp          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Búsqueda en curso · día 8 de ~18                           │
│  Última actualización: hace 12 min                          │
│                                                              │
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━○━━━━○━━━○         │
│  Búsqueda    Pruebas    Análisis    Top 3                  │
│  abierta     en curso   final       listos                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Embudo en vivo                                       │   │
│  │                                                       │   │
│  │  Aplicaron               ████████████████████ 47     │   │
│  │  Pasaron prefiltro       ████████████ 28              │   │
│  │  Completaron pruebas     ████████ 18                  │   │
│  │  En análisis final       ████ 8                       │   │
│  │  Finalistas              ▌ pendiente                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Próximo hito                                                │
│  Cuando los 3 finalistas estén listos te avisaremos por     │
│  correo y WhatsApp. ETA: 7-10 días.                         │
│                                                              │
│  Si necesitás algo, escribiles a tu reclutador:             │
│  WhatsApp +507 xxxx-xxxx                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Detalles:**
- Auto-refresh cada 60 segundos (cuando la tab está visible).
- Visibility-aware (no consume requests cuando la tab está oculta).
- Sin candidatos individuales visibles.
- Mensajería del reclutador siempre presente — la tech no reemplaza el contacto humano.

---

## 5. Vista de finalistas

Cuando los 3 finalistas están listos, el portal cambia a la vista de reporte:

URL: `https://sharktalents.ai/cliente/finalistas/<job_id>?token=<access_token>`

Esta vista **ya existe** en el plan actual ([ClientReport.tsx](../../shark/src/pages/public/ClientReport.tsx)). Solo se reutiliza con el nuevo diseño visual y se agrega la sección "Validación de claims" (cross-reference CV — ver Fase de pruebas).

---

## 6. Sistema de notificaciones por hito

### 4 hitos al cliente

| Hito | Trigger | Canal | Contenido |
|---|---|---|---|
| `profile_ready_for_review` | Cris aprueba el draft del perfil | Email | "Tu perfil está listo para revisión" + link al portal |
| `search_started` | Cliente aprueba el perfil | Email + WhatsApp | "Tu búsqueda arrancó. ETA 15-25 días" + link tracking |
| `funnel_active` | 50%+ del embudo lleno o 5+ candidatos en pruebas | Email | "Tu embudo tiene X candidatos en evaluación" |
| `finalists_ready` | 3 candidatos en estado "finalist" + reporte publicado | Email + WhatsApp | "¡Tus 3 finalistas están listos!" + link al reporte |

### Templates

Tabla `ClientNotificationTemplates`:

```
ROWID            BigInt
tenant_id        Text (50)         (templates por tenant)
hito             Text (50, unique check con tenant_id)
channel          Text (10)          ('email' | 'whatsapp')
language         Text (10)          ('es' | 'en')
subject          Text (200, nullable)   (solo email)
body             Text (long)
variables        Text (long)        JSON: ['client_name', 'job_title', 'eta_days', 'portal_link']
is_active        Boolean
created_at       DateTime
updated_at       DateTime
```

### Implementación via outbox

```typescript
// services/clientNotifier.ts
export async function notifyClientHito(
  req: any,
  tenantId: string,
  jobId: string,
  hito: string
): Promise<void> {
  const job = await db.jobs.getById(req, tenantId, jobId);
  const tenant = await db.tenants.getById(req, tenantId);

  // Renderizar templates
  const emailTemplate = await db.notificationTemplates.get(req, tenantId, hito, 'email');
  const whatsappTemplate = await db.notificationTemplates.get(req, tenantId, hito, 'whatsapp');

  const variables = {
    client_name: job.client_contact_name,
    job_title: job.title,
    company: job.company,
    portal_link: buildClientPortalLink(tenantId, jobId, 'tracking'),
    eta_days: estimateEta(job),
  };

  // Encolar como outbox events
  if (emailTemplate) {
    await db.outboxEvents.insert(req, {
      tenant_id: tenantId,
      event_type: 'client.notify.email',
      payload: JSON.stringify({
        to: job.client_email,
        subject: render(emailTemplate.subject, variables),
        body: render(emailTemplate.body, variables),
      }),
      status: 'pending',
      created_at: db.now(),
    });
  }
  if (whatsappTemplate && job.client_phone) {
    await db.outboxEvents.insert(req, {
      tenant_id: tenantId,
      event_type: 'client.notify.whatsapp',
      payload: JSON.stringify({
        to: job.client_phone,
        body: render(whatsappTemplate.body, variables),
      }),
      status: 'pending',
      created_at: db.now(),
    });
  }
}
```

Worker outbox los procesa, manda via:
- **Email:** SMTP propio (Gmail Workspace de Cris) o servicio (SendGrid, Resend, SES).
- **WhatsApp:** vía Recruit (que ya tiene WhatsApp Business integrado) — se hace POST a Recruit API "Send WhatsApp" con el template.

---

## 7. Tablas nuevas

### `JobProfileDrafts`

```
ROWID                BigInt
tenant_id            Text (50)
job_id               Text (50, nullable until promoted)
meeting_id           Text (100)         (Zoho Meeting recording ID)
client_name          Text (255)
raw_transcript_hash  Text (64)          (idempotencia)
transcript_excerpt   Text (long)        (primeras N chars para audit)
profile_json         Text (long)        (estructura del borrador)
status               Text (20)          ('draft' | 'approved_internal' | 'sent_to_client' | 'approved_by_client' | 'rejected')
client_feedback      Text (long, nullable)
generated_by_user    Text (50)
approved_by_user     Text (50, nullable)
sent_to_client_at    DateTime nullable
approved_by_client_at DateTime nullable
created_at           DateTime
updated_at           DateTime
```

### `ClientNotifications`

```
ROWID            BigInt
tenant_id        Text (50)
job_id           Text (50)
hito             Text (50)
channel          Text (10)
recipient        Text (255)
sent_at          DateTime
status           Text (20)          ('sent' | 'failed' | 'opened' | 'clicked')
error            Text (500, nullable)
trace_id         Text (16)
```

### `JobTrackingSnapshots` (opcional, para histórico)

```
ROWID                BigInt
tenant_id            Text (50)
job_id               Text (50)
applied_count        Integer
prefiltered_count    Integer
in_tests_count       Integer
completed_tests_count Integer
in_analysis_count    Integer
finalists_count      Integer
snapshot_at          DateTime
```

Cron diario que captura snapshot — útil para análisis "cuánto tarda en promedio cada etapa".

---

## 8. Tracking en vivo — endpoint

`GET /api/v1/jobs/:id/tracking-public?token=<access_token>`

Endpoint público (validado con HMAC token), devuelve solo agregados:

```json
{
  "data": {
    "job": {
      "title": "Senior React Developer",
      "company": "Acme Corp",
      "started_at": "2026-04-20T10:00:00Z",
      "estimated_completion_at": "2026-05-08T18:00:00Z"
    },
    "stage": "tests_in_progress",
    "stages_completed": ["search_started", "funnel_active"],
    "next_milestone": {
      "name": "finalists_ready",
      "eta_days": 7,
      "eta_text": "7-10 días"
    },
    "funnel": {
      "applied": 47,
      "prefiltered": 28,
      "in_tests": 18,
      "in_analysis": 8,
      "finalists": null
    },
    "last_updated": "2026-04-28T14:32:00Z",
    "support_contact": {
      "whatsapp": "+507xxxxxxxx",
      "email": "cris@kunodigital.com"
    }
  }
}
```

**Cero info sensible.** Solo conteos agregados.

---

## 9. Aprobación de perfil — endpoint

`POST /api/v1/jobs/:id/profile/approve?token=<access_token>`

Validar token + marcar `JobProfileDrafts.status = 'approved_by_client'` + disparar el siguiente hito (`search_started` notification + publicar puesto).

`POST /api/v1/jobs/:id/profile/request-changes?token=<access_token>`

Body: `{ feedback: string }`. Marca `JobProfileDrafts.status = 'rejected'` + crea email a Cris con el feedback.

---

## 10. Checklist de cierre Fase 17

- [ ] Tabla `JobProfileDrafts` creada
- [ ] Tabla `ClientNotifications` creada
- [ ] Tabla `JobTrackingSnapshots` creada (opcional)
- [ ] Tabla `ClientNotificationTemplates` con seed de 4 hitos × 2 canales × 1 idioma = 8 templates
- [ ] Endpoint `POST /api/admin/profiles/build-from-meeting` implementado
- [ ] Servicio `profileBuilder.buildProfileFromTranscript` con system prompt portado
- [ ] Pantalla admin "Construir perfil" funcional
- [ ] Pantalla admin "Editar borrador del perfil"
- [ ] Pantalla pública "Aprobar perfil" (con HMAC token)
- [ ] Pantalla pública "Tracking en vivo" (visibility-aware refresh)
- [ ] Pantalla pública "Finalistas" (reutiliza ClientReport.tsx existente)
- [ ] Servicio `clientNotifier` con outbox + 4 hitos
- [ ] Worker outbox procesa eventos `client.notify.*` (email + WhatsApp via Recruit)
- [ ] Endpoint `GET /api/v1/jobs/:id/tracking-public` implementado
- [ ] Endpoints de aprobación/cambios del perfil
- [ ] Integración con [23_INTEGRACIONES_ZOHO.md](23_INTEGRACIONES_ZOHO.md) para descargar transcript
- [ ] Smoke tests:
  - [ ] Cris hace meeting → importa transcript → genera perfil → edita → aprueba → cliente recibe email
  - [ ] Cliente entra al portal → ve perfil → click "Aprobar" → search arranca + email "Tu búsqueda arrancó"
  - [ ] Cliente entra al tracking → ve embudo → refresh muestra cambios
  - [ ] Cliente entra después de 3 finalistas → ve reporte completo
  - [ ] Token inválido → 403 con mensaje claro

---

## Siguiente paso

→ [18_PIPELINE_OPERATIVO.md](18_PIPELINE_OPERATIVO.md) — el pipeline operativo en SharkTalents + sync con Recruit como ejecutor de notifs.
