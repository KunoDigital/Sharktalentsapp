/**
 * Cloudflare Turnstile verification helper.
 *
 * Verifica un token de Turnstile (de la landing de marketing) contra la API oficial
 * de Cloudflare. Usado en /api/marketing/eval-request para evitar bots.
 *
 * Env var requerida (privada, NO NEXT_PUBLIC_*):
 *   TURNSTILE_SECRET_KEY
 *
 * Si TURNSTILE_SECRET_KEY no está seteada, la verificación FALLA (no es no-op silencioso).
 * Para development, podés bypass-ar mandando token === 'mock_token' Y dejando la env vacía.
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { logger } from './logger';

const log = logger('TURNSTILE');
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'no_secret' | 'no_token' | 'verification_failed' | 'network_error'; errorCodes?: string[] };

export async function verifyTurnstileToken(token: string, userIP?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    log.warn('TURNSTILE_SECRET_KEY no configurada — todas las verificaciones fallarán');
    return { ok: false, reason: 'no_secret' };
  }
  if (!token) return { ok: false, reason: 'no_token' };

  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', token);
  if (userIP) formData.append('remoteip', userIP);

  try {
    const res = await fetchWithTimeout(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      timeoutMs: 10_000,
    });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (data.success === true) return { ok: true };
    return { ok: false, reason: 'verification_failed', errorCodes: data['error-codes'] };
  } catch (err) {
    log.error('siteverify request failed', { error: (err as Error).message });
    return { ok: false, reason: 'network_error' };
  }
}

/** Helper: dev bypass — solo true si NO hay secret y el token es exactamente 'mock_token'. */
export function isDevBypass(token: string): boolean {
  return !process.env.TURNSTILE_SECRET_KEY && token === 'mock_token';
}
