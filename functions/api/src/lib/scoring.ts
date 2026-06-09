/**
 * Scoring algorithms — backend.
 * Migrado del v1 (functions/sharktalents/src/services/scoring.ts) con fórmulas y
 * thresholds validados con candidatos reales.
 *
 * Fuentes de verdad:
 * - DISC: forced-choice. 40 preguntas, cada una con 4 opciones mapeadas a D/I/S/C.
 *   El score es el conteo de cuántas veces eligió cada dimensión.
 * - VELNA (Cognitive): 5 sub-tests (verbal/espacial/logica/numerica/abstracta).
 *   100-125 preguntas total según level. Cada pregunta tiene `correct: <index>`.
 * - Emotional: 20 preguntas, cada opción tiene `scores: number[]` (0-100).
 *   Promedio. Perfil: ≤33 espontaneo, ≤66 mesura, >66 reflexivo.
 * - Integridad: 90 preguntas. `risk_weights[option_index]` da peso de riesgo.
 *   Thresholds DIFERENTES por dimensión (calibrado por el v1).
 */

// ---- DISC ----

export type DiscRawScores = {
  d: number;
  i: number;
  s: number;
  c: number;
};

export type DiscQuestion = {
  id: string;
  text: string;
  options: string[];
  /** Cada opción mapea a una dimensión: D, I, S, C */
  dimension: ('D' | 'I' | 'S' | 'C')[];
};

export type DiscResult = DiscRawScores & {
  perfil_dominante: 'D' | 'I' | 'S' | 'C';
  total_questions: number;
};

/**
 * Calcula raw counts por dimensión sumando 1 cada vez que el candidato eligió esa dim.
 * Después se puede normalizar a 0-100 (cantidad / total_questions * 100) para comparar.
 */
export function scoreDisc(questions: DiscQuestion[], answers: Record<string, number>): DiscResult {
  const profile: DiscRawScores = { d: 0, i: 0, s: 0, c: 0 };
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.dimension)) continue;
    const dim = q.dimension[sel];
    if (dim === 'D') profile.d++;
    else if (dim === 'I') profile.i++;
    else if (dim === 'S') profile.s++;
    else if (dim === 'C') profile.c++;
  }

  const entries: Array<['D' | 'I' | 'S' | 'C', number]> = [
    ['D', profile.d], ['I', profile.i], ['S', profile.s], ['C', profile.c],
  ];
  entries.sort((a, b) => b[1] - a[1]);

  return {
    ...profile,
    perfil_dominante: entries[0][0],
    total_questions: questions.length,
  };
}

/**
 * Normaliza DISC raw counts a per-axis 0-100 (modelo V1 — sin constraint de suma).
 *
 * Detecta la escala de entrada:
 * - Si la suma raw <= 100: son counts brutos del test → re-escalar per-axis.
 *   Fórmula: raw / (totalQuestions/4) × 100, cap 100.
 *   Esto preserva la propiedad "alto en un eje no obliga a bajar otro" (modelo psicométrico real).
 * - Si suma > 100: ya viene normalizado per-axis → no se toca.
 *
 * Mantenido alineado con candidateScoring.ts de v1 (raw × 5 cap 100 para banco 20 preguntas/eje).
 */
export function normalizeDiscRaw(raw: DiscRawScores, totalQuestions: number): DiscRawScores {
  const sum = raw.d + raw.i + raw.s + raw.c;
  // Ya viene normalizado per-axis 0-100 (suma puede ir hasta 400)
  if (sum > 100) {
    return {
      d: clamp0_100(raw.d), i: clamp0_100(raw.i),
      s: clamp0_100(raw.s), c: clamp0_100(raw.c),
    };
  }
  // Counts brutos → re-escalar per-axis
  const maxPerAxis = totalQuestions > 0 ? totalQuestions / 4 : 20;
  return {
    d: clamp0_100((raw.d / maxPerAxis) * 100),
    i: clamp0_100((raw.i / maxPerAxis) * 100),
    s: clamp0_100((raw.s / maxPerAxis) * 100),
    c: clamp0_100((raw.c / maxPerAxis) * 100),
  };
}

/**
 * Similitud DISC vs ideal — modelo V1 (min/max ratio promediado por eje).
 *
 * Para cada eje: ratio = min(candidato, ideal) / max(candidato, ideal) × 100.
 * Resultado final = promedio de los 4 ratios.
 *
 * Si ambos son 0 → 100% (no hay diferencia). Si uno es 0 y el otro >0 → 0% en ese eje.
 *
 * Ventajas vs euclidiana:
 * - No requiere maxDist hardcoded
 * - Penaliza diferencias relativas (más interpretable para usuario final)
 * - Funciona con cualquier escala per-axis (el ideal y candidato pueden estar en escalas distintas siempre que ambos sean per-axis)
 */
export function calculateDiscSimilarity(candidate: DiscRawScores, ideal: DiscRawScores): number {
  const dims: Array<keyof DiscRawScores> = ['d', 'i', 's', 'c'];
  let totalRatio = 0;
  for (const dim of dims) {
    const c = candidate[dim] || 0;
    const i = ideal[dim] || 0;
    if (i === 0 && c === 0) {
      totalRatio += 100;
      continue;
    }
    totalRatio += Math.round((Math.min(i, c) / Math.max(i, c, 1)) * 100);
  }
  return Math.round(totalRatio / 4);
}

export function discDominantAxis(scores: DiscRawScores): 'D' | 'I' | 'S' | 'C' {
  const entries: Array<['D' | 'I' | 'S' | 'C', number]> = [
    ['D', scores.d], ['I', scores.i], ['S', scores.s], ['C', scores.c],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// ---- Cognitive (VELNA) ----

export type CognitiveQuestion = {
  id: string;
  text: string;
  options: string[];
  /** v1 usa: 'verbal' | 'espacial' | 'logico' | 'numerico' | 'abstracto' */
  dimension: 'verbal' | 'espacial' | 'logico' | 'numerico' | 'abstracto';
  correct: number;
};

export type CognitiveResult = {
  total: number;
  max: number;
  verbal: number;
  espacial: number;
  logica: number;
  numerica: number;
  abstracta: number;
  /** Promedio de los 5 sub-tests, 0-100 */
  indice: number;
};

const COGNITIVE_DIM_MAP: Record<string, keyof Pick<CognitiveResult, 'verbal' | 'espacial' | 'logica' | 'numerica' | 'abstracta'>> = {
  verbal: 'verbal',
  espacial: 'espacial',
  logico: 'logica',
  numerico: 'numerica',
  abstracto: 'abstracta',
};

export function scoreCognitive(questions: CognitiveQuestion[], answers: Record<string, number>): CognitiveResult {
  const dims = { verbal: 0, espacial: 0, logica: 0, numerica: 0, abstracta: 0 };
  const dimTotals = { verbal: 0, espacial: 0, logica: 0, numerica: 0, abstracta: 0 };
  let total = 0;

  for (const q of questions) {
    const dimKey = COGNITIVE_DIM_MAP[q.dimension];
    if (dimKey) dimTotals[dimKey]++;
    const sel = answers[q.id];
    if (sel == null) continue;
    if (sel === q.correct) {
      total++;
      if (dimKey) dims[dimKey]++;
    }
  }

  // Indice: promedio de % por sub-test (no count global)
  const subtestPcts: number[] = [];
  for (const k of ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const) {
    if (dimTotals[k] > 0) {
      subtestPcts.push((dims[k] / dimTotals[k]) * 100);
    }
  }
  const indice = subtestPcts.length > 0
    ? Math.round(subtestPcts.reduce((s, v) => s + v, 0) / subtestPcts.length)
    : 0;

  return {
    total,
    max: questions.length,
    ...dims,
    indice,
  };
}

export type VelnaSubtestPct = {
  verbal: number;
  espacial: number;
  logica: number;
  numerica: number;
  abstracta: number;
};

export function velnaAggregate(pcts: VelnaSubtestPct): number {
  const values = [pcts.verbal, pcts.espacial, pcts.logica, pcts.numerica, pcts.abstracta];
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * Similitud VELNA vs ideal — modelo V1 (min/max ratio promediado por sub-test).
 *
 * Misma fórmula que calculateDiscSimilarity: ratio min/max promedio de los 5 sub-tests.
 * Más interpretable que distancia euclidiana.
 */
export function velnaSimilarity(candidate: VelnaSubtestPct, ideal: VelnaSubtestPct): number {
  const dims: Array<keyof VelnaSubtestPct> = ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'];
  let totalRatio = 0;
  for (const dim of dims) {
    const c = candidate[dim] || 0;
    const i = ideal[dim] || 0;
    if (i === 0 && c === 0) {
      totalRatio += 100;
      continue;
    }
    totalRatio += Math.round((Math.min(i, c) / Math.max(i, c, 1)) * 100);
  }
  return Math.round(totalRatio / 5);
}

// ---- Emotional ----

export type EmotionalQuestion = {
  id: string;
  text: string;
  options: string[];
  scores: number[]; // 0-100, paralelo a options
};

export type EmotionalResult = {
  score: number;
  perfil: 'espontaneo' | 'mesura' | 'reflexivo';
};

export function scoreEmotional(questions: EmotionalQuestion[], answers: Record<string, number>): EmotionalResult | null {
  if (!questions.length) return null;
  let sum = 0;
  let count = 0;
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.scores)) continue;
    sum += q.scores[sel] ?? 50;
    count++;
  }
  if (count === 0) return null;
  const score = Math.round(sum / count);
  const perfil: 'espontaneo' | 'mesura' | 'reflexivo' =
    score <= 33 ? 'espontaneo' : score <= 66 ? 'mesura' : 'reflexivo';
  return { score, perfil };
}

// ---- Integrity ----

export type IntegrityClassification = 'bajo' | 'medio' | 'alto';

export type IntegrityQuestion = {
  id: string;
  dimension: string;
  text: string;
  options: string[];
  /** risk_weights[option_index] = 0..3 (3 = riesgo máximo) */
  risk_weights: number[];
};

export type IntegrityDimensionResult = {
  dimension: string;
  pct: number;
  nivel: IntegrityClassification;
};

export type IntegrityResult = {
  overall: IntegrityClassification;
  overall_pct: number;
  recomendacion: string;
  buena_impresion: IntegrityClassification;
  buena_impresion_pct: number;
  dimensiones: IntegrityDimensionResult[];
};

/**
 * Thresholds calibrados por dimensión (del v1, validado con candidatos reales).
 * Más bajo = más estricto (cualquier riesgo levanta alerta).
 *   medioMin: pct mínimo para pasar de "bajo" a "medio"
 *   altoMin:  pct mínimo para pasar de "medio" a "alto"
 */
/**
 * 13 dimensiones reales del v2 (las del set integrity_v2.json).
 *
 * Histórico: el v1 viejo usaba `etica_profesional` y `personalidad` que se eliminaron
 * en v2 porque eran "mezcla" — `etica_profesional` overlapeaba con honestidad/imparcialidad/
 * confiabilidad, y `personalidad` con autenticidad/dominio_personal/inteligencia_social.
 * El v2 separa mejor en dimensiones más específicas y no las reintroducimos.
 */
const INTEGRITY_THRESHOLDS: Record<string, { medioMin: number; altoMin: number }> = {
  hurto:               { medioMin: 21, altoMin: 41 },
  soborno:             { medioMin: 21, altoMin: 41 },
  drogas:              { medioMin: 26, altoMin: 51 },
  honestidad:          { medioMin: 31, altoMin: 56 },
  confiabilidad:       { medioMin: 31, altoMin: 56 },
  alcohol:             { medioMin: 36, altoMin: 61 },
  apuestas:            { medioMin: 26, altoMin: 51 },
  autenticidad:        { medioMin: 31, altoMin: 56 },
  inteligencia_social: { medioMin: 36, altoMin: 61 },
  imparcialidad:       { medioMin: 26, altoMin: 51 },
  sencillez:           { medioMin: 36, altoMin: 61 },
  dominio_personal:    { medioMin: 31, altoMin: 56 },
  buena_impresion:     { medioMin: 41, altoMin: 66 },
};
const DEFAULT_INTEGRITY_THRESHOLD = { medioMin: 31, altoMin: 56 };

export function classifyIntegrityPct(pct: number, dimension?: string): IntegrityClassification {
  const t = (dimension ? INTEGRITY_THRESHOLDS[dimension] : undefined) ?? DEFAULT_INTEGRITY_THRESHOLD;
  if (pct < t.medioMin) return 'bajo';
  if (pct < t.altoMin) return 'medio';
  return 'alto';
}

export function scoreIntegrity(questions: IntegrityQuestion[], answers: Record<string, number>): IntegrityResult {
  const dimData: Record<string, { risk_score: number; max_risk: number; total: number }> = {};

  for (const q of questions) {
    const dim = q.dimension || 'general';
    if (!dimData[dim]) dimData[dim] = { risk_score: 0, max_risk: 0, total: 0 };
    dimData[dim].max_risk += 3; // máximo de risk_weights
    dimData[dim].total++;

    const sel = answers[q.id];
    if (sel == null) continue;
    dimData[dim].risk_score += q.risk_weights?.[sel] ?? 0;
  }

  const dimensiones: IntegrityDimensionResult[] = [];
  let totalRisk = 0;
  let totalMax = 0;
  let anyAlto = false;
  let biPct = 0;

  for (const [dim, data] of Object.entries(dimData)) {
    const pct = data.max_risk > 0 ? Math.round((data.risk_score / data.max_risk) * 100) : 0;
    const nivel = classifyIntegrityPct(pct, dim);
    dimensiones.push({ dimension: dim, pct, nivel });

    if (dim === 'buena_impresion') {
      biPct = pct;
      continue;
    }
    totalRisk += data.risk_score;
    totalMax += data.max_risk;
    if (nivel === 'alto') anyAlto = true;
  }

  const overallPct = totalMax > 0 ? Math.round((totalRisk / totalMax) * 100) : 0;
  let overall: IntegrityClassification;
  if (overallPct <= 30 && !anyAlto) overall = 'bajo';
  else if (overallPct > 60) overall = 'alto';
  else overall = 'medio';

  const recomendacion = overall === 'bajo' ? 'Se puede recomendar'
    : overall === 'medio' ? 'Revisar con cautela'
    : 'No se recomienda';

  const buena_impresion: IntegrityClassification = biPct > 60 ? 'alto' : biPct > 30 ? 'medio' : 'bajo';

  return {
    overall,
    overall_pct: overallPct,
    recomendacion,
    buena_impresion,
    buena_impresion_pct: biPct,
    dimensiones,
  };
}

// ---- Technical ----

export type TechnicalQuestion = {
  id: string;
  text: string;
  options: string[];
  correct: number;
};

export type TechnicalResult = {
  total_correct: number;
  total_questions: number;
  score_pct: number;
  passed: boolean;
};

export function scoreTechnical(questions: TechnicalQuestion[], answers: Record<string, number>, minRequired: number): TechnicalResult {
  let total = 0;
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null) continue;
    if (sel === q.correct) total++;
  }
  const score_pct = questions.length === 0 ? 0 : Math.round((total / questions.length) * 100);
  return {
    total_correct: total,
    total_questions: questions.length,
    score_pct,
    passed: score_pct >= minRequired,
  };
}

/** Helper más simple — calcula pct y passed sin necesitar la lista de preguntas */
export function calculateTechnicalScore(correct: number, total: number, minimumRequired: number): {
  score_pct: number;
  passed: boolean;
} {
  const pct = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { score_pct: pct, passed: pct >= minimumRequired };
}

// ---- Technical doble eje (doc 19) ----
//
// Una pregunta técnica puede ser de 2 tipos:
//   - 'technical': hay UNA respuesta correcta (igual que el modelo viejo).
//   - 'situational': hay 2 opciones VÁLIDAS y 2 INVÁLIDAS. Las 2 válidas revelan
//     estilos distintos en el eje 'autonomy_vs_consult' (uno actúa, el otro consulta).
//
// La situacional tiene 3 outputs:
//   1. score_pct de validez (cuántas situacionales eligió una opción válida)
//   2. style_axis (0-1) — 0 = puro consult, 1 = puro autonomy
//   3. style_match_with_boss_pct — cuán cerca está el estilo del candidato del estilo del jefe

export type StyleAxis = 'autonomy_vs_consult';
export type StyleValue = 'autonomy' | 'consult';

export type TechnicalQuestionDoubleAxis = {
  id: string;
  text: string;
  options: string[];
  /** 'technical' o 'situational' */
  kind: 'technical' | 'situational';
  /** Solo para 'technical': índice 0-3 de la opción correcta. */
  correct?: number;
  /** Solo para 'situational': array paralelo a options indicando qué opciones son válidas. */
  option_validity?: boolean[];
  /** Solo para 'situational': array paralelo. Las inválidas son null. Las válidas tienen {axis, value}. */
  option_style?: Array<{ axis: StyleAxis; value: StyleValue } | null>;
};

export type DoubleAxisResult = {
  technical: { score_pct: number; correct: number; total: number; passed: boolean };
  situational_validity: { score_pct: number; valid: number; total: number };
  style: { autonomy_vs_consult: number | null; total_situational_answered: number };
};

export function scoreTechnicalDoubleAxis(
  questions: TechnicalQuestionDoubleAxis[],
  answers: Record<string, number>,
  minRequired: number,
): DoubleAxisResult {
  const techQs = questions.filter((q) => q.kind === 'technical');
  const sitQs = questions.filter((q) => q.kind === 'situational');

  // Score técnico: igual que el viejo
  let techCorrect = 0;
  for (const q of techQs) {
    const sel = answers[q.id];
    if (sel == null || q.correct == null) continue;
    if (sel === q.correct) techCorrect++;
  }
  const techPct = techQs.length === 0 ? 0 : Math.round((techCorrect / techQs.length) * 100);

  // Score situacional validez
  let validCount = 0;
  for (const q of sitQs) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.option_validity)) continue;
    if (q.option_validity[sel] === true) validCount++;
  }
  const sitPct = sitQs.length === 0 ? 0 : Math.round((validCount / sitQs.length) * 100);

  // Estilo: ratio autonomy / total
  let autonomy = 0;
  let consult = 0;
  let totalSituationalAnswered = 0;
  for (const q of sitQs) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.option_style)) continue;
    const style = q.option_style[sel];
    if (!style) continue;
    if (style.axis !== 'autonomy_vs_consult') continue;
    totalSituationalAnswered++;
    if (style.value === 'autonomy') autonomy++;
    else if (style.value === 'consult') consult++;
  }
  const styleTotal = autonomy + consult;
  const styleValue = styleTotal === 0 ? null : autonomy / styleTotal;

  return {
    technical: {
      score_pct: techPct,
      correct: techCorrect,
      total: techQs.length,
      passed: techPct >= minRequired,
    },
    situational_validity: {
      score_pct: sitPct,
      valid: validCount,
      total: sitQs.length,
    },
    style: {
      autonomy_vs_consult: styleValue,
      total_situational_answered: totalSituationalAnswered,
    },
  };
}

/**
 * Match estilo del candidato vs estilo del jefe en eje autonomy_vs_consult.
 *
 * Ambos valores son 0..1 (0 = consult, 1 = autonomy).
 * Devuelve { match_pct, interpretation }.
 *
 * Si alguno es null, el match es null (no penaliza, no premia).
 */
export function matchStyleWithBoss(
  candidateStyle: number | null,
  bossStyle: number | null | undefined,
): { match_pct: number; interpretation: string } | null {
  if (candidateStyle == null || bossStyle == null) return null;
  const cClamped = Math.max(0, Math.min(1, candidateStyle));
  const bClamped = Math.max(0, Math.min(1, bossStyle));
  const distance = Math.abs(cClamped - bClamped);
  const matchPct = Math.round((1 - distance) * 100);
  return { match_pct: matchPct, interpretation: interpretMatch(cClamped, bClamped, matchPct) };
}

function interpretMatch(cand: number, _boss: number, pct: number): string {
  if (pct >= 75) {
    return cand > 0.5
      ? 'Candidato proactivo, jefe da autonomía. Match natural.'
      : 'Candidato consultivo, jefe quiere que consulten. Match natural.';
  }
  if (pct >= 50) {
    return 'Match parcial. Candidato puede adaptarse pero requiere ajuste.';
  }
  return cand > 0.5
    ? 'RIESGO: Candidato proactivo bajo jefe controlador. Posible fricción.'
    : 'RIESGO: Candidato consultivo bajo jefe que da autonomía. Posible parálisis.';
}

/**
 * Validación de shape de pregunta situacional. Para usar al recibir output de IA o al
 * persistir manualmente. Lanza Error con razón si falla.
 */
export function validateSituationalQuestion(q: unknown): q is TechnicalQuestionDoubleAxis {
  if (typeof q !== 'object' || q === null) return false;
  const r = q as Record<string, unknown>;
  if (r.kind !== 'situational') return false;
  if (!Array.isArray(r.options) || r.options.length !== 4) return false;
  if (!Array.isArray(r.option_validity) || r.option_validity.length !== 4) return false;
  const validCount = r.option_validity.filter((v) => v === true).length;
  if (validCount !== 2) return false;
  if (!Array.isArray(r.option_style) || r.option_style.length !== 4) return false;
  // Validas tienen style; inválidas son null
  for (let i = 0; i < 4; i++) {
    const isValid = r.option_validity[i] === true;
    const style = r.option_style[i] as { axis?: unknown; value?: unknown } | null;
    if (isValid) {
      if (!style || typeof style !== 'object') return false;
      if (style.axis !== 'autonomy_vs_consult') return false;
      if (style.value !== 'autonomy' && style.value !== 'consult') return false;
    } else {
      if (style != null) return false;
    }
  }
  // Las 2 válidas DEBEN tener distinto value (una autonomy, una consult)
  const validValues = (r.option_style as Array<{ value?: string } | null>)
    .filter((s) => s != null)
    .map((s) => s!.value);
  if (new Set(validValues).size !== 2) return false;
  return true;
}

// ---- Helpers ----

function clamp0_100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
