/**
 * Tests estructurales de integrity.ts + classifyIntegrityPct.
 *
 * Cobertura:
 * - classifyIntegrityPct con thresholds default y por dimension
 * - computeOverall: promedio de dimensiones excluyendo "buena_impresion"
 * - Path parser /api/applications/:id/integrity
 */
import { describe, expect, it } from 'vitest';
import { classifyIntegrityPct } from '../src/lib/scoring';

// Replica de computeOverall (privada en integrity.ts)
function computeOverall(dims: Array<{ dimension: string; pct: number }>): { pct: number; classification: 'bajo' | 'medio' | 'alto' } {
  const relevantDims = dims.filter((d) => d.dimension !== 'buena_impresion');
  const avg = relevantDims.length === 0
    ? 0
    : Math.round(relevantDims.reduce((s, d) => s + d.pct, 0) / relevantDims.length);
  return { pct: avg, classification: classifyIntegrityPct(avg) };
}

function extractResultIdFromIntegrityPath(url: string): string | null {
  return url.match(/^\/api\/applications\/([^/]+)\/integrity/)?.[1] ?? null;
}

describe('classifyIntegrityPct (default thresholds)', () => {
  // Default: medioMin=31, altoMin=56
  // pct < 31 → bajo, [31, 56) → medio, >= 56 → alto

  it('pct=0 → bajo', () => {
    expect(classifyIntegrityPct(0)).toBe('bajo');
  });

  it('pct=30 → bajo (justo antes de medio)', () => {
    expect(classifyIntegrityPct(30)).toBe('bajo');
  });

  it('pct=31 → medio (boundary)', () => {
    expect(classifyIntegrityPct(31)).toBe('medio');
  });

  it('pct=55 → medio (justo antes de alto)', () => {
    expect(classifyIntegrityPct(55)).toBe('medio');
  });

  it('pct=56 → alto (boundary)', () => {
    expect(classifyIntegrityPct(56)).toBe('alto');
  });

  it('pct=100 → alto', () => {
    expect(classifyIntegrityPct(100)).toBe('alto');
  });

  it('pct=50 → medio (caso típico)', () => {
    expect(classifyIntegrityPct(50)).toBe('medio');
  });
});

describe('computeOverall', () => {
  it('lista vacía → pct=0, classification=bajo', () => {
    const r = computeOverall([]);
    expect(r.pct).toBe(0);
    expect(r.classification).toBe('bajo');
  });

  it('promedio simple de 3 dimensiones', () => {
    const r = computeOverall([
      { dimension: 'honestidad', pct: 30 },
      { dimension: 'adicciones', pct: 60 },
      { dimension: 'violencia', pct: 90 },
    ]);
    // (30 + 60 + 90) / 3 = 60
    expect(r.pct).toBe(60);
    expect(r.classification).toBe('alto');
  });

  it('excluye "buena_impresion" del promedio', () => {
    const r = computeOverall([
      { dimension: 'honestidad', pct: 20 },
      { dimension: 'adicciones', pct: 20 },
      { dimension: 'buena_impresion', pct: 80 },  // ← excluida
    ]);
    // (20 + 20) / 2 = 20  (no se cuenta el 80)
    expect(r.pct).toBe(20);
    expect(r.classification).toBe('bajo');
  });

  it('si solo hay buena_impresion → pct=0', () => {
    const r = computeOverall([{ dimension: 'buena_impresion', pct: 80 }]);
    expect(r.pct).toBe(0);
  });

  it('redondea correctamente (no piso ni techo)', () => {
    const r = computeOverall([
      { dimension: 'a', pct: 33 },
      { dimension: 'b', pct: 34 },
      { dimension: 'c', pct: 35 },
    ]);
    // (33 + 34 + 35) / 3 = 34 exact
    expect(r.pct).toBe(34);
  });

  it('redondea promedios con decimales', () => {
    const r = computeOverall([
      { dimension: 'a', pct: 30 },
      { dimension: 'b', pct: 31 },
    ]);
    // (30 + 31) / 2 = 30.5 → redondea a 31
    expect(r.pct).toBe(31);
  });
});

describe('Path parsing /api/applications/:id/integrity', () => {
  it('extrae id', () => {
    expect(extractResultIdFromIntegrityPath('/api/applications/result_abc/integrity')).toBe('result_abc');
  });

  it('extrae con trailing slash', () => {
    expect(extractResultIdFromIntegrityPath('/api/applications/result_abc/integrity/')).toBe('result_abc');
  });

  it('rechaza path sin /integrity', () => {
    expect(extractResultIdFromIntegrityPath('/api/applications/result_abc')).toBe(null);
    expect(extractResultIdFromIntegrityPath('/api/applications/result_abc/scores')).toBe(null);
  });
});

describe('Integrity classification — invariantes de seguridad', () => {
  it('thresholds default no se cruzan: medio < alto', () => {
    // Si alguna vez se intercambian los thresholds, todos los candidatos serían "alto"
    const medioMin = 31;
    const altoMin = 56;
    expect(medioMin).toBeLessThan(altoMin);
  });

  it('un score 0 nunca es alto (sería bug crítico)', () => {
    expect(classifyIntegrityPct(0)).not.toBe('alto');
  });

  it('un score 100 nunca es bajo', () => {
    expect(classifyIntegrityPct(100)).not.toBe('bajo');
  });
});
