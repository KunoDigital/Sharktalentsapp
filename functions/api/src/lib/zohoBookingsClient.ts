/**
 * Cliente HTTP para Zoho Bookings — agendamiento de meetings con cliente.
 *
 * Use case: cuando un cliente nuevo aprueba el contrato, le agendamos automáticamente
 * la reunión de briefing (donde define el perfil del puesto). Después Zia hace
 * transcripción automática + nuestro briefing IA arma el draft.
 *
 * No-op si `ZOHO_BOOKINGS_API_URL` o `ZOHO_BOOKINGS_OAUTH_TOKEN` no están seteados.
 *
 * Pasa por circuit breaker `zoho_bookings` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('ZOHO_BOOKINGS');

const BREAKER_OPTS = { name: 'zoho_bookings', threshold: 5, cooldownMs: 60_000 };

export type ZohoBookingsResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type CreateBookingInput = {
  workspace_id: string;
  service_id: string;
  staff_id?: string;
  customer_email: string;
  customer_name: string;
  customer_phone?: string;
  start_time: string; // ISO 8601
  duration_minutes: number;
  notes?: string;
};

export type Booking = {
  booking_id: string;
  status: string;
  customer_email: string;
  start_time: string;
  meeting_url?: string;
};

function isConfigured(): boolean {
  const e = env();
  return !!e.ZOHO_BOOKINGS_API_URL && !!e.ZOHO_BOOKINGS_OAUTH_TOKEN;
}

async function callBookings<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
  traceId: string,
): Promise<ZohoBookingsResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Zoho Bookings not configured (ZOHO_BOOKINGS_API_URL + ZOHO_BOOKINGS_OAUTH_TOKEN)' };
  }
  const e = env();
  const url = `${e.ZOHO_BOOKINGS_API_URL.replace(/\/$/, '')}${path}`;

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          Authorization: `Zoho-oauthtoken ${e.ZOHO_BOOKINGS_OAUTH_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeoutMs: 15000,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`Bookings ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('zoho bookings call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho bookings call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function createBooking(input: CreateBookingInput, traceId: string): Promise<ZohoBookingsResult<Booking>> {
  return callBookings<Booking>('/bookings', { method: 'POST', body: input }, traceId);
}

export async function getBooking(bookingId: string, traceId: string): Promise<ZohoBookingsResult<Booking>> {
  return callBookings<Booking>(`/bookings/${encodeURIComponent(bookingId)}`, { method: 'GET' }, traceId);
}

export async function cancelBooking(bookingId: string, traceId: string): Promise<ZohoBookingsResult<{ ok: boolean }>> {
  return callBookings<{ ok: boolean }>(`/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' }, traceId);
}

export const _internal = { isConfigured };
