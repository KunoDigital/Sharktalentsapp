/**
 * Cliente OpenAI Whisper — transcripción de audio para el módulo Video.
 *
 * Patrón análogo a `lib/anthropic.ts`: fetch directo (sin SDK), timeout, retries
 * con backoff exponencial, circuit breaker, fragmentSecret en logs.
 *
 * Costo estimado: ~$0.006 por minuto de audio. Para un set de 6 preguntas de 60-90s
 * cada una son ~9 minutos de audio = ~$0.054 por candidato (solo transcripción).
 *
 * NO hay caching — cada transcripción es única por audio. El score 1-10 y la
 * detección de evasivas se hacen en módulos separados (no acá).
 *
 * Uso:
 *   const result = await transcribeAudio(audioBuffer, { language: 'es' });
 *   // result.text, result.duration_seconds, result.segments
 *
 * Limitaciones de Whisper API:
 *   - Tamaño máximo del file: 25 MB (https://platform.openai.com/docs/guides/speech-to-text)
 *   - Formatos: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 *
 * El caller es responsable de:
 *   - extraer el audio del video (si necesario — Whisper acepta video tracks directos en mp4/webm)
 *   - comprimir si el archivo supera 25 MB (ffmpeg/similar fuera del scope de este módulo)
 */

import { env } from './env';
import { withBreaker, CircuitOpenError } from './circuitBreaker';
import { UpstreamError } from './errors';
import { logger } from './logger';

const log = logger('WHISPER');
const BREAKER_NAME = 'openai_whisper';
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB cap impuesto por OpenAI

// ===== Types =====

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptionResult = {
  /** Texto plano completo de la transcripción. */
  text: string;
  /** Código ISO del idioma detectado (ej "es", "en"). */
  language: string;
  /** Duración del audio en segundos. */
  duration_seconds: number;
  /** Segmentos timestamped (solo si response_format=verbose_json — siempre en este módulo). */
  segments?: TranscriptionSegment[];
};

export type TranscribeOptions = {
  /** Hint de idioma (ISO-639-1). Default 'es'. Si null, Whisper detecta. */
  language?: string;
  /** Nombre del archivo a enviar a Whisper. Default 'audio.webm' (la extensión hint el formato). */
  filename?: string;
  /** MIME type. Default 'audio/webm'. Ajustar según el container real. */
  contentType?: string;
  /** Para correlación con logs. */
  traceId?: string;
};

// ===== Internals =====

function fragmentSecret(s: string): string {
  if (!s || s.length < 12) return '<redacted>';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<Response> {
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
  const base = Math.min(8_000, 200 * Math.pow(3, attempt));
  return base + Math.floor(Math.random() * 200);
}

/**
 * Whisper API response shape (verbose_json).
 * Doc: https://platform.openai.com/docs/api-reference/audio/createTranscription
 */
type WhisperVerboseJsonResponse = {
  task?: string;
  language?: string;
  duration?: number;
  text: string;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
};

async function callWhisperOnce(
  audioBuffer: Buffer,
  opts: TranscribeOptions,
): Promise<TranscriptionResult> {
  const e = env();
  const apiKey = e.OPENAI_API_KEY;
  if (!apiKey) {
    throw new UpstreamError('openai_whisper', 'OPENAI_API_KEY not configured');
  }
  if (audioBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new UpstreamError('openai_whisper', `audio file too large: ${audioBuffer.length} bytes (max ${MAX_FILE_SIZE_BYTES})`);
  }

  const filename = opts.filename ?? 'audio.webm';
  const contentType = opts.contentType ?? 'audio/webm';
  const language = opts.language ?? 'es';
  const model = e.OPENAI_WHISPER_MODEL;
  const traceId = opts.traceId ?? '';

  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
  form.append('file', blob, filename);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  const response = await fetchWithTimeout(e.WHISPER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    timeoutMs: e.OPENAI_WHISPER_TIMEOUT_MS,
  });

  if (!response.ok) {
    const errBody = await response.text();
    log.warn('non-2xx response', {
      traceId,
      status: response.status,
      body: errBody.slice(0, 500),
    });
    const retryable = shouldRetry(response.status);
    const err = new UpstreamError('openai_whisper', `HTTP ${response.status}`, {
      status: response.status,
      body: errBody.slice(0, 500),
    });
    (err as Error & { retryable?: boolean }).retryable = retryable;
    throw err;
  }

  const data = (await response.json()) as WhisperVerboseJsonResponse;

  // Defensa: Whisper siempre devuelve text con verbose_json, pero validamos por las dudas.
  if (typeof data.text !== 'string') {
    throw new UpstreamError('openai_whisper', 'response missing text field', {
      shape: Object.keys(data),
    });
  }

  return {
    text: data.text,
    language: data.language ?? language,
    duration_seconds: typeof data.duration === 'number' ? data.duration : 0,
    segments: data.segments?.map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
}

// ===== Costo estimado =====

/** OpenAI Whisper API: $0.006 / minuto al 2026-06-15. https://openai.com/api/pricing/ */
export const WHISPER_COST_PER_MINUTE_USD = 0.006;

export function estimateTranscriptionCostUsd(durationSeconds: number): number {
  return (durationSeconds / 60) * WHISPER_COST_PER_MINUTE_USD;
}

// ===== Función principal =====

export async function transcribeAudio(
  audioBuffer: Buffer,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const e = env();
  const maxRetries = e.OPENAI_WHISPER_MAX_RETRIES;
  const breakerOpts = {
    name: BREAKER_NAME,
    threshold: e.CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs: e.CIRCUIT_BREAKER_COOLDOWN_MS,
  };
  const traceId = opts.traceId ?? '';

  log.debug('request', {
    traceId,
    apiKeyFragment: fragmentSecret(e.OPENAI_API_KEY),
    bytes: audioBuffer.length,
    language: opts.language ?? 'es',
    model: e.OPENAI_WHISPER_MODEL,
  });

  const startTime = Date.now();
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withBreaker(breakerOpts, () => callWhisperOnce(audioBuffer, opts));
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateTranscriptionCostUsd(result.duration_seconds);
      log.info('ok', {
        traceId,
        attempt,
        duration_seconds: result.duration_seconds,
        text_chars: result.text.length,
        language: result.language,
        latency_ms: latencyMs,
        cost_usd_estimated: costUsd.toFixed(5),
      });
      return result;
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

  if (lastErr == null) {
    throw new UpstreamError('openai_whisper', 'No retry attempts succeeded and no error was captured');
  }
  throw lastErr;
}

// ===== Re-exports para tests =====
export { MAX_FILE_SIZE_BYTES, fragmentSecret, shouldRetry, backoffDelay };
