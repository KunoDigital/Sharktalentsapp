/**
 * State machine del pipeline de aplicación. Compartido entre features/applications.ts,
 * features/publicTest.ts, features/bot.ts.
 *
 * Reglas:
 * - Cada transición tiene un set fijo de destinos válidos.
 * - Estados terminales (hired, auto_rejected_low_score, rejected_by_admin) no permiten transiciones.
 * - `transitionAllowed(from, to)` es la única función que debe usarse para validar.
 */

export type PipelineStage =
  | 'prefilter_pending'
  | 'prefilter_passed'
  | 'salary_out_of_range'
  | 'tecnica_completed'
  | 'conductual_completed'
  | 'integridad_completed'
  | 'videos_pending'        // preguntas de video generadas, esperando que candidato responda
  | 'videos_completed'      // candidato completó videos (todos)
  | 'bot_decision_advance'
  | 'finalist'
  | 'awaiting_client_review'
  | 'interview_scheduled'
  | 'offered'
  | 'hired'
  // Terminales
  | 'auto_rejected_low_score'
  | 'rejected_by_admin'
  | 'offer_declined'
  | 'withdrew';

export const ALL_STAGES: readonly PipelineStage[] = [
  'prefilter_pending', 'prefilter_passed', 'salary_out_of_range',
  'tecnica_completed', 'conductual_completed', 'integridad_completed',
  'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
  'auto_rejected_low_score', 'rejected_by_admin', 'offer_declined', 'withdrew',
] as const;

/** Stages activos (no terminales). Útil para queries de "in progress". */
export const ACTIVE_STAGES: readonly PipelineStage[] = [
  'prefilter_pending', 'prefilter_passed', 'salary_out_of_range',
  'tecnica_completed', 'conductual_completed', 'integridad_completed',
  'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered',
] as const;

/** Stages terminales — no se puede salir. */
export const TERMINAL_STAGES: readonly PipelineStage[] = [
  'hired', 'auto_rejected_low_score', 'rejected_by_admin',
  'offer_declined', 'withdrew',
] as const;

const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  prefilter_pending: ['prefilter_passed', 'salary_out_of_range', 'rejected_by_admin', 'withdrew'],
  // 2026-06-03: agregado `auto_rejected_low_score` — si la prueba técnica se reprueba,
  // el candidato pasa directo a rechazo automático. Antes la state machine no permitía
  // este transition desde `prefilter_passed`, así que el rechazo se ignoraba y el
  // candidato quedaba colgado en `prefilter_passed` para siempre (detectado con
  // Andrea Martínez completando la técnica con score bajo).
  prefilter_passed: ['tecnica_completed', 'auto_rejected_low_score', 'rejected_by_admin', 'withdrew'],
  salary_out_of_range: ['prefilter_passed', 'rejected_by_admin', 'withdrew'],
  // tecnica_completed → integridad_completed: necesario para el demo del funnel marketing,
  // donde la persona puede hacer la integridad antes que el conductual (links independientes).
  tecnica_completed: ['conductual_completed', 'integridad_completed', 'auto_rejected_low_score', 'rejected_by_admin', 'withdrew'],
  conductual_completed: ['integridad_completed', 'rejected_by_admin', 'withdrew'],
  // integridad_completed → conductual_completed: idem, demo permite orden inverso.
  integridad_completed: ['conductual_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'rejected_by_admin', 'withdrew'],
  videos_pending: ['videos_completed', 'rejected_by_admin', 'withdrew'],
  videos_completed: ['bot_decision_advance', 'finalist', 'rejected_by_admin', 'withdrew'],
  bot_decision_advance: ['finalist', 'rejected_by_admin', 'withdrew'],
  finalist: ['awaiting_client_review', 'offered', 'rejected_by_admin', 'withdrew'],
  awaiting_client_review: ['interview_scheduled', 'finalist', 'rejected_by_admin', 'withdrew'],
  interview_scheduled: ['offered', 'rejected_by_admin', 'withdrew'],
  offered: ['hired', 'offer_declined', 'rejected_by_admin', 'withdrew'],
  // Terminales
  hired: [],
  auto_rejected_low_score: [],
  rejected_by_admin: [],
  offer_declined: [],
  withdrew: [],
};

export function isStage(s: unknown): s is PipelineStage {
  return typeof s === 'string' && (ALL_STAGES as readonly string[]).includes(s);
}

export function transitionAllowed(from: PipelineStage, to: PipelineStage): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: PipelineStage): readonly PipelineStage[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}
