# Cliente API tipado — guía rápida

Cliente HTTP en [shark/src/lib/api.ts](../../shark/src/lib/api.ts) para hablar con el backend Catalyst.

## Cuándo usarlo

- Cuando estén las 14 tablas de Block 1 en Catalyst.
- Cuando hayas hecho `./scripts/deploy-backend.sh dev`.
- Cuando hayas seteado `VITE_API_BASE` apuntando a tu URL de Catalyst.

## Uso desde un componente React

```tsx
import { useApi } from '../lib/api';
import { useEffect, useState } from 'react';

function JobsList() {
  const api = useApi();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.jobs.list().then(({ jobs }) => {
      setJobs(jobs);
      setLoading(false);
    });
  }, [api]);

  if (loading) return <p>Cargando...</p>;
  return <ul>{jobs.map(j => <li key={j.ROWID}>{j.title}</li>)}</ul>;
}
```

## Endpoints disponibles

### Jobs
```ts
api.jobs.list({ includeInactive?: boolean })
api.jobs.get(id)
api.jobs.create({ title, company, cognitive_level?, tech_prompt?, company_context?, is_active? })
api.jobs.update(id, patch)
api.jobs.archive(id)  // soft delete (is_active=false)
```

### Candidates
```ts
api.candidates.list({ limit?: number })          // candidates con Results en jobs del tenant actual
api.candidates.get(id)
api.candidates.create({ name, email, phone?, age?, salary_expectation?, availability? })
   // ↑ es upsert: si email existe, devuelve el existente con `existed: true`
api.candidates.update(id, patch)
```

### Applications (Results en BD)
```ts
api.applications.list({ jobId?, limit? })        // todas las aplicaciones del tenant o filtradas por job
api.applications.get(id)                          // incluye historial de transiciones
api.applications.create({ assessment_id, candidate_id, idempotency_key? })
api.applications.transition(id, toStage, reason?)  // valida state machine
api.applications.transitions(id)                   // historial only
api.applications.writeScores(id, scoresPayload)    // upsert scores (DISC/VELNA/integridad/emocional/técnica)
api.applications.readScores(id)                    // lee scores actuales
api.applications.writeIntegrity(id, integrityPayload)  // 15 dimensiones + buena_impresion
api.applications.readIntegrity(id)
api.applications.listPrefilterAnswers(id)          // respuestas del candidato al prefilter del job
api.applications.sendOffer(id, { subject, message?, document_url?, template_id? })  // → Zoho Sign
```

### Drafts (briefings IA)
```ts
api.drafts.list({ status? })                       // job profile drafts del tenant
api.drafts.get(id)
api.drafts.save({ draft_payload, transcript?, transcript_source?, status?, version?, client_email?, meeting_url?, highlights? })
api.drafts.patch(id, { status?, draft_payload?, version?, highlights? })
api.drafts.convert(id)                             // convierte draft aprobado → Job real
api.drafts.generate({ transcript })                // POST /api/drafts/generate — IA arma draft del transcript
api.drafts.refine({ draft, feedback })             // ajusta draft existente con feedback en lenguaje natural
```

### Briefings (agendar reuniones cliente)
```ts
api.briefings.schedule({ client_email, client_name, client_company?, client_phone?, start_time, duration_minutes? })
// → crea booking en Zoho Bookings, manda invite con link a meeting + Zia activado
```

### Bot decisor + Review queue
```ts
api.bot.listReviewQueue()                          // items pendientes de decisión humana
api.bot.decide(id, { action: 'confirm' | 'override', override_stage?, rationale? })
// applications.bot-review está bajo /api/applications/:id/bot-review (POST sin método específico en api.ts)
```

### Pool interno + matching
```ts
api.pool.list({ tag?, availableOnly?, limit? })
api.pool.add({ candidate_id, result_id?, tags?, languages?, contact_preference?, notes_internal? })
api.pool.patch(id, { tags?, languages?, disponible_para_outreach?, notes_internal?, contact_preference? })
api.pool.remove(id)
api.pool.match({ job_id, area_tags?, requires_english?, limit? })  // matching DISC + VELNA + tags
```

### Outreach (LinkedIn / email)
```ts
api.outreach.listCampaigns({ status?, jobId? })
api.outreach.createCampaign({ name, provider?, status?, job_id? })  // solo provider=internal/email; heyreach se crean en HeyReach UI
api.outreach.listInbox({ filter?: 'needs_response' | 'unread' | 'all' })
api.outreach.patchInbox(id, { is_read?, needs_response? })
api.outreach.reply(id, text)                       // → enquea outreach.send_dm o email
```

### Notifications (campana)
```ts
api.notifications.list({ status?: 'unread' | 'read', limit? })
api.notifications.markRead(id)
api.notifications.markAllRead()
```

### Reports (resumen para cliente)
```ts
api.reports.list()                                 // reportes con finalists + cache_status + opened_count
// El reporte público vive en /report/bundle/<token> (sin Clerk, token firmado)
```

### Tenant config + Settings
```ts
api.tenantConfig.get()                             // bot_threshold, bot_mode, tecnica_default_min, auto_purge_videos_days + sources
api.tenantConfig.patch({ ... })

api.integrations.status()                          // qué integraciones están configuradas (read-only)
api.emailTemplates.list(locale)                    // 6 templates renderizados con sample vars
api.apiKeys.list() / .create() / .patch() / .revoke()
```

### Prefilter (preguntas iniciales por job)
```ts
api.prefilter.list(jobId)
api.prefilter.create(jobId, { question_text, type, options?, expected_answer?, is_disqualifier?, order_index? })
api.prefilter.patch(jobId, questionId, patch)
api.prefilter.remove(jobId, questionId)
```

### Videos (preguntas dinámicas)
```ts
api.videos.generate(applicationId)                 // IA genera 3-5 preguntas custom según scores del candidato
api.videos.list(applicationId)
api.videos.analyze(applicationId, responseId)      // post-upload: IA analiza el video
```

### Tests nuevos del candidato (Mentalidades + Inglés) — desde 2026-05-06

**Public (sin Clerk, token-signed):** los endpoints que el candidato llama desde el flow del test viven en [shark/src/lib/testApi.ts](../../shark/src/lib/testApi.ts), no en `api.ts` (porque no requieren tenant auth):

```ts
import { submitMindsetTest, submitEnglishTest } from '../lib/testApi';

// Test de mentalidades (10 preguntas, ~7 min)
await submitMindsetTest(token, [
  { question_id: 'm1', chosen_mentalidad: 'crecimiento' },
  // ...
]);
// Returns: { result_id, adaptability_score_pct, adaptability_pattern, perfil }

// Test de inglés (multiple-choice + listening + writing analizado por IA)
await submitEnglishTest(token, {
  level: 'B2',
  mc_correct: 14,
  mc_total: 20,
  listening_correct: 2,
  listening_total: 2,
  writing_text: '...',
  writing_word_count: 152,
  writing_time_seconds: 540,
  writing_paste_attempts: 0,
  writing_focus_lost_count: 1,
});
// Returns: { result_id, level, total_score_pct, threshold_pct, passed }
```

**Tenant (Clerk auth) — vista del recruiter:** estos están en `api.ts`:

```ts
// GET resultados del candidato (tenant-side, para el reporte / candidate detail)
fetch(`${apiBase}/api/applications/${applicationId}/mindset`)  // → { mindset_score: { ... } }
fetch(`${apiBase}/api/applications/${applicationId}/english`)  // → { english_session: { ... } }
```

(Pendiente sumar `api.tests.mindset(id)` y `api.tests.english(id)` al cliente tipado en `api.ts`.)

Bancos de preguntas (estáticos en repo, cargados directo desde frontend):
- `shark/src/data/questions/mindset.json` — 10 preguntas test mentalidades
- `shark/src/data/questions/english-{a2,b1,b2,c1}.json` — 40 preguntas por nivel CEFR
- `shark/src/data/english-config.json` — listening scripts, writing prompts, thresholds, anti-cheat config
- `shark/src/data/mindset-config.json` — mapeo mentalidad → eje + polo, thresholds adaptable/limitante

### Marketing (admin del funnel — landing externa)
```ts
api.marketing.listLeads({ status?, urgency?, minScore?, limit? })
// Endpoints públicos del marketing (sin Clerk, con X-Marketing-Site-Key) NO viven en api.ts;
// los consume la landing externa (Astro). Ver docs/master-plan/24_MARKETING_FUNNEL_TECH_BRIEF.md
```

### Portales cliente (admin emite tokens)
```ts
api.portals.issue({ company, client_name, client_email, agency_name?, ttl_days? })
// Devuelve un token signed para mandar al cliente via email.
```

## Manejo de errores

```ts
import { ApiError } from '../lib/api';

try {
  await api.jobs.create({ ... });
} catch (err) {
  if (err instanceof ApiError) {
    console.log('HTTP', err.status, 'code:', err.code, 'msg:', err.message);
    if (err.traceId) console.log('trace:', err.traceId);
  }
}
```

Códigos comunes:
- `validation_error` (400) — algún campo inválido en el body
- `unauthorized` (401) — token JWT inválido o expirado (Clerk lo refresca solo si el user sigue logueado)
- `forbidden` (403) — sin org activa, o tenant suspendido
- `not_found` (404) — job/candidato/app que pediste no existe o no es del tenant actual
- `conflict` (409) — transición de state machine no permitida
- `network_error` (0) — sin conexión al backend

## Auth flow

- `useApi()` agarra el JWT vía Clerk `getToken()` automáticamente.
- Cada request lleva `Authorization: Bearer <jwt>` y un trace ID.
- El backend valida el token y extrae el tenant del claim `org_id`.

## Migración progresiva desde mocks

**Recomendación:** no reemplaces todos los mocks de golpe. Patrón sugerido por componente:

```tsx
import { useApi } from '../lib/api';
import { MOCK_JOBS } from '../data/mockJobs';
import { useEffect, useState } from 'react';

const USE_API = import.meta.env.VITE_USE_API === 'true';

function JobsList() {
  const api = useApi();
  const [jobs, setJobs] = useState(USE_API ? [] : MOCK_JOBS);
  const [loading, setLoading] = useState(USE_API);

  useEffect(() => {
    if (!USE_API) return;
    api.jobs.list().then(({ jobs }) => {
      setJobs(jobs);
      setLoading(false);
    });
  }, [api]);

  // ...
}
```

Con `VITE_USE_API=false` (por defecto) seguís en modo mock. Cuando tengas backend deployado con tablas, cambiás a `true` en `.env.development` y los componentes empiezan a hablar con el backend real.

## Para mejorar (futuro, no Block 1)

- Cuando el código crezca, sumar **React Query** o **SWR** para cache + revalidación. El cliente actual hace fetch crudo cada render.
- Agregar retry con backoff exponencial en errores 5xx.
- Streaming responses para endpoints largos (reportes IA).
