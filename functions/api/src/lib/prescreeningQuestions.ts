/**
 * Generador IA de preguntas de prescreening custom por puesto.
 *
 * El prescreening reemplaza el filtro inicial que antes vivía en Recruit.
 * Cuando un candidato llega a SharkTalents desde el email automático de Recruit,
 * lo primero que hace son 4-6 preguntas cortas calificatorias.
 *
 * Reglas críticas de las preguntas:
 * - Binarias o de múltiple opción (NO abiertas)
 * - Cada respuesta debe permitir auto-rechazo si no cumple criterio crítico
 * - Foco en: rango salarial, ubicación/remote, disponibilidad, experiencia core
 *
 * Output: array de PrescreeningQuestion. Persistido en Jobs.prescreening_questions_cache.
 */
import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';

const log = logger('PRESCREENING_QUESTIONS');

export type PrescreeningQuestion = {
  id: string;
  text: string;
  /** Tipo de pregunta — define cómo la UI la renderiza. */
  type: 'yes_no' | 'multiple_choice' | 'range_match';
  /** Opciones disponibles. Para yes_no: ["Sí", "No"]. */
  options: string[];
  /**
   * Índices de opciones que SE ACEPTAN (pasa prescreening si elige una de estas).
   * Si el candidato elige cualquier OTRA opción, queda auto-rechazado.
   */
  accepted_indices: number[];
  /** Razón de auto-rechazo si elige una opción no aceptada. */
  rejection_reason: string;
  /** Criterio que evalúa (para Cris/admin entender). */
  criterion: string;
};

const SYSTEM_PRESCREENING = `Eres experto en filtrado inicial de candidatos. Tu tarea: generar preguntas
calificatorias que filtren candidatos ANTES de hacer evaluaciones costosas.

CRÍTICO — LECCIONES DE CASOS REALES:
La mayoría de preguntas SÍ/NO sobre experiencia/skills son INÚTILES porque los
candidatos mienten para pasar. Ejemplos de preguntas BASURA que NO debes generar:
  ❌ "¿Tienes 3+ años de experiencia en X?" → todos dicen sí
  ❌ "¿Tienes dominio de Excel avanzado?" → autoreporte siempre inflado
  ❌ "¿Tu nivel de inglés es intermedio o superior?" → todos dicen sí
  ❌ "¿Te sientes cómodo trabajando bajo presión?" → quién dice "soy frágil"?
  ❌ "¿Tienes experiencia en supervisión de equipos?" → "lideré 1 día" cuenta
  ❌ "¿Estás familiarizado con HACCP/BPM?" → "leí Wikipedia" cuenta

REGLAS ESTRICTAS DE PREGUNTAS:

1. **PROHIBIDO yes_no salvo binarios VERIFICABLES con sí/no objetivo**.
   yes_no SOLO permitido cuando la respuesta es comprobable y sin matices:
   ✅ "¿Puedes trabajar presencial en Zona Libre Colón?" (sí o no, objetivo)
   ✅ "¿Resides actualmente en Panamá?" (objetivo)
   ✅ "¿Tienes permiso de trabajo en Panamá?" (objetivo)
   ✅ "¿Cuentas con vehículo propio?" (objetivo)
   ❌ Cualquier yes_no sobre EXPERIENCIA, SKILLS, AUTOREPORTE → usar multiple_choice escalonada.

2. **OBLIGATORIO multiple_choice escalonada para EXPERIENCIA** (años, frecuencia):
   ✅ "¿Cuántos años de experiencia tienes en [X concreto]?"
      Opciones: ["Ninguna", "1-2 años", "3-5 años", "5-10 años", "10+ años"]
   ✅ "¿Cuál fue la última vez que [hiciste X concreto]?"
      Opciones: ["Nunca", "Hace +2 años", "Hace 6 meses-2 años", "En los últimos 6 meses"]

3. **OBLIGATORIO multiple_choice con EJEMPLOS CONCRETOS para nivel de skill**
   (no auto-reportes vacíos):
   ✅ Para Excel: "¿Cuál de estas funciones usaste en los últimos 6 meses?"
      Opciones: ["Ninguna", "Solo SUMA/PROMEDIO", "Tablas dinámicas y BUSCARV",
                "Power Query, INDEX-MATCH, macros"]
   ✅ Para inglés: "¿Última vez que tuviste una reunión completa en inglés?"
      Opciones: ["Nunca", "Hace +1 año", "En los últimos 6 meses", "Esta semana"]
   ✅ Para liderazgo: "¿Cuántas personas reportaron directo a ti en tu último puesto?"
      Opciones: ["Ninguna", "1-3", "4-10", "10+"]

4. **NUNCA reveles el rango salarial del puesto** en la pregunta (anchor bias).
   ❌ "Nuestro rango es 900-1100 USD, ¿aceptas?"
   ✅ "¿Cuál es tu pretensión salarial mensual neta en USD?"
      Opciones por tramos: ["<800", "800-1100", "1100-1500", "1500-2000", "+2000"]
   Después tu lógica de accepted_indices marca cuáles entran al rango oficial.

5. **NO preguntas SESGADAS de personalidad/soft skill** (todos eligen la deseable):
   ❌ "¿Cómo describes tu capacidad de mantener la calma?" (todos = excelente)
   ❌ "¿Te sientes cómodo cuestionando decisiones?" (todos = sí)
   Esas van en el test conductual/integridad, NO en prescreening.

6. **Cantidad**: ESTRICTAMENTE 5 o 6 preguntas. No menos, no más.
   La regla de negocio es 5-6: con menos no filtramos lo suficiente, con más cansamos
   al candidato. Generá EXACTAMENTE 6 preguntas, todas que pasen las reglas 1-5 arriba.
   Si dudás de alguna, NO la incluyas — pero entonces generá otra que sí pase. Es mejor
   regenerar internamente que devolver 4 preguntas.

7. **Lenguaje**: español neutro Panamá. SIEMPRE "tú" / "tienes" / "puedes".
   NUNCA voseo argentino ("vos", "tenés", "podés", "querés").

8. **accepted_indices**: para cada pregunta, marca los ÍNDICES de opciones que
   pasan el filtro. Resto = auto-rechazo con rejection_reason claro.

Devuelve SOLO el JSON con este schema, sin markdown:
{
  "questions": [
    {
      "id": "pq_1",
      "text": "string (la pregunta)",
      "type": "yes_no" | "multiple_choice" | "range_match",
      "options": ["opción 1", "opción 2", ...],
      "accepted_indices": [0, 1],
      "rejection_reason": "string corto que se le muestra al candidato si no cumple",
      "criterion": "string corto explicando qué evalúa la pregunta"
    }
  ]
}`;

function buildPrescreeningPrompt(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  salaryRange?: { min?: number; max?: number };
  location?: string;
}): string {
  // IMPORTANTE: pasamos el rango interno SOLO como guía para que la IA marque
  // accepted_indices correctamente — pero la pregunta misma NO debe revelarlo
  // al candidato (regla #4 del system prompt).
  const salaryGuide = args.salaryRange && (args.salaryRange.min || args.salaryRange.max)
    ? `\n[GUÍA INTERNA — NO REVELAR AL CANDIDATO]: rango oficial USD ${args.salaryRange.min ?? '?'}-${args.salaryRange.max ?? '?'}. Usa esto solo para marcar qué tramos de pretensión salarial pasan el filtro.\n`
    : '';
  return `PUESTO: ${args.jobTitle}${args.jobCompany ? ` — ${args.jobCompany}` : ''}
${args.location ? `Ubicación: ${args.location}` : ''}
${salaryGuide}
CONTEXTO TÉCNICO DEL PUESTO (lo que se va a evaluar después en otro test):
${args.techPrompt}

Genera las preguntas de prescreening aplicando ESTRICTAMENTE las reglas del system prompt:
- Cuantitativas escalonadas para experiencia (años) y skills (con ejemplos concretos)
- yes_no SOLO para binarios verificables objetivos (residencia, modalidad, permiso)
- Pretensión salarial preguntada SIN revelar el rango oficial
- EXACTAMENTE 5 o 6 preguntas. No menos. Si dudás de alguna, REEMPLAZALA por otra que pase las reglas, no la dejes afuera.
- Lenguaje "tú" estricto, sin voseo`;
}

/**
 * Llama Anthropic para generar las preguntas de prescreening.
 * Persistencia es responsabilidad del caller (outbox handler).
 */
export async function generatePrescreeningQuestions(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  salaryRange?: { min?: number; max?: number };
  location?: string;
  traceId?: string;
  jobId?: string;
  tenantId?: string;
  req?: import('http').IncomingMessage;
}): Promise<PrescreeningQuestion[]> {
  const traceId = args.traceId ?? '';

  if (!args.techPrompt || !args.techPrompt.trim()) {
    throw new Error('techPrompt vacío — necesitamos contexto del puesto para inferir criterios críticos');
  }

  const response = await anthropicMessage({
    system: [{ type: 'text', text: SYSTEM_PRESCREENING, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildPrescreeningPrompt(args) }],
    maxTokens: 1500,
    temperature: 0.4,
  }, {
    traceId,
    feature: 'prescreening_questions',
    tenantId: args.tenantId ?? null,
    req: args.req,
    jobId: args.jobId,
  });

  const parsed = extractJson<{ questions: PrescreeningQuestion[] }>(response);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error('IA no devolvió questions array válido');
  }

  const validated = parsed.questions
    .map((q, idx) => validateQuestion(q, idx))
    .filter((q): q is PrescreeningQuestion => q !== null);

  // Regla de negocio (Cris 2026-06-08, no negociable): SIEMPRE 5-6 preguntas válidas.
  // Si la 1ra llamada generó <5 válidas, hacemos UNA llamada extra pidiendo completar
  // las faltantes. Sin esto, la IA dejaba el handler en failed cada vez que su output
  // tenía 1-2 preguntas que el validator rechazaba.
  if (validated.length < 5) {
    const needed = 6 - validated.length;
    log.warn('prescreening: primera llamada generó <5 válidas, retry para completar', {
      validated: validated.length, needed, traceId,
    });
    try {
      const completionPrompt = `${buildPrescreeningPrompt(args)}

CONTEXTO ADICIONAL: tu llamada anterior generó ${validated.length} preguntas válidas (necesitamos 5-6).
Generá ${needed} preguntas MÁS aplicando las MISMAS reglas estrictas. NO repitas las que ya hay.
Devolvé SOLO las nuevas en el mismo JSON schema.`;
      const completionResponse = await anthropicMessage({
        system: [{ type: 'text', text: SYSTEM_PRESCREENING, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: completionPrompt }],
        maxTokens: 1500,
        temperature: 0.5,
      }, { traceId, feature: 'prescreening_questions_retry', tenantId: args.tenantId ?? null, req: args.req, jobId: args.jobId });
      const completionParsed = extractJson<{ questions: PrescreeningQuestion[] }>(completionResponse);
      const completionValidated = (completionParsed?.questions ?? [])
        .map((q, idx) => validateQuestion(q, validated.length + idx))
        .filter((q): q is PrescreeningQuestion => q !== null);
      log.info('prescreening retry produced extra valid questions', {
        retry_validated: completionValidated.length, traceId,
      });
      validated.push(...completionValidated);
    } catch (retryErr) {
      log.warn('prescreening retry failed (continuing with original)', {
        error: (retryErr as Error).message, traceId,
      });
    }
  }
  if (validated.length < 5) {
    throw new Error(`IA generó solo ${validated.length} preguntas válidas tras retry (mínimo 5, esperado 5-6)`);
  }
  if (validated.length > 6) {
    log.warn('IA generó demasiadas preguntas, truncando a 6', { generated: validated.length });
    return validated.slice(0, 6);
  }

  log.info('prescreening questions generated', {
    traceId,
    validated: validated.length,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return validated;
}

function validateQuestion(raw: unknown, idx: number): PrescreeningQuestion | null {
  // Validator estricto + log de razón cuando rechazamos, para diagnosticar
  // qué shape inválido manda la IA (no podemos arreglar lo que no medimos).
  const rejectReason = (reason: string): null => {
    log.warn('prescreening question rejected by validator', {
      idx, reason,
      raw_preview: JSON.stringify(raw).slice(0, 300),
    });
    return null;
  };
  if (typeof raw !== 'object' || raw === null) return rejectReason('not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return rejectReason('text missing or empty');
  if (!Array.isArray(r.options)) return rejectReason('options not array');
  // Max 5 opciones: el system prompt pide 5 tramos para experiencia y salario
  // (Ninguna/1-2/3-5/5-10/10+ años y los 5 tramos salariales). Si la IA genera 5 ahí,
  // está CUMPLIENDO la regla. Antes el max era 4 y rechazaba preguntas correctas.
  if (r.options.length < 2 || r.options.length > 5) return rejectReason(`options length ${r.options.length} (expected 2-5)`);
  if (!r.options.every((o) => typeof o === 'string' && o.trim().length > 0)) return rejectReason('options has non-string or empty');
  if (!Array.isArray(r.accepted_indices)) return rejectReason('accepted_indices not array');
  if (r.accepted_indices.length === 0) return rejectReason('accepted_indices empty');
  if (!r.accepted_indices.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < (r.options as string[]).length)) {
    return rejectReason(`accepted_indices out of bounds: ${JSON.stringify(r.accepted_indices)} vs ${(r.options as string[]).length} options`);
  }
  if (typeof r.rejection_reason !== 'string' || !r.rejection_reason.trim()) return rejectReason('rejection_reason missing');

  const type = ['yes_no', 'multiple_choice', 'range_match'].includes(r.type as string)
    ? (r.type as PrescreeningQuestion['type'])
    : 'multiple_choice';

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `pq_${idx + 1}`,
    text: r.text.trim().slice(0, 500),
    type,
    options: (r.options as string[]).map((o) => String(o).trim().slice(0, 200)),
    accepted_indices: (r.accepted_indices as number[]).filter((i): i is number => Number.isInteger(i)),
    rejection_reason: r.rejection_reason.trim().slice(0, 300),
    criterion: typeof r.criterion === 'string' ? r.criterion.trim().slice(0, 200) : 'Criterio no especificado',
  };
}

/**
 * Evalúa las respuestas del candidato. Devuelve { passed, failedQuestion }.
 * Si alguna respuesta NO está en accepted_indices → falla y devolvemos la pregunta+razón.
 */
export function evaluatePrescreeningAnswers(
  questions: PrescreeningQuestion[],
  answers: Array<{ question_id: string; selected_index: number }>,
): { passed: boolean; failedQuestion?: PrescreeningQuestion; failedAnswer?: number } {
  const answersById = new Map(answers.map((a) => [a.question_id, a.selected_index]));
  for (const q of questions) {
    const selected = answersById.get(q.id);
    if (selected == null) {
      // No respondió esa pregunta — considerar fallo
      return { passed: false, failedQuestion: q };
    }
    if (!q.accepted_indices.includes(selected)) {
      return { passed: false, failedQuestion: q, failedAnswer: selected };
    }
  }
  return { passed: true };
}
