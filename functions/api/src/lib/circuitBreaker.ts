/**
 * Circuit breaker in-memory para servicios externos (Anthropic, Whisper, HeyReach).
 *
 * Estados:
 * - closed: requests pasan normal
 * - open: bloquea todos los requests por cooldown_ms
 * - half_open: permite 1 request "trial"; si pasa → closed; si falla → open de nuevo
 *
 * Trip-on-failure: cuando consecutive_failures ≥ threshold, abre el breaker.
 *
 * Limitación: in-memory por instancia. Si tenés múltiples instancias del backend
 * el state no se comparte (cada una tiene su propio breaker). Para multi-instance
 * habría que mover a Catalyst Cache. Por ahora, single-instance es suficiente.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export type BreakerOptions = {
  threshold: number;       // failures before tripping
  cooldownMs: number;      // tiempo en open antes de pasar a half_open
  name: string;            // identificador (para logs)
};

type Breaker = {
  state: BreakerState;
  consecutive_failures: number;
  opened_at: number | null;
  total_calls: number;
  total_failures: number;
};

const breakers = new Map<string, Breaker>();

function getOrInit(name: string): Breaker {
  let b = breakers.get(name);
  if (!b) {
    b = { state: 'closed', consecutive_failures: 0, opened_at: null, total_calls: 0, total_failures: 0 };
    breakers.set(name, b);
  }
  return b;
}

export class CircuitOpenError extends Error {
  constructor(name: string, openedAt: number) {
    super(`Circuit breaker "${name}" is OPEN since ${new Date(openedAt).toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export async function withBreaker<T>(opts: BreakerOptions, fn: () => Promise<T>): Promise<T> {
  const b = getOrInit(opts.name);
  b.total_calls += 1;

  // Ver si ya pasó el cooldown
  if (b.state === 'open' && b.opened_at != null) {
    const elapsed = Date.now() - b.opened_at;
    if (elapsed >= opts.cooldownMs) {
      // Transition open → half_open. Resetear contador de fallos consecutivos
      // para que el "trial" tenga oportunidad de recovery limpio.
      b.state = 'half_open';
      b.consecutive_failures = 0;
    } else {
      throw new CircuitOpenError(opts.name, b.opened_at);
    }
  }

  try {
    const result = await fn();
    if (b.state === 'half_open') {
      // recovered
      b.state = 'closed';
      b.opened_at = null;
    }
    b.consecutive_failures = 0;
    return result;
  } catch (err) {
    b.consecutive_failures += 1;
    b.total_failures += 1;
    if (b.state === 'half_open' || b.consecutive_failures >= opts.threshold) {
      b.state = 'open';
      b.opened_at = Date.now();
    }
    throw err;
  }
}

export function getBreakerState(name: string): Breaker | null {
  return breakers.get(name) ?? null;
}

export function resetBreaker(name: string): void {
  breakers.delete(name);
}
