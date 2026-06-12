/**
 * Dispatcher de WhatsApp — selecciona provider (Twilio vs Meta Cloud) según env var.
 *
 * Env: `WHATSAPP_PROVIDER` = 'twilio' | 'meta_cloud' (default: 'twilio')
 *
 * Twilio es el default desde 2026-06-03 — más fácil de setup (~2h) que Meta Business
 * Manager + verificación de empresa. Cris puede empezar con sandbox y mover a número
 * aprobado después.
 *
 * Si querés cambiar a Meta Cloud API en el futuro:
 *   1. setear `WHATSAPP_PROVIDER=meta_cloud` en Catalyst env vars
 *   2. configurar `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
 *
 * El handler de outbox no se entera del cambio — solo cambia el provider que ejecuta.
 */

import { logger } from './logger';

const log = logger('WHATSAPP_DISPATCH');

export type WhatsAppResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type SentMessage = { message_id: string; status?: string };

export type SendTextInput = {
  to_phone: string;
  body: string;
};

export type SendTemplateInput = {
  to_phone: string;
  /** En Twilio: ContentSid (HXxxx). En Meta: template_name. */
  template_name: string;
  language_code?: string;
  /** En Twilio: variables como object {1: 'val', 2: 'val'}. En Meta: components array. */
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: 'text'; text: string }>;
  }>;
};

function getProvider(): 'twilio' | 'meta_cloud' {
  const p = (process.env.WHATSAPP_PROVIDER ?? 'twilio').toLowerCase();
  return p === 'meta_cloud' ? 'meta_cloud' : 'twilio';
}

export async function sendText(input: SendTextInput, traceId = ''): Promise<WhatsAppResult<SentMessage>> {
  const provider = getProvider();
  log.debug('routing sendText', { provider });
  if (provider === 'twilio') {
    const { sendText: twilioSendText } = await import('./twilioWhatsappClient.js');
    return twilioSendText(input, traceId);
  }
  const { sendText: metaSendText } = await import('./whatsappClient.js');
  const r = await metaSendText(input, traceId);
  if (!r.ok) return r;
  const first = r.data.messages[0];
  return { ok: true, data: { message_id: first?.message_id ?? 'unknown', status: first?.status } };
}

export async function sendTemplate(input: SendTemplateInput, traceId = ''): Promise<WhatsAppResult<SentMessage>> {
  const provider = getProvider();
  log.debug('routing sendTemplate', { provider });
  if (provider === 'twilio') {
    const { sendTemplate: twilioSendTemplate } = await import('./twilioWhatsappClient.js');
    // Adapt: Meta usa components[], Twilio usa variables {1, 2, ...}
    const variables: Record<string, string> = {};
    let idx = 1;
    for (const c of input.components ?? []) {
      if (c.type === 'body') {
        for (const p of c.parameters) {
          variables[String(idx++)] = p.text;
        }
      }
    }
    return twilioSendTemplate({
      to_phone: input.to_phone,
      content_sid: input.template_name,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
    }, traceId);
  }
  const { sendTemplate: metaSendTemplate } = await import('./whatsappClient.js');
  const r = await metaSendTemplate(input, traceId);
  if (!r.ok) return r;
  const first = r.data.messages[0];
  return { ok: true, data: { message_id: first?.message_id ?? 'unknown', status: first?.status } };
}

export function isWhatsAppConfigured(): boolean {
  const provider = getProvider();
  if (provider === 'twilio') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
  }
  // Meta cloud
  return !!(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}
