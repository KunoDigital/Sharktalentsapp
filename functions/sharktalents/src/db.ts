/**
 * Database abstraction layer for Catalyst Datastore (ZCQL)
 * Uses zcatalyst-sdk-node v3.x — catalyst.initialize(req)
 */

const catalyst = require('zcatalyst-sdk-node');

function getApp(req: any): any {
  return catalyst.initialize(req);
}

export async function query(req: any, zcql: string): Promise<any[]> {
  console.log('[DB:query]', zcql.substring(0, 80));
  const app = getApp(req);
  const result = await app.zcql().executeZCQLQuery(zcql);
  console.log('[DB:query] rows:', result?.length || 0);
  return result || [];
}

export function flatten(rows: any[], table: string): any[] {
  return rows.map(row => {
    const data = row[table] || row;
    if (data.ROWID && !data.id) data.id = data.ROWID;
    return data;
  });
}

export async function insert(req: any, table: string, data: Record<string, any>): Promise<any> {
  console.log('[DB:insert]', table, 'columns:', Object.keys(data).join(', '));
  console.log('[DB:insert] data:', JSON.stringify(data).substring(0, 200));
  const app = getApp(req);
  try {
    const result = await app.datastore().table(table).insertRow(data);
    console.log('[DB:insert] OK, ROWID:', result?.ROWID);
    return result;
  } catch (err: any) {
    console.error('[DB:insert] FAILED:', err.message);
    console.error('[DB:insert] Error details:', JSON.stringify(err).substring(0, 300));
    throw err;
  }
}

export async function update(req: any, table: string, rowId: string | number, data: Record<string, any>): Promise<any> {
  console.log('[DB:update]', table, rowId);
  const app = getApp(req);
  return await app.datastore().table(table).updateRow({ ROWID: String(rowId), ...data });
}

export async function deleteRow(req: any, table: string, rowId: string | number): Promise<void> {
  console.log('[DB:delete]', table, rowId);
  const app = getApp(req);
  await app.datastore().table(table).deleteRow(String(rowId));
}

export async function queryOne(req: any, zcql: string, table: string): Promise<any | null> {
  const rows = await query(req, zcql);
  const flat = flatten(rows, table);
  return flat.length > 0 ? flat[0] : null;
}

export async function queryAll(req: any, zcql: string, table: string): Promise<any[]> {
  const rows = await query(req, zcql);
  return flatten(rows, table);
}

// Paginated query to get ALL rows (ZCQL limit is 300 per query)
export async function queryAllPaginated(req: any, zcql: string, table: string): Promise<any[]> {
  const allRows: any[] = [];
  let offset = 0;
  const pageSize = 300;
  while (true) {
    const pagedQuery = `${zcql} LIMIT ${pageSize} OFFSET ${offset}`;
    console.log('[DB:paged]', pagedQuery.substring(0, 80), `offset=${offset}`);
    const rows = await query(req, pagedQuery);
    const flat = flatten(rows, table);
    allRows.push(...flat);
    if (flat.length < pageSize) break; // last page
    offset += pageSize;
  }
  console.log('[DB:paged] Total rows:', allRows.length);
  return allRows;
}

export function esc(val: string | number | null): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
