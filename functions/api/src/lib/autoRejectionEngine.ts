/**
 * Engine de auto-rejection según `Job.auto_rejection_rules`.
 *
 * Pure function: dado un set de scores del candidato y las reglas del Job, decide si
 * el candidato debe ser auto-rechazado y devuelve el motivo. No toca DB ni emite eventos
 * — el caller es responsable de aplicar la decisión.
 *
 * Reglas soportadas (todas opcionales):
 *   - disc_min_similarity: mínimo % de similitud DISC vs ideal
 *   - velna_min_indice: mínimo VELNA índice (0-100)
 *   - integridad_max_riesgo: máximo % de riesgo en integridad (0-100)
 *   - emo_min_score: mínimo score emocional (0-100)
 *
 * Si TODAS las reglas pasan → no rechazar.
 * Si ALGUNA regla falla → rechazar y devolver el motivo de la primera que falló.
 *
 * Ver doc: [docs/master-plan/18_PIPELINE_OPERATIVO.md](../../../docs/master-plan/18_PIPELINE_OPERATIVO.md)
 */

export type AutoRejectionRules = {
  disc_min_similarity?: number;
  velna_min_indice?: number;
  integridad_max_riesgo?: number;
  emo_min_score?: number;
};

export type CandidateScores = {
  disc_similarity_pct?: number | null;
  velna_indice?: number | null;
  /** % de riesgo de integridad (0-100). 0=sin riesgo, 100=alto riesgo. */
  integridad_riesgo_pct?: number | null;
  emo_score?: number | null;
};

export type AutoRejectionDecision =
  | { reject: false }
  | { reject: true; reason: string; rule: keyof AutoRejectionRules };

/**
 * Evalúa si el candidato debe ser auto-rechazado según las reglas del Job.
 *
 * @param rules reglas del Job (puede ser null/undefined si no hay reglas)
 * @param scores scores actuales del candidato
 * @returns decisión + razón humana legible si rechaza
 */
export function evaluateAutoRejection(
  rules: AutoRejectionRules | null | undefined,
  scores: CandidateScores,
): AutoRejectionDecision {
  if (!rules) return { reject: false };

  // disc_min_similarity
  if (typeof rules.disc_min_similarity === 'number') {
    const sim = scores.disc_similarity_pct;
    if (sim != null && sim < rules.disc_min_similarity) {
      return {
        reject: true,
        rule: 'disc_min_similarity',
        reason: `DISC similarity ${sim}% < required ${rules.disc_min_similarity}%`,
      };
    }
  }

  // velna_min_indice
  if (typeof rules.velna_min_indice === 'number') {
    const v = scores.velna_indice;
    if (v != null && v < rules.velna_min_indice) {
      return {
        reject: true,
        rule: 'velna_min_indice',
        reason: `VELNA índice ${v} < required ${rules.velna_min_indice}`,
      };
    }
  }

  // integridad_max_riesgo (en este caso, el score es el % de RIESGO — más alto = peor)
  if (typeof rules.integridad_max_riesgo === 'number') {
    const r = scores.integridad_riesgo_pct;
    if (r != null && r > rules.integridad_max_riesgo) {
      return {
        reject: true,
        rule: 'integridad_max_riesgo',
        reason: `Integridad riesgo ${r}% > max permitido ${rules.integridad_max_riesgo}%`,
      };
    }
  }

  // emo_min_score
  if (typeof rules.emo_min_score === 'number') {
    const e = scores.emo_score;
    if (e != null && e < rules.emo_min_score) {
      return {
        reject: true,
        rule: 'emo_min_score',
        reason: `Score emocional ${e} < required ${rules.emo_min_score}`,
      };
    }
  }

  return { reject: false };
}

/**
 * Helper para uso desde el frontend admin: muestra qué reglas el candidato pasó/falló
 * (útil para explicar por qué se rechazó automáticamente).
 */
export type RuleEvaluation = {
  rule: keyof AutoRejectionRules;
  threshold: number;
  actual: number | null;
  passed: boolean;
};

export function evaluateAllRules(
  rules: AutoRejectionRules | null | undefined,
  scores: CandidateScores,
): RuleEvaluation[] {
  if (!rules) return [];
  const result: RuleEvaluation[] = [];

  if (typeof rules.disc_min_similarity === 'number') {
    const actual = scores.disc_similarity_pct ?? null;
    result.push({
      rule: 'disc_min_similarity',
      threshold: rules.disc_min_similarity,
      actual,
      passed: actual == null || actual >= rules.disc_min_similarity,
    });
  }
  if (typeof rules.velna_min_indice === 'number') {
    const actual = scores.velna_indice ?? null;
    result.push({
      rule: 'velna_min_indice',
      threshold: rules.velna_min_indice,
      actual,
      passed: actual == null || actual >= rules.velna_min_indice,
    });
  }
  if (typeof rules.integridad_max_riesgo === 'number') {
    const actual = scores.integridad_riesgo_pct ?? null;
    result.push({
      rule: 'integridad_max_riesgo',
      threshold: rules.integridad_max_riesgo,
      actual,
      passed: actual == null || actual <= rules.integridad_max_riesgo,
    });
  }
  if (typeof rules.emo_min_score === 'number') {
    const actual = scores.emo_score ?? null;
    result.push({
      rule: 'emo_min_score',
      threshold: rules.emo_min_score,
      actual,
      passed: actual == null || actual >= rules.emo_min_score,
    });
  }

  return result;
}
