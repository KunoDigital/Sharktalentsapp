/**
 * Rate limiter token-bucket in-memory.
 *
 * 2 niveles:
 * - Global per-IP (anon): defensa contra DoS
 * - Per-tenant (authed): cada tenant tiene su propio bucket
 *
 * Limitación: in-memory por instancia. Si Catalyst escala a múltiples instancias
 * el límite es por-instancia (no global). Para hard caps sería necesario mover
 * el state a Catalyst Cache. Por ahora suficiente para evitar abuse trivial.
 */

import { env } from './env';
import { RateLimitError } from './errors';

type Bucket = {
  tokens: number;
  lastRefillAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Verifica que haya un token disponible para la key dada.
 * Si no, lanza RateLimitError con retry-after.
 */
export function consumeToken(key: string, capacity: number, refillPerSec: number): void {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity - 1, lastRefillAt: now };
    buckets.set(key, bucket);
    return;
  }

  // Refill basado en tiempo transcurrido
  const elapsed = (now - bucket.lastRefillAt) / 1000;
  const refilled = elapsed * refillPerSec;
  bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
  bucket.lastRefillAt = now;

  if (bucket.tokens < 1) {
    const retryAfterSec = Math.ceil((1 - bucket.tokens) / refillPerSec);
    throw new RateLimitError(retryAfterSec);
  }
  bucket.tokens -= 1;
}

/**
 * Wrapper standard para endpoints autenticados:
 * - Si hay tenant: usa per-tenant rate
 * - Si no: usa per-IP rate (más restrictivo)
 *
 * Bonus: cada N requests dispara cleanup oportunístico para evitar memory leak.
 * El costo amortizado es mínimo (~0.1% requests).
 */
let requestCounter = 0;
const CLEANUP_EVERY = 1000; // ejecutar cleanup cada 1000 requests
const CLEANUP_MAX_AGE_MS = 10 * 60_000; // limpiar buckets sin uso en >10 min

export function checkRateLimit(opts: {
  tenantId: string | null;
  ip: string;
}): void {
  // Cleanup oportunístico (no bloquea el path crítico — solo pasa cada N requests)
  requestCounter += 1;
  if (requestCounter % CLEANUP_EVERY === 0) {
    const removed = cleanupOld(CLEANUP_MAX_AGE_MS);
    if (removed > 0) {
      // No-op log, intencional: solo medible vía getRateLimiterStats si querés tracking.
      // Evitamos log directo para no spamear.
    }
  }

  const e = env();
  if (opts.tenantId) {
    const limit = e.API_V1_RATE_LIMIT_PER_TENANT;
    const refill = limit / (e.RATE_LIMIT_WINDOW_MS / 1000);
    consumeToken(`tenant:${opts.tenantId}`, limit, refill);
  } else {
    const limit = e.RATE_LIMIT_MAX_REQUESTS;
    const refill = limit / (e.RATE_LIMIT_WINDOW_MS / 1000);
    consumeToken(`ip:${opts.ip}`, limit, refill);
  }
}

/**
 * Limpieza periódica para evitar memory leak con keys de IPs viejas.
 * Llamar desde un timer o desde el handler ocasionalmente.
 */
export function cleanupOld(maxAgeMs = 10 * 60_000): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefillAt > maxAgeMs) {
      buckets.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function getRateLimiterStats(): { total_buckets: number } {
  return { total_buckets: buckets.size };
}
