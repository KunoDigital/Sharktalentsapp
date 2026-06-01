import { describe, it, expect } from 'vitest';
import { estimateCostUsd, HAIKU_4_5_COSTS } from '../src/lib/tokenUsage';

describe('tokenUsage.estimateCostUsd', () => {
  it('calcula costo solo con input + output', () => {
    // 1M input + 1M output = $1 + $5 = $6
    const cost = estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(6.0, 4);
  });

  it('cache reduces cost en 90% para input cacheados', () => {
    // 1M input + 1M cached input + 1M output = $1 + $0.10 + $5 = $6.10
    const cost = estimateCostUsd({
      input_tokens: 1_000_000,
      cached_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6.10, 4);
  });

  it('cache puede hacer que un análisis chico sea casi gratis', () => {
    // Llamada típica con cache HIT: 50 input + 5000 cached + 200 output
    // = (50/1M)*1 + (5000/1M)*0.10 + (200/1M)*5
    // = 0.00005 + 0.0005 + 0.001
    // = ~$0.0016
    const cost = estimateCostUsd({
      input_tokens: 50,
      cached_input_tokens: 5000,
      output_tokens: 200,
    });
    expect(cost).toBeLessThan(0.01);
  });

  it('llamada típica writing analyzer: 500 in + 400 out = ~$0.0025', () => {
    const cost = estimateCostUsd({ input_tokens: 500, output_tokens: 400 });
    // (500/1M)*1 + (400/1M)*5 = 0.0005 + 0.002 = 0.0025
    expect(cost).toBeCloseTo(0.0025, 5);
  });

  it('precios HAIKU_4_5_COSTS son los publicados por Anthropic', () => {
    expect(HAIKU_4_5_COSTS.input_per_1m).toBe(1.0);
    expect(HAIKU_4_5_COSTS.output_per_1m).toBe(5.0);
    expect(HAIKU_4_5_COSTS.cached_input_per_1m).toBe(0.10);
  });

  it('cero tokens → cero costo', () => {
    expect(estimateCostUsd({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it('cached_input_tokens undefined no rompe', () => {
    const cost = estimateCostUsd({ input_tokens: 100, output_tokens: 100 });
    expect(cost).toBeGreaterThan(0);
  });
});
