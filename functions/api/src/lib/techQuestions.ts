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
import { anthropicMessage, extractToolUse, type AnthropicTool } from './anthropic';
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

const SYSTEM_TECH = `Eres evaluador técnico senior. Generas la prueba técnica de DOBLE EJE
de SharkTalents para un puesto específico. Es una prueba con 25 preguntas que mide
2 DIMENSIONES INDEPENDIENTES: conocimiento técnico + criterio profesional situacional.

═══════════════════════════════════════════════════════════════════
ESTRUCTURA OBLIGATORIA — 25 preguntas en 2 tipos
═══════════════════════════════════════════════════════════════════

  12 preguntas kind='technical'   — Conocimiento concreto del rol
  13 preguntas kind='situational' — Criterio profesional bajo trade-off

Si generas otra proporción tu output es inválido.

═══════════════════════════════════════════════════════════════════
TIPO 1: PREGUNTAS TECHNICAL (12 obligatorias)
═══════════════════════════════════════════════════════════════════

Miden CONOCIMIENTO DURO del rol. UNA sola respuesta objetivamente correcta.

Schema:
  {
    "id": "tq_1",
    "kind": "technical",
    "text": "...",
    "options": ["A", "B", "C", "D"],
    "correct": 0,        // índice 0-3 de la opción correcta
    "rationale": "..."
  }

REGLAS técnicas:
- Conocimiento concreto del DOMINIO del puesto, no genérico.
  Ej Contable: ITBMS Panamá 7%, conciliación cheques en tránsito, asientos, NIIF PYMES.
  Ej Dev: queries PostgreSQL, índices, OOM en Node, mocking Jest, AWS específico.
  Ej Logística: clasificación arancelaria, incoterms, Zona Libre Colón.
- Distractores PLAUSIBLES. Errores típicos de alguien con conocimiento superficial.
  PROHIBIDO distractores "obvio mal" como: "Ignoras", "Aceptas sin pensar",
  "Esperas a tu jefe sin hacer nada", "Cambias la política para acomodar al proveedor".
- NO googleables en 5 segundos. Buscamos comprensión + criterio técnico, no memoria.

═══════════════════════════════════════════════════════════════════
TIPO 2: PREGUNTAS SITUATIONAL (13 obligatorias)
═══════════════════════════════════════════════════════════════════

Miden CRITERIO PROFESIONAL bajo trade-off real. NO hay UNA respuesta correcta:
hay 2 opciones VÁLIDAS (ambas defendibles profesionalmente, revelan estilos
distintos) + 2 INVÁLIDAS (objetivamente malas).

Schema:
  {
    "id": "sq_1",
    "kind": "situational",
    "text": "...",
    "options": ["A", "B", "C", "D"],
    "option_validity": [true, true, false, false],   // 2 trues + 2 falses obligatorio
    "option_style": [
      { "axis": "autonomy_vs_consult", "value": "autonomy" },
      { "axis": "autonomy_vs_consult", "value": "consult" },
      null,
      null
    ],
    "rationale": "qué trade-off evalúa"
  }

REGLAS situacional (CRÍTICO — validamos shape estrictamente):

- option_validity DEBE tener EXACTAMENTE 2 valores true y 2 valores false. Ni 1, ni 3.
  Si das menos de 2 true, la pregunta es inválida y se descarta. Contá antes de devolver.
  ❌ MAL: [true, false, false, false]  (solo 1 true)
  ❌ MAL: [true, true, true, false]    (3 true)
  ✅ BIEN: [true, true, false, false]
  ✅ BIEN: [false, true, false, true]
  ✅ BIEN: [true, false, true, false]

- option_style DEBE tener axis="autonomy_vs_consult" EXACTO en las 2 válidas.
  NO inventes otros ejes como "transparency", "discretion", "communication", "proactive".
  SOLO existe "autonomy_vs_consult" — repetilo literal.
  ❌ MAL: { axis: "transparency", value: "transparent" }
  ❌ MAL: { axis: "communication", value: "direct" }
  ✅ BIEN: { axis: "autonomy_vs_consult", value: "autonomy" }
  ✅ BIEN: { axis: "autonomy_vs_consult", value: "consult" }

- De las 2 válidas, UNA tiene value="autonomy" y la OTRA tiene value="consult".
  NUNCA ambas con el mismo valor.
  ❌ MAL: las 2 válidas son value="autonomy"
  ✅ BIEN: 1 autonomy + 1 consult

- Las 2 inválidas tienen option_style=null (NO un objeto, null literal).

- Conceptos de cada eje:
    * 'autonomy' = el candidato actúa primero, decide solo, informa después
    * 'consult'  = el candidato consulta a su jefe / valida antes de actuar

- Las 2 inválidas (option_validity=false) son OBJETIVAMENTE MALAS:
  no atender al cliente, mentir, ocultar info, procrastinar, ignorar el problema,
  decisiones que comprometen integridad o seguridad.

- El orden de option_validity / option_style debe COINCIDIR con el orden de options.
- Situaciones realistas DEL PUESTO específico (no genéricas).

═══════════════════════════════════════════════════════════════════
REGLAS GLOBALES — aplican a las 25 preguntas
═══════════════════════════════════════════════════════════════════

1. ANTI-PATRÓN longitud (CRÍTICO — medido como mal en producción):
   Las 4 opciones DEBEN tener longitudes COMPARABLES — el desvío máximo entre
   la más corta y la más larga es ±20% en chars. Un candidato sin conocimiento
   técnico elige "la más larga" como heurística y acierta el 50% si no respetás
   esto.
   ❌ MAL (la correcta es la más larga):
      "A) 15%"
      "B) 25%"
      "C) 16.5% calculado en cascada sobre el arancel base + ITBMS Panamá"  ← correcta
      "D) 20%"
   ✅ BIEN (todas longitudes parejas):
      "A) 15% (solo arancel base)"
      "B) 25% (suma directa de arancel + sobretasa)"
      "C) 16.5% (arancel + sobretasa en cascada)"  ← correcta
      "D) 15% + USD 4500 fijo de sobretasa"

2. BALANCE distribución correctas (CRÍTICO — medido como mal en producción):
   En las 12 técnicas, las posiciones de la respuesta correcta DEBEN distribuirse
   APROXIMADAMENTE 25% en cada índice (0, 1, 2, 3). Esto es 3 correctas en cada
   posición. No es opcional.
   ❌ MAL: 8 en posición 0 + 3 en posición 1 + 1 en posición 2 (sesgo "siempre A")
   ✅ BIEN: 3 en posición 0 + 3 en posición 1 + 3 en posición 2 + 3 en posición 3
   ANTES de devolver el JSON, contá tus "correct" — si están sesgados, REASIGNALOS
   intercambiando opciones entre preguntas.

   Para situacionales, las 2 posiciones de option_validity=true también deben
   rotar entre [0,1] / [0,2] / [0,3] / [1,2] / [1,3] / [2,3] — NO siempre [0,1].

3. ANTI-REDUNDANCIA: dentro de las 25, cubre MÍNIMO 6 TÓPICOS distintos del rol.
   PROHIBIDO repetir el mismo escenario 3+ veces (ej: 3 preguntas sobre
   "documento incompleto" o 3 sobre "discrepancia en conciliación").

4. NIVEL de dificultad según cognitive_level:
   basic → junior (1-2 años exp)
   mid → mid-level (3-5 años)
   senior → senior (5+ años, criterio en ambigüedad)

5. LENGUAJE: español neutro Panamá. SIEMPRE "tú" / "tienes" / "necesitas" /
   "recibes" / "puedes". PROHIBIDO voseo argentino ("vos", "tenés", "necesitás",
   "recibís", "podés", "querés", "sabés", "viste", "fijate", "mirá"). Tampoco
   en las opciones.

6. rationale: UNA frase corta (MÁXIMO 80 chars) que diga qué evalúa la pregunta.
   NO reveles la respuesta correcta. Ejemplos del LARGO esperado:
   ✅ "Mide conocimiento de ITBMS Panamá y orden de cálculo de impuestos."
   ✅ "Evalúa decisión bajo conflicto cliente-jefe sin info completa."
   ❌ NO: párrafos largos. NO: explicación de cada opción. NO: justificación pedagógica.
   La rationale es para el admin, no para enseñar — sé directo.

═══════════════════════════════════════════════════════════════════
SCHEMA DEL JSON DE SALIDA
═══════════════════════════════════════════════════════════════════

{
  "questions": [
    /* 12 técnicas + 13 situacionales — 25 en total */
    { "id": "tq_1", "kind": "technical", "text": "...", "options": [...], "correct": 0, "rationale": "..." },
    { "id": "sq_1", "kind": "situational", "text": "...", "options": [...], "option_validity": [...], "option_style": [...], "rationale": "..." },
    ...
  ]
}

Output ESTRICTO JSON sin markdown, sin texto fuera del JSON.`;

/**
 * Tool definitions con JSON Schema estricto. Cuando se usa `tool_choice` para forzar
 * el tool, Anthropic valida el shape server-side ANTES de devolver — no más markdown,
 * no más JSON.parse manual, no más truncamiento en medio de un string mal escapado.
 */
const TOOL_TECHNICAL: AnthropicTool = {
  name: 'submit_technical_questions',
  description: 'Submit batch of technical knowledge questions (single correct answer).',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text', 'options', 'correct', 'rationale'],
          properties: {
            text: { type: 'string', description: 'Pregunta técnica completa' },
            options: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
              description: '4 opciones de respuesta',
            },
            correct: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Índice 0-3 de la opción correcta',
            },
            rationale: {
              type: 'string',
              maxLength: 120,
              description: 'Una frase corta (≤80 chars) describiendo qué evalúa',
            },
          },
        },
      },
    },
  },
};

const TOOL_SITUATIONAL: AnthropicTool = {
  name: 'submit_situational_questions',
  description: 'Submit batch of situational judgment questions with validity and style markers.',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text', 'options', 'option_validity', 'option_style', 'rationale'],
          properties: {
            text: { type: 'string', description: 'Escenario del puesto' },
            options: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
            },
            option_validity: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'boolean' },
              description: 'EXACTAMENTE 2 true + 2 false. Las true son profesionalmente válidas.',
            },
            option_style: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['axis', 'value'],
                    properties: {
                      axis: { type: 'string', enum: ['autonomy_vs_consult'] },
                      value: { type: 'string', enum: ['autonomy', 'consult'] },
                    },
                  },
                  { type: 'null' },
                ],
              },
              description: 'Las 2 válidas con {axis,value}: UNA autonomy + UNA consult. Las inválidas: null.',
            },
            rationale: {
              type: 'string',
              maxLength: 120,
            },
          },
        },
      },
    },
  },
};

function buildTechPrompt(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count: number;
  /** Tipo de batch: 'technical' (solo conocimiento) o 'situational' (solo criterio). */
  batchType: 'technical' | 'situational';
}): string {
  const { jobTitle, jobCompany, techPrompt, level, count, batchType } = args;
  const focusBlock = batchType === 'technical'
    ? `Genera SOLO preguntas kind='technical' (${count} en total). Cada una con UNA respuesta
correcta objetivamente verificable. Distractores plausibles (errores típicos de alguien
con conocimiento superficial). Cero preguntas situacionales en este batch.`
    : `Genera SOLO preguntas kind='situational' (${count} en total). Cada una con 4 opciones
defendibles donde 2 son válidas (estilo autonomy vs consult) + 2 inválidas
(objetivamente malas: ignorar, mentir, procrastinar, ocultar). Marca option_validity
[true|false] y option_style según el schema del system. Cero preguntas technical
en este batch.`;
  return `PUESTO: ${jobTitle}${jobCompany ? ` — ${jobCompany}` : ''}
NIVEL: ${level}
TIPO DE BATCH: ${batchType}
CANTIDAD: ${count}

CONTEXTO DEL PUESTO (qué evaluar):
${techPrompt}

INSTRUCCIONES ESPECÍFICAS DEL BATCH:
${focusBlock}

Responde con JSON estricto siguiendo el schema definido en el system prompt.`;
}

/**
 * Genera UN batch de N preguntas (sub-función de generateTechnicalQuestions).
 * Encapsula 1 llamada a Anthropic. Se usa en paralelo para acelerar la generación
 * total — ver generateTechnicalQuestions.
 */
async function generateOneTechBatch(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count: number;
  batchType: 'technical' | 'situational';
  idPrefix: string;
  traceId: string;
  jobId?: string;
  tenantId?: string;
  req?: import('http').IncomingMessage;
}): Promise<GeneratedQuestionDoubleAxis[]> {
  // Tool use forzado: Anthropic valida el shape contra el JSON schema definido en el tool
  // ANTES de devolver. Elimina markdown wrapping, JSON.parse manual y truncamiento de strings
  // mal escapados. Si excede maxTokens, el `input` puede venir incompleto pero el shape
  // de cada item validado individualmente sigue siendo correcto.
  // maxTokens 2500: medido en producción 2026-06-08, situacionales ~470 tokens c/u con 5
  // batches paralelos (6+6+5+4+4). Wall-clock ~15-18s, cabe en LB Catalyst 30s.
  const tool = args.batchType === 'technical' ? TOOL_TECHNICAL : TOOL_SITUATIONAL;
  const response = await anthropicMessage({
    system: SYSTEM_TECH,
    messages: [{ role: 'user', content: buildTechPrompt({
      jobTitle: args.jobTitle,
      jobCompany: args.jobCompany,
      techPrompt: args.techPrompt,
      level: args.level,
      count: args.count,
      batchType: args.batchType,
    }) }],
    maxTokens: 2500,
    temperature: 0.7,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  }, {
    traceId: args.traceId,
    feature: 'tech_questions',
    tenantId: args.tenantId ?? null,
    req: args.req,
    jobId: args.jobId,
  });

  const parsed = extractToolUse<{ questions: GeneratedQuestionDoubleAxis[] }>(response, tool.name);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error(`IA no devolvió questions array válido en batch ${args.batchType}`);
  }
  // Renumerar IDs y forzar `kind` correcto al tipo de batch (defensa por si la IA confunde).
  return parsed.questions.map((q, idx) => ({
    ...q,
    id: `${args.idPrefix}_${idx + 1}`,
    kind: args.batchType,
  }));
}

export async function generateTechnicalQuestions(args: {
  jobTitle: string;
  jobCompany?: string;
  techPrompt: string;
  level: 'basic' | 'mid' | 'senior';
  count?: number;
  traceId?: string;
  jobId?: string;
  tenantId?: string;
  req?: import('http').IncomingMessage;
}): Promise<GeneratedQuestionDoubleAxis[]> {
  const traceId = args.traceId ?? '';
  if (!args.techPrompt || !args.techPrompt.trim()) {
    throw new Error('techPrompt vacío — necesitamos descripción de qué evaluar');
  }

  // Doc 19: 12 técnicas + 13 situacionales = 25. 5 calls paralelos para evitar
  // truncamiento medido en producción 2026-06-08: cada situacional pesa ~470 tokens
  // reales (no 280-400 estimados). 7 × 470 = 3290 tokens excede cualquier maxTokens
  // razonable que quepa en el timeout LB Catalyst.
  // División:
  //   2 batches técnicos × 6 = 12 técnicas (6 × 300 = 1800 tokens, cabe en 2500)
  //   3 batches situacionales: 5+4+4 = 13 situacionales (5 × 470 = 2350 tokens, cabe en 2500)
  // 5 batches paralelos: wall-clock = max individual ~15-18s. Cabe en LB 30s.
  const batches = await Promise.all([
    generateOneTechBatch({
      jobTitle: args.jobTitle, jobCompany: args.jobCompany, techPrompt: args.techPrompt,
      level: args.level, count: 6, batchType: 'technical', idPrefix: 'tqA',
      traceId, jobId: args.jobId, tenantId: args.tenantId, req: args.req,
    }),
    generateOneTechBatch({
      jobTitle: args.jobTitle, jobCompany: args.jobCompany, techPrompt: args.techPrompt,
      level: args.level, count: 6, batchType: 'technical', idPrefix: 'tqB',
      traceId, jobId: args.jobId, tenantId: args.tenantId, req: args.req,
    }),
    generateOneTechBatch({
      jobTitle: args.jobTitle, jobCompany: args.jobCompany, techPrompt: args.techPrompt,
      level: args.level, count: 5, batchType: 'situational', idPrefix: 'sqA',
      traceId, jobId: args.jobId, tenantId: args.tenantId, req: args.req,
    }),
    generateOneTechBatch({
      jobTitle: args.jobTitle, jobCompany: args.jobCompany, techPrompt: args.techPrompt,
      level: args.level, count: 4, batchType: 'situational', idPrefix: 'sqB',
      traceId, jobId: args.jobId, tenantId: args.tenantId, req: args.req,
    }),
    generateOneTechBatch({
      jobTitle: args.jobTitle, jobCompany: args.jobCompany, techPrompt: args.techPrompt,
      level: args.level, count: 4, batchType: 'situational', idPrefix: 'sqC',
      traceId, jobId: args.jobId, tenantId: args.tenantId, req: args.req,
    }),
  ]);
  const [technicalA, technicalB, situationalA, situationalB, situationalC] = batches;

  // Re-numerar IDs para que el output tenga tq_1..tq_12 y sq_1..sq_13 consecutivos.
  const technicalRaw = [...technicalA, ...technicalB].map((q, idx) => ({
    ...q, id: `tq_${idx + 1}`,
  }));
  const situationalRaw = [...situationalA, ...situationalB, ...situationalC].map((q, idx) => ({
    ...q, id: `sq_${idx + 1}`,
  }));

  // Post-procesamiento anti-sesgo (doc 19): la IA tiende a poner la opción correcta en
  // posición 0 (50%+ medido) y a hacerla la más larga (50%+ medido). Estos patrones son
  // explotables por candidatos. Shuffle de opciones en código garantiza:
  //   - Distribución exacta de `correct` entre posiciones 0/1/2/3 (3 técnicas en cada una)
  //   - El sesgo de "más larga = correcta" se rompe porque la posición ya no es predecible
  // Para situacionales: shuffle random (option_validity rota naturalmente al permutar).
  const technicalCombined = shuffleTechnicalForBalance(technicalRaw);
  const situationalCombined = situationalRaw.map(shuffleSituationalOptions);
  const combined = [...technicalCombined, ...situationalCombined];

  log.info('tech questions generated (double-axis 6+6+5+4+4) + anti-bias shuffle', {
    traceId,
    technical_count: technicalCombined.length,
    situational_count: situationalCombined.length,
    total: combined.length,
    correct_distribution: countCorrectDistribution(technicalCombined),
  });

  return combined;
}

/**
 * Cuenta distribución de la posición correct en técnicas (para logging y validación).
 */
function countCorrectDistribution(questions: GeneratedQuestionDoubleAxis[]): Record<number, number> {
  const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const q of questions) {
    if (q.kind === 'technical' && typeof q.correct === 'number' && q.correct >= 0 && q.correct <= 3) {
      dist[q.correct]++;
    }
  }
  return dist;
}

/**
 * Para las 12 técnicas: asigna a cada una una posición target (3 en cada índice 0/1/2/3)
 * y mueve la opción correcta a esa posición. Las otras 3 opciones se reordenan aleatoriamente.
 *
 * Esto garantiza distribución 3+3+3+3 exacta y rompe el sesgo "siempre A" + "más larga = correcta"
 * porque la longitud de la correcta ahora aterriza en cualquier posición al azar.
 */
function shuffleTechnicalForBalance(
  questions: GeneratedQuestionDoubleAxis[],
): GeneratedQuestionDoubleAxis[] {
  // Lista de posiciones target: 3 ceros, 3 unos, 3 dos, 3 tres (total 12).
  // Si hay más/menos de 12 técnicas, ajustar manteniendo balance lo más posible.
  const targets: number[] = [];
  for (let pos = 0; pos < 4; pos++) {
    const slotsPerPos = Math.floor(questions.length / 4);
    for (let i = 0; i < slotsPerPos; i++) targets.push(pos);
  }
  // Distribuir los restantes (si questions.length no es múltiplo de 4) entre las posiciones.
  while (targets.length < questions.length) {
    targets.push(targets.length % 4);
  }
  // Shuffle de los targets para que el orden no sea predecible.
  shuffleInPlace(targets);

  return questions.map((q, idx) => {
    if (q.kind !== 'technical' || typeof q.correct !== 'number') return q;
    if (!Array.isArray(q.options) || q.options.length !== 4) return q;
    const newCorrectPos = targets[idx] ?? 0;
    if (q.correct === newCorrectPos) return q; // Ya está en la posición target

    // Intercambiar la opción correcta a la posición target.
    const newOptions = [...q.options];
    [newOptions[q.correct], newOptions[newCorrectPos]] = [newOptions[newCorrectPos], newOptions[q.correct]];
    return { ...q, options: newOptions, correct: newCorrectPos };
  });
}

/**
 * Para una situacional: shuffle random de las 4 opciones manteniendo sincronizados
 * option_validity y option_style (los 3 arrays se permutan con la misma permutación).
 */
function shuffleSituationalOptions(q: GeneratedQuestionDoubleAxis): GeneratedQuestionDoubleAxis {
  if (q.kind !== 'situational') return q;
  if (!Array.isArray(q.options) || q.options.length !== 4) return q;
  if (!Array.isArray(q.option_validity) || q.option_validity.length !== 4) return q;
  if (!Array.isArray(q.option_style) || q.option_style.length !== 4) return q;

  const perm = [0, 1, 2, 3];
  shuffleInPlace(perm);
  return {
    ...q,
    options: perm.map((i) => q.options[i]),
    option_validity: perm.map((i) => q.option_validity![i]),
    option_style: perm.map((i) => q.option_style![i]),
  };
}

/** Fisher-Yates shuffle in-place (no usar Math.random en hot path productivo, OK acá). */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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


// Exports para tests
export const _internal = {
  buildTechPrompt,
  validateQuestion,
};
