/**
 * Scoring del test de Mentalidades (McKinsey Forward — Adaptabilidad y Resiliencia).
 *
 * El test tiene 10 preguntas con 6 opciones cada una (3 ejes × 2 polos). El candidato
 * elige UNA por pregunta. El scoring cuenta cuántas veces eligió cada mentalidad y
 * computa:
 *
 * - **adaptability_score_pct**: % de elecciones de polos adaptables (0-100). Output principal.
 * - **adaptability_pattern**: 'adaptable' | 'mixto' | 'limitante' (basado en thresholds).
 * - **profile_per_axis**: 7 ejes × 2 polos cada uno con su % (output secundario).
 *
 * Ver doc: [docs/master-plan/26_TEST_MENTALIDADES.md](../../../docs/master-plan/26_TEST_MENTALIDADES.md)
 */

/** Las 14 mentalidades del marco McKinsey Forward. */
export type Mentalidad =
  | 'fija' | 'crecimiento'
  | 'experto' | 'curiosa'
  | 'reactiva' | 'creativa'
  | 'victima' | 'agente'
  | 'escasez' | 'abundancia'
  | 'certeza' | 'exploracion'
  | 'proteccion' | 'oportunidad';

/** Mapeo mentalidad → eje (1-7) + polo (limitante/adaptable). */
export const MINDSET_TO_AXIS: Record<Mentalidad, { axis: number; polo: 'limitante' | 'adaptable' }> = {
  fija:         { axis: 1, polo: 'limitante' },
  crecimiento:  { axis: 1, polo: 'adaptable' },
  experto:      { axis: 2, polo: 'limitante' },
  curiosa:      { axis: 2, polo: 'adaptable' },
  reactiva:     { axis: 3, polo: 'limitante' },
  creativa:     { axis: 3, polo: 'adaptable' },
  victima:      { axis: 4, polo: 'limitante' },
  agente:       { axis: 4, polo: 'adaptable' },
  escasez:      { axis: 5, polo: 'limitante' },
  abundancia:   { axis: 5, polo: 'adaptable' },
  certeza:      { axis: 6, polo: 'limitante' },
  exploracion:  { axis: 6, polo: 'adaptable' },
  proteccion:   { axis: 7, polo: 'limitante' },
  oportunidad:  { axis: 7, polo: 'adaptable' },
};

/** Thresholds para determinar el patrón. */
export const ADAPTABILITY_THRESHOLDS = {
  adaptable_min_pct: 70,
  limitante_max_pct: 49,
  // 50-69% = mixto
} as const;

/**
 * Una respuesta del candidato a una pregunta.
 * `chosen_mentalidad` es la mentalidad de la opción que eligió.
 */
export type MindsetAnswer = {
  question_id: string;
  chosen_mentalidad: Mentalidad;
};

export type MindsetScoringResult = {
  /** Score global de adaptabilidad (0-100). Métrica principal. */
  adaptability_score_pct: number;

  /** Patrón dominante. */
  adaptability_pattern: 'adaptable' | 'mixto' | 'limitante';

  /** % por cada uno de los 14 polos. Suman ≈ 100. */
  per_mentalidad_pct: Record<Mentalidad, number>;

  /** Cantidad de elecciones por mentalidad (raw counts). */
  per_mentalidad_count: Record<Mentalidad, number>;

  /** Total de respuestas válidas procesadas. */
  total_answers: number;
};

/**
 * Calcula el resultado completo del test de mentalidades dado un set de respuestas.
 *
 * @param answers Array de respuestas del candidato (idealmente 10).
 * @returns Resultado completo del scoring.
 *
 * @throws Error si answers está vacío.
 */
export function scoreMindsetAnswers(answers: MindsetAnswer[]): MindsetScoringResult {
  if (answers.length === 0) {
    throw new Error('mindsetScoring: at least one answer required');
  }

  const counts: Record<Mentalidad, number> = {
    fija: 0, crecimiento: 0,
    experto: 0, curiosa: 0,
    reactiva: 0, creativa: 0,
    victima: 0, agente: 0,
    escasez: 0, abundancia: 0,
    certeza: 0, exploracion: 0,
    proteccion: 0, oportunidad: 0,
  };

  let validAnswers = 0;
  for (const ans of answers) {
    if (ans.chosen_mentalidad in counts) {
      counts[ans.chosen_mentalidad]++;
      validAnswers++;
    }
  }

  if (validAnswers === 0) {
    throw new Error('mindsetScoring: no valid answers (chosen_mentalidad must be one of the 14 mentalidades)');
  }

  // Compute % per mentalidad
  const per_mentalidad_pct = {} as Record<Mentalidad, number>;
  for (const m in counts) {
    const mentalidad = m as Mentalidad;
    per_mentalidad_pct[mentalidad] = Math.round((counts[mentalidad] / validAnswers) * 100);
  }

  // Compute global adaptability_score_pct = sum of all adaptable polos / total
  let adaptableCount = 0;
  for (const m in counts) {
    const mentalidad = m as Mentalidad;
    if (MINDSET_TO_AXIS[mentalidad].polo === 'adaptable') {
      adaptableCount += counts[mentalidad];
    }
  }
  const adaptability_score_pct = Math.round((adaptableCount / validAnswers) * 100);

  // Determine pattern
  let adaptability_pattern: MindsetScoringResult['adaptability_pattern'];
  if (adaptability_score_pct >= ADAPTABILITY_THRESHOLDS.adaptable_min_pct) {
    adaptability_pattern = 'adaptable';
  } else if (adaptability_score_pct <= ADAPTABILITY_THRESHOLDS.limitante_max_pct) {
    adaptability_pattern = 'limitante';
  } else {
    adaptability_pattern = 'mixto';
  }

  return {
    adaptability_score_pct,
    adaptability_pattern,
    per_mentalidad_pct,
    per_mentalidad_count: counts,
    total_answers: validAnswers,
  };
}
