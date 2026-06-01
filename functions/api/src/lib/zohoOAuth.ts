/**
 * Helper para OAuth de Zoho APIs (Recruit, Sign, Bookings, CRM, Meeting).
 *
 * Zoho usa OAuth 2.0 con tokens de acceso de corta duración (1 hora) y refresh tokens
 * que NO expiran. El flow típico:
 *   1. Setup inicial: Cris obtiene refresh_token usando self-client en Zoho Developer Console
 *   2. Cris pega el refresh_token + client_id + client_secret en Catalyst env vars
 *   3. Backend, cuando llama a Zoho API, primero pide un access_token usando refresh_token
 *   4. El access_token se cachea en memoria por 50 minutos (margin antes del expiry)
 *
 * Esta lib hace el paso 3 + 4. Cristian la usa desde cada client (recruitClient,
 * signClient, etc.) para no repetir el OAuth dance.
 *
 * Docs Zoho OAuth: https://www.zoho.com/accounts/protocol/oauth.html
 *
 * Env vars esperadas (configurar en Catalyst Console):
 *   ZOHO_OAUTH_CLIENT_ID
 *   ZOHO_OAUTH_CLIENT_SECRET
 *   ZOHO_OAUTH_REFRESH_TOKEN
 *   ZOHO_OAUTH_DOMAIN (default 'https://accounts.zoho.com' — usar .com.au, .eu, .in según región)
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { logger } from './logger';

const log = logger('ZOHO_OAUTH');

const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min (Zoho expires at 60 min)

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export type ZohoOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  domain?: string; // ej "https://accounts.zoho.com"
};

function getConfig(): ZohoOAuthConfig | null {
  const clientId = process.env.ZOHO_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZOHO_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    domain: process.env.ZOHO_OAUTH_DOMAIN ?? 'https://accounts.zoho.com',
  };
}

/**
 * Devuelve un access_token válido. Refresca automáticamente si está expirado.
 *
 * @returns access_token o null si Zoho OAuth no está configurado
 */
export async function getZohoAccessToken(traceId = ''): Promise<string | null> {
  // Cache hit
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const cfg = getConfig();
  if (!cfg) {
    log.debug('Zoho OAuth not configured', { traceId });
    return null;
  }

  // Refresh: pedimos un nuevo access_token
  const url = `${cfg.domain}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: cfg.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeoutMs: 10_000,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn('Zoho OAuth refresh failed', {
        traceId,
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return null;
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (data.error || !data.access_token) {
      log.warn('Zoho OAuth response invalid', { traceId, error: data.error });
      return null;
    }

    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.min(TOKEN_TTL_MS, ((data.expires_in ?? 3600) - 600) * 1000),
    };

    log.info('Zoho access_token refreshed', {
      traceId,
      expires_in_seconds: data.expires_in,
    });

    return cachedToken.accessToken;
  } catch (err) {
    log.warn('Zoho OAuth refresh threw', {
      traceId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Para uso desde clients (RecruitClient, SignClient, etc.). Devuelve el header
 * Authorization listo para usar.
 *
 * @returns "Zoho-oauthtoken xxx" o null si no configurado
 */
export async function getZohoAuthHeader(traceId = ''): Promise<string | null> {
  const token = await getZohoAccessToken(traceId);
  if (!token) return null;
  return `Zoho-oauthtoken ${token}`;
}

/** Para tests: limpia el cache. */
export function _resetZohoTokenCache() {
  cachedToken = null;
}
