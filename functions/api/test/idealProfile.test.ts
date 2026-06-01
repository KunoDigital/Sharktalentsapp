import { describe, expect, it } from 'vitest';
import { validateIdealProfile, parseIdealProfile } from '../src/features/jobs';

describe('validateIdealProfile', () => {
  it('null/undefined return null', () => {
    expect(validateIdealProfile(null)).toBe(null);
    expect(validateIdealProfile(undefined)).toBe(null);
  });

  it('rechaza tipos no-objeto', () => {
    expect(() => validateIdealProfile('string')).toThrow();
    expect(() => validateIdealProfile(123)).toThrow();
    expect(() => validateIdealProfile([])).toThrow();
  });

  it('disc válido roundtrip', () => {
    const r = validateIdealProfile({ disc: { d: 65, i: 35, s: 25, c: 75 } });
    expect(r?.disc).toEqual({ d: 65, i: 35, s: 25, c: 75 });
  });

  it('disc fuera de rango falla', () => {
    expect(() => validateIdealProfile({ disc: { d: 150, i: 35, s: 25, c: 75 } })).toThrow();
    expect(() => validateIdealProfile({ disc: { d: -10, i: 35, s: 25, c: 75 } })).toThrow();
  });

  it('preserva pk_code y pk_name', () => {
    const r = validateIdealProfile({
      disc: { d: 50, i: 50, s: 50, c: 50, pk_code: 'PK-09', pk_name: 'Estratega' },
    });
    expect(r?.disc?.pk_code).toBe('PK-09');
    expect(r?.disc?.pk_name).toBe('Estratega');
  });

  it('velna acepta 5 dimensiones', () => {
    const r = validateIdealProfile({
      velna: { verbal: 70, espacial: 60, logica: 80, numerica: 70, abstracta: 65 },
    });
    expect(r?.velna).toEqual({ verbal: 70, espacial: 60, logica: 80, numerica: 70, abstracta: 65 });
  });

  it('competencias valida shape de cada item', () => {
    const r = validateIdealProfile({
      competencias: [{ name: 'Analizar', required_pct: 75 }],
    });
    expect(r?.competencias).toEqual([{ name: 'Analizar', required_pct: 75 }]);
  });

  it('competencia con required_pct inválido falla', () => {
    expect(() => validateIdealProfile({
      competencias: [{ name: 'X', required_pct: 200 }],
    })).toThrow();
  });

  it('tecnica_minimo_pct valida rango', () => {
    expect(validateIdealProfile({ tecnica_minimo_pct: 70 })?.tecnica_minimo_pct).toBe(70);
    expect(() => validateIdealProfile({ tecnica_minimo_pct: -1 })).toThrow();
    expect(() => validateIdealProfile({ tecnica_minimo_pct: 101 })).toThrow();
  });

  it('truncs context_summary a 4000 chars', () => {
    const long = 'x'.repeat(5000);
    const r = validateIdealProfile({ context_summary: long });
    expect(r?.context_summary?.length).toBe(4000);
  });
});

describe('parseIdealProfile', () => {
  it('null/empty string return null', () => {
    expect(parseIdealProfile(null)).toBe(null);
    expect(parseIdealProfile('')).toBe(null);
    expect(parseIdealProfile(undefined)).toBe(null);
  });

  it('JSON inválido return null (no throw)', () => {
    expect(parseIdealProfile('not json')).toBe(null);
    expect(parseIdealProfile('{broken')).toBe(null);
  });

  it('JSON con shape inválida return null', () => {
    expect(parseIdealProfile(JSON.stringify({ disc: { d: 'x' } }))).toBe(null);
  });

  it('JSON válido roundtrip', () => {
    const original = {
      disc: { d: 65, i: 35, s: 25, c: 75 },
      velna: { verbal: 70, espacial: 60, logica: 80, numerica: 70, abstracta: 65 },
      tecnica_minimo_pct: 75,
    };
    const r = parseIdealProfile(JSON.stringify(original));
    expect(r).toEqual(original);
  });
});
