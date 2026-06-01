/**
 * Generador IA de preguntas técnicas custom por puesto.
 *
 * Input: tech_prompt del Job (descripción de qué evaluar) + título + nivel cognitivo.
 * Output: array de TechnicalQuestion con texto, 4 opciones y correct index.
 *
 * Uso:
 *   const qs = await generateTechnicalQuestions({ techPrompt, jobTitle, level: 'mid', count: 15 });
 *
 * Las preguntas se persisten en Jobs.tech_questions_cache (JSON Text). Cuando el
 * candidato hace el test técnico, el frontend pide via GET /test/<token>/tech-questions
 * y recibe las preguntas cached. Si Cris quiere regenerar, llama POST de vuelta.
 */
import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';

const log = logger('TECH_QUESTIONS');

export type GeneratedQuestion = {
  id: string;
  text: string;
  options: string[];
  correct: number;
  rationale?: string;
};

/**
 * Pregunta del modelo doble eje (doc 19). Incluye `kind` discriminator + campos por tipo.
 */
export type GeneratedQuestionDoubleAxis = {
  id: string;
  kind: 'technical' | 'situational';
  text: string;
  options: string[];
  /** Solo en kind='technical'. */
  correct?: number;
  /** Solo en kind='situational'. Array de 4 booleans (2 true, 2 false). */
  option_validity?: boolean[];
  /** Solo en kind='situational'. Array de 4 — válidas con {axis, value}; inválidas null. */
  option_style?: Array<{ axis: 'autonomy_vs_consult'; value: 'autonomy' | 'consult' } | null>;
  rationale?: string;
};

const SYSTEM_TECH = `Sos un evaluador técnico senior. Tu tarea: generar preguntas técnicas
de opción múltiple para evaluar candidatos en un puesto específico.

REGLAS ESTRICTAS:
- 4 opciones por pregunta. UNA sola correcta. Las otras 3 deben ser razonables (no "obviamente incorrectas").
- Mezclar dificultad según el nivel cognitive_level: basic = junior, mid = mid-level, senior = senior.
- Preguntas que NO se puedan responder googleando 5 segundos. Buscamos comprensión, no memoria.
- Preguntas en español neutro (Argentina/Panamá).
- Mínimo 8 preguntas. Máximo 20.
- Incluir una breve "rationale" por pregunta (1-2 frases, NO la respuesta — sino el concepto evaluado).
- Salida ESTRICTAMENTE como JSON con el schema dado. NADA fuera del JSON.`;

function buildTechPrompt(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count: number;
}): string {
  const { jobTitle, jobCompany, techPrompt, level, count } = args;
  return `PUESTO: ${jobTitle}${jobCompany ? ` — ${jobCompany}` : ''}
NIVEL: ${level}
CANTIDAD DE PREGUNTAS: ${count}

DESCRIPCIÓN DE LO QUE QUEREMOS EVALUAR:
${techPrompt}

Devolvé JSON con este schema:
{
  "questions": [
    {
      "id": "tq_1",
      "text": "string (la pregunta)",
      "options": ["opción A", "opción B", "opción C", "opción D"],
      "correct": 0,
      "rationale": "string (concepto que evalúa)"
    }
  ]
}`;
}

export async function generateTechnicalQuestions(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count?: number;
  traceId?: string;
}): Promise<GeneratedQuestion[]> {
  const count = Math.max(8, Math.min(20, args.count ?? 15));
  const traceId = args.traceId ?? '';

  if (!args.techPrompt || !args.techPrompt.trim()) {
    throw new Error('techPrompt vacío — necesitamos descripción de qué evaluar');
  }

  const response = await anthropicMessage({
    system: [{ type: 'text', text: SYSTEM_TECH, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildTechPrompt({ ...args, count }) }],
    maxTokens: 4000,
    temperature: 0.7,
  }, traceId);

  const parsed = extractJson<{ questions: GeneratedQuestion[] }>(response);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error('IA no devolvió questions array válido');
  }

  const validated = parsed.questions
    .map((q, idx) => validateQuestion(q, idx))
    .filter((q): q is GeneratedQuestion => q !== null);

  if (validated.length < 5) {
    throw new Error(`IA generó solo ${validated.length} preguntas válidas (mínimo 5)`);
  }

  log.info('tech questions generated', {
    traceId,
    requested: count,
    received: parsed.questions.length,
    validated: validated.length,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return validated;
}

function validateQuestion(raw: unknown, idx: number): GeneratedQuestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return null;
  if (!Array.isArray(r.options) || r.options.length !== 4) return null;
  if (!r.options.every((o) => typeof o === 'string' && o.trim().length > 0)) return null;
  const correct = Number(r.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `tq_${idx + 1}`,
    text: r.text.trim().slice(0, 1000),
    options: r.options.map((o) => String(o).trim().slice(0, 300)),
    correct,
    ...(typeof r.rationale === 'string' ? { rationale: r.rationale.trim().slice(0, 500) } : {}),
  };
}

// ===== Modelo doble eje (doc 19) =====

const SYSTEM_DOUBLE_AXIS = `Sos un evaluador técnico senior. Generás preguntas de evaluación de candidatos
para un puesto específico. Hay DOS tipos de pregunta:

(A) "technical" — pregunta de conocimiento concreto (algoritmos, herramientas, sintaxis,
    domain knowledge). 4 opciones, UNA sola correcta.

(B) "situational" — escenario de trabajo real. 4 opciones donde:
    - 2 son PROFESIONALMENTE VÁLIDAS (defendibles por un colega senior).
    - 2 son INVÁLIDAS (objetivamente malas: ocultar info, mentir, procrastinar, ignorar
      al cliente, hacer patches sin avisar, etc.).
    Las 2 válidas DEBEN revelar estilos distintos en el eje "autonomy_vs_consult":
    - Una opción tiende a "autonomy" — el candidato actúa primero, decide solo, informa después.
    - La otra tiende a "consult" — el candidato consulta antes de actuar, busca alineación.
    NO hay una "más correcta" entre las válidas. La diferencia es de estilo, no de calidad.

EJEMPLO situacional:
"Un cliente reporta un bug crítico a las 5pm de un viernes."
Opciones:
1. "Convoco al equipo y empezamos inmediatamente, le aviso al cliente que estamos en eso."
   → válida, autonomy
2. "Le aviso a mi jefe primero, espero su lineamiento antes de actuar."
   → válida, consult
3. "Le digo al cliente que se espere al lunes, no es momento para tocar producción."
   → INVÁLIDA (procrastinar/ignorar)
4. "Hago un patch rápido sin avisar para no preocupar a nadie."
   → INVÁLIDA (ocultar)

REGLAS ESTRICTAS:
- Mix recomendado: ~50% technical + ~50% situational. Si count=15 → 8 technical + 7 situational.
- Preguntas en español neutro (Argentina/Panamá).
- Todas con 4 opciones.
- Para situational: option_validity tiene exactamente 2 true y 2 false. option_style tiene
  {axis, value} en las válidas y null en las inválidas. Las 2 válidas DEBEN ser una "autonomy"
  y la otra "consult" (no ambas iguales).
- Para technical: opciones plausibles, no obvias.
- Salida ESTRICTAMENTE como JSON con el schema dado. NADA fuera del JSON.`;

function buildDoubleAxisPrompt(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count: number;
}): string {
  const techCount = Math.floor(args.count / 2);
  const sitCount = args.count - techCount;
  return `PUESTO: ${args.jobTitle}${args.jobCompany ? ` — ${args.jobCompany}` : ''}
NIVEL: ${args.level}
CANTIDAD: ${args.count} preguntas total (${techCount} technical + ${sitCount} situational)

DESCRIPCIÓN DE LO QUE QUEREMOS EVALUAR:
${args.techPrompt}

Devolvé JSON con este schema:
{
  "questions": [
    // technical
    {
      "id": "tq_1",
      "kind": "technical",
      "text": "string",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "rationale": "concepto evaluado"
    },
    // situational
    {
      "id": "sq_1",
      "kind": "situational",
      "text": "escenario",
      "options": ["A", "B", "C", "D"],
      "option_validity": [true, true, false, false],
      "option_style": [
        { "axis": "autonomy_vs_consult", "value": "autonomy" },
        { "axis": "autonomy_vs_consult", "value": "consult" },
        null,
        null
      ],
      "rationale": "qué evalúa el escenario"
    }
  ]
}`;
}

export async function generateDoubleAxisQuestions(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count?: number;
  traceId?: string;
}): Promise<GeneratedQuestionDoubleAxis[]> {
  const count = Math.max(8, Math.min(25, args.count ?? 15));
  const traceId = args.traceId ?? '';

  if (!args.techPrompt || !args.techPrompt.trim()) {
    throw new Error('techPrompt vacío — necesitamos descripción de qué evaluar');
  }

  const response = await anthropicMessage({
    system: [{ type: 'text', text: SYSTEM_DOUBLE_AXIS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildDoubleAxisPrompt({ ...args, count }) }],
    maxTokens: 5000,
    temperature: 0.7,
  }, traceId);

  const parsed = extractJson<{ questions: GeneratedQuestionDoubleAxis[] }>(response);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error('IA no devolvió questions array válido');
  }

  const validated = parsed.questions
    .map((q, idx) => validateDoubleAxisQuestion(q, idx))
    .filter((q): q is GeneratedQuestionDoubleAxis => q !== null);

  if (validated.length < 5) {
    throw new Error(`IA generó solo ${validated.length} preguntas válidas (mínimo 5)`);
  }

  log.info('double-axis tech questions generated', {
    traceId,
    requested: count,
    received: parsed.questions.length,
    validated: validated.length,
    technical: validated.filter((q) => q.kind === 'technical').length,
    situational: validated.filter((q) => q.kind === 'situational').length,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return validated;
}

function validateDoubleAxisQuestion(raw: unknown, idx: number): GeneratedQuestionDoubleAxis | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return null;
  if (!Array.isArray(r.options) || r.options.length !== 4) return null;
  if (!r.options.every((o) => typeof o === 'string' && o.trim().length > 0)) return null;

  const kind = r.kind === 'situational' ? 'situational' : 'technical';

  const base = {
    id: typeof r.id === 'string' && r.id ? r.id : `q_${idx + 1}`,
    text: r.text.trim().slice(0, 1000),
    options: r.options.map((o) => String(o).trim().slice(0, 300)),
    ...(typeof r.rationale === 'string' ? { rationale: r.rationale.trim().slice(0, 500) } : {}),
  };

  if (kind === 'technical') {
    const correct = Number(r.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
    return { ...base, kind: 'technical', correct };
  }

  // situational
  const validity = r.option_validity;
  if (!Array.isArray(validity) || validity.length !== 4) return null;
  if (validity.filter((v) => v === true).length !== 2) return null;

  const styles = r.option_style;
  if (!Array.isArray(styles) || styles.length !== 4) return null;

  const cleanStyles: Array<{ axis: 'autonomy_vs_consult'; value: 'autonomy' | 'consult' } | null> = [];
  for (let i = 0; i < 4; i++) {
    const s = styles[i] as { axis?: unknown; value?: unknown } | null;
    if (validity[i] === true) {
      if (!s || s.axis !== 'autonomy_vs_consult') return null;
      if (s.value !== 'autonomy' && s.value !== 'consult') return null;
      cleanStyles.push({ axis: 'autonomy_vs_consult', value: s.value as 'autonomy' | 'consult' });
    } else {
      cleanStyles.push(null);
    }
  }

  const validVals = cleanStyles.filter((s) => s != null).map((s) => s!.value);
  if (new Set(validVals).size !== 2) return null;

  return {
    ...base,
    kind: 'situational',
    option_validity: validity as boolean[],
    option_style: cleanStyles,
  };
}

// Exports para tests
export const _internal = {
  buildTechPrompt,
  validateQuestion,
  buildDoubleAxisPrompt,
  validateDoubleAxisQuestion,
};
