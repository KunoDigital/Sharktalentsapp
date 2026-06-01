/**
 * Webhook entrante de HeyReach.
 *
 * HeyReach pushea eventos cuando algo cambia en el flujo de outbound:
 *   - invitation.sent
 *   - invitation.accepted
 *   - message.received   ← este es el más importante: aterriza en OutreachInbox
 *   - meeting.booked
 *
 * Endpoint:
 *   POST /api/webhooks/heyreach
 *   Headers: X-HeyReach-Signature: <HMAC-SHA256 del body con HEYREACH_WEBHOOK_SECRET>
 *   Body: payload del evento
 *
 * Si `HEYREACH_WEBHOOK_SECRET` no está seteado en env, devolvemos 503 (mejor fallar
 * explícito que aceptar webhooks sin verificar firma — sería una vulnerabilidad).
 *
 * Idempotencia: usamos el `event_id` de HeyReach como clave en ProcessedEvents
 * (mismo patrón que Clerk webhooks).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { RequestContext } from '../lib/context';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';

const log = logger('HEYREACH_WEBHOOK');

type HeyReachEvent = {
  event_id: string;
  event_type: 'invitation.sent' | 'invitation.accepted' | 'message.received' | 'message.sent' | 'meeting.booked' | string;
  campaign_id: string;
  tenant_id?: string; // Si se mapea por env ó URL, no por payload — pero algunas integraciones lo mandan
  occurred_at: string;
  contact: {
    name: string;
    linkedin_url?: string;
    company?: string;
    role?: string;
  };
  message?: {
    body: string;
    direction: 'in' | 'out';
  };
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
  // timingSafeEqual requires equal length
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function isAlreadyProcessed(req: RequestContext['req'], eventId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(eventId)}' AND provider = 'heyreach' LIMIT 1`,
      )) as unknown[],
      'ProcessedEvents',
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markProcessed(req: RequestContext['req'], eventId: string): Promise<void> {
  try {
    await datastore(req).table('ProcessedEvents').insertRow({
      event_id: eventId,
      provider: 'heyreach',
      processed_at: now(),
    });
  } catch (err) {
    log.warn('failed to mark heyreach event processed', { eventId, error: (err as Error).message });
  }
}

/**
 * Mapea un campaign_id de HeyReach a su tenant_id en SharkTalents.
 *
 * Lookup en OutreachCampaigns por campaign_id. Si no existe (campaña creada en HeyReach
 * pero nunca syncada), devuelve null.
 */
async function findCampaignTenant(req: RequestContext['req'], campaignId: string): Promise<{ rowId: string; tenantId: string } | null> {
  try {
    const rows = unwrapRows<{ ROWID: string; tenant_id: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, tenant_id FROM OutreachCampaigns WHERE ROWID = '${escapeSql(campaignId)}' LIMIT 1`,
      )) as unknown[],
      'OutreachCampaigns',
    );
    if (rows.length === 0) return null;
    return { rowId: rows[0].ROWID, tenantId: rows[0].tenant_id };
  } catch {
    return null;
  }
}

async function handleEvent(req: RequestContext['req'], event: HeyReachEvent, traceId: string): Promise<void> {
  const campaignMatch = await findCampaignTenant(req, event.campaign_id);
  if (!campaignMatch) {
    log.warn('heyreach event for unknown campaign — skipping', {
      traceId,
      campaign_id: event.campaign_id,
      event_type: event.event_type,
    });
    return;
  }

  const { tenantId, rowId: campaignRowId } = campaignMatch;

  switch (event.event_type) {
    case 'message.received': {
      if (!event.message?.body) return;
      try {
        await datastore(req).table('OutreachInbox').insertRow({
          tenant_id: tenantId,
          campaign_id: campaignRowId,
          contact_name: event.contact.name,
          contact_linkedin: event.contact.linkedin_url ?? null,
          contact_company: event.contact.company ?? null,
          contact_role: event.contact.role ?? null,
          channel: 'linkedin_dm',
          direction: 'in',
          body: event.message.body.slice(0, 4000),
          sent_at: event.occurred_at,
          is_read: false,
          needs_response: true,
          created_at: now(),
        });
        log.info('heyreach inbound message persisted', { traceId, campaign_id: event.campaign_id });
      } catch (err) {
        log.error('failed to persist inbound message', { traceId, error: (err as Error).message });
        throw err;
      }
      break;
    }
    case 'invitation.sent':
    case 'invitation.accepted':
    case 'meeting.booked': {
      // Incrementar contadores en OutreachCampaigns. Catalyst no soporta atomic increment;
      // hacemos read-modify-write — best effort. En alta concurrencia podría perder updates,
      // pero el caso de uso (un recruiter, no concurrente) lo tolera.
      try {
        const rows = unwrapRows<Record<string, number>>(
          (await zcql(req).executeZCQLQuery(
            `SELECT invites_sent, accepted, meeting_booked FROM OutreachCampaigns WHERE ROWID = '${escapeSql(campaignRowId)}' LIMIT 1`,
          )) as unknown[],
          'OutreachCampaigns',
        );
        const current = rows[0] ?? { invites_sent: 0, accepted: 0, meeting_booked: 0 };
        const update: Record<string, number | string> = { ROWID: campaignRowId };
        if (event.event_type === 'invitation.sent') update.invites_sent = (current.invites_sent ?? 0) + 1;
        if (event.event_type === 'invitation.accepted') update.accepted = (current.accepted ?? 0) + 1;
        if (event.event_type === 'meeting.booked') update.meeting_booked = (current.meeting_booked ?? 0) + 1;
        await datastore(req).table('OutreachCampaigns').updateRow(update as { ROWID: string });
      } catch (err) {
        log.warn('failed to increment campaign stats', { traceId, error: (err as Error).message });
      }
      break;
    }
    case 'message.sent': {
      // Outbound message — solo loggeamos por audit. La outbound real se persistió cuando
      // el dispatcher la mandó; este webhook es solo confirmación de delivery.
      log.info('heyreach confirmed outbound delivery', { traceId, campaign_id: event.campaign_id });
      break;
    }
    default:
      log.info('heyreach event type ignored', { traceId, event_type: event.event_type });
  }
}

export async function handleHeyReachWebhook(ctx: RequestContext): Promise<void> {
  const e = env();
  const secret = e.HEYREACH_WEBHOOK_SECRET;
  if (!secret) {
    log.error('HEYREACH_WEBHOOK_SECRET not configured — rejecting webhook for safety');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(ctx.req);
  const signature = ctx.req.headers['x-heyreach-signature'];
  if (typeof signature !== 'string') {
    throw new UnauthorizedError('Missing X-HeyReach-Signature header');
  }
  if (!verifySignature(rawBody, signature, secret)) {
    throw new UnauthorizedError('Invalid HeyReach signature');
  }

  let event: HeyReachEvent;
  try {
    event = JSON.parse(rawBody) as HeyReachEvent;
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  if (!event.event_id || !event.event_type) {
    throw new ValidationError('event_id + event_type required');
  }

  if (await isAlreadyProcessed(ctx.req, event.event_id)) {
    log.info('duplicate heyreach event ignored', { eventId: event.event_id, type: event.event_type });
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  try {
    await handleEvent(ctx.req, event, ctx.traceId);
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true });
  } catch (err) {
    log.error('heyreach event processing failed — HeyReach will retry', {
      eventId: event.event_id,
      type: event.event_type,
      error: (err as Error).message,
    });
    sendJson(ctx.res, 503, { error: { code: 'processing_failed', message: 'will be retried' } });
  }
}

export const _internal = { verifySignature };
