/**
 * Webhook entrante de Zia (Zoho AI) — recibe el transcript de un meeting.
 *
 * Flow completo del briefing cliente:
 *   1. Cris llama POST /api/briefings/schedule → Zoho Bookings crea meeting
 *   2. Cliente recibe invite, asiste al meeting (con Zia activado)
 *   3. Zia transcribe automáticamente
 *   4. Al terminar el meeting, Zia POSTea el transcript a este webhook
 *   5. Acá guardamos el transcript en outbox event para que el cron lo procese
 *      llamando a drafts.generateDraft con el transcript completo
 *
 * Verificación HMAC con `ZIA_WEBHOOK_SECRET`. Si no está seteado, devolvemos 503.
 *
 * Idempotencia: usamos `meeting_id` (Zia lo provee) como event_id en ProcessedEvents.
 *
 * Endpoint:
 *   POST /api/webhooks/zia
 *   Headers: X-Zia-Signature: <HMAC-SHA256 del body>
 *   Body: { meeting_id, booking_id?, transcript, language?, duration_seconds?, occurred_at }
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { RequestContext } from '../lib/context';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { publishOutboxEvent } from './outbox';

const log = logger('ZIA_WEBHOOK');

type ZiaPayload = {
  meeting_id: string;
  booking_id?: string;
  transcript: string;
  language?: string;
  duration_seconds?: number;
  occurred_at?: string;
};

async function readRawBody(req: RequestContext['req']): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function isAlreadyProcessed(req: RequestContext['req'], meetingId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(meetingId)}' AND provider = 'zia_webhook' LIMIT 1`,
      )) as unknown[],
      'ProcessedEvents',
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markProcessed(req: RequestContext['req'], meetingId: string): Promise<void> {
  try {
    await datastore(req).table('ProcessedEvents').insertRow({
      event_id: meetingId,
      provider: 'zia_webhook',
      processed_at: now(),
    });
  } catch (err) {
    log.warn('failed to mark zia event processed', { meetingId, error: (err as Error).message });
  }
}

export async function handleZiaWebhook(ctx: RequestContext): Promise<void> {
  const e = env();
  if (!e.ZIA_WEBHOOK_SECRET) {
    log.error('ZIA_WEBHOOK_SECRET not configured — rejecting webhook');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(ctx.req);
  const signature = ctx.req.headers['x-zia-signature'];
  if (typeof signature !== 'string') {
    throw new UnauthorizedError('Missing X-Zia-Signature header');
  }
  if (!verifySignature(rawBody, signature, e.ZIA_WEBHOOK_SECRET)) {
    throw new UnauthorizedError('Invalid Zia signature');
  }

  let payload: ZiaPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ValidationError('invalid JSON body');
  }

  if (!payload.meeting_id || typeof payload.meeting_id !== 'string') {
    throw new ValidationError('meeting_id required');
  }
  if (!payload.transcript || typeof payload.transcript !== 'string') {
    throw new ValidationError('transcript required');
  }
  if (payload.transcript.length < 100) {
    throw new ValidationError('transcript too short (<100 chars)');
  }

  if (await isAlreadyProcessed(ctx.req, payload.meeting_id)) {
    log.info('duplicate zia event ignored', { meetingId: payload.meeting_id });
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  // Enquear al outbox para procesamiento async (drafts.generateDraft toma >5s con
  // Anthropic, no queremos bloquear el webhook).
  // OutboxEvents.payload tiene límite de 8K chars; transcripts pueden ser >10K.
  // Persistimos el transcript en File Store y guardamos solo la referencia en el outbox.
  try {
    const { persistLargeContent } = await import('../lib/largeContentStore.js');
    const transcriptRef = await persistLargeContent(
      ctx.req,
      payload.transcript,
      `Briefings.transcript_text[${payload.meeting_id}]`,
    );
    await publishOutboxEvent(ctx.req, 'briefing.transcript_received', {
      meeting_id: payload.meeting_id,
      booking_id: payload.booking_id ?? null,
      transcript_ref: transcriptRef, // string corto: contenido inline o "file:<id>"
      transcript_chars: payload.transcript.length,
      language: payload.language ?? null,
      duration_seconds: payload.duration_seconds ?? null,
      occurred_at: payload.occurred_at ?? now(),
    });
    await markProcessed(ctx.req, payload.meeting_id);
    log.info('zia transcript received + queued', {
      traceId: ctx.traceId,
      meetingId: payload.meeting_id,
      transcript_chars: payload.transcript.length,
      language: payload.language,
    });
    sendJson(ctx.res, 200, { received: true, queued: true });
  } catch (err) {
    log.error('zia webhook processing failed — Zia will retry', {
      meetingId: payload.meeting_id,
      error: (err as Error).message,
    });
    sendJson(ctx.res, 503, {
      error: { code: 'processing_failed', message: 'will be retried' },
    });
  }
}

export const _internal = { verifySignature };
