import { describe, expect, it, beforeEach } from 'vitest';
import { withBreaker, CircuitOpenError, resetBreaker, getBreakerState } from '../src/lib/circuitBreaker';

const opts = (name: string) => ({ name, threshold: 3, cooldownMs: 100 });

describe('CircuitBreaker', () => {
  beforeEach(() => {
    resetBreaker('test-breaker');
  });

  it('pasa requests cuando todo va bien', async () => {
    const result = await withBreaker(opts('test-breaker'), async () => 'ok');
    expect(result).toBe('ok');
    expect(getBreakerState('test-breaker')?.state).toBe('closed');
  });

  it('abre el breaker después de N fallos consecutivos', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await withBreaker(opts('test-breaker'), async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(getBreakerState('test-breaker')?.state).toBe('open');
  });

  it('rechaza con CircuitOpenError cuando está abierto', async () => {
    // Trip
    for (let i = 0; i < 3; i++) {
      try {
        await withBreaker(opts('test-breaker'), async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    await expect(
      withBreaker(opts('test-breaker'), async () => 'never-runs'),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('pasa a half_open después del cooldown', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await withBreaker(opts('test-breaker'), async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(getBreakerState('test-breaker')?.state).toBe('open');

    // Esperar el cooldown
    await new Promise((r) => setTimeout(r, 110));

    // El próximo request entra en half_open y, si funciona, cierra el breaker
    const result = await withBreaker(opts('test-breaker'), async () => 'recovered');
    expect(result).toBe('recovered');
    expect(getBreakerState('test-breaker')?.state).toBe('closed');
  });

  it('vuelve a abrir si en half_open falla', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await withBreaker(opts('test-breaker'), async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 110));

    try {
      await withBreaker(opts('test-breaker'), async () => {
        throw new Error('still failing');
      });
    } catch {
      // expected
    }
    expect(getBreakerState('test-breaker')?.state).toBe('open');
  });

  it('resetea el contador de fallos cuando un request pasa', async () => {
    // 2 fallos consecutivos
    for (let i = 0; i < 2; i++) {
      try {
        await withBreaker(opts('test-breaker'), async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(getBreakerState('test-breaker')?.consecutive_failures).toBe(2);

    // 1 pase
    await withBreaker(opts('test-breaker'), async () => 'ok');
    expect(getBreakerState('test-breaker')?.consecutive_failures).toBe(0);
  });
});
