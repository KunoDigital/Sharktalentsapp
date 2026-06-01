import { describe, it, expect } from 'vitest';
import {
  pickRandom,
  pickStratified,
  shuffle,
  ENGLISH_DISTRIBUTION,
} from '../src/lib/questionSelector';

type TestQ = { id: string; type?: 'vocab' | 'grammar' | 'reading'; text: string };

const sampleBank: TestQ[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ id: `v${i}`, type: 'vocab' as const, text: 'vocab' })),
  ...Array.from({ length: 16 }, (_, i) => ({ id: `g${i}`, type: 'grammar' as const, text: 'grammar' })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, type: 'reading' as const, text: 'reading' })),
];

describe('questionSelector.pickRandom', () => {
  it('selecciona N preguntas sin reemplazo', () => {
    const picked = pickRandom(sampleBank, 10);
    expect(picked).toHaveLength(10);
    const uniqueIds = new Set(picked.map((q) => q.id));
    expect(uniqueIds.size).toBe(10);
  });

  it('count >= bank.length devuelve banco entero shuffleado', () => {
    const picked = pickRandom(sampleBank, 100);
    expect(picked).toHaveLength(sampleBank.length);
  });

  it('count <= 0 devuelve array vacío', () => {
    expect(pickRandom(sampleBank, 0)).toEqual([]);
    expect(pickRandom(sampleBank, -5)).toEqual([]);
  });
});

describe('questionSelector.pickStratified', () => {
  it('respeta la distribución por tipo', () => {
    const picked = pickStratified(sampleBank, ENGLISH_DISTRIBUTION);
    expect(picked).toHaveLength(20);

    const counts = { vocab: 0, grammar: 0, reading: 0 };
    for (const q of picked) {
      if (q.type) counts[q.type]++;
    }
    expect(counts.vocab).toBe(8);
    expect(counts.grammar).toBe(8);
    expect(counts.reading).toBe(4);
  });

  it('throws si pides más preguntas de un tipo de las que hay', () => {
    expect(() => pickStratified(sampleBank, { vocab: 100 })).toThrow(/needed 100/);
  });

  it('todas las IDs son únicas', () => {
    const picked = pickStratified(sampleBank, ENGLISH_DISTRIBUTION);
    const ids = new Set(picked.map((q) => q.id));
    expect(ids.size).toBe(picked.length);
  });
});

describe('questionSelector.shuffle', () => {
  it('no muta el array original', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    shuffle(arr);
    expect(arr).toEqual(original);
  });

  it('devuelve un array de la misma longitud y mismos elementos', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled).toHaveLength(arr.length);
    expect([...shuffled].sort()).toEqual([...arr].sort());
  });
});

describe('ENGLISH_DISTRIBUTION', () => {
  it('suma 20 (lo que ve el candidato del banco de 40)', () => {
    const sum = ENGLISH_DISTRIBUTION.vocab + ENGLISH_DISTRIBUTION.grammar + ENGLISH_DISTRIBUTION.reading;
    expect(sum).toBe(20);
  });
});
