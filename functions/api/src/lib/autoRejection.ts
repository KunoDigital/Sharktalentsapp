/**
 * Auto-rejection multidimensional (doc 18).
 *
 * Evalúa scores del candidato contra `Jobs.ideal_profile.auto_rejection_rules`.
 * Si CUALQUIER regla falla, devuelve razón → caller transiciona a `auto_rejected_low_score`.
 *
 * Reglas chequeadas (todas opcionales — si no están seteadas, no aplican):
 *   - disc_min_similarity: similitud DISC del candidato vs ideal (0-100)
 *   - velna_min_indice: índice VELNA mínimo
 *   - integridad_max_riesgo: % de riesgo integridad máximo permitido
 *   - emo_min_score: score emocional mínimo
 *
 * No incluye `tecnica_minimo_pct` porque ese ya se aplica en submitTest (técnica fail
 * → auto_rejected_low_score directo).
 */
import type { IdealProfile, AutoRejectionRules } from '../features/jobs';
import { calculateDiscSimilarity } from './scoring';

export type RejectionDecision = {
  reject: boolean;
  reasons: string[];
};

type ScoresInput = {
  disc_norm_d?: number; disc_norm_i?: number; disc_norm_s?: number; disc_norm_c?: number;
  velna_indice?: number;
  emo_score?: number;
  int_overall_pct?: number;
  /** Score adaptabilidad del test de mentalidades (0-100). */
  mindset_adaptability_pct?: number;
  /** True/false si pasó el test de inglés (cuando aplica). */
  english_passed?: boolean;
};

export function evaluateAutoRejection(
  scores: ScoresInput | null | undefined,
  ideal: IdealProfile | null | undefined,
): RejectionDecision {
  const rules = ideal?.auto_rejection_rules;
  if (!rules || !scores) return { reject: false, reasons: [] };

  const reasons: string[] = [];

  // DISC similarity
  if (rules.disc_min_similarity != null && ideal?.disc
    && typeof scores.disc_norm_d === 'number' && typeof scores.disc_norm_i === 'number'
    && typeof scores.disc_norm_s === 'number' && typeof scores.disc_norm_c === 'number') {
    const sim = calculateDiscSimilarity(
      { d: scores.disc_norm_d, i: scores.disc_norm_i, s: scores.disc_norm_s, c: scores.disc_norm_c },
      { d: ideal.disc.d, i: ideal.disc.i, s: ideal.disc.s, c: ideal.disc.c },
    );
    if (sim < rules.disc_min_similarity) {
      reasons.push(`DISC similitud ${sim}% < umbral ${rules.disc_min_similarity}%`);
    }
  }

  // VELNA
  if (rules.velna_min_indice != null && typeof scores.velna_indice === 'number') {
    if (scores.velna_indice < rules.velna_min_indice) {
      reasons.push(`VELNA índice ${scores.velna_indice} < umbral ${rules.velna_min_indice}`);
    }
  }

  // Integridad (más alto = más riesgo)
  if (rules.integridad_max_riesgo != null && typeof scores.int_overall_pct === 'number') {
    if (scores.int_overall_pct > rules.integridad_max_riesgo) {
      reasons.push(`Integridad ${scores.int_overall_pct}% riesgo > umbral ${rules.integridad_max_riesgo}%`);
    }
  }

  // Emocional
  if (rules.emo_min_score != null && typeof scores.emo_score === 'number') {
    if (scores.emo_score < rules.emo_min_score) {
      reasons.push(`Emocional ${scores.emo_score} < umbral ${rules.emo_min_score}`);
    }
  }

  // Mindset (adaptabilidad)
  if (rules.mindset_min_adaptability != null && typeof scores.mindset_adaptability_pct === 'number') {
    if (scores.mindset_adaptability_pct < rules.mindset_min_adaptability) {
      reasons.push(`Adaptabilidad ${scores.mindset_adaptability_pct}% < umbral ${rules.mindset_min_adaptability}%`);
    }
  }

  // Inglés (require_english_passed)
  if (rules.require_english_passed && scores.english_passed === false) {
    reasons.push(`No alcanzó el nivel de inglés requerido`);
  }

  return { reject: reasons.length > 0, reasons };
}

// Re-export para tests
export type { AutoRejectionRules };
