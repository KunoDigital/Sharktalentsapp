/**
 * Webhook entrante de Zoho Sign — recibe eventos de firma de oferta laboral.
 *
 * Cuando se manda una oferta via /api/applications/:id/send-offer, queda creada en
 * Zoho Sign con un request_id. Cuando el candidato la firma (o rechaza, o expira),
 * Zoho Sign POSTea acá. Acá actualizamos el pipeline_stage del Result:
 *   - completed (firmado) → stage 'hired'
 *   - declined            → stage 'offer_declined'
 *   - expired             → no-op (Cris decide manualmente)
 *
 * HMAC con `ZOHO_SIGN_WEBHOOK_SECRET`. Idempotencia via `event_id` en ProcessedEvents.
 *
 * Endpoint:
 *   POST /api/webhooks/zoho-sign
 *   Headers: X-Zoho-Sign-Signature: <HMAC-SHA256 del body>
 *   Body: { event_id, request_id, event_type, occurred_at }
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { RequestContext } from '../lib/context';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { transitionAllowed, type PipelineStage, isStage } from '../lib/pipelineStateMachine';

const log = logger('ZOHO_SIGN_WEBHOOK');

type ZohoSignEvent = {
  event_id: string;
  request_id: string;
  event_type: 'completed' | 'declined' | 'expired' | 'sent' | 'recalled' | string;
  occurred_at?: string;
  /** Email del firmante que disparó el evento — Sign lo manda en el payload. Lo usamos
   * para matchear contra MarketingLeads cuando es un contrato (no una oferta de candidato). */
  signer_email?: string;
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

async function isAlreadyProcessed(req: RequestContext['req'], eventId: string): Promise<boolean> {
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(eventId)}' AND provider = 'zoho_sign_webhook' LIMIT 1`,
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
      provider: 'zoho_sign_webhook',
      processed_at: now(),
    });
  } catch (err) {
    log.warn('failed to mark sign event processed', { eventId, error: (err as Error).message });
  }
}

/**
 * Busca la application asociada a este sign request_id.
 *
 * NOTA: requiere que cuando se manda la oferta (sendOfferForSignature) se persista el
 * request_id en algún lado. Por ahora, consultamos AuditLog buscando el resource_id que
 * tenga el request_id en changes. Cuando exista columna `Results.sign_request_id`
 * (Block 2 deferred), reemplazar por query directa.
 */
async function findApplicationBySignRequest(req: RequestContext['req'], requestId: string): Promise<{ resultId: string; currentStage: string } | null> {
  try {
    const rows = unwrapRows<{ resource_id: string; changes: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT resource_id, changes FROM AuditLog
         WHERE action = 'application.transition' AND resource_type = 'application'
         ORDER BY CREATEDTIME DESC LIMIT 100`,
      )) as unknown[],
      'AuditLog',
    );
    for (const r of rows) {
      try {
        const changes = JSON.parse(r.changes ?? '{}') as Record<string, unknown>;
        if (changes.sign_request_id === requestId) {
          // Cargar stage actual
          const result = unwrapRows<{ pipeline_stage: string }>(
            (await zcql(req).executeZCQLQuery(
              `SELECT pipeline_stage FROM Results WHERE ROWID = '${escapeSql(r.resource_id)}' LIMIT 1`,
            )) as unknown[],
            'Results',
          )[0];
          if (result) {
            return { resultId: r.resource_id, currentStage: result.pipeline_stage };
          }
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    log.warn('audit log lookup failed', { error: (err as Error).message });
  }
  return null;
}

function eventToTargetStage(eventType: string): PipelineStage | null {
  if (eventType === 'completed') return 'hired';
  if (eventType === 'declined') return 'offer_declined';
  return null;
}

/**
 * Maneja el caso: el cliente firmó el contrato marketing (no una oferta de candidato).
 *
 * Si encuentra un MarketingLead con el email del firmante, lo marca como 'won' y crea
 * el Tenant correspondiente (mismo flow que /api/marketing/lead/:id/convert-to-tenant
 * pero disparado automáticamente).
 *
 * Devuelve true si procesó el evento, false si no había lead matching.
 */
async function tryHandleMarketingContractSigned(
  ctx: RequestContext,
  signerEmail: string,
  signRequestId: string,
): Promise<boolean> {
  try {
    const email = signerEmail.trim().toLowerCase();
    type LeadRow = { ROWID: string; email: string; contact_name: string | null; company: string | null; status: string };
    const lead = unwrapRows<LeadRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, email, contact_name, company, status FROM MarketingLeads WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'MarketingLeads',
    )[0];

    if (!lead || !lead.company) {
      log.info('sign completed event with no matching marketing lead', { signerEmail, signRequestId });
      return false;
    }

    // Crear Tenant
    const slug = lead.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const tenantInsert = {
      clerk_org_id: `pending_${lead.ROWID}`,
      name: lead.company,
      slug,
      plan: 'standard',
      status: 'active',
      max_active_jobs: 5,
      max_candidates_per_month: 500,
      features_enabled: null,
      branding_config: null,
      billing_email: lead.email,
      created_at: now(),
      updated_at: now(),
    };
    const tenantRow = await datastore(ctx.req).table('Tenants').insertRow(tenantInsert);
    const { unwrapRow } = await import('../lib/dbHelpers.js');
    const tenant = unwrapRow<{ ROWID: string }>(tenantRow, 'Tenants');
    if (!tenant) {
      log.warn('failed to auto-create tenant on contract sign', { leadId: lead.ROWID });
      return false;
    }

    // Marcar lead como won
    await datastore(ctx.req).table('MarketingLeads').updateRow({
      ROWID: lead.ROWID,
      status: 'won',
      updated_at: now(),
    });

    log.info('marketing contract signed → tenant created', {
      traceId: ctx.traceId,
      leadId: lead.ROWID,
      tenantId: tenant.ROWID,
      company: lead.company,
      signRequestId,
    });

    return true;
  } catch (err) {
    log.warn('tryHandleMarketingContractSigned failed', { error: (err as Error).message });
    return false;
  }
}

export async function handleZohoSignWebhook(ctx: RequestContext): Promise<void> {
  const e = env();
  if (!e.ZOHO_SIGN_WEBHOOK_SECRET) {
    log.error('ZOHO_SIGN_WEBHOOK_SECRET not configured');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(ctx.req);
  const signature = ctx.req.headers['x-zoho-sign-signature'];
  if (typeof signature !== 'string') {
    throw new UnauthorizedError('Missing X-Zoho-Sign-Signature header');
  }
  if (!verifySignature(rawBody, signature, e.ZOHO_SIGN_WEBHOOK_SECRET)) {
    throw new UnauthorizedError('Invalid Zoho Sign signature');
  }

  let event: ZohoSignEvent;
  try {
    event = JSON.parse(rawBody) as ZohoSignEvent;
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  if (!event.event_id || !event.request_id || !event.event_type) {
    throw new ValidationError('event_id + request_id + event_type required');
  }

  if (await isAlreadyProcessed(ctx.req, event.event_id)) {
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  const targetStage = eventToTargetStage(event.event_type);
  if (!targetStage) {
    // Eventos como 'sent', 'expired', 'recalled' los aceptamos pero no transicionan.
    log.info('sign event accepted but no transition', { eventId: event.event_id, type: event.event_type });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }

  const app = await findApplicationBySignRequest(ctx.req, event.request_id);
  if (!app) {
    // No es una oferta de candidato. Puede ser un CONTRATO marketing (cliente firmó).
    // Detectamos: si el evento es 'completed' Y tenemos signer_email → buscamos lead.
    if (event.event_type === 'completed' && event.signer_email) {
      const triggered = await tryHandleMarketingContractSigned(ctx, event.signer_email, event.request_id);
      if (triggered) {
        await markProcessed(ctx.req, event.event_id);
        sendJson(ctx.res, 200, { received: true, transitioned: false, marketing_contract_processed: true });
        return;
      }
    }
    log.warn('sign event for unknown request — accepting but no action', {
      eventId: event.event_id,
      requestId: event.request_id,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }

  if (!isStage(app.currentStage)) {
    log.warn('current stage invalid', { resultId: app.resultId, currentStage: app.currentStage });
    sendJson(ctx.res, 200, { received: true, transitioned: false });
    return;
  }
  if (!transitionAllowed(app.currentStage as PipelineStage, targetStage)) {
    log.warn('sign event would cause invalid transition', {
      resultId: app.resultId,
      from: app.currentStage,
      to: targetStage,
    });
    await markProcessed(ctx.req, event.event_id);
    sendJson(ctx.res, 200, { received: true, transitioned: false, reason: 'transition_not_allowed' });
    return;
  }

  try {
    // Insert transition + update Result
    await datastore(ctx.req).table('PipelineTransitions').insertRow({
      result_id: app.resultId,
      from_stage: app.currentStage,
      to_stage: targetStage,
      actor: 'zoho_sign_webhook',
      reason: `Sign event: ${event.event_type}`,
      transitioned_at: event.occurred_at ?? now(),
    });
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: app.resultId,
      pipeline_stage: targetStage,
    });
    await markProcessed(ctx.req, event.event_id);

    log.info('sign event applied', {
      eventId: event.event_id,
      resultId: app.resultId,
      from: app.currentStage,
      to: targetStage,
    });

    sendJson(ctx.res, 200, { received: true, transitioned: true, target_stage: targetStage });
  } catch (err) {
    log.error('sign webhook processing failed', { eventId: event.event_id, error: (err as Error).message });
    sendJson(ctx.res, 503, { error: { code: 'processing_failed', message: 'will be retried' } });
  }
}

export const _internal = { verifySignature, eventToTargetStage };
