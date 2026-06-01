/**
 * Determina qué bloques del test debe correr el candidato según la configuración del Job.
 *
 * Orden canónico (definido en docs/master-plan/25_TEST_INGLES.md y 26_TEST_MENTALIDADES.md):
 *   1. DISC                 (siempre)
 *   2. Mindset              (si job.mindset_test_enabled, default true)
 *   3. VELNA cognitivo      (siempre)
 *   4. Integridad           (siempre)
 *   5. Emocional            (siempre)
 *   6. Técnica              (si job.tech_prompt definido o cognitive_level requiere)
 *   7. Inglés               (si job.english_required)
 *   8. Videos abiertos      (siempre, último)
 *
 * Reglas:
 * - Si un bloque falla (ej: inglés debajo del threshold), NO se aborta el flow — se
 *   marca como "failed" pero sigue. Cris decide manualmente si rechazar al candidato.
 * - El test de mentalidades es OPCIONAL pero default ON (la mayoría de puestos lo correrán).
 */

export type TestBlock =
  | 'disc'
  | 'mindset'
  | 'velna'
  | 'integrity'
  | 'emotional'
  | 'technical'
  | 'english'
  | 'videos';

export type JobTestConfig = {
  /** Si el puesto requiere test de inglés. Default false. */
  english_required?: boolean;
  /** Nivel CEFR mínimo si english_required. */
  english_min_level?: 'A2' | 'B1' | 'B2' | 'C1';
  /** Si correr test de mentalidades. Default true. */
  mindset_test_enabled?: boolean;
  /** Si tiene prueba técnica configurada. */
  tech_prompt?: string | null;
};

/**
 * Devuelve los bloques en el orden canónico que el candidato debe completar.
 */
export function buildTestFlow(config: JobTestConfig): TestBlock[] {
  const flow: TestBlock[] = ['disc'];

  // Mindset es default true (solo lo desactivás explícitamente si el cliente lo pide)
  if (config.mindset_test_enabled !== false) {
    flow.push('mindset');
  }

  flow.push('velna', 'integrity', 'emotional');

  // Técnica solo si está configurada
  if (config.tech_prompt && config.tech_prompt.trim().length > 0) {
    flow.push('technical');
  }

  // Inglés solo si requerido + nivel especificado
  if (config.english_required && config.english_min_level) {
    flow.push('english');
  }

  flow.push('videos');

  return flow;
}

/**
 * Calcula tiempo estimado total del flow (en minutos).
 *
 * Promedios reales basados en data del v1:
 *   - DISC: 12 min
 *   - Mindset: 7 min
 *   - VELNA: 18 min
 *   - Integridad: 8 min
 *   - Emocional: 7 min
 *   - Técnica: 30 min (varía mucho)
 *   - Inglés: 20 min (full block: MC + listening + writing + opt video)
 *   - Videos: 12 min (5-7 preguntas × 1.5 min cada)
 */
export const BLOCK_DURATION_MINUTES: Record<TestBlock, number> = {
  disc: 12,
  mindset: 7,
  velna: 18,
  integrity: 8,
  emotional: 7,
  technical: 30,
  english: 20,
  videos: 12,
};

export function estimateTestDurationMinutes(config: JobTestConfig): number {
  const flow = buildTestFlow(config);
  return flow.reduce((sum, block) => sum + BLOCK_DURATION_MINUTES[block], 0);
}
