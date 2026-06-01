import { describe, expect, it } from 'vitest';
import { calculateMatch, calculateMatchWithJobLevel, _internal, type PoolCandidateInput } from '../src/lib/candidatePoolMatcher';
import type { IdealProfile } from '../src/features/jobs';

const { scoreDisc, scoreCognitive, scoreArea, scoreEnglish, scoreRecency, scoreContactHistory, WEIGHTS } = _internal;

const idealDisc: IdealProfile = {
  disc: { d: 70, i: 30, s: 25, c: 75 },
};

function makeCandidate(overrides: Partial<PoolCandidateInput> = {}): PoolCandidateInput {
  return {
    candidate_id: 'c1',
    disc: { d: 70, i: 30, s: 25, c: 75 },
    cognitive_level: 'mid',
    velna_indice: 80,
    tags: ['react', 'typescript'],
    last_active: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días atrás
    languages: ['es', 'en'],
    disponible_para_outreach: true,
    times_contacted: 0,
    ...overrides,
  };
}

describe('scoreDisc', () => {
  it('match perfecto = peso completo', () => {
    expect(scoreDisc({ d: 50, i: 50, s: 50, c: 50 }, { d: 50, i: 50, s: 50, c: 50 })).toBe(WEIGHTS.disc);
  });

  it('polos opuestos = 0 o cerca', () => {
    const r = scoreDisc({ d: 100, i: 0, s: 100, c: 0 }, { d: 0, i: 100, s: 0, c: 100 });
    expect(r).toBeLessThan(5);
  });

  it('null candidate o null ideal → 0', () => {
    expect(scoreDisc(null, idealDisc.disc)).toBe(0);
    expect(scoreDisc({ d: 50, i: 50, s: 50, c: 50 }, undefined)).toBe(0);
  });
});

describe('scoreCognitive', () => {
  it('match exacto = peso completo', () => {
    expect(scoreCognitive('senior', 'senior')).toBe(WEIGHTS.cognitive);
  });

  it('mismatch = 0', () => {
    expect(scoreCognitive('basic', 'senior')).toBe(0);
  });

  it('null = 0', () => {
    expect(scoreCognitive(null, 'mid')).toBe(0);
  });
});

describe('scoreArea', () => {
  it('match con un tag = peso completo', () => {
    expect(scoreArea(['react', 'typescript'], ['react'])).toBe(WEIGHTS.area);
  });

  it('case insensitive', () => {
    expect(scoreArea(['React'], ['react'])).toBe(WEIGHTS.area);
  });

  it('sin match = 0', () => {
    expect(scoreArea(['java'], ['react', 'angular'])).toBe(0);
  });

  it('areaTags vacío = 0', () => {
    expect(scoreArea(['react'], [])).toBe(0);
  });
});

describe('scoreEnglish', () => {
  it('no requiere = peso completo (no penaliza)', () => {
    expect(scoreEnglish(['es'], false)).toBe(WEIGHTS.english);
  });

  it('requiere y tiene en = peso completo', () => {
    expect(scoreEnglish(['es', 'en'], true)).toBe(WEIGHTS.english);
  });

  it('requiere y NO tiene = 0', () => {
    expect(scoreEnglish(['es'], true)).toBe(0);
  });

  it('match en-US o english variants', () => {
    expect(scoreEnglish(['en-US'], true)).toBe(WEIGHTS.english);
  });
});

describe('scoreRecency', () => {
  it('< 6 meses = peso completo', () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(scoreRecency(recent)).toBe(WEIGHTS.recency);
  });

  it('6-12 meses = mitad', () => {
    const mid = new Date(Date.now() - 9 * 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(scoreRecency(mid)).toBe(Math.round(WEIGHTS.recency / 2));
  });

  it('> 12 meses = 0', () => {
    const old = new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(scoreRecency(old)).toBe(0);
  });

  it('null = 0', () => {
    expect(scoreRecency(null)).toBe(0);
  });
});

describe('scoreContactHistory', () => {
  it('0 contactos = 0 penalty', () => {
    expect(scoreContactHistory(0)).toBe(0);
  });

  it('contactos altos penalizan', () => {
    expect(scoreContactHistory(5)).toBeLessThan(0);
  });

  it('penalty cap a -10', () => {
    expect(scoreContactHistory(100)).toBe(-10);
  });
});

describe('calculateMatch — integración', () => {
  it('candidato perfecto + recent + tag match → score alto', () => {
    const c = makeCandidate();
    const r = calculateMatch(c, idealDisc, { areaTags: ['react'] });
    expect(r.match_score).toBeGreaterThan(70);
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it('candidato no match DISC + sin tags + viejo → score bajo', () => {
    const c = makeCandidate({
      disc: { d: 0, i: 100, s: 100, c: 0 },
      tags: ['cobol'],
      last_active: new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const r = calculateMatch(c, idealDisc, { areaTags: ['react'] });
    expect(r.match_score).toBeLessThan(30);
  });

  it('available=false marcado pero score se calcula igual', () => {
    const c = makeCandidate({ disponible_para_outreach: false });
    const r = calculateMatch(c, idealDisc, { areaTags: ['react'] });
    expect(r.available).toBe(false);
    expect(r.match_score).toBeGreaterThan(0);
  });

  it('reasoning incluye penalty si overcontact', () => {
    const c = makeCandidate({ times_contacted: 5 });
    const r = calculateMatch(c, idealDisc, { areaTags: ['react'] });
    expect(r.reasoning.some((x) => x.includes('5 veces'))).toBe(true);
  });

  it('score nunca negativo aunque haya penalty alto', () => {
    const c = makeCandidate({
      disc: null,
      cognitive_level: null,
      tags: [],
      languages: [],
      last_active: null,
      times_contacted: 100,
    });
    const r = calculateMatch(c, null, {});
    expect(r.match_score).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateMatchWithJobLevel', () => {
  it('candidato senior + job senior → cognitive full', () => {
    const c = makeCandidate({ cognitive_level: 'senior' });
    const r = calculateMatchWithJobLevel(c, idealDisc, 'senior', { areaTags: ['react'] });
    expect(r.breakdown.cognitive).toBe(WEIGHTS.cognitive);
  });

  it('candidato basic + job senior → cognitive 0', () => {
    const c = makeCandidate({ cognitive_level: 'basic' });
    const r = calculateMatchWithJobLevel(c, idealDisc, 'senior', { areaTags: ['react'] });
    expect(r.breakdown.cognitive).toBe(0);
  });

  it('match score se ajusta correctamente con cognitive', () => {
    const c1 = makeCandidate({ cognitive_level: 'senior' });
    const c2 = makeCandidate({ cognitive_level: 'basic' });
    const r1 = calculateMatchWithJobLevel(c1, idealDisc, 'senior', { areaTags: ['react'] });
    const r2 = calculateMatchWithJobLevel(c2, idealDisc, 'senior', { areaTags: ['react'] });
    expect(r1.match_score).toBeGreaterThan(r2.match_score);
  });
});
