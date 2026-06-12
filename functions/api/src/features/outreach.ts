/**
 * Outreach (LinkedIn outbound + email) — campañas + inbox unificado.
 *
 * Tablas (Block 3 deferred):
 *   - OutreachCampaigns (id, tenant_id, name, job_id?, provider, status, invites_sent,
 *                        accepted, replied, meeting_booked, started_at, ...)
 *   - OutreachContacts  (id, campaign_id, tenant_id, name, linkedin_url?, company?, role?,
 *                        email?, status, last_event_at)
 *   - OutreachInbox     (id, tenant_id, campaign_id?, contact_name, contact_linkedin?,
 *                        channel, direction, body, sent_at, is_read, needs_response)
 *   - OutreachTemplates (id, tenant_id, name, channel, body, vars)
 *
 * Si las tablas no existen, GET devuelve [] y POST devuelve 503 con mensaje claro.
 *
 * El provider HeyReach se integra via webhook entrante (HeyReach pushea inviteAccepted,
 * messageReceived, etc. a /api/webhooks/heyreach) — eso normaliza al inbox interno.
 *
 * Endpoints:
 *   GET  /api/outreach/campaigns?status=...&job_id=...
 *   POST /api/outreach/campaigns                    → crear (sólo provider=internal por ahora)
 *   GET  /api/outreach/inbox?filter=needs_response|unread|all
 *   PATCH /api/outreach/inbox/:id                   → mark read / replied
 *   POST /api/outreach/inbox/:id/reply              → enviar respuesta (vía heyreach o email)
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { publishOutboxEvent } from './outbox';

const log = logger('OUTREACH');
const TABLE_CAMPAIGNS = 'OutreachCampaigns';
const TABLE_INBOX = 'OutreachInbox';

export type OutreachProvider = 'heyreach' | 'internal' | 'email';
export type OutreachCampaignStatus = 'active' | 'paused' | 'closed' | 'draft';
export type OutreachChannel = 'linkedin_dm' | 'email';
export type OutreachDirection = 'in' | 'out';

export type OutreachCampaign = {
  ROWID: string;
  tenant_id: string;
  name: string;
  job_id: string | null;
  provider: OutreachProvider;
  status: OutreachCampaignStatus;
  invites_sent: number;
  accepted: number;
  replied: number;
  meeting_booked: number;
  started_at: string;
  created_at: string;
};

export type OutreachInboxRow = {
  ROWID: string;
  tenant_id: string;
  campaign_id: string | null;
  contact_name: string;
  contact_linkedin: string | null;
  contact_company: string | null;
  contact_role: string | null;
  channel: OutreachChannel;
  direction: OutreachDirection;
  body: string;
  sent_at: string;
  is_read: boolean;
  needs_response: boolean;
  created_at: string;
};

const tableReady: { campaigns: boolean | null; inbox: boolean | null } = {
  campaigns: null,
  inbox: null,
};

async function probeTable(req: IncomingMessage, name: 'campaigns' | 'inbox'): Promise<boolean> {
  if (tableReady[name] !== null) return tableReady[name] as boolean;
  const tableName = name === 'campaigns' ? TABLE_CAMPAIGNS : TABLE_INBOX;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${tableName} LIMIT 1`);
    tableReady[name] = true;
  } catch {
    tableReady[name] = false;
  }
  return tableReady[name] as boolean;
}

export function _resetTableReadyForTests() {
  tableReady.campaigns = null;
  tableReady.inbox = null;
}

// ===== Campaigns =====

export async function listOutreachCampaigns(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  if (!(await probeTable(ctx.req, 'campaigns'))) {
    sendJson(ctx.res, 200, { campaigns: [], table_ready: false });
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const jobId = url.searchParams.get('job_id');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100)));

  const filters = [`tenant_id = '${escapeSql(tenantId)}'`];
  if (status) filters.push(`status = '${escapeSql(status)}'`);
  if (jobId) filters.push(`job_id = '${escapeSql(jobId)}'`);

  const q = `SELECT * FROM ${TABLE_CAMPAIGNS} WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  const rows = unwrapRows<OutreachCampaign>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE_CAMPAIGNS);

  sendJson(ctx.res, 200, { campaigns: rows, count: rows.length, table_ready: true });
}

export async function createOutreachCampaign(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'campaigns'))) {
    sendJson(ctx.res, 503, {
      error: 'OutreachCampaigns table not ready — pending Catalyst Datastore creation.',
    });
    return;
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  if (typeof body.name !== 'string' || !body.name.trim()) throw new ValidationError('name required');
  const provider = (typeof body.provider === 'string' ? body.provider : 'internal') as OutreachProvider;
  if (!['heyreach', 'internal', 'email'].includes(provider)) {
    throw new ValidationError('provider must be heyreach|internal|email');
  }
  // Por ahora solo permitimos crear campañas internal/email desde el dashboard.
  // Las heyreach se crean en la herramienta externa y aparecen acá vía webhook.
  if (provider === 'heyreach') {
    throw new ValidationError('HeyReach campaigns must be created in HeyReach UI; they sync via webhook');
  }

  const status = (typeof body.status === 'string' ? body.status : 'draft') as OutreachCampaignStatus;
  if (!['active', 'paused', 'closed', 'draft'].includes(status)) {
    throw new ValidationError('invalid status');
  }

  const row = await datastore(ctx.req).table(TABLE_CAMPAIGNS).insertRow({
    tenant_id: tenantId,
    name: body.name.trim().slice(0, 255),
    job_id: typeof body.job_id === 'string' ? body.job_id : null,
    provider,
    status,
    invites_sent: 0,
    accepted: 0,
    replied: 0,
    meeting_booked: 0,
    started_at: now(),
    created_at: now(),
  });

  void auditLog(ctx, {
    action: 'outreach.campaign_create',
    resource_type: 'outreach_campaign',
    resource_id: (row as { ROWID?: string }).ROWID ?? '',
    changes: { name: body.name, provider, status },
  });

  sendJson(ctx.res, 201, { campaign: row });
}

// ===== Inbox =====

export async function listOutreachInbox(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  if (!(await probeTable(ctx.req, 'inbox'))) {
    sendJson(ctx.res, 200, { messages: [], table_ready: false });
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const filter = url.searchParams.get('filter') ?? 'all';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));

  const filters = [`tenant_id = '${escapeSql(tenantId)}'`];
  if (filter === 'needs_response') filters.push('needs_response = true');
  else if (filter === 'unread') filters.push('is_read = false');

  const q = `SELECT * FROM ${TABLE_INBOX} WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  const rows = unwrapRows<OutreachInboxRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE_INBOX);

  sendJson(ctx.res, 200, { messages: rows, count: rows.length, table_ready: true });
}

export async function patchOutreachInboxItem(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'inbox'))) {
    sendJson(ctx.res, 503, { error: 'OutreachInbox table not ready' });
    return;
  }
  const id = ctx.req.url?.match(/^\/api\/outreach\/inbox\/([^/]+)/)?.[1];
  if (!id) throw new ValidationError('id missing');

  const existing = unwrapRows<{ ROWID: string; tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tenant_id FROM ${TABLE_INBOX} WHERE ROWID = '${escapeSql(id)}' LIMIT 1`,
    )) as unknown[],
    TABLE_INBOX,
  )[0];
  if (!existing || existing.tenant_id !== tenantId) throw new NotFoundError('Message not found');

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const patch: { ROWID: string; is_read?: boolean; needs_response?: boolean } = { ROWID: id };
  if (typeof body.is_read === 'boolean') patch.is_read = body.is_read;
  if (typeof body.needs_response === 'boolean') patch.needs_response = body.needs_response;
  if (Object.keys(patch).length === 1) throw new ValidationError('nothing to update');

  await datastore(ctx.req).table(TABLE_INBOX).updateRow(patch);
  sendJson(ctx.res, 200, { updated: true });
}

/**
 * Reply en el inbox. Por ahora: si es heyreach → enquea en outbox para que el cron lo
 * mande via API HeyReach; si es email → enquea email.send_pending; si es internal → solo
 * inserta el out-message en el inbox (sin envío real).
 *
 * Cuando exista el cliente HeyReach (Block 3), `outbox.dispatch('outreach.send_dm')` llama
 * al endpoint real. Hoy queda como evento NOT_IMPLEMENTED — pero la conversación queda
 * registrada en el inbox.
 */
export async function replyOutreachInbox(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'inbox'))) {
    sendJson(ctx.res, 503, { error: 'OutreachInbox table not ready' });
    return;
  }
  const id = ctx.req.url?.match(/^\/api\/outreach\/inbox\/([^/]+)\/reply/)?.[1];
  if (!id) throw new ValidationError('id missing');

  const original = unwrapRows<OutreachInboxRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE_INBOX} WHERE ROWID = '${escapeSql(id)}' LIMIT 1`,
    )) as unknown[],
    TABLE_INBOX,
  )[0];
  if (!original || original.tenant_id !== tenantId) throw new NotFoundError('Message not found');

  const body = await readJsonBody<{ text?: string }>(ctx.req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new ValidationError('text required');

  // Insertar la respuesta como out-message
  await datastore(ctx.req).table(TABLE_INBOX).insertRow({
    tenant_id: tenantId,
    campaign_id: original.campaign_id,
    contact_name: original.contact_name,
    contact_linkedin: original.contact_linkedin,
    contact_company: original.contact_company,
    contact_role: original.contact_role,
    channel: original.channel,
    direction: 'out',
    body: text.slice(0, 4000),
    sent_at: now(),
    is_read: true,
    needs_response: false,
    created_at: now(),
  });

  // Marcar el incoming como respondido
  await datastore(ctx.req).table(TABLE_INBOX).updateRow({
    ROWID: id,
    needs_response: false,
    is_read: true,
  });

  // Si es LinkedIn DM y tenemos URL del contacto, enquear envío real via HeyReach.
  // Si es email, enquear via email.send_pending. Sino, queda solo registrado en inbox.
  if (original.channel === 'linkedin_dm' && original.contact_linkedin) {
    // audit fix #24: fireAndForget wrap.
    const { fireAndForget } = await import('../lib/fireAndForget.js');
    fireAndForget('publishOutbox.outreach_send_dm', () =>
      publishOutboxEvent(ctx.req, 'outreach.send_dm', {
        campaign_id: original.campaign_id,
        contact_linkedin_url: original.contact_linkedin,
        message: text,
      }),
    );
  }

  log.info('outreach reply queued', {
    traceId: ctx.traceId,
    inboxId: id,
    channel: original.channel,
  });

  void auditLog(ctx, {
    action: 'outreach.reply',
    resource_type: 'outreach_inbox',
    resource_id: id,
    changes: { channel: original.channel },
  });

  sendJson(ctx.res, 200, { ok: true });
}
