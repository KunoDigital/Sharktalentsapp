import { describe, expect, it } from 'vitest';
import {
  calculateDiscRaw,
  calculateDiscSimilarity,
  pickBestIdealProfile,
  discDominantLabel,
  isTransitionAllowed,
  nextPhaseAfterCompleted,
} from '../src/lib/scoring';

describe('calculateDiscRaw', () => {
  it('respuestas balanceadas → 50% en cada eje', () => {
    const questions = Array.from({ length: 24 }, (_, i) => ({
      id: `q${i}`,
      group: 'q',
      label: 'q',
      options: [],
    }));
    const result = calculateDiscRaw(questions, []);
    expect(result.d).toBe(50);
    expect(result.i).toBe(50);
    expect(result.s).toBe(50);
    expect(result.c).toBe(50);
  });
});

describe('calculateDiscSimilarity', () => {
  it('perfiles idénticos = 100', () => {
    const profile = { d: 70, i: 30, s: 50, c: 60 };
    expect(calculateDiscSimilarity(profile, profile)).toBe(100);
  });

  it('perfiles opuestos extremos = 0', () => {
    const a = { d: 100, i: 100, s: 100, c: 100 };
    const b = { d: 0, i: 0, s: 0, c: 0 };
    expect(calculateDiscSimilarity(a, b)).toBe(0);
  });
});

describe('pickBestIdealProfile', () => {
  const idealA = {
    d: 80, i: 20, s: 30, c: 50,
    pk_profile_code: 'PK-A', pk_profile_name: 'A', description: [],
  };
  const idealB = {
    d: 30, i: 80, s: 50, c: 30,
    pk_profile_code: 'PK-B', pk_profile_name: 'B', description: [],
  };

  it('retorna A si solo se pasa A', () => {
    const result = pickBestIdealProfile({ d: 70, i: 25, s: 35, c: 55 }, idealA);
    expect(result.key).toBe('A');
  });

  it('elige B cuando candidato es más similar a B', () => {
    const candidate = { d: 35, i: 75, s: 45, c: 25 };
    const result = pickBestIdealProfile(candidate, idealA, idealB);
    expect(result.key).toBe('B');
  });

  it('elige A cuando candidato es más similar a A', () => {
    const candidate = { d: 75, i: 25, s: 35, c: 55 };
    const result = pickBestIdealProfile(candidate, idealA, idealB);
    expect(result.key).toBe('A');
  });
});

describe('discDominantLabel', () => {
  it('detecta D dominante', () => {
    const r = discDominantLabel({ d: 80, i: 30, s: 25, c: 50 });
    expect(r.axis).toBe('d');
    expect(r.label).toContain('Dominante');
  });

  it('detecta C dominante', () => {
    const r = discDominantLabel({ d: 30, i: 25, s: 40, c: 85 });
    expect(r.axis).toBe('c');
    expect(r.label).toContain('Cumplidor');
  });
});

describe('state machine', () => {
  it('registrado → en_progreso permitido', () => {
    expect(isTransitionAllowed('registrado', 'en_progreso')).toBe(true);
  });

  it('completado → siguiente_etapa permitido', () => {
    expect(isTransitionAllowed('completado', 'siguiente_etapa')).toBe(true);
  });

  it('rechazado no permite transiciones', () => {
    expect(isTransitionAllowed('rechazado', 'en_progreso')).toBe(false);
  });

  it('siguiente_etapa solo permite ir a rechazado', () => {
    expect(isTransitionAllowed('siguiente_etapa', 'rechazado')).toBe(true);
    expect(isTransitionAllowed('siguiente_etapa', 'completado')).toBe(false);
  });

  it('nextPhaseAfterCompleted en orden', () => {
    expect(nextPhaseAfterCompleted('tecnica')).toBe('conductual');
    expect(nextPhaseAfterCompleted('conductual')).toBe('integridad');
    expect(nextPhaseAfterCompleted('integridad')).toBe('finalist');
  });
});
