/**
 * WhatsApp Business API client.
 *
 * Para mensajes transaccionales: confirmación de aplicación, recordatorios de test,
 * notificación de finalist, agendamiento de entrevista.
 *
 * Default: Meta Cloud API (graph.facebook.com).
 *
 * Use cases:
 *   - Recordatorio al candidato 24h antes que expire link de test
 *   - Confirmación al cliente cuando se agenda briefing
 *   - Alerta a Cris cuando llega un nuevo finalist
 *
 * NOTA: requiere número aprobado en WABA (WhatsApp Business Account) + templates
 * pre-aprobados (Meta no permite mensajes free-form fuera de la ventana de 24h).
 *
 * No-op si `WHATSAPP_API_URL` o `WHATSAPP_ACCESS_TOKEN` no están seteados.
 *
 * Pasa por circuit breaker `whatsapp` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('WHATSAPP');

const BREAKER_OPTS = { name: 'whatsapp', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 12_000;

export type WhatsAppResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type SendTemplateInput = {
  to_phone: string;             // E.164 format ej: '+50760001234'
  template_name: string;        // template name pre-aprobado en WABA
  language_code?: string;       // default 'es'
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: 'text'; text: string }>;
  }>;
};

export type SendTextInput = {
  to_phone: string;
  body: string;                 // free-form, solo válido en ventana de 24h post-mensaje del usuario
};

export type WhatsAppMessage = {
  message_id: string;
  status?: string;
};

function isConfigured(): boolean {
  const e = env();
  return !!e.WHATSAPP_API_URL && !!e.WHATSAPP_ACCESS_TOKEN && !!e.WHATSAPP_PHONE_NUMBER_ID;
}

function normalizePhone(phone: string): string {
  // Strip todo excepto dígitos. WhatsApp espera sin '+'.
  return phone.replace(/[^\d]/g, '');
}

async function callWhatsApp<T>(body: Record<string, unknown>, traceId: string): Promise<WhatsAppResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'WhatsApp not configured (WHATSAPP_API_URL + WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID)' };
  }
  const e = env();
  const url = `${e.WHATSAPP_API_URL.replace(/\/$/, '')}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`WhatsApp ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('whatsapp call ok', { traceId });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('whatsapp call failed', { traceId, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function sendTemplate(input: SendTemplateInput, traceId: string): Promise<WhatsAppResult<{ messages: WhatsAppMessage[] }>> {
  return callWhatsApp<{ messages: WhatsAppMessage[] }>({
    messaging_product: 'whatsapp',
    to: normalizePhone(input.to_phone),
    type: 'template',
    template: {
      name: input.template_name,
      language: { code: input.language_code ?? 'es' },
      components: input.components,
    },
  }, traceId);
}

export async function sendText(input: SendTextInput, traceId: string): Promise<WhatsAppResult<{ messages: WhatsAppMessage[] }>> {
  return callWhatsApp<{ messages: WhatsAppMessage[] }>({
    messaging_product: 'whatsapp',
    to: normalizePhone(input.to_phone),
    type: 'text',
    text: { body: input.body.slice(0, 4096) },
  }, traceId);
}

export const _internal = { isConfigured, normalizePhone };
