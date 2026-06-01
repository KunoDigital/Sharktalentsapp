/**
 * Scoring del test de inglés (4 niveles CEFR: A2/B1/B2/C1).
 *
 * El test tiene 3 bloques:
 * 1. Multiple-choice (vocab + grammar + reading): peso 50%
 * 2. Listening: peso 25%
 * 3. Writing (analizado por IA): peso 25%
 *
 * El score total ponderado se compara contra el threshold del nivel solicitado:
 * - A2: 60% / B1: 65% / B2: 70% / C1: 75%
 *
 * Si total >= threshold → passed = true → el candidato pasa al video speaking.
 *
 * Ver doc: [docs/master-plan/25_TEST_INGLES.md](../../../docs/master-plan/25_TEST_INGLES.md)
 */

export type CefrLevel = 'A2' | 'B1' | 'B2' | 'C1';

/** Pesos del score total. Suman 1.0. */
export const ENGLISH_SCORE_WEIGHTS = {
  multiple_choice: 0.50,
  listening: 0.25,
  writing: 0.25,
} as const;

/** Threshold de pase por nivel CEFR. */
export const ENGLISH_PASS_THRESHOLDS: Record<CefrLevel, number> = {
  A2: 60,
  B1: 65,
  B2: 70,
  C1: 75,
};

export type EnglishScoringInput = {
  level: CefrLevel;
  /** % de aciertos en multiple-choice (0-100). */
  mc_score_pct: number;
  /** % de aciertos en listening (0-100). */
  listening_score_pct: number;
  /** % asignado por la IA al writing (0-100). */
  writing_score_pct: number;
};

export type EnglishScoringResult = {
  level: CefrLevel;
  threshold_pct: number;
  mc_score_pct: number;
  listening_score_pct: number;
  writing_score_pct: number;
  /** Score total ponderado (0-100). */
  total_score_pct: number;
  /** True si total >= threshold. */
  passed: boolean;
};

/**
 * Calcula score total + verifica si el candidato pasa al nivel solicitado.
 *
 * @throws Error si algún score parcial está fuera de [0, 100] o el level es inválido.
 */
export function scoreEnglishTest(input: EnglishScoringInput): EnglishScoringResult {
  if (!(input.level in ENGLISH_PASS_THRESHOLDS)) {
    throw new Error(`englishScoring: invalid level "${input.level}". Must be A2, B1, B2, or C1.`);
  }

  const partials = [input.mc_score_pct, input.listening_score_pct, input.writing_score_pct];
  for (const p of partials) {
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new Error(`englishScoring: partial scores must be in [0, 100], got ${p}`);
    }
  }

  const totalRaw =
    input.mc_score_pct * ENGLISH_SCORE_WEIGHTS.multiple_choice +
    input.listening_score_pct * ENGLISH_SCORE_WEIGHTS.listening +
    input.writing_score_pct * ENGLISH_SCORE_WEIGHTS.writing;

  const total_score_pct = Math.round(totalRaw);
  const threshold_pct = ENGLISH_PASS_THRESHOLDS[input.level];
  const passed = total_score_pct >= threshold_pct;

  return {
    level: input.level,
    threshold_pct,
    mc_score_pct: input.mc_score_pct,
    listening_score_pct: input.listening_score_pct,
    writing_score_pct: input.writing_score_pct,
    total_score_pct,
    passed,
  };
}

/**
 * Helper: calcula score parcial multiple-choice dado un array de respuestas.
 *
 * @param correctCount cantidad de respuestas correctas
 * @param totalQuestions cantidad total de preguntas
 */
export function multipleChoiceScorePct(correctCount: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  if (correctCount < 0) correctCount = 0;
  if (correctCount > totalQuestions) correctCount = totalQuestions;
  return Math.round((correctCount / totalQuestions) * 100);
}
