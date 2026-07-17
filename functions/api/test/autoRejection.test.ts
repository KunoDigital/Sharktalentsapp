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

  // === Reglas nuevas Integridad por dimensión (Cris 2026-06-12) ===

  describe('Integridad por dimensión (modelo nuevo)', () => {
    it('hurto en bajo → AUTO-RECHAZO', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'hurto', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
      expect(r.reasons.some((m) => m.includes('hurto'))).toBe(true);
    });

    it('soborno en bajo → AUTO-RECHAZO', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'soborno', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
    });

    it('drogas en bajo → AUTO-RECHAZO', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'drogas', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
    });

    it('alcohol en bajo → AUTO-RECHAZO', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'alcohol', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
    });

    it('confiabilidad en bajo → AUTO-RECHAZO', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'confiabilidad', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
    });

    it('honestidad en bajo → Duda CV (no rechaza auto)', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'honestidad', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(true);
      expect(r.review_reasons.some((m) => m.includes('honestidad'))).toBe(true);
    });

    it('imparcialidad en bajo → Duda CV', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'imparcialidad', classification: 'bajo' },
      ]);
      expect(r.needs_review).toBe(true);
      expect(r.reject).toBe(false);
    });

    it('apuestas en bajo → Duda CV (no es hard reject)', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'apuestas', classification: 'bajo' },
      ]);
      expect(r.needs_review).toBe(true);
      expect(r.reject).toBe(false);
    });

    it('buena_impresion en BAJO → NI rechazo NI duda (Lie scale invertida — bajo = honesto)', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'buena_impresion', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });

    it('buena_impresion en ALTO → Duda CV (posible fingimiento)', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'buena_impresion', classification: 'alto' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(true);
      expect(r.review_reasons.some((m) => m.toLowerCase().includes('fingimiento'))).toBe(true);
    });

    it('buena_impresion en medio → ni rechazo ni duda', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'buena_impresion', classification: 'medio' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });

    it('todas en alto → ni rechazo ni duda', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'hurto', classification: 'alto' },
        { dimension: 'soborno', classification: 'alto' },
        { dimension: 'drogas', classification: 'alto' },
        { dimension: 'honestidad', classification: 'alto' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });

    it('medio en cualquiera → no dispara nada', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'hurto', classification: 'medio' },
        { dimension: 'honestidad', classification: 'medio' },
      ]);
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });

    it('mix: hurto bajo + honestidad bajo → rechaza Y necesita revisión', () => {
      const r = evaluateAutoRejection({}, {}, [
        { dimension: 'hurto', classification: 'bajo' },
        { dimension: 'honestidad', classification: 'bajo' },
      ]);
      expect(r.reject).toBe(true);
      expect(r.needs_review).toBe(true);
      expect(r.reasons.some((m) => m.includes('hurto'))).toBe(true);
      expect(r.review_reasons.some((m) => m.includes('honestidad'))).toBe(true);
    });

    it('hurto bajo prevalece sobre regla legacy integridad_max_riesgo', () => {
      // Si pasamos integrityDims, NO se evalúa la regla legacy por % global
      const r = evaluateAutoRejection(
        { int_overall_pct: 20 }, // riesgo alto global
        { auto_rejection_rules: { integridad_max_riesgo: 30 } },
        [{ dimension: 'imparcialidad', classification: 'bajo' }], // dim review-only
      );
      // No debe disparar reasons por la regla legacy (porque pasamos dimensiones)
      expect(r.reasons.length).toBe(0);
      expect(r.needs_review).toBe(true);
    });
  });

  // === VELNA por dimensión (modelo nuevo Cris 2026-06-12) ===

  describe('VELNA por dimensión (modelo nuevo)', () => {
    it('velna verbal debajo del umbral → reject + razón menciona verbal', () => {
      const r = evaluateAutoRejection(
        { velna_verbal: 42 },
        { auto_rejection_rules: { velna_per_dimension: { verbal: 65 } } },
      );
      expect(r.reject).toBe(true);
      expect(r.reasons.some((m) => m.toLowerCase().includes('verbal'))).toBe(true);
      expect(r.reasons.some((m) => m.includes('65'))).toBe(true);
    });

    it('velna numerica debajo del umbral para puesto contable → reject', () => {
      const r = evaluateAutoRejection(
        { velna_numerica: 55 },
        { auto_rejection_rules: { velna_per_dimension: { numerica: 70 } } },
      );
      expect(r.reject).toBe(true);
      expect(r.reasons.some((m) => m.toLowerCase().includes('numerica'))).toBe(true);
      expect(r.reasons.some((m) => m.includes('70'))).toBe(true);
    });

    it('todas las velna arriba de umbrales → no reject', () => {
      const r = evaluateAutoRejection(
        {
          velna_verbal: 80,
          velna_espacial: 75,
          velna_logica: 90,
          velna_numerica: 72,
          velna_abstracta: 68,
        },
        {
          auto_rejection_rules: {
            velna_per_dimension: {
              verbal: 65,
              espacial: 60,
              logica: 70,
              numerica: 70,
              abstracta: 50,
            },
          },
        },
      );
      expect(r.reject).toBe(false);
      expect(r.reasons.length).toBe(0);
    });

    it('velna_per_dimension no seteada → no se evalúa', () => {
      const r = evaluateAutoRejection(
        { velna_verbal: 10, velna_numerica: 5 },
        { auto_rejection_rules: {} },
      );
      expect(r.reject).toBe(false);
    });

    it('velna_per_dimension.verbal Y velna_min_indice ambos setteados y fallan → 2 razones', () => {
      const r = evaluateAutoRejection(
        { velna_verbal: 40, velna_indice: 35 },
        {
          auto_rejection_rules: {
            velna_per_dimension: { verbal: 65 },
            velna_min_indice: 60,
          },
        },
      );
      expect(r.reject).toBe(true);
      expect(r.reasons.length).toBe(2);
      expect(r.reasons.some((m) => m.toLowerCase().includes('verbal'))).toBe(true);
      expect(r.reasons.some((m) => m.includes('índice') || m.includes('indice'))).toBe(true);
    });

    it('velna_per_dimension.verbal seteado y candidato tiene verbal=0 → reject específico', () => {
      const r = evaluateAutoRejection(
        { velna_verbal: 0 },
        { auto_rejection_rules: { velna_per_dimension: { verbal: 65 } } },
      );
      expect(r.reject).toBe(true);
      expect(r.reasons.some((m) => m.toLowerCase().includes('verbal'))).toBe(true);
      expect(r.reasons.some((m) => m.includes('0'))).toBe(true);
    });

    it('candidato NO tiene velna_verbal (undefined) → no se evalúa (no rompe)', () => {
      const r = evaluateAutoRejection(
        {}, // sin velna_verbal
        { auto_rejection_rules: { velna_per_dimension: { verbal: 65 } } },
      );
      expect(r.reject).toBe(false);
      expect(r.reasons.length).toBe(0);
    });

    it('mix: una dimensión por debajo y otra por encima → reject solo por la que falla', () => {
      const r = evaluateAutoRejection(
        { velna_verbal: 80, velna_numerica: 40 },
        {
          auto_rejection_rules: {
            velna_per_dimension: { verbal: 65, numerica: 70 },
          },
        },
      );
      expect(r.reject).toBe(true);
      expect(r.reasons.length).toBe(1);
      expect(r.reasons.some((m) => m.toLowerCase().includes('numerica'))).toBe(true);
      expect(r.reasons.some((m) => m.toLowerCase().includes('verbal'))).toBe(false);
    });
  });

  // === Inglés → Duda CV (regla nueva 2026-06-12) ===

  describe('Inglés bajo → Duda CV (NO auto-rechazo)', () => {
    it('english_passed=false → Duda CV', () => {
      const r = evaluateAutoRejection({ english_passed: false }, {});
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(true);
      expect(r.review_reasons.some((m) => m.toLowerCase().includes('inglés'))).toBe(true);
    });

    it('english_passed=true → no dispara nada', () => {
      const r = evaluateAutoRejection({ english_passed: true }, {});
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });

    it('english_passed=undefined → no dispara nada (puesto no requiere inglés)', () => {
      const r = evaluateAutoRejection({}, {});
      expect(r.reject).toBe(false);
      expect(r.needs_review).toBe(false);
    });
  });

  // === API shape: campos nuevos siempre presentes ===

  it('return shape incluye needs_review y review_reasons siempre', () => {
    const r = evaluateAutoRejection({}, {});
    expect(r).toHaveProperty('reject');
    expect(r).toHaveProperty('reasons');
    expect(r).toHaveProperty('needs_review');
    expect(r).toHaveProperty('review_reasons');
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(Array.isArray(r.review_reasons)).toBe(true);
  });
});
