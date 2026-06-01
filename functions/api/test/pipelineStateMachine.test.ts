import { describe, expect, it } from 'vitest';
import {
  isStage,
  transitionAllowed,
  getAllowedTransitions,
  ALL_STAGES,
} from '../src/lib/pipelineStateMachine';

describe('isStage', () => {
  it('reconoce stages válidos', () => {
    for (const s of ALL_STAGES) {
      expect(isStage(s)).toBe(true);
    }
  });

  it('rechaza valores inválidos', () => {
    expect(isStage('invalid_stage')).toBe(false);
    expect(isStage('')).toBe(false);
    expect(isStage(null)).toBe(false);
    expect(isStage(42)).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

describe('transitionAllowed', () => {
  it('rechaza transición a sí mismo', () => {
    expect(transitionAllowed('prefilter_pending', 'prefilter_pending')).toBe(false);
    expect(transitionAllowed('finalist', 'finalist')).toBe(false);
  });

  it('permite flujo principal: prefilter → tecnica → conductual → integridad → finalist', () => {
    expect(transitionAllowed('prefilter_pending', 'prefilter_passed')).toBe(true);
    expect(transitionAllowed('prefilter_passed', 'tecnica_completed')).toBe(true);
    expect(transitionAllowed('tecnica_completed', 'conductual_completed')).toBe(true);
    expect(transitionAllowed('conductual_completed', 'integridad_completed')).toBe(true);
    expect(transitionAllowed('integridad_completed', 'finalist')).toBe(true);
    expect(transitionAllowed('finalist', 'offered')).toBe(true);
    expect(transitionAllowed('offered', 'hired')).toBe(true);
  });

  it('rechaza saltos largos (ej: prefilter → finalist directo)', () => {
    expect(transitionAllowed('prefilter_pending', 'finalist')).toBe(false);
    expect(transitionAllowed('prefilter_pending', 'tecnica_completed')).toBe(false);
    expect(transitionAllowed('prefilter_passed', 'conductual_completed')).toBe(false);
    // tecnica_completed → integridad_completed: permitido para el demo marketing
    // (links independientes), no es un "salto largo" en ese caso.
    expect(transitionAllowed('tecnica_completed', 'finalist')).toBe(false);
  });

  it('rechaza transiciones desde estados terminales', () => {
    expect(transitionAllowed('hired', 'offered')).toBe(false);
    expect(transitionAllowed('hired', 'finalist')).toBe(false);
    expect(transitionAllowed('auto_rejected_low_score', 'tecnica_completed')).toBe(false);
    expect(transitionAllowed('rejected_by_admin', 'finalist')).toBe(false);
  });

  it('permite rechazo desde cualquier stage no-terminal', () => {
    expect(transitionAllowed('prefilter_pending', 'rejected_by_admin')).toBe(true);
    expect(transitionAllowed('tecnica_completed', 'rejected_by_admin')).toBe(true);
    expect(transitionAllowed('conductual_completed', 'rejected_by_admin')).toBe(true);
    expect(transitionAllowed('finalist', 'rejected_by_admin')).toBe(true);
    expect(transitionAllowed('offered', 'rejected_by_admin')).toBe(true);
  });

  it('permite auto-reject desde tecnica', () => {
    expect(transitionAllowed('tecnica_completed', 'auto_rejected_low_score')).toBe(true);
    // Pero no desde conductual (la técnica ya pasó)
    expect(transitionAllowed('conductual_completed', 'auto_rejected_low_score')).toBe(false);
  });

  it('salary_out_of_range puede recovered si vuelve a prefilter_passed', () => {
    expect(transitionAllowed('salary_out_of_range', 'prefilter_passed')).toBe(true);
    expect(transitionAllowed('salary_out_of_range', 'tecnica_completed')).toBe(false);
  });
});

describe('getAllowedTransitions', () => {
  it('estado terminal devuelve []', () => {
    expect(getAllowedTransitions('hired')).toEqual([]);
    expect(getAllowedTransitions('auto_rejected_low_score')).toEqual([]);
    expect(getAllowedTransitions('rejected_by_admin')).toEqual([]);
  });

  it('prefilter_pending tiene 3 destinos', () => {
    const allowed = getAllowedTransitions('prefilter_pending');
    expect(allowed).toContain('prefilter_passed');
    expect(allowed).toContain('salary_out_of_range');
    expect(allowed).toContain('rejected_by_admin');
  });
});
