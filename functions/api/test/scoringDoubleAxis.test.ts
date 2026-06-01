import { describe, expect, it } from 'vitest';
import {
  scoreTechnicalDoubleAxis,
  matchStyleWithBoss,
  validateSituationalQuestion,
  type TechnicalQuestionDoubleAxis,
} from '../src/lib/scoring';

const techQ = (id: string, correct: number): TechnicalQuestionDoubleAxis => ({
  id, kind: 'technical',
  text: 'Q', options: ['A', 'B', 'C', 'D'], correct,
});

const sitQ = (id: string): TechnicalQuestionDoubleAxis => ({
  id, kind: 'situational',
  text: 'Scenario', options: ['actuar', 'consultar', 'mentir', 'ignorar'],
  option_validity: [true, true, false, false],
  option_style: [
    { axis: 'autonomy_vs_consult', value: 'autonomy' },
    { axis: 'autonomy_vs_consult', value: 'consult' },
    null, null,
  ],
});

describe('scoreTechnicalDoubleAxis — technical block', () => {
  it('cuenta correctas en preguntas technical', () => {
    const qs = [techQ('t1', 0), techQ('t2', 1), techQ('t3', 2)];
    const ans = { t1: 0, t2: 1, t3: 0 }; // 2 correctas
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.technical.correct).toBe(2);
    expect(r.technical.total).toBe(3);
    expect(r.technical.score_pct).toBe(67);
    expect(r.technical.passed).toBe(true);
  });

  it('passed=false si below minRequired', () => {
    const qs = [techQ('t1', 0), techQ('t2', 1)];
    const ans = { t1: 0 };
    const r = scoreTechnicalDoubleAxis(qs, ans, 80);
    expect(r.technical.score_pct).toBe(50);
    expect(r.technical.passed).toBe(false);
  });

  it('sin technical questions → pct=0, passed=false (50% < 0)', () => {
    const r = scoreTechnicalDoubleAxis([], {}, 50);
    expect(r.technical.score_pct).toBe(0);
    expect(r.technical.total).toBe(0);
  });
});

describe('scoreTechnicalDoubleAxis — situational validity', () => {
  it('cuenta selecciones de opciones VÁLIDAS', () => {
    const qs = [sitQ('s1'), sitQ('s2'), sitQ('s3')];
    const ans = { s1: 0, s2: 1, s3: 2 }; // s3 es inválida
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.situational_validity.valid).toBe(2);
    expect(r.situational_validity.score_pct).toBe(67);
  });

  it('todas válidas = 100%', () => {
    const qs = [sitQ('s1'), sitQ('s2')];
    const ans = { s1: 0, s2: 1 };
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.situational_validity.score_pct).toBe(100);
  });
});

describe('scoreTechnicalDoubleAxis — style axis', () => {
  it('todas autonomy → 1.0', () => {
    const qs = [sitQ('s1'), sitQ('s2')];
    const ans = { s1: 0, s2: 0 };
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.style.autonomy_vs_consult).toBe(1);
  });

  it('todas consult → 0.0', () => {
    const qs = [sitQ('s1'), sitQ('s2')];
    const ans = { s1: 1, s2: 1 };
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.style.autonomy_vs_consult).toBe(0);
  });

  it('mitad y mitad → 0.5', () => {
    const qs = [sitQ('s1'), sitQ('s2')];
    const ans = { s1: 0, s2: 1 };
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    expect(r.style.autonomy_vs_consult).toBe(0.5);
  });

  it('selecciones inválidas no cuentan en estilo', () => {
    const qs = [sitQ('s1'), sitQ('s2')];
    const ans = { s1: 0, s2: 2 }; // s2 inválida
    const r = scoreTechnicalDoubleAxis(qs, ans, 50);
    // Solo 1 respuesta válida (autonomy) → 1/1 = 1
    expect(r.style.autonomy_vs_consult).toBe(1);
    expect(r.style.total_situational_answered).toBe(1);
  });

  it('sin situacionales respondidas → null', () => {
    const r = scoreTechnicalDoubleAxis([sitQ('s1')], {}, 50);
    expect(r.style.autonomy_vs_consult).toBe(null);
  });
});

describe('matchStyleWithBoss', () => {
  it('estilos iguales = 100', () => {
    expect(matchStyleWithBoss(0.7, 0.7)?.match_pct).toBe(100);
  });

  it('polos opuestos = 0', () => {
    expect(matchStyleWithBoss(0, 1)?.match_pct).toBe(0);
  });

  it('candidato autonomy alto + jefe autonomy alto → match natural', () => {
    const r = matchStyleWithBoss(0.69, 0.75);
    expect(r?.match_pct).toBeGreaterThanOrEqual(90);
    expect(r?.interpretation).toContain('Match natural');
  });

  it('candidato autonomy bajo + jefe autonomy alto → riesgo de parálisis', () => {
    const r = matchStyleWithBoss(0.1, 0.9);
    expect(r?.match_pct).toBeLessThan(50);
    expect(r?.interpretation).toContain('parálisis');
  });

  it('candidato proactivo + jefe controlador → fricción', () => {
    const r = matchStyleWithBoss(0.9, 0.1);
    expect(r?.interpretation).toContain('fricción');
  });

  it('candidate=null → null', () => {
    expect(matchStyleWithBoss(null, 0.5)).toBe(null);
  });

  it('boss=null → null', () => {
    expect(matchStyleWithBoss(0.5, null)).toBe(null);
  });

  it('clamp valores fuera de rango', () => {
    const r = matchStyleWithBoss(1.5, -0.2);
    // candidate=1, boss=0 → distance=1 → match_pct=0
    expect(r?.match_pct).toBe(0);
  });
});

describe('validateSituationalQuestion', () => {
  const valid = {
    id: 's1',
    kind: 'situational',
    text: 'foo',
    options: ['a', 'b', 'c', 'd'],
    option_validity: [true, true, false, false],
    option_style: [
      { axis: 'autonomy_vs_consult', value: 'autonomy' },
      { axis: 'autonomy_vs_consult', value: 'consult' },
      null, null,
    ],
  };

  it('shape correcto pasa', () => {
    expect(validateSituationalQuestion(valid)).toBe(true);
  });

  it('rechaza si las 2 válidas son ambas autonomy', () => {
    const bad = {
      ...valid,
      option_style: [
        { axis: 'autonomy_vs_consult', value: 'autonomy' },
        { axis: 'autonomy_vs_consult', value: 'autonomy' },
        null, null,
      ],
    };
    expect(validateSituationalQuestion(bad)).toBe(false);
  });

  it('rechaza si validity tiene 3 válidas', () => {
    const bad = { ...valid, option_validity: [true, true, true, false] };
    expect(validateSituationalQuestion(bad)).toBe(false);
  });

  it('rechaza si una válida tiene style null', () => {
    const bad = {
      ...valid,
      option_style: [
        null,
        { axis: 'autonomy_vs_consult', value: 'consult' },
        null, null,
      ],
    };
    expect(validateSituationalQuestion(bad)).toBe(false);
  });

  it('rechaza si una inválida tiene style asignado', () => {
    const bad = {
      ...valid,
      option_style: [
        { axis: 'autonomy_vs_consult', value: 'autonomy' },
        { axis: 'autonomy_vs_consult', value: 'consult' },
        { axis: 'autonomy_vs_consult', value: 'autonomy' },
        null,
      ],
    };
    expect(validateSituationalQuestion(bad)).toBe(false);
  });

  it('rechaza axis distinto a autonomy_vs_consult', () => {
    const bad = {
      ...valid,
      option_style: [
        { axis: 'speed_vs_thoroughness', value: 'autonomy' },
        { axis: 'autonomy_vs_consult', value: 'consult' },
        null, null,
      ],
    };
    expect(validateSituationalQuestion(bad)).toBe(false);
  });

  it('rechaza kind=technical', () => {
    expect(validateSituationalQuestion({ ...valid, kind: 'technical' })).toBe(false);
  });
});
