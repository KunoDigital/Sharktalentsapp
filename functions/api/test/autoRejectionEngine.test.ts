import { describe, it, expect } from 'vitest';
import { evaluateAutoRejection, evaluateAllRules } from '../src/lib/autoRejectionEngine';

describe('autoRejectionEngine.evaluateAutoRejection', () => {
  it('sin reglas → no rechaza', () => {
    expect(evaluateAutoRejection(null, {})).toEqual({ reject: false });
    expect(evaluateAutoRejection(undefined, {})).toEqual({ reject: false });
    expect(evaluateAutoRejection({}, {})).toEqual({ reject: false });
  });

  it('disc_min_similarity: rechaza si bajo', () => {
    const result = evaluateAutoRejection(
      { disc_min_similarity: 60 },
      { disc_similarity_pct: 55 },
    );
    expect(result.reject).toBe(true);
    if (result.reject) {
      expect(result.rule).toBe('disc_min_similarity');
      expect(result.reason).toMatch(/55%/);
    }
  });

  it('disc_min_similarity: pasa si igual al threshold', () => {
    expect(
      evaluateAutoRejection({ disc_min_similarity: 60 }, { disc_similarity_pct: 60 }),
    ).toEqual({ reject: false });
  });

  it('velna_min_indice: rechaza si bajo', () => {
    const result = evaluateAutoRejection(
      { velna_min_indice: 50 },
      { velna_indice: 30 },
    );
    expect(result.reject).toBe(true);
    if (result.reject) expect(result.rule).toBe('velna_min_indice');
  });

  it('integridad_max_riesgo: rechaza si MAYOR al max', () => {
    // 70% de riesgo > 50% max permitido → rechazar
    const result = evaluateAutoRejection(
      { integridad_max_riesgo: 50 },
      { integridad_riesgo_pct: 70 },
    );
    expect(result.reject).toBe(true);
    if (result.reject) expect(result.rule).toBe('integridad_max_riesgo');
  });

  it('integridad_max_riesgo: pasa si menor', () => {
    expect(
      evaluateAutoRejection({ integridad_max_riesgo: 50 }, { integridad_riesgo_pct: 30 }),
    ).toEqual({ reject: false });
  });

  it('emo_min_score: rechaza si bajo', () => {
    const result = evaluateAutoRejection(
      { emo_min_score: 60 },
      { emo_score: 40 },
    );
    expect(result.reject).toBe(true);
    if (result.reject) expect(result.rule).toBe('emo_min_score');
  });

  it('múltiples reglas, todas pasan', () => {
    expect(
      evaluateAutoRejection(
        {
          disc_min_similarity: 50,
          velna_min_indice: 40,
          integridad_max_riesgo: 70,
          emo_min_score: 50,
        },
        {
          disc_similarity_pct: 80,
          velna_indice: 65,
          integridad_riesgo_pct: 30,
          emo_score: 75,
        },
      ),
    ).toEqual({ reject: false });
  });

  it('múltiples reglas: devuelve la primera que falla', () => {
    const result = evaluateAutoRejection(
      { disc_min_similarity: 80, velna_min_indice: 80 },
      { disc_similarity_pct: 60, velna_indice: 50 }, // ambas fallan
    );
    expect(result.reject).toBe(true);
    if (result.reject) expect(result.rule).toBe('disc_min_similarity'); // primera regla evaluada
  });

  it('regla con threshold pero score null → no rechaza (sin data, no podemos juzgar)', () => {
    expect(
      evaluateAutoRejection({ disc_min_similarity: 60 }, { disc_similarity_pct: null }),
    ).toEqual({ reject: false });
  });
});

describe('autoRejectionEngine.evaluateAllRules', () => {
  it('devuelve evaluación de cada regla', () => {
    const rules = {
      disc_min_similarity: 60,
      velna_min_indice: 50,
      integridad_max_riesgo: 50,
      emo_min_score: 60,
    };
    const scores = {
      disc_similarity_pct: 80, // pasa
      velna_indice: 30, // falla
      integridad_riesgo_pct: 70, // falla (max permitido 50)
      emo_score: 75, // pasa
    };
    const evals = evaluateAllRules(rules, scores);
    expect(evals).toHaveLength(4);
    expect(evals.find((e) => e.rule === 'disc_min_similarity')?.passed).toBe(true);
    expect(evals.find((e) => e.rule === 'velna_min_indice')?.passed).toBe(false);
    expect(evals.find((e) => e.rule === 'integridad_max_riesgo')?.passed).toBe(false);
    expect(evals.find((e) => e.rule === 'emo_min_score')?.passed).toBe(true);
  });

  it('sin reglas → array vacío', () => {
    expect(evaluateAllRules(null, {})).toEqual([]);
    expect(evaluateAllRules(undefined, {})).toEqual([]);
  });
});
