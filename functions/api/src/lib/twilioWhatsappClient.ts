/**
 * Twilio WhatsApp client.
 *
 * Pivot 2026-06-10: Twilio como BSP (Business Solution Provider) en vez de Meta directo.
 * Sandbox para testing inmediato + Sender de producción con número Zadarma cuando se
 * apruebe en WABA.
 *
 * Endpoint: https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 * Auth: HTTP Basic con AccountSid:AuthToken
 *
 * Env vars:
 *   TWILIO_ACCOUNT_SID         — empieza con "AC..."
 *   TWILIO_AUTH_TOKEN          — secret, configurar en Catalyst Console
 *   TWILIO_WHATSAPP_FROM       — número Twilio en formato "whatsapp:+14155238886"
 *                                (sandbox usa este número, producción usa el tuyo)
 *
 * Si alguna no está seteada, retorna { ok: false, error: 'not configured' } sin lanzar.
 *
 * Las exports son `sendText` y `sendTemplate` (sin prefijo Twilio) para que el dispatcher
 * en whatsappDispatcher.ts pueda importarlas con el shape común.
 *
 * Pasa por circuit breaker `twilio_whatsapp` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';

const log = logger('TWILIO_WHATSAPP');

const BREAKER_OPTS = { name: 'twilio_whatsapp', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 12_000;

/** Shape común esperado por whatsappDispatcher.ts. Compatible con Meta también. */
export type SentMessage = { message_id: string; status?: string };
export type WhatsAppResult =
  | { ok: true; data: SentMessage }
  | { ok: false; error: string; status?: number };

export type SendTextInput = {
  to_phone: string;             // E.164 ej '+50761112233'
  body: string;
};

export type SendTemplateInput = {
  to_phone: string;
  /** Twilio Content SID (HXxxxxx) del template aprobado en Twilio Content Builder. */
  content_sid: string;
  /** Variables del template como {"1": "valor1", "2": "valor2"} */
  variables?: Record<string, string>;
};

function isConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID
    && !!process.env.TWILIO_AUTH_TOKEN
    && !!process.env.TWILIO_WHATSAPP_FROM;
}

/** Normaliza al formato Twilio: `whatsapp:+50761112233` */
function toTwilioWhatsApp(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`;
  return `whatsapp:${withPlus}`;
}

function encodeForm(params: Record<string, string | undefined>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return out.join('&');
}

async function twilioPost(
  params: Record<string, string | undefined>,
  traceId: string,
): Promise<WhatsAppResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'Twilio not configured (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM)' };
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: encodeForm(params),
        timeoutMs: TIMEOUT_MS,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      if (!response.ok) {
        const errorMsg = (parsed as { message?: string })?.message ?? text.slice(0, 200);
        const err: Error & { status?: number } = new Error(`Twilio HTTP ${response.status}: ${errorMsg}`);
        err.status = response.status;
        throw err;
      }
      const data = parsed as { sid?: string; status?: string };
      return { sid: data.sid ?? 'unknown', status: data.status ?? 'queued' };
    });
    log.info('twilio whatsapp ok', { traceId, sid: result.sid, status: result.status });
    return { ok: true, data: { message_id: result.sid, status: result.status } };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('twilio whatsapp failed', { traceId, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

/** Manda un mensaje de texto via Twilio WhatsApp. Free-form solo válido en ventana
 *  de 24h post-mensaje del usuario (regla de Meta) o en Sandbox. */
export async function sendText(input: SendTextInput, traceId: string): Promise<WhatsAppResult> {
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const body = input.body.slice(0, 4096);
  return twilioPost({
    From: from,
    To: toTwilioWhatsApp(input.to_phone),
    Body: body,
  }, traceId);
}

/** Manda un template aprobado via Twilio Content API. Para producción.
 *  Sandbox NO acepta templates custom — usa sendText. */
export async function sendTemplate(input: SendTemplateInput, traceId: string): Promise<WhatsAppResult> {
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const params: Record<string, string | undefined> = {
    From: from,
    To: toTwilioWhatsApp(input.to_phone),
    ContentSid: input.content_sid,
  };
  if (input.variables && Object.keys(input.variables).length > 0) {
    params.ContentVariables = JSON.stringify(input.variables);
  }
  return twilioPost(params, traceId);
}

export const _internal = { isConfigured, toTwilioWhatsApp };
