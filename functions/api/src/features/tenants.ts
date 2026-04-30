import type { IncomingMessage } from 'http';
import { Webhook } from 'svix';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { sendJson, readRawBody } from '../lib/http';
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
  const { isNew } = await markProcessed(ctx.req, eventId, 'clerk');
  if (!isNew) {
    log.info('duplicate event ignored', { eventId, type: event.type });
    sendJson(ctx.res, 200, { received: true, duplicate: true });
    return;
  }

  sendJson(ctx.res, 200, { received: true });

  processEventAsync(ctx, event).catch((err) => {
    log.error('async processing failed', {
      eventId,
      type: event.type,
      error: (err as Error).message,
    });
  });
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

    case 'user.deleted':
      log.warn('user.deleted received — manual GDPR cleanup may be required', {
        userId: (event.data as ClerkUserEventData).id,
      });
      break;

    default:
      log.debug('unhandled event type', { type: event.type });
  }
}
