import type { RequestContext } from '../lib/context';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import * as tenantsDb from '../db/tenants';

export async function requireTenant(ctx: RequestContext): Promise<string> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');

  const clerkOrgId = ctx.user.clerk_org_id;
  if (!clerkOrgId) throw new ForbiddenError('No active organization. Select one.');

  const tenant = await tenantsDb.getByClerkOrgId(ctx.req, clerkOrgId);
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
