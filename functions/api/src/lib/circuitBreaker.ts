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
    // Errores que no deberían abrir el breaker: facturación, validación del caller, etc.
    // Detectados por flag `skipBreaker=true` en el error. Estos errores fluyen al caller
    // sin ensuciar el estado del breaker (sino, p.ej., "credit balance too low" en Anthropic
    // bloquea TODO el sistema hasta que termine el cooldown — incluyendo el ping para
    // verificar si se recargaron créditos).
    const skipBreaker = (err as Error & { skipBreaker?: boolean }).skipBreaker === true;
    if (!skipBreaker) {
      b.consecutive_failures += 1;
      b.total_failures += 1;
      if (b.state === 'half_open' || b.consecutive_failures >= opts.threshold) {
        b.state = 'open';
        b.opened_at = Date.now();
      }
    }
    throw err;
  }
}

export function getBreakerState(name: string): Breaker | null {
  return breakers.get(name) ?? null;
}

export function listBreakers(): Array<{ name: string; state: BreakerState; consecutive_failures: number; opened_at: number | null; total_calls: number; total_failures: number }> {
  return Array.from(breakers.entries()).map(([name, b]) => ({
    name,
    state: b.state,
    consecutive_failures: b.consecutive_failures,
    opened_at: b.opened_at,
    total_calls: b.total_calls,
    total_failures: b.total_failures,
  }));
}

export function resetBreaker(name: string): void {
  breakers.delete(name);
}
