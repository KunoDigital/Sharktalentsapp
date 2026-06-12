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
  options: { method: 'GET' | 'POST'; body?: unknown; bodyAsForm?: boolean },
  traceId: string,
): Promise<ZohoBookingsResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Zoho Bookings not configured (ZOHO_BOOKINGS_API_URL + ZOHO_BOOKINGS_OAUTH_TOKEN)' };
  }
  const e = env();
  const url = `${e.ZOHO_BOOKINGS_API_URL.replace(/\/$/, '')}${path}`;

  // Zoho Bookings v1 espera form-urlencoded con un campo `data` que tiene JSON
  // stringificado adentro. Es muy distinto a un REST tradicional con JSON body.
  // Bandera bodyAsForm controla esto por endpoint.
  const isForm = options.bodyAsForm === true;
  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${e.ZOHO_BOOKINGS_OAUTH_TOKEN}`,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    if (isForm) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      params.set('data', JSON.stringify(options.body));
      body = params.toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers,
        body,
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
  // Zoho Bookings v1 — endpoint correcto es `/appointment` (NO `/bookings`).
  // El body va form-urlencoded con un campo `data` que tiene este shape JSON:
  //   { service_id, staff_id?, from_time, customer_details: { name, email, phone_number } }
  // from_time formato: 'dd-MMM-yyyy HH:mm:ss' (ej. '06-Jun-2026 15:00:00'). NO ISO 8601.
  const startDate = new Date(input.start_time);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const fromTime = `${pad(startDate.getDate())}-${months[startDate.getMonth()]}-${startDate.getFullYear()} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:${pad(startDate.getSeconds())}`;
  const zohoBody = {
    service_id: input.service_id,
    ...(input.staff_id ? { staff_id: input.staff_id } : {}),
    from_time: fromTime,
    customer_details: {
      name: input.customer_name,
      email: input.customer_email,
      ...(input.customer_phone ? { phone_number: input.customer_phone } : {}),
    },
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const result = await callBookings<Record<string, unknown>>(
    '/appointment',
    { method: 'POST', body: zohoBody, bodyAsForm: true },
    traceId,
  );
  if (!result.ok) return result;

  // Zoho Bookings v1 puede devolver el booking_id en varios shapes según versión:
  //   { response: { returnvalue: { booking_id } } }   ← v1 clásica
  //   { response: { returnvalue: [ { booking_id } ] } } ← variantes
  //   { booking_id }                                  ← v2 (poco probable acá)
  // O si hay error de negocio, devuelve { response: { status: "failure", message: "..." } }.
  const data = result.data as Record<string, unknown>;
  const response = (data?.response ?? data) as Record<string, unknown>;
  const status = String(response?.status ?? '');
  if (status.toLowerCase() === 'failure' || response?.error_message) {
    const msg = response?.error_message ?? response?.message ?? 'Bookings rechazó la solicitud';
    log.warn('zoho bookings failure response', { traceId, status, response: JSON.stringify(response).slice(0, 500) });
    return { ok: false, error: `Bookings: ${msg}` };
  }
  let rv = response?.returnvalue as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (Array.isArray(rv)) rv = rv[0];
  const bookingId = (rv?.booking_id ?? rv?.appointment_id ?? data?.booking_id) as string | undefined;
  if (!bookingId) {
    // Diagnóstico: si no encontramos booking_id, mostrar las primeras keys reales para
    // que sepamos qué shape devolvió la API.
    const topKeys = Object.keys(data ?? {}).join(',');
    const rvKeys = rv ? Object.keys(rv).join(',') : 'no_returnvalue';
    log.warn('Bookings response shape unknown', { traceId, topKeys, rvKeys, raw: JSON.stringify(data).slice(0, 800) });
    return { ok: false, error: `Bookings response missing booking_id (top:${topKeys} rv:${rvKeys})` };
  }
  return {
    ok: true,
    data: {
      booking_id: String(bookingId),
      status: String(rv?.status ?? 'scheduled'),
      customer_email: String((rv?.customer_more_info as Record<string, unknown> | undefined)?.email ?? input.customer_email),
      start_time: String(rv?.start_time ?? input.start_time),
      meeting_url: rv?.meeting_url as string | undefined,
    },
  };
}

export async function getBooking(bookingId: string, traceId: string): Promise<ZohoBookingsResult<Booking>> {
  // GET /appointment?booking_id=...
  return callBookings<Booking>(`/appointment?booking_id=${encodeURIComponent(bookingId)}`, { method: 'GET' }, traceId);
}

export async function cancelBooking(bookingId: string, traceId: string): Promise<ZohoBookingsResult<{ ok: boolean }>> {
  // Cancel appointment: POST /updateappointment con action=cancel
  return callBookings<{ ok: boolean }>(
    '/updateappointment',
    { method: 'POST', body: { booking_id: bookingId, action: 'cancel' }, bodyAsForm: true },
    traceId,
  );
}

export const _internal = { isConfigured };
