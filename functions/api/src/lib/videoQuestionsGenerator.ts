/**
 * Generador IA de preguntas de video personalizadas por candidato (doc 20).
 *
 * Input: scores del candidato + perfil del puesto + (opcional) claims del CV.
 * Output: 7 preguntas (8 si el puesto requiere inglés) con texto, categoría y rationale interno.
 *
 * Las preguntas NO son fijas. Se personalizan según:
 *   - Áreas débiles detectadas en pruebas
 *   - Cross-references entre CV y técnica
 *   - Flags de integridad (medio/alto)
 *   - Caso real del puesto
 *
 * El rationale interno NO se muestra al candidato — solo Cris lo ve.
 */
import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';

const log = logger('VIDEO_QUESTIONS_GEN');

export type VideoQuestionCategory =
  | 'technical'
  | 'weakness_followup'
  | 'situational'
  | 'cv_claim_check'
  | 'integrity_check'
  | 'english_check';

export type GeneratedVideoQuestion = {
  id: string;
  category: VideoQuestionCategory;
  question_text: string;
  rationale_internal: string;
  expected_signals: string[];
  max_duration_sec: number;
};

const SYSTEM_VIDEO_QUESTIONS = `Sos un reclutador senior. Vas a generar 7 preguntas (8 si requires_english=true)
para que un candidato responda en video corto. Las preguntas deben ser ESPECÍFICAS al candidato,
basadas en sus resultados de pruebas y, si está disponible, en su CV.

REGLAS ESTRICTAS:
- Cantidad: exactamente 7 (o 8 si requires_english=true; la 8va en inglés).
- Cada pregunta clara, sin ambigüedad — el candidato debe entenderla en 5 segundos.
- Mezcla de tipos:
  * 2-3 'technical' — validar conocimiento concreto del puesto.
  * 1-2 'weakness_followup' — sobre puntos débiles detectados (formato observacional, NO acusatorio).
  * 1 'situational' — caso real del puesto.
  * 1 'cv_claim_check' — claim del CV no validado todavía (solo si hay CV claims; sino, otra technical).
  * 1 'integrity_check' SI hay flag de integridad medio/alto — formato suave, observacional.
  * 1 'english_check' SI requires_english=true.
- Respuestas esperadas: 30-90 segundos por pregunta.
- NO preguntas trampa, NO ad hominem, NO preguntas que invadan privacidad.
- Idioma: español neutro (Argentina/Panamá), excepto la english_check.

OUTPUT: JSON con schema:
{
  "questions": [
    {
      "id": "v1",
      "category": "technical|weakness_followup|situational|cv_claim_check|integrity_check|english_check",
      "question_text": "...",
      "rationale_internal": "Por qué hacer esta pregunta — solo para Cris, NO se le muestra al candidato",
      "expected_signals": ["claridad", "ejemplo concreto"],
      "max_duration_sec": 60
    }
  ]
}`;

type GeneratorInput = {
  jobTitle: string;
  jobCompany: string;
  jobContext?: string;
  cognitiveLevel: 'basic' | 'mid' | 'senior';
  requiresEnglish?: boolean;
  candidateName: string;
  scores: Record<string, unknown> | null;
  integrityDimensions?: Array<{ dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number }>;
  cvClaims?: string[];
  weaknesses?: string[];
  traceId?: string;
};

function buildUserPrompt(input: GeneratorInput): string {
  const lines: string[] = [
    `PUESTO: ${input.jobTitle}${input.jobCompany ? ` — ${input.jobCompany}` : ''}`,
    `NIVEL: ${input.cognitiveLevel}`,
    input.requiresEnglish ? 'REQUIERE INGLÉS: sí (agregar 8va pregunta en inglés)' : 'REQUIERE INGLÉS: no',
  ];

  if (input.jobContext) lines.push(`CONTEXTO: ${input.jobContext}`);

  lines.push('', `CANDIDATO: ${input.candidateName}`);

  if (input.scores) {
    const s = input.scores;
    if (s.disc_norm_d != null) {
      lines.push(`DISC norm: D=${s.disc_norm_d} I=${s.disc_norm_i} S=${s.disc_norm_s} C=${s.disc_norm_c}`);
    }
    if (s.velna_indice != null) lines.push(`Cognitiva (VELNA) índice: ${s.velna_indice}/100`);
    if (s.tec_score_pct != null) lines.push(`Técnica: ${s.tec_score_pct}% (${s.tec_passed === false ? 'NO pasó' : 'pasó'} mínimo)`);
    if (s.emo_score != null) lines.push(`Emocional: ${s.emo_score}/100, perfil ${s.emo_perfil ?? 'N/A'}`);
    if (s.int_overall != null) lines.push(`Integridad overall: ${s.int_overall} (${s.int_overall_pct ?? 0}% riesgo)`);
  }

  if (input.integrityDimensions && input.integrityDimensions.length > 0) {
    const flagged = input.integrityDimensions.filter((d) => d.nivel !== 'bajo');
    if (flagged.length > 0) {
      lines.push(`Dimensiones integridad con FLAG: ${flagged.map((d) => `${d.dimension}=${d.nivel} (${d.pct}%)`).join(', ')}`);
    }
  }

  if (input.weaknesses && input.weaknesses.length > 0) {
    lines.push(`Debilidades detectadas: ${input.weaknesses.join('; ')}`);
  }

  if (input.cvClaims && input.cvClaims.length > 0) {
    lines.push(`Claims del CV no validados: ${input.cvClaims.slice(0, 5).join('; ')}`);
  }

  return lines.join('\n');
}

export async function generateVideoQuestions(input: GeneratorInput): Promise<GeneratedVideoQuestion[]> {
  const traceId = input.traceId ?? '';
  const expectedCount = input.requiresEnglish ? 8 : 7;

  const response = await anthropicMessage({
    system: [{ type: 'text', text: SYSTEM_VIDEO_QUESTIONS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    maxTokens: 3000,
    temperature: 0.7,
  }, traceId);

  const parsed = extractJson<{ questions: GeneratedVideoQuestion[] }>(response);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error('IA no devolvió array de questions válido');
  }

  const validated = parsed.questions
    .map((q, idx) => validateQuestion(q, idx))
    .filter((q): q is GeneratedVideoQuestion => q !== null);

  if (validated.length < 5) {
    throw new Error(`IA generó solo ${validated.length} preguntas válidas (mínimo 5)`);
  }

  log.info('video questions generated', {
    traceId,
    expected: expectedCount,
    received: parsed.questions.length,
    validated: validated.length,
    has_english: validated.some((q) => q.category === 'english_check'),
    has_integrity_check: validated.some((q) => q.category === 'integrity_check'),
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return validated;
}

const VALID_CATEGORIES: readonly VideoQuestionCategory[] = [
  'technical', 'weakness_followup', 'situational',
  'cv_claim_check', 'integrity_check', 'english_check',
];

function validateQuestion(raw: unknown, idx: number): GeneratedVideoQuestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.question_text !== 'string' || !r.question_text.trim()) return null;
  if (!VALID_CATEGORIES.includes(r.category as VideoQuestionCategory)) return null;

  const duration = Number(r.max_duration_sec);
  const validDuration = Number.isFinite(duration) && duration >= 15 && duration <= 180
    ? Math.round(duration)
    : 60;

  const signals = Array.isArray(r.expected_signals)
    ? r.expected_signals.filter((s) => typeof s === 'string').slice(0, 5)
    : [];

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `v${idx + 1}`,
    category: r.category as VideoQuestionCategory,
    question_text: r.question_text.trim().slice(0, 1000),
    rationale_internal: typeof r.rationale_internal === 'string'
      ? r.rationale_internal.slice(0, 1000)
      : '',
    expected_signals: signals,
    max_duration_sec: validDuration,
  };
}

// Helpers para identificar weaknesses desde scores
export function analyzeWeaknesses(scores: Record<string, unknown> | null): string[] {
  if (!scores) return [];
  const out: string[] = [];
  const s = scores;

  if (typeof s.tec_score_pct === 'number' && s.tec_score_pct < 70) {
    out.push(`Técnica baja: ${s.tec_score_pct}%`);
  }
  if (typeof s.velna_indice === 'number' && s.velna_indice < 60) {
    out.push(`Cognitiva baja: índice ${s.velna_indice}`);
  }
  if (typeof s.emo_score === 'number' && s.emo_score < 50) {
    out.push(`Emocional bajo: ${s.emo_score}`);
  }
  // DISC: detectar polos extremos que pueden friccionar con puesto
  // Solo flag si el campo existe (typeof number) — no suponer 0 si está ausente
  if (typeof s.disc_norm_d === 'number' && s.disc_norm_d < 25) {
    out.push(`DISC D bajo (${s.disc_norm_d}) — poco asertivo en decisiones`);
  }
  if (typeof s.disc_norm_i === 'number' && s.disc_norm_i < 25) {
    out.push(`DISC I bajo (${s.disc_norm_i}) — poco social`);
  }
  if (typeof s.disc_norm_c === 'number' && s.disc_norm_c < 25) {
    out.push(`DISC C bajo (${s.disc_norm_c}) — poco detallista`);
  }

  return out;
}

// Exports para tests
export const _internal = { buildUserPrompt, validateQuestion, VALID_CATEGORIES };
