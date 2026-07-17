/**
 * Auto-rejection multidimensional.
 *
 * Reglas de pipeline (confirmadas por Cris 2026-06-12, ver memoria
 * `project_reglas_pipeline_candidato.md`):
 *
 * 🔴 AUTO-RECHAZO (`reject: true`):
 *   - Técnico < umbral del puesto (lo maneja submitTest, no esta función)
 *   - Situacional con respuestas dañinas (idem submitTest)
 *   - Integridad con cualquiera de estas 5 dimensiones en `'bajo'`:
 *       hurto, soborno, drogas, alcohol, confiabilidad
 *   - VELNA por dimensión individual debajo del umbral configurado para el puesto
 *     (regla nueva 2026-06-12 — `auto_rejection_rules.velna_per_dimension`).
 *     Cada puesto define qué dimensiones VELNA son críticas y con qué umbral.
 *     Ej.: contable → numerica ≥ 70; vendedor → verbal ≥ 65.
 *
 * 🟡 DUDA CV (`needs_review: true`):
 *   - Inglés bajo el mínimo (cuando el puesto lo activó)
 *   - Integridad con cualquiera de estas 8 dimensiones en `'bajo'`:
 *       honestidad, imparcialidad, autenticidad, sencillez, dominio_personal,
 *       inteligencia_social, apuestas, buena_impresion
 *
 * 🟢 NUNCA RECHAZA NI VA A DUDA CV:
 *   - Mindset (siempre informativo)
 *   - DISC + Emoción (análisis IA contextual, no umbrales)
 *
 * Las reglas viejas por umbral global (disc_min_similarity, velna_min_indice, etc.)
 * quedan DEPRECATED — siguen funcionando si el draft del puesto las setea, pero
 * se desaconseja usarlas. El modelo nuevo para VELNA es `velna_per_dimension`
 * (umbrales individuales). Si el draft setea ambas, ambas se evalúan.
 */
import type { IdealProfile, AutoRejectionRules } from '../features/jobs';
import { calculateDiscSimilarity } from './scoring';

export type RejectionDecision = {
  /** Auto-rechazo automático. Transiciona a `auto_rejected_low_score`. */
  reject: boolean;
  /** Razones del auto-rechazo (texto legible). */
  reasons: string[];
  /** Duda CV — pasa a revisión manual del recruiter. NO rechaza solo. */
  needs_review: boolean;
  /** Razones de la duda CV (texto legible). */
  review_reasons: string[];
};

type ScoresInput = {
  disc_norm_d?: number; disc_norm_i?: number; disc_norm_s?: number; disc_norm_c?: number;
  velna_indice?: number;
  /** Scores VELNA por dimensión individual (0-100). Usados por `velna_per_dimension`. */
  velna_verbal?: number;
  velna_espacial?: number;
  velna_logica?: number;
  velna_numerica?: number;
  velna_abstracta?: number;
  emo_score?: number;
  int_overall_pct?: number;
  /** Score adaptabilidad del test de mentalidades (0-100). */
  mindset_adaptability_pct?: number;
  /** True/false si pasó el test de inglés (cuando aplica). */
  english_passed?: boolean;
};

/** Dimensiones individuales de Integridad — clasificación 'bajo' significa RIESGO ALTO. */
export type IntegrityDim = {
  dimension: string;
  classification: 'bajo' | 'medio' | 'alto';
};

/** 5 dimensiones de Integridad que disparan auto-rechazo si están en `'bajo'`. */
const INTEGRITY_HARD_REJECT_DIMS = new Set([
  'hurto',
  'soborno',
  'drogas',
  'alcohol',
  'confiabilidad',
]);

/**
 * 7 dimensiones de Integridad que disparan Duda CV si están en `'bajo'` (riesgo alto).
 *
 * NOTA: `buena_impresion` se evalúa APARTE porque su lógica es INVERSA — pct alto
 * significa que el candidato está fingiendo (Lie scale). Solo dispara Duda CV
 * cuando está en `'alto'` (no en `'bajo'`).
 */
const INTEGRITY_REVIEW_DIMS = new Set([
  'honestidad',
  'imparcialidad',
  'autenticidad',
  'sencillez',
  'dominio_personal',
  'inteligencia_social',
  'apuestas',
]);

/**
 * Dimensión especial — buena_impresion (Lie scale):
 *   - pct alto  = el candidato está fingiendo respuestas socialmente deseables
 *   - pct bajo  = el candidato es honesto consigo mismo (BUENO)
 *
 * Por eso disparamos Duda CV solo cuando está clasificada 'alto'. La clasificación
 * 'bajo' aquí NO es problemática — al contrario.
 */
const INTEGRITY_LIE_SCALE_DIM = 'buena_impresion';

export function evaluateAutoRejection(
  scores: ScoresInput | null | undefined,
  ideal: IdealProfile | null | undefined,
  integrityDims?: IntegrityDim[] | null,
): RejectionDecision {
  const reasons: string[] = [];
  const reviewReasons: string[] = [];

  if (!scores) {
    return { reject: false, reasons, needs_review: false, review_reasons: reviewReasons };
  }

  // --- Reglas nuevas (confirmadas Cris 2026-06-12) ---

  // Integridad por dimensión individual
  if (Array.isArray(integrityDims) && integrityDims.length > 0) {
    for (const dim of integrityDims) {
      // Caso especial: buena_impresion (Lie scale) — lógica invertida.
      // Solo dispara Duda CV cuando está en 'alto' (candidato fingiendo).
      if (dim.dimension === INTEGRITY_LIE_SCALE_DIM) {
        if (dim.classification === 'alto') {
          reviewReasons.push('Integridad — posible fingimiento detectado (buena_impresion alta)');
        }
        continue;
      }
      // Resto de dimensiones: clasificación 'bajo' = riesgo alto.
      if (dim.classification !== 'bajo') continue;
      if (INTEGRITY_HARD_REJECT_DIMS.has(dim.dimension)) {
        reasons.push(`Integridad — riesgo alto en ${dim.dimension}`);
      } else if (INTEGRITY_REVIEW_DIMS.has(dim.dimension)) {
        reviewReasons.push(`Integridad — observación en ${dim.dimension}`);
      }
    }
  }

  // Inglés bajo el mínimo → Duda CV (NO auto-rechazo)
  // Reemplaza la regla vieja `require_english_passed` cuando esté presente.
  if (scores.english_passed === false) {
    reviewReasons.push('Inglés por debajo del nivel requerido — revisar manualmente');
  }

  // --- Reglas viejas DEPRECATED — siguen funcionando por compatibilidad ---
  // Si el draft del puesto NO las setea, no aplican. El modelo confirmado
  // por Cris es que Conductual NO rechaza por umbrales binarios — usar la
  // Capa 4 (análisis IA contextual) en su lugar.
  const rules = ideal?.auto_rejection_rules;

  if (rules?.disc_min_similarity != null && ideal?.disc
    && typeof scores.disc_norm_d === 'number' && typeof scores.disc_norm_i === 'number'
    && typeof scores.disc_norm_s === 'number' && typeof scores.disc_norm_c === 'number') {
    const sim = calculateDiscSimilarity(
      { d: scores.disc_norm_d, i: scores.disc_norm_i, s: scores.disc_norm_s, c: scores.disc_norm_c },
      { d: ideal.disc.d, i: ideal.disc.i, s: ideal.disc.s, c: ideal.disc.c },
    );
    if (sim < rules.disc_min_similarity) {
      reasons.push(`DISC similitud ${sim}% < umbral ${rules.disc_min_similarity}% (regla legacy)`);
    }
  }

  // VELNA por dimensión individual (modelo nuevo Cris 2026-06-12).
  // Cada puesto define qué dimensiones son críticas para ese rol.
  // Se evalúa ANTES de la regla legacy `velna_min_indice` y de manera independiente
  // — si ambas están seteadas en el draft, ambas se evalúan.
  if (rules?.velna_per_dimension) {
    const vpd = rules.velna_per_dimension;
    const dims = [
      { key: 'verbal', score: scores.velna_verbal, threshold: vpd.verbal },
      { key: 'espacial', score: scores.velna_espacial, threshold: vpd.espacial },
      { key: 'logica', score: scores.velna_logica, threshold: vpd.logica },
      { key: 'numerica', score: scores.velna_numerica, threshold: vpd.numerica },
      { key: 'abstracta', score: scores.velna_abstracta, threshold: vpd.abstracta },
    ] as const;
    for (const d of dims) {
      if (d.threshold == null) continue;
      if (typeof d.score !== 'number') continue; // sin score: no se evalúa (no rompe)
      if (d.score < d.threshold) {
        reasons.push(`VELNA ${d.key} ${d.score} < umbral ${d.threshold} (puesto requiere)`);
      }
    }
  }

  if (rules?.velna_min_indice != null && typeof scores.velna_indice === 'number'
    && scores.velna_indice < rules.velna_min_indice) {
    reasons.push(`VELNA índice ${scores.velna_indice} < umbral ${rules.velna_min_indice} (regla legacy)`);
  }

  // Regla vieja de integridad por % global — solo aplica si NO se pasaron las dimensiones nuevas.
  if (!integrityDims && rules?.integridad_max_riesgo != null
    && typeof scores.int_overall_pct === 'number'
    && scores.int_overall_pct > rules.integridad_max_riesgo) {
    reasons.push(`Integridad ${scores.int_overall_pct}% riesgo > umbral ${rules.integridad_max_riesgo}% (regla legacy global)`);
  }

  if (rules?.emo_min_score != null && typeof scores.emo_score === 'number'
    && scores.emo_score < rules.emo_min_score) {
    reasons.push(`Emocional ${scores.emo_score} < umbral ${rules.emo_min_score} (regla legacy)`);
  }

  if (rules?.mindset_min_adaptability != null && typeof scores.mindset_adaptability_pct === 'number'
    && scores.mindset_adaptability_pct < rules.mindset_min_adaptability) {
    reasons.push(`Adaptabilidad ${scores.mindset_adaptability_pct}% < umbral ${rules.mindset_min_adaptability}% (regla legacy)`);
  }

  // Regla vieja de inglés — DEPRECATED, ahora va a Duda CV automático arriba.
  // Si el draft tiene `require_english_passed: true` Y el test falló, ya se agregó a reviewReasons.
  // No duplicamos en reasons salvo que el draft lo pida explícito (compat).
  if (rules?.require_english_passed && scores.english_passed === false) {
    // Movido a reviewReasons arriba. Si el cliente quiere mantener el rechazo duro legacy,
    // descomenta esta línea — pero NO se recomienda.
    // reasons.push(`No alcanzó el nivel de inglés requerido (regla legacy)`);
  }

  return {
    reject: reasons.length > 0,
    reasons,
    needs_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
  };
}

// Re-export para tests
export type { AutoRejectionRules };
