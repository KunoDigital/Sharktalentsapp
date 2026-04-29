import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from './helpers';

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

export type TenantInsert = Omit<Tenant, 'ROWID'>;

const TABLE = 'Tenants';

export async function insert(req: IncomingMessage, payload: Omit<TenantInsert, 'created_at' | 'updated_at'>): Promise<Tenant> {
  const table = datastore(req).table(TABLE);
  const row = await table.insertRow({
    ...payload,
    created_at: now(),
    updated_at: now(),
  });
  return unwrapRow<Tenant>(row, TABLE) as Tenant;
}

export async function update(req: IncomingMessage, rowId: string, patch: Partial<TenantInsert>): Promise<Tenant | null> {
  const table = datastore(req).table(TABLE);
  const row = await table.updateRow({
    ROWID: rowId,
    ...patch,
    updated_at: now(),
  });
  return unwrapRow<Tenant>(row, TABLE);
}

export async function getByClerkOrgId(req: IncomingMessage, clerkOrgId: string): Promise<Tenant | null> {
  const query = `SELECT * FROM ${TABLE} WHERE clerk_org_id = '${escapeSql(clerkOrgId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  const rows = unwrapRows<Tenant>(result, TABLE);
  return rows[0] ?? null;
}

export async function getById(req: IncomingMessage, rowId: string): Promise<Tenant | null> {
  const table = datastore(req).table(TABLE);
  const row = await table.getRow(rowId);
  return unwrapRow<Tenant>(row, TABLE);
}
