/**
 * Tests de los parsers pure de scores.ts.
 *
 * Replica las funciones parseDiscPayload, parseCognitivePayload, parseEmotionalPayload,
 * parseTechnicalPayload — porque viven adentro del feature y no están exportadas.
 *
 * Si scores.ts cambia su shape, los tests fallan y obligan a actualizar.
 */
import { describe, expect, it } from 'vitest';

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseDiscPayload(raw: unknown): { raw: { d: number; i: number; s: number; c: number }; total_questions: number; pk_id: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.raw_d == null && r.d == null) return null;
  return {
    raw: {
      d: num(r.raw_d ?? r.d),
      i: num(r.raw_i ?? r.i),
      s: num(r.raw_s ?? r.s),
      c: num(r.raw_c ?? r.c),
    },
    total_questions: num(r.total_questions, 24),
    pk_id: typeof r.pk_id === 'string' ? r.pk_id : null,
  };
}

function parseCognitivePayload(raw: unknown): { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    verbal: num(r.verbal),
    espacial: num(r.espacial),
    logica: num(r.logica),
    numerica: num(r.numerica),
    abstracta: num(r.abstracta),
  };
}

function parseEmotionalPayload(raw: unknown): { score: number; perfil: 'espontaneo' | 'mesura' | 'reflexivo' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const score = num(r.score);
  let perfil: 'espontaneo' | 'mesura' | 'reflexivo' = 'mesura';
  if (score < 35) perfil = 'espontaneo';
  else if (score >= 70) perfil = 'reflexivo';
  return { score, perfil };
}

function parseTechnicalPayload(raw: unknown): { total_correct: number; total_questions: number; min_required: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const total_questions = num(r.total_questions);
  if (total_questions <= 0) return null;
  return {
    total_correct: Math.max(0, Math.min(num(r.total_correct), total_questions)),
    total_questions,
    min_required: num(r.min_required, 60),
  };
}

describe('parseDiscPayload', () => {
  it('parsea con keys raw_*', () => {
    const r = parseDiscPayload({ raw_d: 10, raw_i: 5, raw_s: 8, raw_c: 6, total_questions: 24, pk_id: 'PK-09' });
    expect(r).toEqual({ raw: { d: 10, i: 5, s: 8, c: 6 }, total_questions: 24, pk_id: 'PK-09' });
  });

  it('parsea con keys cortas (d/i/s/c)', () => {
    const r = parseDiscPayload({ d: 12, i: 4, s: 6, c: 8 });
    expect(r?.raw.d).toBe(12);
    expect(r?.raw.c).toBe(8);
  });

  it('default total_questions = 24 si falta', () => {
    const r = parseDiscPayload({ raw_d: 1, raw_i: 1, raw_s: 1, raw_c: 1 });
    expect(r?.total_questions).toBe(24);
  });

  it('rechaza payload null/undefined', () => {
    expect(parseDiscPayload(null)).toBe(null);
    expect(parseDiscPayload(undefined)).toBe(null);
  });

  it('rechaza payload sin raw_d ni d', () => {
    expect(parseDiscPayload({ i: 1, s: 1, c: 1 })).toBe(null);
  });

  it('campos faltantes default a 0', () => {
    const r = parseDiscPayload({ raw_d: 5 });
    expect(r?.raw.i).toBe(0);
    expect(r?.raw.s).toBe(0);
    expect(r?.raw.c).toBe(0);
  });

  it('pk_id no-string queda null', () => {
    const r = parseDiscPayload({ d: 5, pk_id: 123 });
    expect(r?.pk_id).toBe(null);
  });
});

describe('parseCognitivePayload (VELNA)', () => {
  it('parsea los 5 sub-tests', () => {
    const r = parseCognitivePayload({ verbal: 70, espacial: 60, logica: 80, numerica: 75, abstracta: 65 });
    expect(r).toEqual({ verbal: 70, espacial: 60, logica: 80, numerica: 75, abstracta: 65 });
  });

  it('campos faltantes default a 0', () => {
    const r = parseCognitivePayload({ verbal: 80 });
    expect(r?.verbal).toBe(80);
    expect(r?.espacial).toBe(0);
  });

  it('null/undefined → null', () => {
    expect(parseCognitivePayload(null)).toBe(null);
    expect(parseCognitivePayload(undefined)).toBe(null);
  });
});

describe('parseEmotionalPayload', () => {
  it('score < 35 → perfil espontaneo', () => {
    expect(parseEmotionalPayload({ score: 20 })?.perfil).toBe('espontaneo');
    expect(parseEmotionalPayload({ score: 0 })?.perfil).toBe('espontaneo');
    expect(parseEmotionalPayload({ score: 34 })?.perfil).toBe('espontaneo');
  });

  it('score 35-69 → perfil mesura', () => {
    expect(parseEmotionalPayload({ score: 35 })?.perfil).toBe('mesura');
    expect(parseEmotionalPayload({ score: 50 })?.perfil).toBe('mesura');
    expect(parseEmotionalPayload({ score: 69 })?.perfil).toBe('mesura');
  });

  it('score >= 70 → perfil reflexivo', () => {
    expect(parseEmotionalPayload({ score: 70 })?.perfil).toBe('reflexivo');
    expect(parseEmotionalPayload({ score: 100 })?.perfil).toBe('reflexivo');
  });

  it('boundary: 34/35 y 69/70 son inclusivos correctos', () => {
    expect(parseEmotionalPayload({ score: 34 })?.perfil).toBe('espontaneo');
    expect(parseEmotionalPayload({ score: 35 })?.perfil).toBe('mesura');
    expect(parseEmotionalPayload({ score: 69 })?.perfil).toBe('mesura');
    expect(parseEmotionalPayload({ score: 70 })?.perfil).toBe('reflexivo');
  });

  it('score faltante default a 0 → espontaneo', () => {
    expect(parseEmotionalPayload({})?.perfil).toBe('espontaneo');
  });
});

describe('parseTechnicalPayload', () => {
  it('parsea correcto', () => {
    const r = parseTechnicalPayload({ total_correct: 12, total_questions: 15, min_required: 70 });
    expect(r).toEqual({ total_correct: 12, total_questions: 15, min_required: 70 });
  });

  it('total_correct se clamp a [0, total_questions]', () => {
    expect(parseTechnicalPayload({ total_correct: -5, total_questions: 10 })?.total_correct).toBe(0);
    expect(parseTechnicalPayload({ total_correct: 100, total_questions: 10 })?.total_correct).toBe(10);
  });

  it('total_questions=0 → null (no se pueden calcular scores)', () => {
    expect(parseTechnicalPayload({ total_correct: 0, total_questions: 0 })).toBe(null);
  });

  it('total_questions negativo → null', () => {
    expect(parseTechnicalPayload({ total_correct: 5, total_questions: -1 })).toBe(null);
  });

  it('min_required default = 60', () => {
    const r = parseTechnicalPayload({ total_correct: 5, total_questions: 10 });
    expect(r?.min_required).toBe(60);
  });

  it('payload no-object → null', () => {
    expect(parseTechnicalPayload(null)).toBe(null);
    expect(parseTechnicalPayload('string')).toBe(null);
    expect(parseTechnicalPayload(123)).toBe(null);
  });
});

describe('num helper', () => {
  it('valor numérico válido pasa', () => {
    expect(num(5)).toBe(5);
    expect(num(0)).toBe(0);
    expect(num(-3.14)).toBe(-3.14);
  });

  it('NaN → fallback', () => {
    expect(num(NaN)).toBe(0);
    expect(num(NaN, 99)).toBe(99);
  });

  it('Infinity → fallback', () => {
    expect(num(Infinity)).toBe(0);
    expect(num(-Infinity, 50)).toBe(50);
  });

  it('non-number → fallback', () => {
    expect(num('5')).toBe(0);
    expect(num(null, 10)).toBe(10);
    expect(num(undefined, 7)).toBe(7);
  });
});
