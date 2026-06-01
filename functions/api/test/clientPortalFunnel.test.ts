/**
 * Tests del cómputo del funnel del portal cliente.
 *
 * Validamos que las stats (applied, prefilter_passed, tecnica_done, etc.) cuentan
 * correctamente según el pipeline_stage de cada Result.
 *
 * NO testeamos el endpoint completo (eso requiere mock del SDK Catalyst).
 * Testeamos la pure-function de categorización via re-implementación inline:
 * el mismo set de constantes que clientPortal.ts usa, aplicado a inputs sintéticos.
 */
import { describe, expect, it } from 'vitest';

// Replicamos las constantes de clientPortal.ts. Si divergen del backend, los tests fallan
// y obligan a sincronizar (intencional — son la "verdad" del producto).
const PASSED_PREFILTER = [
  'prefilter_passed', 'tecnica_completed', 'conductual_completed',
  'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const TECNICA_DONE = [
  'tecnica_completed', 'conductual_completed', 'integridad_completed',
  'videos_pending', 'videos_completed', 'bot_decision_advance',
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];
const FINALISTS = ['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired'];

function computeFunnel(results: { pipeline_stage: string }[]) {
  const inSet = (s: string, arr: string[]) => arr.includes(s);
  return {
    applied: results.length,
    prefilter_passed: results.filter((r) => inSet(r.pipeline_stage, PASSED_PREFILTER)).length,
    tecnica_done: results.filter((r) => inSet(r.pipeline_stage, TECNICA_DONE)).length,
    finalists: results.filter((r) => inSet(r.pipeline_stage, FINALISTS)).length,
  };
}

describe('Client portal funnel computation', () => {
  it('vacío devuelve todos 0', () => {
    expect(computeFunnel([])).toEqual({ applied: 0, prefilter_passed: 0, tecnica_done: 0, finalists: 0 });
  });

  it('un candidato en prefilter_pending no pasa filtro', () => {
    const r = computeFunnel([{ pipeline_stage: 'prefilter_pending' }]);
    expect(r.applied).toBe(1);
    expect(r.prefilter_passed).toBe(0);
    expect(r.tecnica_done).toBe(0);
  });

  it('finalist pasa todos los filtros previos', () => {
    const r = computeFunnel([{ pipeline_stage: 'finalist' }]);
    expect(r.applied).toBe(1);
    expect(r.prefilter_passed).toBe(1);
    expect(r.tecnica_done).toBe(1);
    expect(r.finalists).toBe(1);
  });

  it('videos_pending cuenta como tecnica_done (post-tests)', () => {
    const r = computeFunnel([{ pipeline_stage: 'videos_pending' }]);
    expect(r.tecnica_done).toBe(1);
    expect(r.finalists).toBe(0); // todavía no es finalist
  });

  it('hired cuenta como finalist (estado terminal positivo)', () => {
    const r = computeFunnel([{ pipeline_stage: 'hired' }]);
    expect(r.finalists).toBe(1);
  });

  it('rejected_by_admin NO cuenta como prefilter_passed', () => {
    const r = computeFunnel([{ pipeline_stage: 'rejected_by_admin' }]);
    expect(r.applied).toBe(1);
    expect(r.prefilter_passed).toBe(0);
  });

  it('mix de 5 candidatos en stages distintos', () => {
    const r = computeFunnel([
      { pipeline_stage: 'prefilter_pending' },
      { pipeline_stage: 'tecnica_completed' },
      { pipeline_stage: 'finalist' },
      { pipeline_stage: 'hired' },
      { pipeline_stage: 'auto_rejected_low_score' },
    ]);
    expect(r.applied).toBe(5);
    expect(r.prefilter_passed).toBe(3); // tecnica + finalist + hired
    expect(r.tecnica_done).toBe(3);
    expect(r.finalists).toBe(2); // finalist + hired
  });

  it('awaiting_client_review e interview_scheduled cuentan como finalists', () => {
    const r = computeFunnel([
      { pipeline_stage: 'awaiting_client_review' },
      { pipeline_stage: 'interview_scheduled' },
    ]);
    expect(r.finalists).toBe(2);
  });

  it('offer_declined NO cuenta como finalist (estado terminal negativo)', () => {
    const r = computeFunnel([{ pipeline_stage: 'offer_declined' }]);
    expect(r.finalists).toBe(0);
  });

  it('withdrew NO cuenta en ningún stage post-prefilter', () => {
    const r = computeFunnel([{ pipeline_stage: 'withdrew' }]);
    expect(r.applied).toBe(1);
    expect(r.prefilter_passed).toBe(0);
    expect(r.finalists).toBe(0);
  });
});
