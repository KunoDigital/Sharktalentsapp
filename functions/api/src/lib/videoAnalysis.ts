/**
 * Análisis IA de UNA respuesta en video (transcript ya disponible).
 *
 * Input: pregunta original + rationale + transcript del candidato.
 * Output: análisis estructurado con score por dimensión + observaciones + flags.
 *
 * NO se hace transcripción acá — el transcript llega de Whisper/Zia/etc. (integraciones).
 * Este lib solo procesa el TEXT.
 */
import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';
import type { VideoQuestionCategory } from './videoQuestionsGenerator';

const log = logger('VIDEO_ANALYSIS');

export type VideoAnswerAnalysis = {
  /** Score global 0-100 de la respuesta. */
  overall_pct: number;
  /** Cumplió con los expected_signals de la pregunta (% de señales detectadas). */
  signals_matched_pct: number;
  /** Listado de observaciones en español neutro. 2-4 frases. */
  observations: string[];
  /** Flags binarios para señales rojas (ej: "respuesta evasiva", "mintió"). */
  flags: string[];
  /** Para preguntas cv_claim_check: ¿el candidato corroboró el claim? */
  claim_corroborated?: boolean;
  /** Para preguntas integrity_check: nivel de preocupación 0-100 (0=todo bien, 100=red flag). */
  integrity_concern_pct?: number;
  /** Para preguntas english_check: nivel del candidato 0-100. */
  english_level_pct?: number;
};

const SYSTEM_VIDEO_ANALYSIS = `Sos un evaluador senior. Recibís una pregunta + el transcript de la respuesta de un candidato (1-2 minutos hablado).
Generás un análisis estructurado.

REGLAS ESTRICTAS:
- Sé honesto: si la respuesta es vaga, marcalo. Si es excelente, marcalo.
- NO inventar contenido que no esté en el transcript.
- Observaciones: 2-4 frases concisas. Mencionar tanto fortalezas como debilidades.
- Flags solo si hay evidencia clara: "evasiva" (no contestó), "incoherente" (contradicciones), "exagerada" (claims sin sustento).
- overall_pct: ponderar profundidad + ejemplos concretos + claridad + match con expected_signals.
- Para cv_claim_check: claim_corroborated=true si describe la experiencia con detalle creíble; false si es vaga o evasiva.
- Para integrity_check: integrity_concern_pct refleja red flags (0=narrativa creíble y matizada; 100=red flags claros).
- Para english_check: english_level_pct según fluidez + gramática + vocabulary del transcript.

OUTPUT JSON estricto:
{
  "overall_pct": 0-100,
  "signals_matched_pct": 0-100,
  "observations": ["...", "..."],
  "flags": ["..."],
  "claim_corroborated": true|false,
  "integrity_concern_pct": 0-100,
  "english_level_pct": 0-100
}`;

export type AnalyzeInput = {
  category: VideoQuestionCategory;
  question_text: string;
  rationale_internal?: string;
  expected_signals: string[];
  transcript: string;
  traceId?: string;
};

export async function analyzeVideoAnswer(input: AnalyzeInput): Promise<VideoAnswerAnalysis> {
  if (!input.transcript || input.transcript.trim().length < 20) {
    throw new Error('Transcript demasiado corto (<20 chars) — no se puede analizar');
  }

  const userPrompt = [
    `CATEGORÍA: ${input.category}`,
    `PREGUNTA: ${input.question_text}`,
    input.rationale_internal ? `CONTEXTO INTERNO (no compartido al candidato): ${input.rationale_internal}` : '',
    `EXPECTED SIGNALS: ${input.expected_signals.join(', ') || 'N/A'}`,
    '',
    'TRANSCRIPT DE LA RESPUESTA:',
    input.transcript.slice(0, 8000),
  ].filter(Boolean).join('\n');

  const response = await anthropicMessage({
    system: [{ type: 'text', text: SYSTEM_VIDEO_ANALYSIS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 1200,
    temperature: 0.4,
  }, input.traceId ?? '');

  const parsed = extractJson<VideoAnswerAnalysis>(response);
  return validateAnalysis(parsed);
}

function clamp0_100(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function validateAnalysis(raw: unknown): VideoAnswerAnalysis {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Analysis output not object');
  }
  const r = raw as Record<string, unknown>;
  const out: VideoAnswerAnalysis = {
    overall_pct: clamp0_100(r.overall_pct),
    signals_matched_pct: clamp0_100(r.signals_matched_pct),
    observations: Array.isArray(r.observations)
      ? r.observations.filter((s) => typeof s === 'string').slice(0, 6).map((s) => String(s).slice(0, 500))
      : [],
    flags: Array.isArray(r.flags)
      ? r.flags.filter((s) => typeof s === 'string').slice(0, 6).map((s) => String(s).slice(0, 200))
      : [],
  };

  if (typeof r.claim_corroborated === 'boolean') out.claim_corroborated = r.claim_corroborated;
  if (r.integrity_concern_pct != null) out.integrity_concern_pct = clamp0_100(r.integrity_concern_pct);
  if (r.english_level_pct != null) out.english_level_pct = clamp0_100(r.english_level_pct);

  return out;
}

log.debug('video analysis lib loaded');

export const _internal = { validateAnalysis, clamp0_100 };
