/**
 * Loader de preguntas reales (migradas del v1).
 *
 * DISC, Emotional, Integrity → import estático (cargan al iniciar la app, ~150KB total).
 * Cognitive (basic/mid/senior) → DYNAMIC import (cargan solo cuando el candidato hace
 * una prueba VELNA, ahorrando ~500KB del bundle inicial).
 *
 * Cantidad real al 1-may-2026:
 * - DISC: 40 preguntas forced-choice
 * - Cognitive basic: 100 preguntas (5 sub-tests × 20)
 * - Cognitive mid: 100 preguntas
 * - Cognitive senior: 125 preguntas (5 sub-tests × 25)
 * - Emotional: 20 preguntas
 * - Integrity: 90 preguntas (13 dimensiones)
 *
 * Total: 475 preguntas validadas con clientes reales del v1.
 */

import discData from './questions/disc.json';
import emotionalData from './questions/emotional.json';
import integrityData from './questions/integrity.json';

import type {
  DiscQuestionV2,
  CognitiveQuestionV2,
  EmotionalQuestionV2,
  IntegrityQuestionV2,
} from '../lib/scoring';

export type CognitiveLevel = 'basic' | 'mid' | 'senior';

export const DISC_QUESTIONS_V2: DiscQuestionV2[] = discData as DiscQuestionV2[];
export const EMOTIONAL_QUESTIONS_V2: EmotionalQuestionV2[] = emotionalData as EmotionalQuestionV2[];
export const INTEGRITY_QUESTIONS_V2: IntegrityQuestionV2[] = integrityData as IntegrityQuestionV2[];

// Lazy load — solo se carga el level que el candidato necesita.
// Cache en memoria para no re-fetch si se llama 2 veces (ej: refresh dentro del test).
const cognitiveCache: Partial<Record<CognitiveLevel, CognitiveQuestionV2[]>> = {};

export async function loadCognitiveQuestions(level: CognitiveLevel): Promise<CognitiveQuestionV2[]> {
  if (cognitiveCache[level]) return cognitiveCache[level]!;
  let mod: { default: unknown };
  if (level === 'basic') {
    mod = (await import('./questions/cognitive_basic.json')) as { default: unknown };
  } else if (level === 'mid') {
    mod = (await import('./questions/cognitive_mid.json')) as { default: unknown };
  } else {
    mod = (await import('./questions/cognitive_senior.json')) as { default: unknown };
  }
  const questions = mod.default as CognitiveQuestionV2[];
  cognitiveCache[level] = questions;
  return questions;
}

/**
 * Conteos rápidos para mostrar en UI (ej: "Tienes 40 preguntas").
 * Para cognitive devuelve null hasta que se carga el level específico.
 */
export const QUESTION_COUNTS = {
  disc: DISC_QUESTIONS_V2.length,
  emotional: EMOTIONAL_QUESTIONS_V2.length,
  integrity: INTEGRITY_QUESTIONS_V2.length,
  cognitive_basic: 100,
  cognitive_mid: 100,
  cognitive_senior: 125,
} as const;
