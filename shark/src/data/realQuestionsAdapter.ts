/**
 * Adapter: convierte las preguntas REALES del v1 (en /data/questions/*.json)
 * al formato que esperan los componentes existentes.
 *
 * Esto preserva el UI sin migrar el formato de datos en cascada.
 *
 * Convenciones:
 * - Cognitive v1 dimension `logico` → mock key `logica` (idem numerico→numerica, abstracto→abstracta)
 * - Cognitive v1 `correct: <number>` → mock `correct_option_id: '<number>'`
 * - Cognitive v1 `options: string[]` → mock `options: [{id, text}]` con id = índice
 */

import type { VelnaSubtest, VelnaSubtestKey } from './mockCandidateTests';
import {
  DISC_QUESTIONS_V2,
  EMOTIONAL_QUESTIONS_V2,
  INTEGRITY_QUESTIONS_V2,
  loadCognitiveQuestions,
  type CognitiveLevel,
} from './questionLoader';
import type {
  CognitiveQuestionV2,
  DiscQuestionV2,
  IntegrityQuestionV2,
  EmotionalQuestionV2,
} from '../lib/scoring';

// ---- Cognitive (VELNA) ----

const SUBTEST_LABELS: Record<VelnaSubtestKey, { label: string; description: string }> = {
  verbal: {
    label: 'Verbal',
    description: 'Comprensión lectora, sinónimos y vocabulario.',
  },
  espacial: {
    label: 'Espacial',
    description: 'Razonamiento con formas, rotación y distancias.',
  },
  logica: {
    label: 'Lógica',
    description: 'Patrones, secuencias y razonamiento deductivo.',
  },
  numerica: {
    label: 'Numérica',
    description: 'Cálculo, porcentajes y razonamiento cuantitativo.',
  },
  abstracta: {
    label: 'Abstracta',
    description: 'Reconocimiento de patrones y razonamiento abstracto.',
  },
};

const V1_TO_V2_DIM: Record<string, VelnaSubtestKey> = {
  verbal: 'verbal',
  espacial: 'espacial',
  logico: 'logica',
  numerico: 'numerica',
  abstracto: 'abstracta',
};

/**
 * Toma las preguntas reales del v1 (lazy load por level) y las agrupa en VelnaSubtest[]
 * (formato mock que usa la UI). Async porque las preguntas cognitive se importan dinámicamente
 * para no inflar el bundle inicial (~500KB que solo se cargan cuando arranca el test).
 *
 * Tiempo por subtest: ~12 seg/pregunta para basic/mid, ~15 seg/pregunta para senior.
 */
export async function buildVelnaSubtestsFromReal(level: CognitiveLevel): Promise<VelnaSubtest[]> {
  const realQuestions = await loadCognitiveQuestions(level);
  const grouped: Record<VelnaSubtestKey, CognitiveQuestionV2[]> = {
    verbal: [],
    espacial: [],
    logica: [],
    numerica: [],
    abstracta: [],
  };

  for (const q of realQuestions) {
    const v2Key = V1_TO_V2_DIM[q.dimension];
    if (v2Key) grouped[v2Key].push(q);
  }

  const baseSecondsPerQuestion = level === 'senior' ? 15 : 12;

  // Override por subtest: las que requieren más razonamiento se les da más tiempo.
  // Lógica, numérica y abstracta requieren 18 seg/pregunta (6 min total con 20 preg).
  // Verbal y espacial siguen con 12 seg/pregunta (4 min total).
  const SECONDS_OVERRIDE: Partial<Record<VelnaSubtestKey, number>> = {
    logica: 18,
    numerica: 18,
    abstracta: 18,
  };

  return (Object.keys(SUBTEST_LABELS) as VelnaSubtestKey[]).map((key) => {
    const meta = SUBTEST_LABELS[key];
    const subtestQuestions = grouped[key];
    const secondsPerQuestion = SECONDS_OVERRIDE[key] ?? baseSecondsPerQuestion;
    return {
      key,
      label: meta.label,
      description: meta.description,
      duration_sec: subtestQuestions.length * secondsPerQuestion,
      questions: subtestQuestions.map((q) => ({
        id: q.id,
        question: q.text,
        question_svg: q.svg,
        options: q.options.map((text, idx) => ({
          id: String(idx),
          text,
          svg: q.options_svg?.[idx],
        })),
        correct_option_id: String(q.correct),
      })),
    };
  });
}

// ---- DISC ----

/**
 * Convierte preguntas reales DISC (forced-choice con `dimension: ['D','I','S','C']`)
 * al formato que la UI mock actual espera. La UI mock usa `most_axis/least_axis`.
 *
 * IMPORTANTE: el v1 NO usa most/least — es single-select. Esta función adapta para
 * que la UI tipo "elige más como yo / menos como yo" siga funcionando, mapeando:
 *   most = la opción que el candidato eligió (es la dim que aporta +1)
 *   least = se calcula automáticamente como la opción opuesta (NO se pregunta)
 *
 * Si quieres migrar la UI a single-select puro, ese es otro refactor de pantallas.
 */
export type RealDiscQuestion = DiscQuestionV2;

export function getRealDiscQuestions(): RealDiscQuestion[] {
  return DISC_QUESTIONS_V2;
}

// DISC y Integridad: el adapter NO se usa todavía porque los componentes UI
// necesitan refactor (DISC v1 es single-select, mock UI es most/least;
// Integridad v1 es multiple-choice con risk_weights, mock UI es Likert 1-5).
// Cuando esos componentes se migren, exportamos las preguntas reales directamente
// via getRealDiscQuestions() / getRealIntegrityQuestions().

// ---- Emotional ----

export function getRealEmotionalQuestions(): EmotionalQuestionV2[] {
  return EMOTIONAL_QUESTIONS_V2;
}

// ---- Integrity ----

/**
 * Convierte preguntas reales (multiple-choice con risk_weights) al formato Likert mock.
 * NO se puede convertir — son formatos fundamentalmente distintos.
 *
 * En su lugar, exportamos las preguntas reales y la UI debe migrarse a multiple-choice.
 * Por ahora la UI Likert sigue mostrando el mock chico hasta que migremos la pantalla.
 */
export function getRealIntegrityQuestions(): IntegrityQuestionV2[] {
  return INTEGRITY_QUESTIONS_V2;
}

// Para Integridad: ver nota arriba sobre refactor pendiente de UI.
