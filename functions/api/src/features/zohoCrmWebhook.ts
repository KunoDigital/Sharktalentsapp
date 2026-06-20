/**
 * Webhook entrante de Zoho CRM — recibe leads que entran al CRM desde fuentes
 * externas (Meta Ads, manual del equipo Kuno, etc).
 *
 * Cuando se crea un Lead en CRM con cierto Lead_Source (configurable via
 * `CRM_META_LEAD_SOURCE`), Chris configura un workflow rule que dispara un POST
 * acá. SharkTalents:
 *   1. Crea/actualiza MarketingLead en su tabla
 *   2. Dispara email "Bienvenida + agenda llamada" (template `meta_lead_welcome`)
 *   3. (Futuro) WhatsApp con mismo mensaje — pendiente configurar Twilio
 *
 * Validación: secret literal en `CRM_WEBHOOK_SECRET` (Catalyst strip headers,
 * por eso el secret va en query string).
 *
 * Endpoint:
 *   POST /api/webhooks/zoho-crm/lead-created?secret=XXX
 *   Body form-urlencoded o JSON: { email, contact_name, company, phone, lead_source, ... }
 *
 * Idempotency: si el email ya existe en MarketingLeads, UPDATE en vez de crear
 * duplicado. No re-dispara email si ya se envió antes.
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows, unwrapRow } from '../lib/dbHelpers';

const log = logger('ZOHO_CRM_WEBHOOK');

type IncomingLead = {
  email?: string;
  contact_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  lead_source?: string;
  lead_id?: string;
};

async function readRawBody(req: RequestContext['req']): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Parsea body que puede ser JSON o form-urlencoded (Zoho manda lo que configures). */
function parseBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ValidationError('invalid JSON body');
    }
  }
  // Default: form-urlencoded
  const params = new URLSearchParams(raw);
  const result: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) result[k] = v;
  return result;
}

export async function handleZohoCrmLeadCreated(ctx: RequestContext): Promise<void> {
  const e = env();
  const secret = e.CRM_WEBHOOK_SECRET;
  if (!secret) {
    log.error('CRM_WEBHOOK_SECRET not configured');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  // Secret va en query string (Catalyst strip de custom headers).
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const providedSecret = url.searchParams.get('secret') ?? '';
  if (providedSecret !== secret) {
    throw new UnauthorizedError('Invalid CRM webhook secret');
  }

  const rawBody = await readRawBody(ctx.req);
  const contentType = typeof ctx.req.headers['content-type'] === 'string' ? ctx.req.headers['content-type'] : '';
  const body = parseBody(rawBody, contentType) as IncomingLead;

  const email = (body.email ?? '').trim().toLowerCase();
  // Aceptamos nombre completo o nombre+apellido por separado (Meta lo manda separado).
  const firstName = (body.first_name ?? '').trim();
  const lastName = (body.last_name ?? '').trim();
  const contactName = (body.contact_name ?? '').trim()
    || [firstName, lastName].filter(Boolean).join(' ').trim();
  const company = (body.company ?? '').trim();
  const phone = (body.phone ?? '').trim();
  const leadSource = (body.lead_source ?? '').trim();

  if (!email) {
    sendJson(ctx.res, 400, { error: 'email required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(ctx.res, 400, { error: 'invalid email format' });
    return;
  }

  // Filtro por Lead_Source: solo procesamos los configurados. Si no matchea,
  // 200 OK sin hacer nada (no es error, simplemente no es nuestro flujo).
  const allowedSources = (e.CRM_META_LEAD_SOURCE ?? 'SharkTalents Funnel,Meta leads ad')
    .split(',').map((s) => s.trim().toLowerCase());
  if (!allowedSources.includes(leadSource.toLowerCase())) {
    log.info('lead source not in allowed list — skipping', {
      lead_source: leadSource,
      allowed: allowedSources,
      email_masked: email.slice(0, 3) + '***',
    });
    sendJson(ctx.res, 200, { received: true, processed: false, reason: 'lead_source_not_allowed' });
    return;
  }

  // 1. Buscar lead existente por email (idempotency).
  type LeadRow = { ROWID: string; email: string };
  const existing = unwrapRows<LeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email FROM MarketingLeads WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'MarketingLeads',
  );

  let leadId: string;
  let isNew = false;
  if (existing[0]) {
    leadId = existing[0].ROWID;
    // Actualizar con datos nuevos si vienen.
    const updates: Record<string, unknown> = { ROWID: leadId, updated_at: now() };
    if (contactName) updates.contact_name = contactName.slice(0, 255);
    if (company) updates.company = company.slice(0, 255);
    if (phone) updates.whatsapp = phone.slice(0, 50);
    if (Object.keys(updates).length > 2) {
      await datastore(ctx.req).table('MarketingLeads').updateRow(updates as { ROWID: string });
    }
    log.info('crm lead exists — updated', { leadId, email_masked: email.slice(0, 3) + '***' });
  } else {
    const insertPayload: Record<string, unknown> = {
      email,
      contact_name: contactName.slice(0, 255) || null,
      company: company.slice(0, 255) || null,
      whatsapp: phone.slice(0, 50) || null,
      source: leadSource.slice(0, 50) || 'crm_webhook',
      // 2026-06-11: bug fix — leads del webhook CRM no se mostraban en el kanban porque
      // status quedaba null. El kanban filtra por status in ('new','eval_requested',...).
      status: 'new',
      created_at: now(),
      updated_at: now(),
    };
    const inserted = await datastore(ctx.req).table('MarketingLeads').insertRow(insertPayload);
    const row = unwrapRow<{ ROWID: string }>(inserted, 'MarketingLeads');
    if (!row) {
      throw new Error('MarketingLeads insert returned null');
    }
    leadId = row.ROWID;
    isNew = true;
    log.info('crm lead created — new MarketingLead', { leadId, source: leadSource });
  }

  // 2. Disparar email de bienvenida (solo si es nuevo, para no spammear).
  if (isNew) {
    try {
      const { publishAndProcessEvent } = await import('./outbox.js');
      const bookingsUrl = e.CRM_BOOKINGS_URL || 'https://zbooking.us/vde72';
      await publishAndProcessEvent(ctx.req, 'email.send_pending', {
        to: email,
        template: 'meta_lead_welcome',
        locale: 'es',
        vars: {
          contact_name: contactName || 'equipo',
          bookings_url: bookingsUrl,
        },
      });
      log.info('crm lead welcome email queued', { leadId });
    } catch (err) {
      log.warn('failed to queue welcome email — lead created OK, email retry on cron', {
        leadId,
        error: (err as Error).message,
      });
    }
  }

  // 3. Alerta WhatsApp a Cris (speed-to-lead < 5 min). Solo si es lead nuevo de Meta
  // y OPS_ALERT_PHONE está configurado. 2026-06-19: funciona mientras el join al
  // Sandbox Twilio esté activo (72h); cuando WABA esté aprobado se vuelve robusto.
  if (isNew && e.OPS_ALERT_PHONE) {
    const leadPhoneClean = (phone ?? '').replace(/[^\d]/g, '');
    const waLink = leadPhoneClean ? `https://wa.me/${leadPhoneClean}` : '(sin WhatsApp)';
    const alertBody = [
      `🦈 Lead nuevo en SharkTalents`,
      ``,
      `👤 ${contactName || 'sin nombre'}`,
      `📧 ${email}`,
      `📱 ${waLink}`,
      `🎯 Fuente: ${leadSource || 'Meta'}`,
      ``,
      `Speed-to-lead: < 5 min recomendado.`,
    ].join('\n');
    try {
      const { sendText } = await import('../lib/whatsappDispatcher.js');
      const waRes = await sendText({ to_phone: e.OPS_ALERT_PHONE, body: alertBody }, ctx.traceId);
      log.info('ops alert whatsapp result', {
        leadId,
        ok: waRes.ok,
        error: waRes.ok ? undefined : waRes.error,
      });
    } catch (err) {
      log.warn('ops alert whatsapp failed', { leadId, error: (err as Error).message });
    }
  }

  sendJson(ctx.res, 200, {
    received: true,
    processed: true,
    lead_id: leadId,
    is_new: isNew,
    email_queued: isNew,
  });
}
