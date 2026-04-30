/**
 * Scoring algorithms — TypeScript puro, corre en el browser.
 * Cuando haya backend, esta lógica se mueve allí (o se mantiene en ambos lados
 * para validación rápida sin round-trip).
 */

import type { DiscQuestion, VelnaSubtest, IntegrityQuestion } from '../data/mockCandidateTests';
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

export function calculateDiscRaw(
  questions: DiscQuestion[],
  answers: DiscAnswer[],
): DiscRawScores {
  const counts = { d: 0, i: 0, s: 0, c: 0 };
  for (const ans of answers) {
    counts[ans.most_axis] += 1;
    counts[ans.least_axis] -= 1;
  }
  // Normalizar a 0-100 con base = total preguntas
  const total = questions.length;
  return {
    d: Math.max(0, Math.min(100, ((counts.d + total) / (total * 2)) * 100)),
    i: Math.max(0, Math.min(100, ((counts.i + total) / (total * 2)) * 100)),
    s: Math.max(0, Math.min(100, ((counts.s + total) / (total * 2)) * 100)),
    c: Math.max(0, Math.min(100, ((counts.c + total) / (total * 2)) * 100)),
  };
}

/**
 * Calcula similitud entre 2 perfiles DISC (0-100).
 * Distancia euclidiana normalizada e invertida.
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
  // Distancia máxima posible en R⁴ con valores 0-100: sqrt(4 * 100²) = 200
  const maxDist = 200;
  return Math.max(0, Math.round(((maxDist - dist) / maxDist) * 100));
}

/**
 * Selecciona el perfil ideal (A o B) con mejor match para un candidato.
 */
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

/**
 * Determina la dimensión dominante (D/I/S/C) y devuelve etiqueta humana.
 */
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

// ============== VELNA ==============

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
  answers: Record<string, string>, // qid -> selected option id
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

  const aggregate = Math.round(
    perSubtest.reduce((sum, s) => sum + s.pct, 0) / perSubtest.length,
  );

  // Similitud con perfil ideal: distancia euclidiana invertida sobre 5 dimensiones
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

  return {
    per_subtest: perSubtest,
    aggregate_pct: aggregate,
    similarity_with_ideal_pct: similarity,
  };
}

// ============== Integridad ==============

export type IntegrityClassification = 'Bajo' | 'Medio' | 'Alto';

export type IntegrityResult = {
  per_dimension: { name: string; classification: IntegrityClassification; score_pct: number }[];
  buena_impresion_alta: boolean;
  observations: string[];
};

/**
 * Clasifica respuestas Likert (1-5) por dimensión.
 * - Alto = mayoría 1-2 (en preguntas reverse-coded) o 4-5 (en preguntas straight)
 * - SDC check: si todas las preguntas SDC fueron respondidas con extremos consistentes
 *   en la dirección "socialmente deseable", flag buena_impresion_alta.
 *
 * Nota: en producción esto se calibra con cada pregunta sabiendo si es reverse-coded.
 * Aquí asumimos que respuestas extremas (5) en SDC = "intentando dar buena impresión".
 */
export function calculateIntegrityResult(
  questions: IntegrityQuestion[],
  answers: Record<string, number>, // qid -> 1-5
): IntegrityResult {
  // Detectar buena impresión
  const sdcQuestions = questions.filter((q) => q.is_social_desirability_check);
  const sdcAllExtreme = sdcQuestions.every((q) => answers[q.id] === 5);
  const sdcMostExtreme =
    sdcQuestions.filter((q) => answers[q.id] === 5).length / sdcQuestions.length >= 0.8;
  const buena_impresion_alta = sdcAllExtreme || sdcMostExtreme;

  // Clasificar por dimensión (usando un score promedio)
  const dimensionMap: Record<string, number[]> = {};
  for (const q of questions) {
    if (!dimensionMap[q.dimension]) dimensionMap[q.dimension] = [];
    if (answers[q.id] != null) dimensionMap[q.dimension].push(answers[q.id]);
  }

  const per_dimension = Object.entries(dimensionMap).map(([name, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const score_pct = Math.round((avg / 5) * 100);
    let classification: IntegrityClassification;
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

// ============== Competencias derivadas (54) ==============

/**
 * Las 54 competencias del master plan se derivan de DISC + cognitive + emotional.
 * Mock simplificado: 5 competencias clave calculadas con weights conocidos.
 * En producción la tabla completa de 54 viene de docs/evaluaciones/LOGICA_COMPETENCIAS.md.
 */

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
      { factor: 's', weight: 0.3, reverse: true }, // S muy alto reduce adaptabilidad
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
      { factor: 'emotional', weight: 0.4 }, // mesura > espontáneo
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
  emotional_pct: number, // 0-100, alto = más mesurado/reflexivo
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

// ============== State machine de fases ==============

export type PhaseState = 'registrado' | 'en_progreso' | 'completado' | 'siguiente_etapa' | 'duda_cv' | 'salario_fuera_rango' | 'llamar_entrevista' | 'rechazado';

const VALID_TRANSITIONS: Record<PhaseState, PhaseState[]> = {
  registrado: ['en_progreso', 'rechazado', 'salario_fuera_rango'],
  en_progreso: ['completado', 'rechazado'],
  completado: ['siguiente_etapa', 'duda_cv', 'rechazado', 'llamar_entrevista'],
  siguiente_etapa: ['rechazado'], // ya avanzó, solo se puede revertir con rechazo
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
