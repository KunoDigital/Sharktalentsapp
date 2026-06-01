import { describe, expect, it } from 'vitest';
import { shuffleOptions, originalIndex } from '../src/lib/shuffle';

describe('shuffleOptions — Fisher-Yates con reverse map', () => {
  it('preserva todos los elementos (mismas cardinalidad y values)', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const { shuffled } = shuffleOptions(arr, 42);
    expect(shuffled).toHaveLength(4);
    expect([...shuffled].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reverseMap permite recuperar el orden original', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const { shuffled, reverseMap } = shuffleOptions(arr, 42);
    // reverseMap[displayIdx] = originalIdx
    for (let displayIdx = 0; displayIdx < shuffled.length; displayIdx++) {
      const origIdx = reverseMap[displayIdx];
      expect(arr[origIdx]).toBe(shuffled[displayIdx]);
    }
  });

  it('seed reproducible: misma seed → mismo orden', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const r1 = shuffleOptions(arr, 123);
    const r2 = shuffleOptions(arr, 123);
    expect(r1.shuffled).toEqual(r2.shuffled);
    expect(r1.reverseMap).toEqual(r2.reverseMap);
  });

  it('seeds distintos dan ordenes distintos', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const r1 = shuffleOptions(arr, 1);
    const r2 = shuffleOptions(arr, 2);
    expect(r1.shuffled).not.toEqual(r2.shuffled);
  });

  it('1 elemento se shuffflea trivialmente', () => {
    const { shuffled, reverseMap } = shuffleOptions(['only'], 42);
    expect(shuffled).toEqual(['only']);
    expect(reverseMap).toEqual([0]);
  });

  it('array vacío no rompe', () => {
    const { shuffled, reverseMap } = shuffleOptions([], 42);
    expect(shuffled).toEqual([]);
    expect(reverseMap).toEqual([]);
  });
});

describe('originalIndex helper', () => {
  it('traduce display → original correctamente', () => {
    const reverseMap = [2, 0, 3, 1]; // display 0 → orig 2, etc.
    expect(originalIndex(reverseMap, 0)).toBe(2);
    expect(originalIndex(reverseMap, 1)).toBe(0);
    expect(originalIndex(reverseMap, 2)).toBe(3);
    expect(originalIndex(reverseMap, 3)).toBe(1);
  });

  it('índice fuera de rango devuelve el original', () => {
    const reverseMap = [0, 1, 2];
    expect(originalIndex(reverseMap, 99)).toBe(99);
    expect(originalIndex(reverseMap, -1)).toBe(-1);
  });
});

describe('shuffle anti-bias check', () => {
  it('1000 shuffles distribuyen las posiciones uniformemente', () => {
    const positions = [0, 0, 0, 0]; // counter de cuántas veces el item original 0 aparece en cada display position
    const arr = ['target', 'a', 'b', 'c'];

    for (let trial = 0; trial < 1000; trial++) {
      const { shuffled } = shuffleOptions(arr, trial);
      const idx = shuffled.indexOf('target');
      positions[idx]++;
    }

    // Cada posición debería tener ~250 ± tolerancia razonable (chi-square approx)
    for (const count of positions) {
      expect(count).toBeGreaterThan(150);
      expect(count).toBeLessThan(350);
    }
  });
});
