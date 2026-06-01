/**
 * Cliente HTTP para HeyReach API.
 *
 * HeyReach es nuestro proveedor de outbound LinkedIn (envío de invitaciones + DMs).
 * Ver master plan §22 OUTBOUND_SOURCING.
 *
 * Funciones:
 *   - sendDM: mandar mensaje DM a un contacto LinkedIn vía HeyReach
 *   - getCampaignStats: leer stats de una campaña (invites_sent, accepted, replied, etc.)
 *
 * Si las env vars `HEYREACH_API_URL` o `HEYREACH_API_KEY` no están seteadas, todas las
 * funciones devuelven `{ ok: false, error: 'not_configured' }`. Esto evita romper en
 * desarrollo / staging cuando aún no se configuró la integración.
 *
 * Las llamadas pasan por el circuit breaker `heyreach` (threshold 5, cooldown 60s) para
 * no inundar HeyReach con requests rotos cuando hay outages.
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('HEYREACH');

const BREAKER_OPTS = { name: 'heyreach', threshold: 5, cooldownMs: 60_000 };

export type HeyReachResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type SendDMInput = {
  campaign_id: string;
  contact_linkedin_url: string;
  message: string;
};

export type CampaignStats = {
  campaign_id: string;
  invites_sent: number;
  accepted: number;
  replied: number;
  meeting_booked: number;
};

function isConfigured(): boolean {
  const e = env();
  return !!e.HEYREACH_API_URL && !!e.HEYREACH_API_KEY;
}

async function callHeyReach<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
  traceId: string,
): Promise<HeyReachResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'HeyReach not configured (HEYREACH_API_URL + HEYREACH_API_KEY)' };
  }
  const e = env();
  const url = `${e.HEYREACH_API_URL.replace(/\/$/, '')}${path}`;

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          'X-API-KEY': e.HEYREACH_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeoutMs: 15000,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`HeyReach ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('heyreach call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('heyreach call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * Manda un DM via HeyReach a un contacto LinkedIn.
 *
 * NOTA: el endpoint exacto depende de la versión del API de HeyReach. Ajustar `path`
 * cuando se confirme con docs oficiales. Hoy uso `/v1/messages/send` como placeholder
 * razonable.
 */
export async function sendDM(input: SendDMInput, traceId: string): Promise<HeyReachResult<{ message_id: string }>> {
  return callHeyReach<{ message_id: string }>('/v1/messages/send', {
    method: 'POST',
    body: {
      campaign_id: input.campaign_id,
      contact_url: input.contact_linkedin_url,
      message: input.message,
    },
  }, traceId);
}

/**
 * Lee stats de una campaña desde HeyReach. Se usa para refrescar datos en el dashboard
 * cuando la campaña está activa.
 */
export async function getCampaignStats(campaignId: string, traceId: string): Promise<HeyReachResult<CampaignStats>> {
  return callHeyReach<CampaignStats>(`/v1/campaigns/${encodeURIComponent(campaignId)}/stats`, {
    method: 'GET',
  }, traceId);
}

export const _internal = { isConfigured };
