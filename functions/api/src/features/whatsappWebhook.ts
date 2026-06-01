/**
 * Webhook entrante de WhatsApp Business (Meta Cloud API).
 *
 * Meta usa 2 mecanismos:
 *   1. Verification challenge (GET): handshake inicial cuando se registra el webhook
 *   2. Event delivery (POST): mensajes/status updates con HMAC X-Hub-Signature-256
 *
 * Eventos soportados:
 *   - messages: incoming text del candidato/cliente → guardar para Cris
 *   - statuses: delivered/read/failed para mensajes salientes (audit)
 *
 * Verification: GET con `hub.verify_token` debe matchear `WHATSAPP_VERIFY_TOKEN`.
 * Event POST: HMAC-SHA256 con `WHATSAPP_APP_SECRET`.
 *
 * Idempotencia: usamos message_id como event_id en ProcessedEvents.
 *
 * Endpoint:
 *   GET  /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *   POST /api/webhooks/whatsapp
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { RequestContext } from '../lib/context';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';

const log = logger('WHATSAPP_WEBHOOK');

type IncomingMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};

type StatusUpdate = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
};

type WhatsAppPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product?: string;
        messages?: IncomingMessage[];
        statuses?: StatusUpdate[];
        metadata?: { phone_number_id: string };
      };
    }>;
  }>;
};

async function readRawBody(req: RequestContext['req']): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function verifyMetaSignature(rawBody: string, headerValue: string, appSecret: string): boolean {
  // Meta envía el header como "sha256=<hex>"
  if (!headerValue.startsWith('sha256=')) return false;
  const provided = headerValue.slice(7);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function isAlreadyProcessed(req: RequestContext['req'], messageId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(messageId)}' AND provider = 'whatsapp_webhook' LIMIT 1`,
      )) as unknown[],
      'ProcessedEvents',
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markProcessed(req: RequestContext['req'], messageId: string): Promise<void> {
  try {
    await datastore(req).table('ProcessedEvents').insertRow({
      event_id: messageId,
      provider: 'whatsapp_webhook',
      processed_at: now(),
    });
  } catch (err) {
    log.warn('failed to mark whatsapp event processed', { messageId, error: (err as Error).message });
  }
}

async function persistInboundMessage(req: RequestContext['req'], msg: IncomingMessage, traceId: string): Promise<void> {
  // Guardamos el inbound en OutreachInbox como `direction='in'` con channel='whatsapp'.
  // El recruiter ve esto en el inbox unificado. Si la tabla no existe, lo loggeamos.
  if (msg.type !== 'text' || !msg.text?.body) {
    log.info('whatsapp incoming non-text ignored', { traceId, type: msg.type });
    return;
  }
  try {
    await datastore(req).table('OutreachInbox').insertRow({
      tenant_id: null, // sin tenant context — Cris asignará/reasignará si tiene mapping
      campaign_id: null,
      contact_name: `WhatsApp ${msg.from}`,
      contact_linkedin: null,
      contact_company: null,
      contact_role: null,
      channel: 'whatsapp',
      direction: 'in',
      body: msg.text.body.slice(0, 4000),
      sent_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
      is_read: false,
      needs_response: true,
      created_at: now(),
    });
    log.info('whatsapp inbound persisted', { traceId, messageId: msg.id });
  } catch (err) {
    log.warn('whatsapp inbound persist failed (table may not exist)', {
      traceId,
      error: (err as Error).message,
      from: msg.from,
      preview: msg.text.body.slice(0, 100),
    });
  }
}

export async function handleWhatsAppWebhook(ctx: RequestContext): Promise<void> {
  const e = env();
  const verifyToken = e.WHATSAPP_VERIFY_TOKEN;
  const appSecret = e.WHATSAPP_APP_SECRET;

  // ===== GET: verification challenge =====
  if (ctx.req.method === 'GET') {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (!verifyToken) {
      sendJson(ctx.res, 503, { error: 'WHATSAPP_VERIFY_TOKEN not configured' });
      return;
    }

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      // Meta espera el challenge en plain text, no JSON
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/plain');
      ctx.res.end(challenge);
      log.info('whatsapp webhook verification ok');
      return;
    }
    throw new UnauthorizedError('Invalid verify token');
  }

  // ===== POST: event delivery =====
  if (!appSecret) {
    log.error('WHATSAPP_APP_SECRET not configured');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(ctx.req);
  const sigHeader = ctx.req.headers['x-hub-signature-256'];
  if (typeof sigHeader !== 'string') {
    throw new UnauthorizedError('Missing X-Hub-Signature-256');
  }
  if (!verifyMetaSignature(rawBody, sigHeader, appSecret)) {
    throw new UnauthorizedError('Invalid Meta signature');
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppPayload;
  } catch {
    throw new ValidationError('invalid JSON body');
  }

  if (payload.object !== 'whatsapp_business_account') {
    log.info('whatsapp non-business-account event ignored', { object: payload.object });
    sendJson(ctx.res, 200, { received: true });
    return;
  }

  let messagesPersisted = 0;
  let statusesProcessed = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Mensajes entrantes
      for (const msg of change.value.messages ?? []) {
        if (await isAlreadyProcessed(ctx.req, msg.id)) continue;
        await persistInboundMessage(ctx.req, msg, ctx.traceId);
        await markProcessed(ctx.req, msg.id);
        messagesPersisted++;
      }
      // Status updates de mensajes salientes (delivered/read/failed)
      for (const status of change.value.statuses ?? []) {
        // Solo loggeamos por ahora — útil para debug delivery issues
        log.info('whatsapp status', {
          message_id: status.id,
          status: status.status,
          recipient: status.recipient_id,
        });
        statusesProcessed++;
      }
    }
  }

  sendJson(ctx.res, 200, {
    received: true,
    messages_persisted: messagesPersisted,
    statuses_processed: statusesProcessed,
  });
}

export const _internal = { verifyMetaSignature };
