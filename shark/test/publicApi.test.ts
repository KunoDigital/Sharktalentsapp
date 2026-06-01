import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { publicApi } from '../src/lib/publicApi';
import { ApiError } from '../src/lib/api';

// Mock the config module to control useApi flag
vi.mock('../src/config', () => ({
  config: {
    apiBase: 'https://test.example.com/server/api',
    appVersion: 'test',
    appBaseUrl: 'http://localhost:3000',
    clientHostingPath: '/',
    clerkPublishableKey: 'pk_test_test',
    useApi: true,
  },
}));

describe('publicApi.submitTest', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace POST al endpoint correcto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ submitted: ['disc'] }),
    });

    await publicApi.submitTest('test-token-123', {
      disc: { raw_d: 5, raw_i: 3, raw_s: 2, raw_c: 4, total_questions: 14 },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://test.example.com/server/api/test/test-token-123/submit');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('parsea respuesta JSON correctamente', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ submitted: ['velna', 'disc'] }),
    });

    const result = await publicApi.submitTest('t', {
      velna: { verbal: 80, espacial: 70, logica: 75, numerica: 65, abstracta: 70, total: 14, max: 20 },
    });
    expect(result).toEqual({ submitted: ['velna', 'disc'] });
  });

  it('lanza ApiError en respuesta 4xx con código y trace', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'conflict', message: 'DISC already submitted' },
        trace_id: 'trc_xyz',
      }),
    });

    try {
      await publicApi.submitTest('t', { disc: { raw_d: 0, raw_i: 0, raw_s: 0, raw_c: 0, total_questions: 0 } });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.code).toBe('conflict');
      expect(apiErr.traceId).toBe('trc_xyz');
    }
  });

  it('lanza ApiError network_error si fetch falla (después de retries)', async () => {
    // submitTest tiene retry automático (3 intentos en errores 0/5xx/429), así que
    // todos los intentos deben fallar para que llegue el error al caller.
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));
    try {
      await publicApi.submitTest('t', { disc: { raw_d: 0, raw_i: 0, raw_s: 0, raw_c: 0, total_questions: 0 } });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('network_error');
    }
  });

  it('encodeURIComponent del token (caracteres especiales)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ submitted: [] }),
    });

    await publicApi.submitTest('token/with/slashes', {
      tecnica: { total_questions: 10, total_correct: 7 },
    });

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('token%2Fwith%2Fslashes');
  });

  it('soporta payload mezclado disc + anti_cheat', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ submitted: ['disc'] }),
    });

    await publicApi.submitTest('t', {
      disc: { raw_d: 5, raw_i: 3, raw_s: 2, raw_c: 4, total_questions: 14 },
      anti_cheat: {
        count: 2,
        events: [
          { type: 'cursor_out', question_id: 'q5' },
          { type: 'window_blur', question_id: 'q7', duration_ms: 3500 },
        ],
        phase: 'conductual',
      },
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.disc.raw_d).toBe(5);
    expect(body.anti_cheat.count).toBe(2);
    expect(body.anti_cheat.events).toHaveLength(2);
  });
});

describe('publicApi.getTestStatus', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace GET al endpoint correcto sin body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ application_id: 'app_1', pipeline_stage: 'tecnica_completed', expired: false }),
    });

    const result = await publicApi.getTestStatus('abc-token');
    expect(result?.application_id).toBe('app_1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://test.example.com/server/api/test/abc-token');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
  });
});
