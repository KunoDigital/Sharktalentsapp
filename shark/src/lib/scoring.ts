/**
 * Scoring algorithms — frontend.
 * Espejo del backend functions/api/src/lib/scoring.ts.
 *
 * Migrado del v1 con fórmulas y thresholds validados con candidatos reales.
 */

import type { DiscQuestion as MockDiscQuestion, VelnaSubtest, IntegrityQuestion as MockIntegrityQuestion } from '../data/mockCandidateTests';
import type { DiscIdealProfile, VelnaIdealProfile } from '../data/mockJobs';

// ============== DISC ==============

export type DiscAnswer = {
  question_id: string;
  most_axis: 'd' | 'i' | 's' | 'c';
  least_axis: 'd' | 'i' | 's' | 'c';
};

export type DiscRawScores = {
  d: number;
  i: number;
  s: number;
  c: number;
};

/**
 * v2 forced-choice: cada pregunta tiene `dimension: ['D','I','S','C']` y la respuesta es
 * el índice de la opción elegida. El score es el conteo de cada dimensión.
 */
export type DiscQuestionV2 = {
  id: string;
  text: string;
  options: string[];
  dimension: ('D' | 'I' | 'S' | 'C')[];
};

export type DiscResult = DiscRawScores & {
  perfil_dominante: 'D' | 'I' | 'S' | 'C';
  total_questions: number;
};

export function scoreDisc(questions: DiscQuestionV2[], answers: Record<string, number>): DiscResult {
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
  return { ...profile, perfil_dominante: entries[0][0], total_questions: questions.length };
}

/**
 * Legacy: para compat con la UI mock antigua basada en `DiscAnswer[]` (most/least).
 * No se usa con las preguntas v1 reales — pero mantenemos para no romper componentes.
 */
export function calculateDiscRaw(
  questions: MockDiscQuestion[],
  answers: DiscAnswer[],
): DiscRawScores {
  const counts = { d: 0, i: 0, s: 0, c: 0 };
  for (const ans of answers) {
    counts[ans.most_axis] += 1;
    counts[ans.least_axis] -= 1;
  }
  const total = questions.length;
  return {
    d: Math.max(0, Math.min(100, ((counts.d + total) / (total * 2)) * 100)),
    i: Math.max(0, Math.min(100, ((counts.i + total) / (total * 2)) * 100)),
    s: Math.max(0, Math.min(100, ((counts.s + total) / (total * 2)) * 100)),
    c: Math.max(0, Math.min(100, ((counts.c + total) / (total * 2)) * 100)),
  };
}

/**
 * Normaliza counts crudos (raw 0-N) a porcentaje (0-100). Útil después de scoreDisc.
 */
export function normalizeDiscRaw(raw: DiscRawScores, totalQuestions: number): DiscRawScores {
  if (totalQuestions === 0) return { d: 0, i: 0, s: 0, c: 0 };
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round((v / totalQuestions) * 100)));
  return { d: clamp(raw.d), i: clamp(raw.i), s: clamp(raw.s), c: clamp(raw.c) };
}

/**
 * Distancia euclidiana invertida → similitud 0-100 entre 2 perfiles DISC.
 * Asume perfiles normalizados a la misma escala (0-100).
 */
export function calculateDiscSimilarity(
  candidate: DiscRawScores,
  ideal: DiscRawScores,
): number {
  const dd = candidate.d - ideal.d;
  const di = candidate.i - ideal.i;
  const ds = candidate.s - ideal.s;
  const dc = candidate.c - ideal.c;
  const dist = Math.sqrt(dd * dd + di * di + ds * ds + dc * dc);
  const maxDist = 200;
  return Math.max(0, Math.round(((maxDist - dist) / maxDist) * 100));
}

export function pickBestIdealProfile(
  candidate: DiscRawScores,
  idealA: DiscIdealProfile,
  idealB?: DiscIdealProfile,
): { profile: DiscIdealProfile; key: 'A' | 'B'; similarity: number } {
  const simA = calculateDiscSimilarity(candidate, idealA);
  if (!idealB) return { profile: idealA, key: 'A', similarity: simA };
  const simB = calculateDiscSimilarity(candidate, idealB);
  return simA >= simB
    ? { profile: idealA, key: 'A', similarity: simA }
    : { profile: idealB, key: 'B', similarity: simB };
}

export function discDominantLabel(scores: DiscRawScores): { axis: 'd' | 'i' | 's' | 'c'; label: string } {
  const entries = Object.entries(scores) as [keyof DiscRawScores, number][];
  entries.sort(([, a], [, b]) => b - a);
  const dominant = entries[0][0];
  const labels: Record<keyof DiscRawScores, string> = {
    d: 'D — Dominante',
    i: 'I — Influyente',
    s: 'S — Sólido',
    c: 'C — Cumplidor',
  };
  return { axis: dominant, label: labels[dominant] };
}

// ============== VELNA / Cognitive ==============

export type CognitiveQuestionV2 = {
  id: string;
  text: string;
  options: string[];
  /** SVG inline para preguntas que requieren imagen (espacial, numérica, abstracta). */
  svg?: string;
  /** SVG inline por opción cuando las opciones son visuales (espacial, abstracta). */
  options_svg?: string[];
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
  indice: number;
};

const COGNITIVE_DIM_MAP: Record<string, 'verbal' | 'espacial' | 'logica' | 'numerica' | 'abstracta'> = {
  verbal: 'verbal',
  espacial: 'espacial',
  logico: 'logica',
  numerico: 'numerica',
  abstracto: 'abstracta',
};

export function scoreCognitive(questions: CognitiveQuestionV2[], answers: Record<string, number>): CognitiveResult {
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

  const subtestPcts: number[] = [];
  for (const k of ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const) {
    if (dimTotals[k] > 0) subtestPcts.push((dims[k] / dimTotals[k]) * 100);
  }
  const indice = subtestPcts.length > 0
    ? Math.round(subtestPcts.reduce((s, v) => s + v, 0) / subtestPcts.length)
    : 0;

  return { total, max: questions.length, ...dims, indice };
}

// Legacy: calc por subtests del mock (mantengo para compat con UI antigua)
export type VelnaSubtestResult = {
  key: string;
  correct: number;
  total: number;
  pct: number;
};

export type VelnaResult = {
  per_subtest: VelnaSubtestResult[];
  aggregate_pct: number;
  similarity_with_ideal_pct: number;
};

export function calculateVelnaResult(
  subtests: VelnaSubtest[],
  answers: Record<string, string>,
  ideal: VelnaIdealProfile,
): VelnaResult {
  const perSubtest: VelnaSubtestResult[] = subtests.map((st) => {
    const correct = st.questions.filter((q) => answers[q.id] === q.correct_option_id).length;
    return {
      key: st.key,
      correct,
      total: st.questions.length,
      pct: Math.round((correct / st.questions.length) * 100),
    };
  });

  const aggregate = Math.round(perSubtest.reduce((sum, s) => sum + s.pct, 0) / perSubtest.length);

  const candidate = {
    verbal: perSubtest.find((s) => s.key === 'verbal')?.pct ?? 0,
    espacial: perSubtest.find((s) => s.key === 'espacial')?.pct ?? 0,
    logica: perSubtest.find((s) => s.key === 'logica')?.pct ?? 0,
    numerica: perSubtest.find((s) => s.key === 'numerica')?.pct ?? 0,
    abstracta: perSubtest.find((s) => s.key === 'abstracta')?.pct ?? 0,
  };
  const dist = Math.sqrt(
    Math.pow(candidate.verbal - ideal.verbal, 2) +
      Math.pow(candidate.espacial - ideal.espacial, 2) +
      Math.pow(candidate.logica - ideal.logica, 2) +
      Math.pow(candidate.numerica - ideal.numerica, 2) +
      Math.pow(candidate.abstracta - ideal.abstracta, 2),
  );
  const maxDist = Math.sqrt(5 * 100 * 100);
  const similarity = Math.max(0, Math.round(((maxDist - dist) / maxDist) * 100));

  return { per_subtest: perSubtest, aggregate_pct: aggregate, similarity_with_ideal_pct: similarity };
}

// ============== Emotional ==============

export type EmotionalQuestionV2 = {
  id: string;
  text: string;
  options: string[];
  scores: number[];
};

export type EmotionalResult = {
  score: number;
  perfil: 'espontaneo' | 'mesura' | 'reflexivo';
};

export function scoreEmotional(questions: EmotionalQuestionV2[], answers: Record<string, number>): EmotionalResult | null {
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

// ============== Integridad ==============

export type IntegrityClassification = 'bajo' | 'medio' | 'alto';
export type IntegrityClassificationLegacy = 'Bajo' | 'Medio' | 'Alto';

export type IntegrityQuestionV2 = {
  id: string;
  dimension: string;
  text: string;
  options: string[];
  risk_weights: number[];
};

export type IntegrityDimensionResult = {
  dimension: string;
  pct: number;
  nivel: IntegrityClassification;
};

export type IntegrityResultV2 = {
  overall: IntegrityClassification;
  overall_pct: number;
  recomendacion: string;
  buena_impresion: IntegrityClassification;
  buena_impresion_pct: number;
  dimensiones: IntegrityDimensionResult[];
};

// 13 dimensiones del v2 (sin etica_profesional ni personalidad — eran "mezcla" en v1 viejo).
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

export function scoreIntegrity(questions: IntegrityQuestionV2[], answers: Record<string, number>): IntegrityResultV2 {
  const dimData: Record<string, { risk_score: number; max_risk: number; total: number }> = {};

  for (const q of questions) {
    const dim = q.dimension || 'general';
    if (!dimData[dim]) dimData[dim] = { risk_score: 0, max_risk: 0, total: 0 };
    dimData[dim].max_risk += 3;
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

  return { overall, overall_pct: overallPct, recomendacion, buena_impresion, buena_impresion_pct: biPct, dimensiones };
}

// ============== Legacy integrity (mock-based, mantengo para no romper UI antigua) ==============

export type IntegrityResult = {
  per_dimension: { name: string; classification: IntegrityClassificationLegacy; score_pct: number }[];
  buena_impresion_alta: boolean;
  observations: string[];
};

export function calculateIntegrityResult(
  questions: MockIntegrityQuestion[],
  answers: Record<string, number>,
): IntegrityResult {
  const sdcQuestions = questions.filter((q) => q.is_social_desirability_check);
  const sdcAllExtreme = sdcQuestions.length > 0 && sdcQuestions.every((q) => answers[q.id] === 5);
  const sdcMostExtreme = sdcQuestions.length > 0 &&
    sdcQuestions.filter((q) => answers[q.id] === 5).length / sdcQuestions.length >= 0.8;
  const buena_impresion_alta = sdcAllExtreme || sdcMostExtreme;

  const dimensionMap: Record<string, number[]> = {};
  for (const q of questions) {
    if (!dimensionMap[q.dimension]) dimensionMap[q.dimension] = [];
    if (answers[q.id] != null) dimensionMap[q.dimension].push(answers[q.id]);
  }

  const per_dimension = Object.entries(dimensionMap).map(([name, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const score_pct = Math.round((avg / 5) * 100);
    let classification: IntegrityClassificationLegacy;
    if (score_pct < 35) classification = 'Bajo';
    else if (score_pct < 70) classification = 'Medio';
    else classification = 'Alto';
    return { name, classification, score_pct };
  });

  const observations: string[] = [];
  if (buena_impresion_alta) {
    observations.push('Buena impresión alta — respuestas extremas consistentes en preguntas detectoras de deseabilidad social.');
  }
  const altoCount = per_dimension.filter((d) => d.classification === 'Alto').length;
  if (altoCount >= 3) {
    observations.push(`${altoCount} dimensiones en clasificación Alto — revisar antes de avanzar.`);
  }

  return { per_dimension, buena_impresion_alta, observations };
}

// ============== Competencias derivadas ==============

export type CompetenciaResult = {
  name: string;
  score_pct: number;
  required_pct?: number;
  passes: boolean;
};

type CompetenciaFormula = {
  name: string;
  weights: { factor: 'd' | 'i' | 's' | 'c' | 'velna_aggregate' | 'emotional'; weight: number; reverse?: boolean }[];
};

const COMPETENCIAS_FORMULAS: CompetenciaFormula[] = [
  {
    name: 'Resolución de problemas complejos',
    weights: [
      { factor: 'velna_aggregate', weight: 0.5 },
      { factor: 'c', weight: 0.3 },
      { factor: 'd', weight: 0.2 },
    ],
  },
  {
    name: 'Adaptabilidad',
    weights: [
      { factor: 'i', weight: 0.4 },
      { factor: 's', weight: 0.3, reverse: true },
      { factor: 'velna_aggregate', weight: 0.3 },
    ],
  },
  {
    name: 'Comunicación digital',
    weights: [
      { factor: 'i', weight: 0.5 },
      { factor: 'velna_aggregate', weight: 0.5 },
    ],
  },
  {
    name: 'Resiliencia, tolerancia al estrés y flexibilidad',
    weights: [
      { factor: 's', weight: 0.4 },
      { factor: 'emotional', weight: 0.4 },
      { factor: 'd', weight: 0.2 },
    ],
  },
  {
    name: 'Planificación',
    weights: [
      { factor: 'c', weight: 0.6 },
      { factor: 'velna_aggregate', weight: 0.4 },
    ],
  },
];

export function calculateCompetencias(
  disc: DiscRawScores,
  velna_aggregate_pct: number,
  emotional_pct: number,
  required_per_competencia?: Record<string, number>,
): CompetenciaResult[] {
  return COMPETENCIAS_FORMULAS.map((formula) => {
    const score = formula.weights.reduce((sum, w) => {
      let value = 0;
      if (w.factor === 'd') value = disc.d;
      else if (w.factor === 'i') value = disc.i;
      else if (w.factor === 's') value = disc.s;
      else if (w.factor === 'c') value = disc.c;
      else if (w.factor === 'velna_aggregate') value = velna_aggregate_pct;
      else if (w.factor === 'emotional') value = emotional_pct;
      if (w.reverse) value = 100 - value;
      return sum + value * w.weight;
    }, 0);
    const required = required_per_competencia?.[formula.name];
    return {
      name: formula.name,
      score_pct: Math.round(score),
      required_pct: required,
      passes: required != null ? score >= required : true,
    };
  });
}

// ============== State machine ==============

export type PhaseState = 'registrado' | 'en_progreso' | 'completado' | 'siguiente_etapa' | 'duda_cv' | 'salario_fuera_rango' | 'llamar_entrevista' | 'rechazado';

const VALID_TRANSITIONS: Record<PhaseState, PhaseState[]> = {
  registrado: ['en_progreso', 'rechazado', 'salario_fuera_rango'],
  en_progreso: ['completado', 'rechazado'],
  completado: ['siguiente_etapa', 'duda_cv', 'rechazado', 'llamar_entrevista'],
  siguiente_etapa: ['rechazado'],
  duda_cv: ['siguiente_etapa', 'rechazado'],
  salario_fuera_rango: ['siguiente_etapa', 'rechazado'],
  llamar_entrevista: ['rechazado'],
  rechazado: [],
};

export function isTransitionAllowed(from: PhaseState, to: PhaseState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextPhaseAfterCompleted(currentPhase: 'tecnica' | 'conductual' | 'integridad'): 'conductual' | 'integridad' | 'finalist' {
  if (currentPhase === 'tecnica') return 'conductual';
  if (currentPhase === 'conductual') return 'integridad';
  return 'finalist';
}
