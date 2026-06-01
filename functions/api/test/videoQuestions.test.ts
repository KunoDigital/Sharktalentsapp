import { describe, expect, it } from 'vitest';
import { _internal, analyzeWeaknesses } from '../src/lib/videoQuestionsGenerator';
import { _internal as analysisInternal } from '../src/lib/videoAnalysis';

const { buildUserPrompt, validateQuestion, VALID_CATEGORIES } = _internal;
const { validateAnalysis, clamp0_100 } = analysisInternal;

describe('analyzeWeaknesses', () => {
  it('vacío si no hay scores', () => {
    expect(analyzeWeaknesses(null)).toEqual([]);
    expect(analyzeWeaknesses({})).toEqual([]);
  });

  it('detecta técnica baja', () => {
    const r = analyzeWeaknesses({ tec_score_pct: 50 });
    expect(r.some((s) => s.includes('Técnica baja'))).toBe(true);
  });

  it('no flag técnica si pasa 70', () => {
    const r = analyzeWeaknesses({ tec_score_pct: 75 });
    expect(r.some((s) => s.includes('Técnica baja'))).toBe(false);
  });

  it('detecta DISC D bajo', () => {
    const r = analyzeWeaknesses({ disc_norm_d: 15, disc_norm_i: 50, disc_norm_s: 50, disc_norm_c: 50 });
    expect(r.some((s) => s.includes('DISC D bajo'))).toBe(true);
  });

  it('detecta multiple weaknesses', () => {
    const r = analyzeWeaknesses({ tec_score_pct: 40, velna_indice: 50, emo_score: 30 });
    expect(r.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildUserPrompt', () => {
  it('incluye job + candidate + scores', () => {
    const p = buildUserPrompt({
      jobTitle: 'Backend Engineer',
      jobCompany: 'AcmeTech',
      cognitiveLevel: 'mid',
      candidateName: 'Luis',
      scores: { disc_norm_d: 70, velna_indice: 80, tec_score_pct: 85 },
    });
    expect(p).toContain('Backend Engineer');
    expect(p).toContain('AcmeTech');
    expect(p).toContain('NIVEL: mid');
    expect(p).toContain('Luis');
    expect(p).toContain('D=70');
  });

  it('marca requires_english', () => {
    const p = buildUserPrompt({
      jobTitle: 'X',
      jobCompany: 'Y',
      cognitiveLevel: 'senior',
      candidateName: 'Z',
      scores: null,
      requiresEnglish: true,
    });
    expect(p).toContain('REQUIERE INGLÉS: sí');
  });

  it('inclu integrity flags solo si nivel != bajo', () => {
    const p = buildUserPrompt({
      jobTitle: 'X', jobCompany: 'Y', cognitiveLevel: 'mid', candidateName: 'Z', scores: null,
      integrityDimensions: [
        { dimension: 'hurto', nivel: 'bajo', pct: 10 },
        { dimension: 'soborno', nivel: 'medio', pct: 35 },
      ],
    });
    expect(p).toContain('soborno=medio');
    expect(p).not.toContain('hurto=bajo');
  });
});

describe('validateQuestion (video)', () => {
  it('rechaza categoría inválida', () => {
    expect(validateQuestion({ category: 'unknown', question_text: 'q', max_duration_sec: 60 }, 0)).toBe(null);
  });

  it('rechaza text vacío', () => {
    expect(validateQuestion({ category: 'technical', question_text: '   ', max_duration_sec: 60 }, 0)).toBe(null);
  });

  it('genera id default', () => {
    const q = validateQuestion({ category: 'technical', question_text: 'Q', max_duration_sec: 60 }, 4);
    expect(q?.id).toBe('v5');
  });

  it('clamp duration al rango 15-180', () => {
    const tooBig = validateQuestion({ category: 'technical', question_text: 'Q', max_duration_sec: 999 }, 0);
    expect(tooBig?.max_duration_sec).toBe(60); // fallback
    const tooSmall = validateQuestion({ category: 'technical', question_text: 'Q', max_duration_sec: 5 }, 0);
    expect(tooSmall?.max_duration_sec).toBe(60); // fallback
  });

  it('limita expected_signals a 5', () => {
    const q = validateQuestion({
      category: 'technical', question_text: 'Q', max_duration_sec: 60,
      expected_signals: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    }, 0);
    expect(q?.expected_signals.length).toBe(5);
  });

  it('todas las 6 categories válidas', () => {
    expect(VALID_CATEGORIES.length).toBe(6);
  });
});

describe('validateAnalysis', () => {
  it('clamp valores fuera de 0-100', () => {
    expect(clamp0_100(-5)).toBe(0);
    expect(clamp0_100(150)).toBe(100);
    expect(clamp0_100(50)).toBe(50);
  });

  it('rechaza non-object', () => {
    expect(() => validateAnalysis('string')).toThrow();
    expect(() => validateAnalysis(null)).toThrow();
  });

  it('analysis válido roundtrip', () => {
    const r = validateAnalysis({
      overall_pct: 80,
      signals_matched_pct: 75,
      observations: ['claro', 'concreto'],
      flags: [],
    });
    expect(r.overall_pct).toBe(80);
    expect(r.observations).toEqual(['claro', 'concreto']);
  });

  it('preserva campos opcionales por categoría', () => {
    const r = validateAnalysis({
      overall_pct: 70,
      signals_matched_pct: 60,
      observations: [],
      flags: [],
      claim_corroborated: true,
      integrity_concern_pct: 25,
      english_level_pct: 80,
    });
    expect(r.claim_corroborated).toBe(true);
    expect(r.integrity_concern_pct).toBe(25);
    expect(r.english_level_pct).toBe(80);
  });

  it('limita observations a 6', () => {
    const r = validateAnalysis({
      overall_pct: 50,
      signals_matched_pct: 50,
      observations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      flags: [],
    });
    expect(r.observations.length).toBe(6);
  });
});
