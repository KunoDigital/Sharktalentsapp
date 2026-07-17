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

/** Tool definition para forzar output estructurado (sin markdown, sin JSON.parse manual). */
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
};

/** Si seteado a {type:'tool', name:X}, el modelo SIEMPRE llama ese tool. */
export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

export type AnthropicRequest = {
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
};

export type AnthropicUsage = {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
};

/** Bloque del content: text (legacy) o tool_use (cuando se forzó un tool). */
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type AnthropicResponse = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
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

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: req.system,
    messages: req.messages,
    stop_sequences: req.stop_sequences,
  };
  // Tool use: forzar output estructurado server-side. Elimina markdown wrapping,
  // JSON.parse manual y reduce el riesgo de respuestas malformadas.
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
  }
  if (req.tool_choice) {
    body.tool_choice = req.tool_choice;
  }

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
    // Detección de "credit balance too low": Anthropic devuelve 400 con ese mensaje cuando
    // la cuenta se queda sin créditos. Marcamos skipBreaker para que el circuit breaker
    // NO se abra (sino bloquea el ping admin que necesitamos para verificar recarga) y
    // emitimos un SystemAlert visible para que Cris se entere sin debuggear.
    const isBillingError = response.status === 400 && /credit balance is too low/i.test(errBody);
    const err = new UpstreamError('anthropic', `HTTP ${response.status}`, {
      status: response.status,
      body: errBody.slice(0, 500),
      billing_error: isBillingError,
    });
    (err as Error & { retryable?: boolean }).retryable = retryable;
    if (isBillingError) {
      (err as Error & { skipBreaker?: boolean }).skipBreaker = true;
      log.error('ANTHROPIC BILLING: credit balance too low — recharge at console.anthropic.com', {
        traceId,
        body: errBody.slice(0, 200),
      });
    }
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
  /** Job ID si la llamada es atribuible a un puesto (para JobCosts dashboard). */
  jobId?: string;
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
              jobId: ctx.jobId,
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
 * Helper: extrae el texto plano de los bloques de respuesta. Ignora bloques tool_use
 * (esos los maneja `extractToolUse`).
 */
export function extractText(response: AnthropicResponse): string {
  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Helper: extrae el input parseado del primer bloque tool_use con el nombre dado.
 *
 * Cuando se manda `tools` + `tool_choice: {type:'tool', name}`, Anthropic SIEMPRE invoca
 * ese tool y devuelve `content: [{type: 'tool_use', name, input: <parsed JSON>}]`.
 *
 * Ventajas vs extractJson:
 *   - SIN markdown wrapping (no aparece ```json...``` ni warnings al prompt)
 *   - SIN JSON.parse manual (Anthropic ya validó el shape contra el schema server-side)
 *   - Si la respuesta excede maxTokens y el input está incompleto, `stop_reason`
 *     viene como 'max_tokens' y podemos detectarlo explícitamente
 *
 * Lanza error explícito si el tool no fue invocado o el shape es inesperado.
 */
export function extractToolUse<T = Record<string, unknown>>(
  response: AnthropicResponse,
  toolName: string,
): T {
  const toolBlock = response.content.find(
    (c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      c.type === 'tool_use' && c.name === toolName,
  );
  if (!toolBlock) {
    const text = extractText(response).slice(0, 300);
    log.error('extractToolUse: tool not invoked by model', {
      requested_tool: toolName,
      content_types: response.content.map((c) => c.type),
      stop_reason: response.stop_reason,
      text_preview: text,
    });
    throw new Error(`Model did not invoke tool "${toolName}" — stop_reason=${response.stop_reason}`);
  }
  if (response.stop_reason === 'max_tokens') {
    log.warn('extractToolUse: tool input may be incomplete due to max_tokens limit', {
      tool: toolName,
      output_tokens: response.usage?.output_tokens,
    });
  }
  return toolBlock.input as T;
}

/**
 * Helper: parsea JSON dentro de respuesta. El modelo a veces envuelve en ```json ... ```.
 */
export function extractJson<T = unknown>(response: AnthropicResponse): T {
  const text = extractText(response);
  // Estrategia: limpiar markdown fences si existen (apertura y cierre opcionales)
  // y parsear lo que queda. Si la respuesta está truncada (maxTokens agotado), el
  // JSON.parse va a fallar con error que apunta a la posición exacta — eso es bueno
  // para diagnóstico. NO intentamos "reparar" el JSON: el approach firstBrace/lastBrace
  // que probamos antes agarraba el `}` de un object interno cuando el JSON estaba
  // truncado, dando errores confusos como "Expected ',' or ']' at position X".
  let cleaned = text.trim();
  // Sacar fence de apertura ```json o ``` (con o sin newline).
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
  // Sacar fence de cierre si existe al final.
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (firstErr) {
    // 2026-06-29: Claude a veces agrega texto explicativo después del JSON cerrado
    // ("Notas adicionales: ..."). Intentar extraer SOLO el objeto JSON balanceado.
    const balanced = extractBalancedJsonObject(cleaned);
    if (balanced && balanced !== cleaned) {
      try {
        return JSON.parse(balanced) as T;
      } catch {
        // Si el balanced tampoco parsea, caer al log original con el error inicial.
      }
    }
    const parseErr = firstErr;
    // Log obligatorio cuando parsing falla — sin este detalle estamos adivinando.
    // El raw text completo es lo único que permite diagnosticar JSON malformados,
    // truncamientos, escapado mal de comillas, caracteres unicode raros, etc.
    log.error('extractJson failed — dumping raw response for diagnosis', {
      parse_error: (parseErr as Error).message,
      raw_text_length: text.length,
      raw_text_start: text.slice(0, 200),
      raw_text_end: text.slice(-200),
      raw_text_around_error: extractRawAroundError(cleaned, parseErr as Error),
      response_id: response.id,
      stop_reason: response.stop_reason,
      output_tokens: response.usage?.output_tokens,
    });
    throw parseErr;
  }
}

/**
 * Extrae el primer objeto JSON balanceado del texto. Si Claude responde
 * `{"foo": 1}\n\nNotas adicionales: ...`, devuelve solo `{"foo": 1}`.
 * Respeta strings (no cuenta `{` ni `}` dentro de comillas).
 */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Intenta extraer el chunk del text alrededor de la posición donde falló JSON.parse. */
function extractRawAroundError(text: string, err: Error): string {
  const m = /position\s+(\d+)/i.exec(err.message);
  if (!m) return '';
  const pos = Number(m[1]);
  const from = Math.max(0, pos - 200);
  const to = Math.min(text.length, pos + 200);
  return `[...${text.slice(from, pos)}<<<HERE>>>${text.slice(pos, to)}...]`;
}
