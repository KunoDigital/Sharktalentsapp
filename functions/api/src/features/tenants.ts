import type { IncomingMessage } from 'http';
import { Webhook } from 'svix';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { ForbiddenError, UnauthorizedError, NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readRawBody, readJsonBody } from '../lib/http';
import { auditLog } from '../lib/auditLog';
import { logger } from '../lib/logger';
import { markProcessed } from '../lib/processedEvents';
import { slugify } from '../lib/slugify';

const log = logger('TENANTS');
const TABLE = 'Tenants';

// ---- Types ----

export type TenantStatus = 'active' | 'suspended' | 'deleted';

export type Tenant = {
  ROWID: string;
  clerk_org_id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  max_active_jobs: number;
  max_candidates_per_month: number;
  features_enabled: string;
  branding_config: string | null;
  billing_email: string | null;
  created_at: string;
  updated_at: string;
};

type TenantInsert = Omit<Tenant, 'ROWID'>;

// ---- DB queries ----

async function insertTenant(
  req: IncomingMessage,
  payload: Omit<TenantInsert, 'created_at' | 'updated_at'>,
): Promise<Tenant> {
  const row = await datastore(req).table(TABLE).insertRow({
    ...payload,
    created_at: now(),
    updated_at: now(),
  });
  return unwrapRow<Tenant>(row, TABLE) as Tenant;
}

async function updateTenant(
  req: IncomingMessage,
  rowId: string,
  patch: Partial<TenantInsert>,
): Promise<Tenant | null> {
  const row = await datastore(req).table(TABLE).updateRow({
    ROWID: rowId,
    ...patch,
    updated_at: now(),
  });
  return unwrapRow<Tenant>(row, TABLE);
}

async function getByClerkOrgId(req: IncomingMessage, clerkOrgId: string): Promise<Tenant | null> {
  const query = `SELECT * FROM ${TABLE} WHERE clerk_org_id = '${escapeSql(clerkOrgId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  const rows = unwrapRows<Tenant>(result, TABLE);
  return rows[0] ?? null;
}

// ---- Middleware: requireTenant ----

export async function requireTenant(ctx: RequestContext): Promise<string> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');

  const clerkOrgId = ctx.user.clerk_org_id;
  if (!clerkOrgId) throw new ForbiddenError('No active organization. Select one.');

  const tenant = await getByClerkOrgId(ctx.req, clerkOrgId);
  if (!tenant) throw new ForbiddenError(`Tenant not provisioned for org ${clerkOrgId}`);
  if (tenant.status !== 'active') throw new ForbiddenError(`Tenant is ${tenant.status}`);

  ctx.tenantId = tenant.ROWID;
  ctx.tenant = {
    id: tenant.ROWID,
    clerk_org_id: tenant.clerk_org_id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
  };
  return tenant.ROWID;
}

// ---- Webhook handler: Clerk → Tenants sync ----

type ClerkOrgEventData = {
  id: string;
  name?: string;
  slug?: string | null;
};

type ClerkUserEventData = {
  id: string;
};

type ClerkEvent =
  | { type: 'organization.created' | 'organization.updated' | 'organization.deleted'; data: ClerkOrgEventData }
  | { type: 'organizationMembership.created' | 'organizationMembership.deleted'; data: { id: string } }
  | { type: 'user.created' | 'user.updated' | 'user.deleted'; data: ClerkUserEventData }
  | { type: string; data: Record<string, unknown> };

export async function handleClerkWebhook(ctx: RequestContext): Promise<void> {
  const rawBody = await readRawBody(ctx.req);
  const wh = new Webhook(env().CLERK_WEBHOOK_SECRET);

  const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
  const svixId = headers['svix-id'] as string | undefined;
  const svixTimestamp = headers['svix-timestamp'] as string | undefined;
  const svixSignature = headers['svix-signature'] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new UnauthorizedError('Missing svix headers');
  }

  let event: ClerkEvent;
  try {
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    throw new UnauthorizedError(`Invalid webhook signature: ${(err as Error).message}`);
  }

  const eventId = svixId;

  // Idempotencia: si ya procesamos este event_id antes, descartamos.
  // Chequeo ANTES de procesar (no marcamos hasta que termine OK).
  const alreadyProcessed = await findProcessedEvent(ctx.req, eventId);
  if (alreadyProcessed) {
    log.info('duplicate event ignored', { eventId, type: event.type });
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  // Procesamiento síncrono — si falla, devolvemos 5xx para que Clerk reintente.
  // Recién al terminar OK marcamos el event_id como procesado.
  // Tradeoff: la respuesta a Clerk puede demorar 1-2s, pero garantizamos durabilidad.
  try {
    await processEventAsync(ctx, event);
    await markProcessed(ctx.req, eventId, 'clerk_webhook');
    sendJson(ctx.res, 200, { received: true });
  } catch (err) {
    log.error('event processing failed — Clerk will retry', {
      eventId,
      type: event.type,
      error: (err as Error).message,
    });
    // 503 → Clerk retry
    sendJson(ctx.res, 503, {
      error: { code: 'processing_failed', message: 'Event processing failed, will be retried' },
    });
  }
}

async function findProcessedEvent(req: import('http').IncomingMessage, eventId: string): Promise<boolean> {
  const query = `SELECT ROWID FROM ProcessedEvents WHERE event_id = '${escapeSql(eventId)}' AND provider = 'clerk_webhook' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<{ ROWID: string }>(result, 'ProcessedEvents').length > 0;
}

async function processEventAsync(ctx: RequestContext, event: ClerkEvent): Promise<void> {
  log.info('processing', { type: event.type, id: event.data.id });

  switch (event.type) {
    case 'organization.created': {
      const data = event.data as ClerkOrgEventData;
      const name = data.name ?? `Org ${data.id}`;
      await insertTenant(ctx.req, {
        clerk_org_id: data.id,
        name,
        slug: data.slug ?? slugify(name),
        plan: 'free',
        status: 'active',
        max_active_jobs: 5,
        max_candidates_per_month: 50,
        features_enabled: JSON.stringify({ mcp: false, api: false, custom_branding: false }),
        branding_config: null,
        billing_email: null,
      });
      break;
    }

    case 'organization.updated': {
      const data = event.data as ClerkOrgEventData;
      const tenant = await getByClerkOrgId(ctx.req, data.id);
      if (tenant) {
        await updateTenant(ctx.req, tenant.ROWID, {
          name: data.name ?? tenant.name,
          slug: data.slug ?? tenant.slug,
        });
      }
      break;
    }

    case 'organization.deleted': {
      const data = event.data as ClerkOrgEventData;
      const tenant = await getByClerkOrgId(ctx.req, data.id);
      if (tenant) {
        await updateTenant(ctx.req, tenant.ROWID, { status: 'deleted' });
      }
      break;
    }

    case 'user.created':
      log.info('user.created — Clerk maneja la auth, nada que sincronizar a nuestro lado', {
        userId: (event.data as ClerkUserEventData).id,
      });
      break;

    case 'user.updated':
      log.debug('user.updated — sin acción a nuestro lado', {
        userId: (event.data as ClerkUserEventData).id,
      });
      break;

    case 'user.deleted': {
      // GDPR / right to erasure: log para que admin pueda hacer cleanup manual
      // (limpiar Candidates por email, Results, AuditLog del user, etc.).
      // Auto-delete agresivo desde webhook es riesgoso — preferimos auditoría.
      const userId = (event.data as ClerkUserEventData).id;
      log.warn('user.deleted received — manual GDPR cleanup may be required', { userId });
      try {
        // Marcar audit log: que existió esa eliminación con un evento sintético.
        await datastore(ctx.req).table('AuditLog').insertRow({
          actor_user: 'system',
          action: 'tenant.delete',
          resource_type: 'user',
          resource_id: userId,
          changes: JSON.stringify({ source: 'clerk_webhook', event: 'user.deleted' }),
          ip: null,
          user_agent: 'clerk-webhook',
          created_at: now(),
        });
      } catch {
        // tolerar fallo de audit (mejor procesar el webhook)
      }
      break;
    }

    case 'organizationMembership.created':
    case 'organizationMembership.updated': {
      // Clerk maneja la membership directamente. Solo logueamos para audit.
      const data = event.data as { id: string; organization?: { id: string }; public_user_data?: { user_id?: string }; role?: string };
      log.info('organizationMembership change', {
        type: event.type,
        membershipId: data.id,
        orgId: data.organization?.id,
        userId: data.public_user_data?.user_id,
        role: data.role,
      });
      break;
    }

    case 'organizationMembership.deleted': {
      const data = event.data as { id: string; organization?: { id: string }; public_user_data?: { user_id?: string } };
      log.warn('organizationMembership deleted', {
        membershipId: data.id,
        orgId: data.organization?.id,
        userId: data.public_user_data?.user_id,
      });
      break;
    }

    case 'organizationInvitation.created':
    case 'organizationInvitation.accepted':
    case 'organizationInvitation.revoked': {
      const data = event.data as { id: string; email_address?: string; organization_id?: string };
      log.info('organizationInvitation event', {
        type: event.type,
        invitationId: data.id,
        orgId: data.organization_id,
        email: data.email_address,
      });
      break;
    }

    default:
      log.debug('unhandled event type', { type: event.type });
  }
}

// ===== Branding (Tenants.branding_config) =====

/**
 * GET /api/tenants/me/branding
 * Devuelve la config actual de branding del tenant del user (parsed + defaults).
 */
export async function getMyBranding(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const tenant = await fetchTenantById(ctx.req, tenantId);
  if (!tenant) throw new NotFoundError(`Tenant ${tenantId} not found`);

  const { parseBranding } = await import('../lib/branding.js');
  const branding = parseBranding(tenant.branding_config);
  sendJson(ctx.res, 200, { branding });
}

/**
 * PATCH /api/tenants/me/branding
 * Actualiza la config de branding del tenant. Body acepta cualquier subset de
 * BrandingConfig — los campos no enviados quedan iguales.
 */
export async function updateMyBranding(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const tenant = await fetchTenantById(ctx.req, tenantId);
  if (!tenant) throw new NotFoundError(`Tenant ${tenantId} not found`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  const { parseBranding, serializeBranding } = await import('../lib/branding.js');
  const current = parseBranding(tenant.branding_config);

  // Merge body sobre current — solo overrides los keys provistos
  const merged = { ...current };
  for (const key of Object.keys(body)) {
    const k = key as keyof typeof current;
    const v = body[key];
    if (v === null) {
      delete merged[k];
    } else if (typeof v === 'string') {
      merged[k] = v as never;
    }
  }

  let serialized: string;
  try {
    serialized = serializeBranding(merged);
  } catch (err) {
    throw new ValidationError(`Invalid branding: ${(err as Error).message}`);
  }

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: tenantId,
    branding_config: serialized,
    updated_at: now(),
  });

  void auditLog(ctx, {
    action: 'tenant.update',
    resource_type: 'tenant',
    resource_id: tenantId,
    changes: { branding_keys_updated: Object.keys(body) },
  });

  log.info('branding updated', { tenantId, keys: Object.keys(body) });
  sendJson(ctx.res, 200, { branding: parseBranding(serialized) });
}

async function fetchTenantById(req: IncomingMessage, tenantId: string): Promise<Tenant | null> {
  const query = `SELECT * FROM ${TABLE} WHERE ROWID = '${escapeSql(tenantId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  const rows = unwrapRows<Tenant>(result, TABLE);
  return rows[0] ?? null;
}
