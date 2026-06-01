/**
 * Tests del helper de Cloudflare Turnstile.
 *
 * No hace network calls reales — usa mock de fetchWithTimeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstileToken, isDevBypass } from '../src/lib/turnstile';

vi.mock('../src/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';

const mockFetch = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

describe('verifyTurnstileToken', () => {
  const origSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    if (origSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = origSecret;
  });

  it('devuelve no_secret cuando TURNSTILE_SECRET_KEY no está seteada', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstileToken('any_token');
    expect(result).toEqual({ ok: false, reason: 'no_secret' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('devuelve no_token cuando el token es string vacío', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test_secret';
    const result = await verifyTurnstileToken('');
    expect(result).toEqual({ ok: false, reason: 'no_token' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('devuelve ok cuando Cloudflare confirma el challenge', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test_secret';
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    });
    const result = await verifyTurnstileToken('valid_token');
    expect(result).toEqual({ ok: true });
  });

  it('devuelve verification_failed con error codes cuando Cloudflare rechaza', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test_secret';
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const result = await verifyTurnstileToken('bad_token');
    expect(result).toEqual({
      ok: false,
      reason: 'verification_failed',
      errorCodes: ['invalid-input-response'],
    });
  });

  it('devuelve network_error cuando el fetch tira excepción', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test_secret';
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await verifyTurnstileToken('any_token');
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  it('manda el userIP a Cloudflare si se pasa como argumento', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test_secret';
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    });
    await verifyTurnstileToken('any_token', '1.2.3.4');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body as string).toContain('remoteip=1.2.3.4');
  });
});

describe('isDevBypass', () => {
  const origSecret = process.env.TURNSTILE_SECRET_KEY;
  afterEach(() => {
    if (origSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = origSecret;
  });

  it('true solo cuando NO hay secret Y el token es exactamente mock_token', () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isDevBypass('mock_token')).toBe(true);
  });

  it('false cuando hay secret seteada (no permitimos bypass en prod)', () => {
    process.env.TURNSTILE_SECRET_KEY = 'real_secret';
    expect(isDevBypass('mock_token')).toBe(false);
  });

  it('false cuando el token no es mock_token', () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isDevBypass('any_other_token')).toBe(false);
    expect(isDevBypass('')).toBe(false);
  });
});
