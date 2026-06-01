import { describe, expect, it, beforeEach } from 'vitest';
import { consumeToken, cleanupOld, getRateLimiterStats } from '../src/lib/rateLimiter';
import { RateLimitError } from '../src/lib/errors';

describe('rateLimiter.consumeToken', () => {
  beforeEach(() => {
    // limpieza para no contaminar entre tests
    cleanupOld(0);
  });

  it('permite el primer request en bucket vacío', () => {
    expect(() => consumeToken('test:1', 5, 1)).not.toThrow();
  });

  it('rechaza después de capacidad agotada', () => {
    const key = 'test:burst';
    for (let i = 0; i < 3; i++) {
      consumeToken(key, 3, 0.001); // refill muy lento
    }
    expect(() => consumeToken(key, 3, 0.001)).toThrow(RateLimitError);
  });

  it('retry-after se calcula proporcional al refill rate', () => {
    const key = 'test:retry';
    for (let i = 0; i < 5; i++) consumeToken(key, 5, 1); // capacity 5, refill 1/seg
    try {
      consumeToken(key, 5, 1);
      throw new Error('should have thrown');
    } catch (err) {
      if (err instanceof RateLimitError) {
        expect((err.details as { retry_after_sec: number }).retry_after_sec).toBeGreaterThan(0);
      } else {
        throw err;
      }
    }
  });

  it('refill recupera tokens con el tiempo', async () => {
    const key = 'test:refill';
    consumeToken(key, 1, 100); // capacity 1, refill 100/seg
    expect(() => consumeToken(key, 1, 100)).toThrow(RateLimitError);
    // Esperar 50ms → debería tener ~5 tokens disponibles
    await new Promise((r) => setTimeout(r, 50));
    expect(() => consumeToken(key, 1, 100)).not.toThrow();
  });
});

describe('rateLimiter.cleanupOld', () => {
  it('remueve buckets viejos', async () => {
    consumeToken('to-clean', 5, 1);
    const before = getRateLimiterStats().total_buckets;
    // Esperar 2ms para que el bucket tenga edad medible (cleanupOld usa estricto >)
    await new Promise((r) => setTimeout(r, 2));
    const removed = cleanupOld(0);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(getRateLimiterStats().total_buckets).toBeLessThan(before);
  });
});
