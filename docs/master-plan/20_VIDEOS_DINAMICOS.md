# 20 — Videos Dinámicos (reemplazo de entrevista presencial)

**Objetivo:** después de las 4 pruebas (DISC + cognitivo + integridad + técnica), generar 7 preguntas personalizadas por candidato basadas en sus resultados, respondidas via video corto, con análisis IA del contenido. Reemplaza la entrevista presencial de 30 min — solo el top 3 va a entrevista en vivo con Cris.

**Tiempo estimado:** 3 semanas.
**Dependencias:** Fase 5 (Anthropic), Fase 18 (pipeline operativo + state machine), integración con servicio de transcripción (Whisper o Deepgram).
**Riesgo:** medio — UX de grabación delicada, storage no trivial.

---

## El concepto

Las preguntas NO son fijas. Se **generan dinámicamente** para cada candidato basadas en:

1. Resultados de DISC + cognitivo + emocional (estilo, áreas fuertes/débiles)
2. Resultados de técnica (qué temas fallaron específicamente)
3. Resultados de integridad (qué dimensiones tienen flag)
4. Claims del CV vs resultados (cross-reference de Fase 18 — cuestiones a validar)
5. Caso real específico del puesto (definido por Cris en el perfil)
6. Inglés opcional (si el puesto lo requiere)

Cada candidato responde **7 videos distintos** (8 si hay test de inglés).

**Output:** transcripción + análisis IA dirigido (no genérico) que va al reporte del cliente.

---

## Deliverables

- [ ] Generador de preguntas dinámicas (Anthropic) basado en resultados del candidato
- [ ] Componente frontend de grabación de video (MediaRecorder API)
- [ ] Fallback a respuesta en texto largo si no hay cámara/audio
- [ ] Upload + storage en Catalyst File Store
- [ ] Integración con servicio de transcripción (Whisper API o equivalente)
- [ ] Análisis IA por video (claridad, ejemplos, profundidad, coherencia con claims)
- [ ] Auto-delete de videos físicos a 30 días post-cierre del puesto
- [ ] Consent expreso obligatorio antes de grabar
- [ ] Vista admin: ver todas las respuestas + análisis
- [ ] Vista cliente: solo análisis IA en el reporte (no video crudo)
- [ ] 2 intentos por pregunta (queda el último)
- [ ] Test de inglés opcional (flag por puesto)

---

## 1. Cuándo se generan las preguntas

```
Candidato termina las 4 pruebas (DISC, cognitivo, integridad, técnica)
  ↓
Bot decisor evalúa si pasa a etapa de video
  ↓
Si SÍ → SharkTalents ejecuta workflow de generación:
  1. Recopila scores: DISC, cognitivo, emocional, integridad, técnica
  2. Recopila claims del CV (extraídos por IA al subirlo)
  3. Recopila contexto del puesto (perfil, contexto de empresa, jefe)
  4. Llama a Anthropic con prompt específico → genera 7 (o 8) preguntas personalizadas
  5. Guarda preguntas en tabla VideoQuestions linked a la application
  ↓
Cambio de etapa → video_pending → outbox → Recruit → email + WhatsApp:
  "Hola Juan, último paso: 7 preguntas en video, 1:30 cada una. [Link]"
  ↓
Candidato hace click → flow de grabación
```

---

## 2. Generación de preguntas con Anthropic

### Prompt template

```
SYSTEM:
Sos un reclutador senior. Vas a generar 7 preguntas para que un candidato responda en video corto (1:30 max cada una). Las preguntas deben ser ESPECÍFICAS al candidato, basadas en sus resultados de pruebas y su CV.

REGLAS:
- 7 preguntas exactas (8 si requires_english=true, la última en inglés)
- Cada pregunta clara, sin ambigüedad — el candidato debe entenderla en 5 segundos
- Mezcla de tipos:
  - 2-3 técnicas específicas del puesto (validar conocimiento concreto)
  - 1-2 sobre puntos débiles detectados en pruebas (sin acusar — formato "contame de una vez que...")
  - 1 caso real situacional del puesto
  - 1 sobre claims del CV no validadas todavía (cross-reference)
  - 1 de integridad SI hay flag (medio/alto en alguna dimensión) — formato suave, observacional
- Respuestas esperadas: 30-90 segundos
- NO preguntas trampa, NO ad hominem, NO preguntas que invadan privacidad

INPUT QUE TE DOY:
- Puesto: título, descripción, responsabilidades clave, contexto de empresa
- Resultados del candidato (scores + flags)
- Claims del CV
- Idioma del puesto (es / en)

OUTPUT:
JSON array de 7 preguntas, cada una:
{
  "id": "v1",
  "category": "technical" | "weakness_followup" | "situational" | "cv_claim_check" | "integrity_check" | "english_check",
  "question_text": "...",
  "rationale_internal": "Por qué se hace esta pregunta — para Cris, no se le muestra al candidato",
  "expected_signals": ["claridad", "ejemplo concreto", "profundidad técnica"],
  "max_duration_sec": 90
}
```

### Ejemplo de output

```json
[
  {
    "id": "v1",
    "category": "technical",
    "question_text": "Mostrame con un ejemplo concreto de tu trabajo: ¿cómo estructurarías el state management en una app React con 5+ features que necesitan compartir datos entre sí?",
    "rationale_internal": "Su técnica fue 78% pero falló las preguntas de Redux/Context. Validar conocimiento real.",
    "expected_signals": ["mención de tools concretos", "trade-offs explicados", "ejemplo real"],
    "max_duration_sec": 90
  },
  {
    "id": "v2",
    "category": "cv_claim_check",
    "question_text": "Tu CV menciona 5 años con HubSpot. Contame el flow más complejo de automatización que armaste ahí. Ejemplo concreto, paso a paso.",
    "rationale_internal": "Cross-reference CV: claims '5 años HubSpot' + score técnico HubSpot 35%. Validar profundidad real.",
    "expected_signals": ["ejemplo específico", "uso de features avanzadas", "lenguaje natural de hubsuario"],
    "max_duration_sec": 90
  },
  {
    "id": "v3",
    "category": "weakness_followup",
    "question_text": "En la prueba conductual, tu perfil sale más detallista que de toma de decisiones rápidas. Contame de una vez que tuviste que decidir rápido sin toda la información — qué hiciste y qué aprendiste.",
    "rationale_internal": "DISC C alto (90), D bajo (20). Puesto requiere D. Validar si es capaz de salir de su comfort zone.",
    "expected_signals": ["ejemplo concreto", "no defensiva", "aprendizaje claro"],
    "max_duration_sec": 90
  },
  {
    "id": "v4",
    "category": "situational",
    "question_text": "Llega un cliente clave a las 5pm de un viernes diciendo que tiene un bug en producción. Tu equipo ya se fue. ¿Cómo lo manejás los próximos 30 minutos?",
    "rationale_internal": "Caso del puesto. Validar criterio bajo presión.",
    "expected_signals": ["plan claro", "comunicación con stakeholders", "no overcommit"],
    "max_duration_sec": 60
  },
  {
    "id": "v5",
    "category": "integrity_check",
    "question_text": "Contame de una situación donde te enteraste de algo que tu empresa estaba haciendo mal — algo que no era tu área de responsabilidad. ¿Qué hiciste?",
    "rationale_internal": "Integridad: dimensión Etica Profesional dio MEDIO. Profundizar.",
    "expected_signals": ["narrativa creíble", "matiz", "no juzgar excesivamente"],
    "max_duration_sec": 90
  },
  {
    "id": "v6",
    "category": "technical",
    "question_text": "¿Qué herramienta de testing usás más y por qué? Si nunca probaste otra, ¿cuál evaluarías y qué te haría cambiarte?",
    "rationale_internal": "Validar criterio técnico open-ended.",
    "expected_signals": ["preferencia con razón", "awareness de alternativas", "mindset de mejora"],
    "max_duration_sec": 60
  },
  {
    "id": "v7",
    "category": "situational",
    "question_text": "El equipo está en desacuerdo entre dos arquitecturas posibles. Vos tenés una opinión. La mitad del equipo está del otro lado. ¿Cómo lo resolvés?",
    "rationale_internal": "Validar manejo de disenso. Match con estilo del jefe.",
    "expected_signals": ["escucha", "argumentación", "no ego"],
    "max_duration_sec": 60
  }
]
```

(Si `requires_english_test = true`, agrega 1 pregunta más en inglés sobre el puesto.)

### Implementación

```typescript
// services/videoQuestionsGenerator.ts
export async function generateVideoQuestions(
  req: any,
  applicationId: string
): Promise<VideoQuestion[]> {
  const app = await db.jobApplications.getById(req, applicationId);
  const job = await db.jobs.getFullProfile(req, app.tenant_id, app.job_id);
  const candidate = await db.candidates.getWithCvClaims(req, app.candidate_id);
  const scores = await db.scores.getAllForResult(req, app.id);
  const integrity = await db.integrityScores.withDimensions(req, app.id);
  const technical = await db.technicalScores.getByApp(req, app.id);
  const cvClaims = await db.cvClaims.listByCandidate(req, candidate.id);

  // Identificar weaknesses + flags
  const weaknesses = analyzeWeaknesses(scores, technical, integrity);
  const cvCrossRefs = identifyCvCrossRefs(cvClaims, technical, scores);
  const integrityFlags = integrity.dimensions.filter(d => d.nivel !== 'bajo');

  const response = await anthropicCall(req, {
    action: 'generate_video_questions',
    timeout: 25000,
    system: VIDEO_QUESTIONS_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildUserPrompt({
        job, candidate, scores, technical, integrity,
        cvClaims, weaknesses, cvCrossRefs, integrityFlags,
        requiresEnglish: job.requires_english_test || false,
        language: 'es',
      }),
    }],
  });

  const questions = parseAndValidateQuestions(response);

  // Persistir
  for (const q of questions) {
    await db.videoQuestions.insert(req, {
      tenant_id: app.tenant_id,
      application_id: applicationId,
      question_id: q.id,
      category: q.category,
      question_text: q.question_text,
      rationale_internal: q.rationale_internal,
      expected_signals: JSON.stringify(q.expected_signals),
      max_duration_sec: q.max_duration_sec,
      sort_order: questions.indexOf(q),
      created_at: db.now(),
    });
  }

  return questions;
}
```

---

## 3. UX del candidato — flow de grabación

### Pantalla principal

```
┌─────────────────────────────────────────────────────────────┐
│  SharkTalents · Senior React Developer · Acme Corp           │
│                                                              │
│  Último paso: 7 preguntas en video                          │
│  Tiempo total estimado: ~15 minutos                         │
│                                                              │
│  ⚠ Antes de empezar                                          │
│  - Necesitás cámara y micrófono                             │
│  - Si no podés grabar video, podés responder por texto      │
│  - Cada pregunta: 1:30 máximo                               │
│  - 2 intentos por pregunta (queda el último)                │
│  - Tu video se borra a los 30 días post-decisión final      │
│  - Solo se conserva la transcripción                        │
│                                                              │
│  Términos                                                    │
│  [✓] Doy consent expreso para grabar voz e imagen y         │
│      que sea analizado por IA según política de privacidad. │
│                                                              │
│  [Probar cámara y micrófono]  [Grabar sin video (audio)]    │
│  [Responder por texto] [Cancelar]                           │
└─────────────────────────────────────────────────────────────┘
```

### Pantalla por pregunta

```
┌─────────────────────────────────────────────────────────────┐
│  Pregunta 3 de 7                            ⏱ 1:30 max     │
│                                                              │
│  Mostrame con un ejemplo concreto de tu trabajo:            │
│  ¿cómo estructurarías el state management en una app        │
│  React con 5+ features que necesitan compartir datos?       │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │                                              │           │
│  │            [video preview]                   │           │
│  │                                              │           │
│  │            ● REC  0:42 / 1:30               │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  [⏸ Pausar]  [⏹ Detener y guardar]                          │
│  Intentos restantes: 2                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Componente frontend (esqueleto)

```tsx
// shark/src/pages/candidate/VideoQuestion.tsx
import { useEffect, useRef, useState } from 'react';

export default function VideoQuestion({ question, onComplete, onSkip }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState(2);
  const [mode, setMode] = useState<'video' | 'audio' | 'text'>('video');

  async function startRecording() {
    try {
      const constraints = mode === 'video'
        ? { video: true, audio: true }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current!.srcObject = stream;
      videoRef.current!.play();

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      setRecording(true);
    } catch (err) {
      // Sin permisos → fallback automático
      setMode('text');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function handleStop() {
    const blob = new Blob(chunksRef.current, { type: mode === 'video' ? 'video/webm' : 'audio/webm' });
    const url = await uploadToServer(blob, question.id);
    setAttemptsLeft(prev => prev - 1);
    onComplete({ recording_url: url, mode, duration_sec: elapsed });
  }

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setElapsed(prev => {
        if (prev >= question.max_duration_sec) {
          stopRecording();
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  if (mode === 'text') {
    return <TextResponse question={question} onComplete={onComplete} />;
  }

  return (
    <div>
      <h2>Pregunta {question.sort_order + 1} de 7</h2>
      <p>{question.question_text}</p>

      {mode === 'video' && <video ref={videoRef} muted style={{ width: 400 }} />}

      <div>{recording && `● REC ${formatTime(elapsed)} / ${formatTime(question.max_duration_sec)}`}</div>

      <button onClick={recording ? stopRecording : startRecording}>
        {recording ? 'Detener' : 'Grabar'}
      </button>
      <button onClick={() => setMode('audio')}>Solo audio</button>
      <button onClick={() => setMode('text')}>Texto</button>
      <p>Intentos restantes: {attemptsLeft}</p>
    </div>
  );
}
```

(Pseudo-código. La implementación real maneja edge cases: cámara ya en uso, denial de permisos, file size limits, etc.)

---

## 4. Storage

### Uploading

Cuando el candidato termina la grabación:
1. Frontend genera Blob (video/webm o audio/webm)
2. Upload via `POST /api/public/test/<token>/video-response` con multipart
3. Backend valida tamaño (max 50 MB), guarda en Catalyst File Store en folder `videos/<application_id>/`
4. Retorna `file_id` que se guarda en `VideoResponses`

### Tabla `VideoResponses`

```
ROWID                  BigInt
tenant_id              Text (50)
application_id         Text (50)
question_id            Text (50)
attempt_number         Integer       (1 o 2)
mode                   Text (10)     ('video' | 'audio' | 'text')
file_id                Text (50, nullable)        (Catalyst File Store ID; null si mode=text)
text_response          Text (long, nullable)      (si mode=text, el texto)
duration_sec           Integer
size_bytes             Integer
recorded_at            DateTime
transcribed_at         DateTime nullable
transcription          Text (long, nullable)
analyzed_at            DateTime nullable
analysis               Text (long, nullable)      JSON con análisis IA
status                 Text (20)         ('uploaded' | 'transcribing' | 'transcribed' | 'analyzed' | 'failed')
error                  Text (500, nullable)
```

### Volumen estimado

- 7 videos × 1.5 min × 1080p ≈ 50-100 MB por candidato
- 100 candidatos/mes con video (los que llegan a esta etapa) ≈ 5-10 GB/mes en File Store
- Con auto-delete a 30 días post-cierre: equilibrio sostenible

---

## 5. Transcripción

Pipeline async (worker outbox):

```
Video upload completo → outbox event 'video.transcribe'
  ↓
Worker procesa:
  1. Descarga video de File Store
  2. POST a Whisper API (OpenAI) o Deepgram con audio
  3. Recibe transcript
  4. Guarda en VideoResponses.transcription
  5. Outbox event 'video.analyze'
```

### Servicio de transcripción

**Whisper (OpenAI):**
- $0.006/minuto
- ~7.5 min/candidato → $0.05/candidato
- Endpoint: `https://api.openai.com/v1/audio/transcriptions`
- Soporta video/audio webm directo (extrae audio)

**Deepgram (alternativa):**
- $0.0043/min para tier nuevo
- Más rápido (real-time)
- Mejor para volumen alto

**Decisión:** Whisper API para v1. Más simple, calidad sólida, soporta español.

```typescript
// integrations/whisper.ts
export async function transcribeAudio(audioUrl: string, language = 'es'): Promise<string> {
  const audioFile = await fetch(audioUrl).then(r => r.blob());
  const formData = new FormData();
  formData.append('file', audioFile, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getEnv('OPENAI_API_KEY')}` },
    body: formData,
  });
  
  const { text } = await res.json();
  return text;
}
```

Env var nueva: `OPENAI_API_KEY` (solo para Whisper — el LLM principal sigue siendo Claude).

---

## 6. Análisis IA del contenido

Después de transcribir, otra llamada a Claude para analizar:

```typescript
// services/videoAnalyzer.ts
export async function analyzeVideoResponse(
  req: any,
  responseId: string
): Promise<VideoAnalysis> {
  const response = await db.videoResponses.getById(req, responseId);
  const question = await db.videoQuestions.getById(req, response.question_id);
  const application = await db.jobApplications.getById(req, response.application_id);
  const job = await db.jobs.getById(req, application.tenant_id, application.job_id);

  const analysisResponse = await anthropicCall(req, {
    action: 'analyze_video_response',
    timeout: 20000,
    system: VIDEO_ANALYSIS_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `
PREGUNTA AL CANDIDATO:
${question.question_text}

RAZÓN INTERNA DE LA PREGUNTA (no se la mostraste al candidato):
${question.rationale_internal}

SEÑALES ESPERADAS:
${JSON.parse(question.expected_signals).join(', ')}

CONTEXTO DEL PUESTO:
${job.title} en ${job.company}

TRANSCRIPCIÓN DE LA RESPUESTA DEL CANDIDATO:
${response.transcription}

Analizá esta respuesta. Devolvé JSON con:
{
  "overall_score": 0-100,
  "claridad": 0-100,
  "profundidad": 0-100,
  "ejemplos_concretos": 0-100,
  "coherencia": 0-100,
  "summary": "2 oraciones del análisis",
  "fortalezas": ["..."],
  "puntos_debiles": ["..."],
  "red_flags": ["..."]   (vacío si ninguna)
}
      `.trim(),
    }],
  });

  const analysis = parseAnalysis(analysisResponse);

  await db.videoResponses.update(req, responseId, {
    analysis: JSON.stringify(analysis),
    analyzed_at: db.now(),
    status: 'analyzed',
  });

  return analysis;
}
```

System prompt focus:
- Análisis del **contenido**, NO tono/voz/expresión facial
- No genera sesgo cultural ni acusa
- Output estructurado para que el reporte lo agregue
- Maneja transcripciones imperfectas (Whisper a veces tiene errores)

---

## 7. Output en el reporte al cliente

Sección "Análisis de profundización" en el reporte:

```
┌─────────────────────────────────────────────────────────────┐
│  Profundización en video                                     │
│                                                              │
│  Pregunta 1 — Stack técnico (React state mgmt)              │
│  ────────────────────────────────────────────────           │
│  Maria explicó con claridad un caso real con Redux Toolkit. │
│  Mencionó trade-offs entre Context y Redux según escala.    │
│  Ejemplo concreto del proyecto X.                           │
│  Score: 88%                                                 │
│                                                              │
│  Pregunta 2 — Validación claim CV: HubSpot                  │
│  ────────────────────────────────────────────────           │
│  Maria respondió con ejemplos vagos sobre HubSpot.          │
│  No mencionó features avanzadas ni workflows complejos.     │
│  ⚠ Inconsistente con claim de "5 años con HubSpot".         │
│  Score: 42% — recomendable validar en entrevista presencial.│
│                                                              │
│  Pregunta 3 — Toma de decisiones rápida                     │
│  ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

**El cliente NO ve los videos**, solo el análisis textual.

Cris admin sí puede ver los videos (link al File Store, expira a 30d post-cierre).

---

## 8. Auto-delete de videos físicos

Cron diario que ejecuta:

```sql
SELECT vr.file_id FROM VideoResponses vr
JOIN JobApplications app ON app.ROWID = vr.application_id
JOIN Jobs j ON j.ROWID = app.job_id
WHERE j.is_active = false  -- puesto cerrado
  AND j.closed_at < (now - 30 days)
  AND vr.file_id IS NOT NULL  -- aún no borrado
```

Para cada uno:
1. Eliminar archivo de Catalyst File Store
2. Update `VideoResponses.file_id = null`, `status = 'archived'`

**Conserva:**
- `transcription` (texto)
- `analysis` (JSON)
- Metadata (duración, fecha, etc.)

**Borra:**
- El archivo binario de video/audio.

Así cumplís compliance + ahorro de storage + el reporte sigue siendo válido para auditoría futura.

---

## 9. Re-grabación: política

- Máximo **2 intentos** por pregunta.
- Queda registrado el **último intento** (para análisis).
- Cris puede ver ambos en admin panel ("Ver intentos previos").
- Si no se completaron las 7 preguntas en 7 días, el sistema hace timeout y la application va a estado `video_abandoned`.

---

## 10. Caso especial: respuesta en texto

Si el candidato no puede grabar (sin cámara/audio o por preferencia), se le permite responder en texto largo:

- Mismo análisis IA aplicado al texto.
- Marcado como `mode: 'text'` en el reporte.
- El reporte muestra: _"María respondió en texto (sin video)."_ — para que el cliente sepa.

No se castiga al candidato por elegir texto. Pero se marca para Cris evalúe en entrevista.

---

## 11. Tablas nuevas

### `VideoQuestions`

```
ROWID                  BigInt
tenant_id              Text (50)
application_id         Text (50)
question_id            Text (10)         ('v1', 'v2', ..., 'v7')
category               Text (30)
question_text          Text (long)
rationale_internal     Text (long)
expected_signals       Text (long)        JSON array
max_duration_sec       Integer
sort_order             Integer
created_at             DateTime
```

### `VideoResponses`

(Ya descripta arriba en sección 4.)

### `VideoConsents`

Para auditoría legal del consent:

```
ROWID            BigInt
tenant_id        Text (50)
application_id   Text (50, unique check)
candidate_id     Text (50)
consent_text     Text (long)         (texto exacto que firmó)
consent_at       DateTime
ip               Text (45)
user_agent       Text (300)
```

---

## 12. Checklist de cierre Fase 20

- [ ] Tablas creadas: `VideoQuestions`, `VideoResponses`, `VideoConsents`
- [ ] System prompt `VIDEO_QUESTIONS_SYSTEM_PROMPT` definido (constante)
- [ ] System prompt `VIDEO_ANALYSIS_SYSTEM_PROMPT` definido
- [ ] `services/videoQuestionsGenerator.ts` implementado
- [ ] `integrations/whisper.ts` (o equivalente) implementado
- [ ] `services/videoAnalyzer.ts` implementado
- [ ] Worker outbox para `video.transcribe` y `video.analyze`
- [ ] Componente frontend `VideoQuestion.tsx` con MediaRecorder
- [ ] Fallback a audio-only y texto
- [ ] Endpoint `POST /api/public/test/<token>/video-response` con multipart upload
- [ ] Auto-delete cron job (30 días post-cierre)
- [ ] Sección "Profundización en video" en reporte cliente
- [ ] Vista admin para ver intentos + análisis + video link
- [ ] Env var `OPENAI_API_KEY` configurada
- [ ] Smoke tests:
  - [ ] Candidato termina pruebas → recibe email con link a videos
  - [ ] Graba 7 videos → transcripciones llegan en < 5 min
  - [ ] Análisis IA se genera por video
  - [ ] Sin cámara → fallback a texto funciona
  - [ ] Solo audio → funciona y se transcribe
  - [ ] 2 intentos → queda el último
  - [ ] Reporte muestra análisis (no video crudo)
  - [ ] Auto-delete: simulado, video físico desaparece, transcript queda

---

## Siguiente paso

→ [21_BOT_DECISOR.md](21_BOT_DECISOR.md) — el bot que decide automáticamente las transiciones del pipeline.
