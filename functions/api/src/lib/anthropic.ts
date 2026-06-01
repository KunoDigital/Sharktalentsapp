/**
 * Cliente Anthropic Claude — fetch directo (sin SDK) para tener control total.
 *
 * Soporta:
 * - timeout configurable (default 25s)
 * - retries con backoff exponencial en errores 5xx / 429
 * - circuit breaker (vía lib/circuitBreaker)
 * - prompt caching (header anthropic-beta) cuando ANTHROPIC_CACHING_ENABLED=true
 * - tracking de tokens (logger metric, futuro: tabla TokenUsage)
 *
 * Uso:
 *   const reply = await anthropicMessage({
 *     system: 'You are a helpful assistant.',
 *     messages: [{ role: 'user', content: 'Hi!' }],
 *     maxTokens: 1024,
 *   });
 *   // reply.content[0].text
 */

import { env } from './env';
import { withBreaker, CircuitOpenError } from './circuitBreaker';
import { UpstreamError } from './errors';
import { logger } from './logger';

const log = logger('ANTHROPIC');
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const BREAKER_NAME = 'anthropic';

export type AnthropicRole = 'user' | 'assistant';

export type AnthropicMessage = {
  role: AnthropicRole;
  content: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
};

export type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

export type AnthropicRequest = {
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  stop_sequences?: string[];
};

export type AnthropicUsage = {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
};

export type AnthropicResponse = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: AnthropicUsage;
};

function fragmentSecret(s: string): string {
  if (!s || s.length < 12) return '<redacted>';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeoutMs: number }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function backoffDelay(attempt: number): number {
  // Exponential backoff with jitter: 200ms, 600ms, 1.4s, 3s, ...
  const base = Math.min(8_000, 200 * Math.pow(3, attempt));
  return base + Math.floor(Math.random() * 200);
}

async function callAnthropicOnce(req: AnthropicRequest, traceId: string): Promise<AnthropicResponse> {
  const e = env();
  const model = req.model ?? e.ANTHROPIC_MODEL;
  const maxTokens = req.maxTokens ?? 2048;
  const temperature = req.temperature ?? 0.4;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': e.ANTHROPIC_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (e.ANTHROPIC_CACHING_ENABLED) {
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
  }

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: req.system,
    messages: req.messages,
    stop_sequences: req.stop_sequences,
  };

  const response = await fetchWithTimeout(ANTHROPIC_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeoutMs: e.ANTHROPIC_TIMEOUT_MS,
  });

  if (!response.ok) {
    const errBody = await response.text();
    log.warn('non-2xx response', { traceId, status: response.status, body: errBody.slice(0, 500) });
    const retryable = shouldRetry(response.status);
    const err = new UpstreamError('anthropic', `HTTP ${response.status}`, {
      status: response.status,
      body: errBody.slice(0, 500),
    });
    (err as Error & { retryable?: boolean }).retryable = retryable;
    throw err;
  }

  const data = (await response.json()) as AnthropicResponse;
  return data;
}

export type AnthropicContext = {
  /** Para correlación con logs */
  traceId?: string;
  /** Identificador del feature que llama (ej: "writing_analysis"). Si presente, registra TokenUsage. */
  feature?: string;
  /** Tenant del que viene la llamada (null si es admin/system). */
  tenantId?: string | null;
  /** IncomingMessage para acceder a Catalyst datastore (necesario para registrar TokenUsage). */
  req?: import('http').IncomingMessage;
};

export async function anthropicMessage(
  req: AnthropicRequest,
  traceIdOrCtx: string | AnthropicContext = '',
): Promise<AnthropicResponse> {
  // Backwards compat: aceptamos string (traceId) o objeto AnthropicContext
  const ctx: AnthropicContext = typeof traceIdOrCtx === 'string' ? { traceId: traceIdOrCtx } : traceIdOrCtx;
  const traceId = ctx.traceId ?? '';

  const e = env();
  const maxRetries = e.ANTHROPIC_MAX_RETRIES;
  const breakerOpts = {
    name: BREAKER_NAME,
    threshold: e.CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs: e.CIRCUIT_BREAKER_COOLDOWN_MS,
  };

  log.debug('request', {
    traceId,
    model: req.model ?? e.ANTHROPIC_MODEL,
    apiKeyFragment: fragmentSecret(e.ANTHROPIC_API_KEY),
    msgCount: req.messages.length,
    maxTokens: req.maxTokens,
  });

  const startTime = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await withBreaker(breakerOpts, () => callAnthropicOnce(req, traceId));
      const latencyMs = Date.now() - startTime;
      log.info('ok', {
        traceId,
        attempt,
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_read: res.usage.cache_read_input_tokens ?? 0,
        latency_ms: latencyMs,
      });

      // Track TokenUsage si el caller pasó feature + req (best-effort, no bloquea)
      if (ctx.feature && ctx.req) {
        void (async () => {
          try {
            const { recordTokenUsage } = await import('./tokenUsage.js');
            await recordTokenUsage(ctx.req!, {
              tenantId: ctx.tenantId ?? null,
              feature: ctx.feature!,
              model: req.model ?? e.ANTHROPIC_MODEL,
              inputTokens: res.usage.input_tokens,
              cachedInputTokens: res.usage.cache_read_input_tokens ?? 0,
              outputTokens: res.usage.output_tokens,
              latencyMs,
              traceId,
            });
          } catch {
            // Best-effort — si falla TokenUsage, no rompe la llamada
          }
        })();
      }

      return res;
    } catch (err) {
      lastErr = err;
      if (err instanceof CircuitOpenError) {
        log.warn('circuit open, aborting retries', { traceId });
        throw err;
      }
      const retryable = (err as Error & { retryable?: boolean }).retryable === true;
      if (!retryable || attempt >= maxRetries) {
        throw err;
      }
      const delay = backoffDelay(attempt);
      log.warn('retrying', { traceId, attempt, delayMs: delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // Caso teórico: maxRetries=0 y el primer try saltó al for sin entrar al catch.
  // Defensa: si no hay error capturado (no debería pasar), tirar uno explícito.
  if (lastErr == null) {
    throw new UpstreamError('anthropic', 'No retry attempts succeeded and no error was captured');
  }
  throw lastErr;
}

/**
 * Helper: extrae el texto plano del primer bloque de respuesta.
 */
export function extractText(response: AnthropicResponse): string {
  return response.content.map((c) => c.text).join('\n');
}

/**
 * Helper: parsea JSON dentro de respuesta. El modelo a veces envuelve en ```json ... ```.
 */
export function extractJson<T = unknown>(response: AnthropicResponse): T {
  const text = extractText(response);
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  return JSON.parse(candidate) as T;
}
