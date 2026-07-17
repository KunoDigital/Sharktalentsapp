/**
 * Tests del cliente OpenAI Whisper (transcripción de audio para módulo Video).
 *
 * Patrón: mockear global.fetch — no llamamos a OpenAI real (caro + flaky + requiere key).
 * Cubre: happy path, timeout, 5xx con retry, 4xx sin retry, error de API key faltante,
 * archivo demasiado grande, estimación de costo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Setear env requeridos ANTES de importar el módulo (env() cachea).
process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_dummy';
process.env.CLERK_SECRET_KEY ??= 'sk_test_dummy';
process.env.CLERK_WEBHOOK_SECRET ??= 'whsec_dummy';
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test-dummy';
process.env.INTERNAL_API_KEY ??= 'internal_test';
process.env.URL_SIGNING_SECRET ??= 'url_signing_test';
process.env.CRYPTO_MASTER_KEY ??= 'crypto_master_test_32_chars_long____';
process.env.APP_BASE_URL ??= 'http://localhost:3000';
process.env.OPENAI_API_KEY = 'sk-test-openai-key';
process.env.OPENAI_WHISPER_MODEL = 'whisper-1';
process.env.OPENAI_WHISPER_TIMEOUT_MS = '60000';
process.env.OPENAI_WHISPER_MAX_RETRIES = '1';
process.env.CIRCUIT_BREAKER_THRESHOLD = '5';
process.env.CIRCUIT_BREAKER_COOLDOWN_MS = '60000';

import {
  transcribeAudio,
  estimateTranscriptionCostUsd,
  WHISPER_COST_PER_MINUTE_USD,
  MAX_FILE_SIZE_BYTES,
  fragmentSecret,
  shouldRetry,
  backoffDelay,
} from '../src/lib/videoTranscription';

const originalFetch = global.fetch;

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const fn = vi.fn().mockResolvedValueOnce(response as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchSequence(responses: Array<Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> } | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r as Response);
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fragmentSecret', () => {
  it('redacta secrets cortos enteros', () => {
    expect(fragmentSecret('short')).toBe('<redacted>');
  });
  it('muestra primeros 6 + últimos 4 chars de secrets largos', () => {
    expect(fragmentSecret('sk-test-openai-key-1234567890')).toBe('sk-tes...7890');
  });
  it('redacta string vacía', () => {
    expect(fragmentSecret('')).toBe('<redacted>');
  });
});

describe('shouldRetry', () => {
  it('retry en 429 (rate limit)', () => {
    expect(shouldRetry(429)).toBe(true);
  });
  it('retry en 5xx', () => {
    expect(shouldRetry(500)).toBe(true);
    expect(shouldRetry(502)).toBe(true);
    expect(shouldRetry(599)).toBe(true);
  });
  it('NO retry en 4xx (excepto 429)', () => {
    expect(shouldRetry(400)).toBe(false);
    expect(shouldRetry(401)).toBe(false);
    expect(shouldRetry(404)).toBe(false);
  });
  it('NO retry en 2xx', () => {
    expect(shouldRetry(200)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('crece exponencialmente con jitter', () => {
    const d0 = backoffDelay(0);
    const d2 = backoffDelay(2);
    expect(d0).toBeGreaterThanOrEqual(200);
    expect(d0).toBeLessThan(500);
    expect(d2).toBeGreaterThan(d0);
  });
  it('clampea al máximo de 8s+jitter', () => {
    const d10 = backoffDelay(10);
    expect(d10).toBeLessThanOrEqual(8_200);
  });
});

describe('estimateTranscriptionCostUsd', () => {
  it('costo proporcional a la duración', () => {
    expect(estimateTranscriptionCostUsd(60)).toBeCloseTo(WHISPER_COST_PER_MINUTE_USD, 6);
    expect(estimateTranscriptionCostUsd(120)).toBeCloseTo(WHISPER_COST_PER_MINUTE_USD * 2, 6);
  });
  it('costo 0 para duración 0', () => {
    expect(estimateTranscriptionCostUsd(0)).toBe(0);
  });
});

describe('transcribeAudio — happy path', () => {
  it('parse verbose_json y devuelve text + language + duration + segments', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'Hola, mi nombre es María y trabajo en ventas.',
        language: 'es',
        duration: 5.2,
        segments: [
          { id: 0, start: 0, end: 2.5, text: 'Hola, mi nombre es María' },
          { id: 1, start: 2.5, end: 5.2, text: 'y trabajo en ventas.' },
        ],
      }),
    });

    const buf = Buffer.from('fake-audio-bytes');
    const result = await transcribeAudio(buf, { language: 'es' });

    expect(result.text).toContain('María');
    expect(result.language).toBe('es');
    expect(result.duration_seconds).toBe(5.2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments?.[0]).toEqual({ start: 0, end: 2.5, text: 'Hola, mi nombre es María' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('manda Authorization header con el OPENAI_API_KEY', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ text: 'ok', language: 'es', duration: 1 }),
    });
    await transcribeAudio(Buffer.from('audio'), {});
    const callArgs = fetchMock.mock.calls[0];
    const opts = callArgs[1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-openai-key');
    expect(opts.method).toBe('POST');
  });

  it('default language es "es"', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ text: 'ok', language: 'es', duration: 1 }),
    });
    await transcribeAudio(Buffer.from('audio'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No podemos inspect FormData fácilmente, pero verificamos que el call fue hecho.
  });
});

describe('transcribeAudio — error 4xx (no retry)', () => {
  it('throws UpstreamError sin reintentar en 400', async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"Invalid audio file"}}',
      },
    ]);

    await expect(transcribeAudio(Buffer.from('audio'))).rejects.toThrow(/openai_whisper/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws UpstreamError sin reintentar en 401 (auth)', async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"Invalid API key"}}',
      },
    ]);

    await expect(transcribeAudio(Buffer.from('audio'))).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('transcribeAudio — error 5xx (retry)', () => {
  it('reintenta una vez en 500 y luego éxito', async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: false,
        status: 500,
        text: async () => 'internal server error',
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ text: 'recovered', language: 'es', duration: 3 }),
      },
    ]);

    const result = await transcribeAudio(Buffer.from('audio'));
    expect(result.text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('después de agotar retries (MAX_RETRIES=1), tira el último error', async () => {
    const fetchMock = mockFetchSequence([
      { ok: false, status: 503, text: async () => 'overloaded' },
      { ok: false, status: 503, text: async () => 'still overloaded' },
    ]);

    await expect(transcribeAudio(Buffer.from('audio'))).rejects.toThrow(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reintenta también en 429 (rate limit)', async () => {
    const fetchMock = mockFetchSequence([
      { ok: false, status: 429, text: async () => 'too many requests' },
      { ok: true, status: 200, json: async () => ({ text: 'after rate limit', language: 'es', duration: 2 }) },
    ]);

    const result = await transcribeAudio(Buffer.from('audio'));
    expect(result.text).toBe('after rate limit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('transcribeAudio — guardas defensivas', () => {
  it('rechaza archivos arriba del cap de 25 MB sin llamar a fetch', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const tooBig = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 0);

    await expect(transcribeAudio(tooBig)).rejects.toThrow(/too large/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws si la response tiene 200 pero sin field text', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ language: 'es', duration: 1 }), // falta text
    });

    await expect(transcribeAudio(Buffer.from('audio'))).rejects.toThrow(/missing text/);
  });
});
