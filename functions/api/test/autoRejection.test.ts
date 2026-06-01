import { describe, expect, it } from 'vitest';
import { evaluateAutoRejection } from '../src/lib/autoRejection';

describe('evaluateAutoRejection', () => {
  it('sin reglas → reject=false', () => {
    const r = evaluateAutoRejection({ velna_indice: 50 }, { disc: { d: 50, i: 50, s: 50, c: 50 } });
    expect(r.reject).toBe(false);
  });

  it('sin scores → reject=false (no podemos evaluar)', () => {
    const r = evaluateAutoRejection(null, { auto_rejection_rules: { velna_min_indice: 70 } });
    expect(r.reject).toBe(false);
  });

  it('VELNA debajo del umbral → reject', () => {
    const r = evaluateAutoRejection(
      { velna_indice: 50 },
      { auto_rejection_rules: { velna_min_indice: 70 } },
    );
    expect(r.reject).toBe(true);
    expect(r.reasons.some((m) => m.includes('VELNA'))).toBe(true);
  });

  it('VELNA arriba del umbral → no reject', () => {
    const r = evaluateAutoRejection(
      { velna_indice: 80 },
      { auto_rejection_rules: { velna_min_indice: 70 } },
    );
    expect(r.reject).toBe(false);
  });

  it('integridad % alto → reject', () => {
    const r = evaluateAutoRejection(
      { int_overall_pct: 60 },
      { auto_rejection_rules: { integridad_max_riesgo: 40 } },
    );
    expect(r.reject).toBe(true);
    expect(r.reasons.some((m) => m.includes('Integridad'))).toBe(true);
  });

  it('emocional bajo → reject', () => {
    const r = evaluateAutoRejection(
      { emo_score: 30 },
      { auto_rejection_rules: { emo_min_score: 50 } },
    );
    expect(r.reject).toBe(true);
    expect(r.reasons.some((m) => m.includes('Emocional'))).toBe(true);
  });

  it('multiple reglas falladas → multiple razones', () => {
    const r = evaluateAutoRejection(
      { velna_indice: 30, int_overall_pct: 80, emo_score: 20 },
      {
        auto_rejection_rules: {
          velna_min_indice: 60,
          integridad_max_riesgo: 30,
          emo_min_score: 40,
        },
      },
    );
    expect(r.reject).toBe(true);
    expect(r.reasons.length).toBe(3);
  });

  it('DISC similarity baja → reject (con DISC scores y ideal)', () => {
    const r = evaluateAutoRejection(
      {
        disc_norm_d: 0, disc_norm_i: 100, disc_norm_s: 100, disc_norm_c: 0,
      },
      {
        disc: { d: 100, i: 0, s: 0, c: 100 },
        auto_rejection_rules: { disc_min_similarity: 50 },
      },
    );
    expect(r.reject).toBe(true);
    expect(r.reasons.some((m) => m.includes('DISC'))).toBe(true);
  });

  it('DISC similarity alta → no reject', () => {
    const r = evaluateAutoRejection(
      { disc_norm_d: 70, disc_norm_i: 30, disc_norm_s: 25, disc_norm_c: 75 },
      {
        disc: { d: 70, i: 30, s: 25, c: 75 },
        auto_rejection_rules: { disc_min_similarity: 80 },
      },
    );
    expect(r.reject).toBe(false);
  });

  it('regla seteada pero score ausente → no reject (no se evalúa)', () => {
    const r = evaluateAutoRejection(
      { velna_indice: 80 }, // sin DISC
      {
        disc: { d: 50, i: 50, s: 50, c: 50 },
        auto_rejection_rules: { disc_min_similarity: 90, velna_min_indice: 70 },
      },
    );
    expect(r.reject).toBe(false); // VELNA pasa, DISC no se evalúa
  });
});
