/**
 * Generación de preguntas para el módulo Video con Claude (tool calling forzado).
 *
 * Contexto del flujo (confirmado por Chris Palma — ver memoria
 * `project_reglas_pipeline_candidato.md`):
 *
 *   1. IA genera 5-7 preguntas mezcladas (técnicas + conductuales + integridad)
 *   2. Chris revisa y aprueba (puede editar)
 *   3. Candidato graba video respondiendo (60-90s por pregunta)
 *   4. Backend transcribe + compara contra respuesta_correcta_interna + score 1-10
 *   5. Por ahora 100% informativo, NO rechaza
 *
 * Cada pregunta lleva una "respuesta_correcta_interna" que es la baseline semántica
 * que se usará luego para comparar la respuesta real del candidato. Esa baseline NO
 * se muestra al candidato — solo a Chris al aprobar (vía justificacion_para_admin).
 *
 * Uso:
 *   const questions = await generateVideoQuestions({
 *     job_title: 'Ejecutivo Comercial Senior',
 *     context_summary: 'Vendedor de productos femeninos. Cliente busca conexión emocional...',
 *     competencias: [{ name: 'orientacion_al_cliente', required_pct: 75 }],
 *     count: 6,
 *   });
 *   // questions[0].pregunta, questions[0].respuesta_correcta_interna, etc.
 *
 * NO toca el flujo comercial. Solo es la pieza generativa — el endpoint público,
 * la UI, la persistencia en VideoQuestions y la lógica de score 1-10 vienen aparte.
 */

import { anthropicMessage, extractToolUse, type AnthropicTool } from './anthropic';
import { logger } from './logger';

const log = logger('VIDEO_QUESTION_GEN');

// ===== Types =====

export type VideoQuestionType = 'tecnica' | 'conductual' | 'integridad';

export type GeneratedVideoQuestion = {
  /** ID corto y estable. Usado por el frontend para tracking; backend lo regenera al persistir. */
  id: string;
  type: VideoQuestionType;
  /** Pregunta que se le muestra al candidato. Concreta, referencia al rol. */
  pregunta: string;
  /** Respuesta esperada (baseline semántica). Oculta al candidato — solo Chris la ve al aprobar. */
  respuesta_correcta_interna: string;
  /** 1-2 frases que explican qué evalúa esta pregunta y por qué encaja con el puesto. */
  justificacion_para_admin: string;
  /** Tiempo máximo de respuesta en segundos. Default sugerido por la IA, típicamente 60-90. */
  tiempo_max_segundos: number;
};

export type GenerateVideoQuestionsInput = {
  job_title: string;
  /** Resumen narrativo del contexto del puesto. Lo que diferencia este puesto de otros con mismo título. */
  context_summary: string;
  competencias: Array<{ name: string; required_pct: number }>;
  /** Cantidad de preguntas a generar (default 6, mínimo 5, máximo 7). */
  count?: number;
};

// Cap defensivos del modelo. Si el modelo devuelve fuera de rango, lo clampeamos.
const DEFAULT_COUNT = 6;
const MIN_COUNT = 5;
const MAX_COUNT = 7;
const MIN_SECONDS = 30;
const MAX_SECONDS = 180;

// ===== Prompt + Tool schema =====

const SYSTEM_PROMPT = `Eres un consultor senior de reclutamiento ejecutivo con 20 años de experiencia evaluando candidatos en LATAM.

Tu tarea: generar un set BALANCEADO de preguntas para una entrevista en video asíncrona.

PRINCIPIOS:
- Mix obligatorio: al menos 1 técnica + 1 conductual + 1 integridad. El resto del mix lo decides según el contexto del puesto.
- Cada pregunta debe ser CONCRETA y referenciar el contexto específico del puesto. Sin genéricos tipo "háblame de ti".
- Por cada pregunta defines también una "respuesta_correcta_interna" — la baseline semántica que se usará luego para comparar con la respuesta real del candidato. Debe ser concreta (3-6 frases), describir el patrón de respuesta esperado, y NO ser una sola palabra ni una oración trivial.
- "justificacion_para_admin": 1-2 frases que explican qué evalúa esta pregunta y por qué es relevante para este puesto en particular. La administradora (Chris) las lee al aprobar el set.
- "tiempo_max_segundos": 60-90 típicamente. Preguntas técnicas profundas pueden ir a 120. Integridad cortas pueden ir a 45.
- Las preguntas de integridad NO son trampas. Son situaciones grises donde una respuesta honesta revela el patrón ético del candidato. Ej: "Qué harías si tu jefe te pide algo que crees que no es del todo correcto".
- Las técnicas evalúan dominio del rol, no trivia. Ej: "Describe paso a paso cómo manejarías una objeción de precio en este sector".
- Las conductuales son situacionales reales del puesto, no abstractas. Ej: "Cliente furioso, llamada urgente, tu jefe quiere reporte. Qué priorizas y cómo".

REGLAS ESTRICTAS:
- Español neutro LatAm (target Panamá). Usa "tú/tienes/puedes". PROHIBIDO voseo argentino (tenés, querés, sos, podés, mirá).
- No inventes información del puesto. Solo usa lo que está en context_summary, competencias y job_title.
- IDs cortos, formato "q1", "q2", etc.
- Output ESTRICTAMENTE vía la tool call 'submit_video_questions'. Nada fuera del tool input.`;

const TOOL_SCHEMA: AnthropicTool = {
  name: 'submit_video_questions',
  description: 'Envía el set de preguntas generadas para la entrevista en video del candidato.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: MIN_COUNT,
        maxItems: MAX_COUNT,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID corto y estable, formato "q1", "q2", etc.',
              maxLength: 8,
            },
            type: {
              type: 'string',
              enum: ['tecnica', 'conductual', 'integridad'],
              description: 'Tipo de pregunta. El set DEBE incluir al menos una de cada tipo.',
            },
            pregunta: {
              type: 'string',
              description: 'Pregunta concreta, referencia al rol/contexto. Lo que ve el candidato.',
              maxLength: 400,
            },
            respuesta_correcta_interna: {
              type: 'string',
              description: 'Baseline semántica esperada (3-6 frases). Oculta al candidato. Se usa para comparar contra la respuesta real.',
              maxLength: 800,
            },
            justificacion_para_admin: {
              type: 'string',
              description: '1-2 frases para Chris (la administradora) al aprobar: qué evalúa y por qué encaja con el puesto.',
              maxLength: 300,
            },
            tiempo_max_segundos: {
              type: 'integer',
              minimum: MIN_SECONDS,
              maximum: MAX_SECONDS,
              description: 'Tiempo máximo de respuesta. 60-90 típicamente.',
            },
          },
          required: [
            'id',
            'type',
            'pregunta',
            'respuesta_correcta_interna',
            'justificacion_para_admin',
            'tiempo_max_segundos',
          ],
        },
      },
    },
    required: ['questions'],
  },
};

function buildUserMessage(input: GenerateVideoQuestionsInput, count: number): string {
  const parts: string[] = [];
  parts.push(`# Puesto\nTítulo: ${input.job_title}`);
  parts.push(`\n# Contexto del puesto`);
  parts.push(input.context_summary || '(sin contexto narrativo cargado — genera preguntas basadas en el título)');
  if (input.competencias.length > 0) {
    parts.push(`\n# Competencias requeridas`);
    parts.push(
      input.competencias.map((c) => `- ${c.name} (mínimo ${c.required_pct}%)`).join('\n'),
    );
  }
  parts.push(`\n# Tu tarea`);
  parts.push(
    `Genera exactamente ${count} preguntas para una entrevista en video asíncrona del candidato. Mix obligatorio: al menos 1 técnica + 1 conductual + 1 integridad. Envía el set vía la tool 'submit_video_questions'.`,
  );
  return parts.join('\n');
}

function clampCount(n: number | undefined): number {
  const v = n ?? DEFAULT_COUNT;
  if (v < MIN_COUNT) return MIN_COUNT;
  if (v > MAX_COUNT) return MAX_COUNT;
  return Math.floor(v);
}

// ===== Función principal =====

export async function generateVideoQuestions(
  input: GenerateVideoQuestionsInput,
  opts?: { traceId?: string },
): Promise<GeneratedVideoQuestion[]> {
  const count = clampCount(input.count);
  log.info('generating video questions', {
    job_title: input.job_title,
    requested_count: count,
    competencias_count: input.competencias.length,
  });

  const userMessage = buildUserMessage(input, count);

  const response = await anthropicMessage(
    {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      // Mayor que conductual porque hay que generar 5-7 objetos con baseline+justificación.
      maxTokens: 3000,
      // Algo más alto que análisis (0.3) porque queremos variedad razonable entre preguntas,
      // pero no tan alto que se descontrole.
      temperature: 0.5,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'submit_video_questions' },
    },
    opts?.traceId ?? '',
  );

  const result = extractToolUse<{ questions: GeneratedVideoQuestion[] }>(
    response,
    'submit_video_questions',
  );

  if (!result || !Array.isArray(result.questions) || result.questions.length === 0) {
    throw new Error('IA devolvió set de preguntas vacío o malformado');
  }

  const questions = result.questions;

  // Validación defensiva del mix mínimo (la tool schema NO lo garantiza por sí sola).
  const types = new Set(questions.map((q) => q.type));
  const missing: VideoQuestionType[] = [];
  if (!types.has('tecnica')) missing.push('tecnica');
  if (!types.has('conductual')) missing.push('conductual');
  if (!types.has('integridad')) missing.push('integridad');
  if (missing.length > 0) {
    log.warn('IA no respetó el mix obligatorio — set devuelto igual, caller decide qué hacer', {
      missing_types: missing,
      generated_types: Array.from(types),
    });
  }

  // Clamp defensivo del tiempo_max_segundos por si el modelo se salta el schema.
  for (const q of questions) {
    if (q.tiempo_max_segundos < MIN_SECONDS) q.tiempo_max_segundos = MIN_SECONDS;
    if (q.tiempo_max_segundos > MAX_SECONDS) q.tiempo_max_segundos = MAX_SECONDS;
  }

  log.info('generated video questions', {
    count: questions.length,
    types: Array.from(types),
  });

  return questions;
}

// ===== Re-exports para tests =====
export { buildUserMessage, clampCount, TOOL_SCHEMA, SYSTEM_PROMPT, MIN_COUNT, MAX_COUNT };
