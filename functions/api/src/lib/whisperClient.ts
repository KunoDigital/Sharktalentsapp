/**
 * Whisper transcription wrapper.
 *
 * Acepta URL de audio (Catalyst File Store, Zoho Drive, etc.) o buffer in-memory.
 * Retorna transcript en texto plano.
 *
 * Default: usa la API de OpenAI Whisper (requiere `WHISPER_API_KEY` env var).
 * Alternativa: cualquier endpoint compatible con la spec de Whisper.
 *
 * Use cases:
 *   - Transcript del briefing cliente (Zia ya hace esto, este es fallback si Zia falla)
 *   - Transcript de videos del candidato (para análisis IA cuando el video tiene audio)
 *
 * No-op si `WHISPER_API_KEY` no está seteado → devuelve error explícito.
 *
 * Pasa por circuit breaker `whisper` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('WHISPER');

const BREAKER_OPTS = { name: 'whisper', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 120_000; // 2 min — Whisper puede tardar en archivos largos

export type TranscribeResult =
  | { ok: true; text: string; duration_seconds?: number; language?: string }
  | { ok: false; error: string };

export type TranscribeInput = {
  audio_buffer: Buffer;
  mime_type: string;            // ej: 'audio/mpeg', 'audio/wav', 'video/mp4'
  filename?: string;
  language_hint?: string;       // ISO 639-1 ej: 'es', 'en'
};

function isConfigured(): boolean {
  return !!env().WHISPER_API_KEY;
}

export async function transcribeAudio(input: TranscribeInput, traceId: string): Promise<TranscribeResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'Whisper not configured (WHISPER_API_KEY missing)' };
  }

  const e = env();

  // Construir multipart form-data manualmente (no FormData en Node sin polyfill seguro)
  const boundary = `----WhisperBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const filename = input.filename ?? 'audio.bin';
  const parts: Buffer[] = [];

  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${input.mime_type}\r\n\r\n`,
  ));
  parts.push(input.audio_buffer);
  parts.push(Buffer.from('\r\n'));

  // model field
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1\r\n`,
  ));

  // response_format json (default but explicit)
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
    `verbose_json\r\n`,
  ));

  // language hint si viene
  if (input.language_hint) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `${input.language_hint}\r\n`,
    ));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(e.WHISPER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${e.WHISPER_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Whisper ${response.status}: ${text.slice(0, 200)}`);
      }
      return (await response.json()) as { text: string; duration?: number; language?: string };
    });

    log.info('whisper transcribe ok', {
      traceId,
      duration: result.duration,
      language: result.language,
      text_chars: result.text?.length ?? 0,
    });

    return {
      ok: true,
      text: result.text ?? '',
      duration_seconds: result.duration,
      language: result.language,
    };
  } catch (err) {
    const e = err as Error;
    log.warn('whisper transcribe failed', { traceId, error: e.message });
    return { ok: false, error: e.message };
  }
}

export const _internal = { isConfigured };
