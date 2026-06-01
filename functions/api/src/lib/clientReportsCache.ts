/**
 * Persistencia de reportes generados (multi-candidato + narrativas IA).
 *
 * La tabla `ClientReports` es OPCIONAL (deferred Block 2). Si no existe, el sistema cae
 * al cache in-memory de `lib/reportNarratives.ts` (TTL 1h, eviction LRU). Cuando exista,
 * estos helpers leen primero la tabla y solo regeneran si el report está stale o ausente.
 *
 * Schema esperado de ClientReports (ver MIGRATIONS_BLOCK2.md §2):
 *   - tenant_id Var Char 50
 *   - job_id Var Char 50
 *   - cache_key Var Char 64 (sha256 de input — para invalidación)
 *   - bundle_payload Text (JSON con candidates + narratives + summary)
 *   - status Var Char 20 (default 'active')
 *   - opened_count Int (default 0)
 *   - last_opened_at DateTime (nullable)
 *   - generated_at DateTime
 *   - expires_at DateTime
 */
import type { IncomingMessage } from 'http';
import { datastore, zcql } from './db';
import { escapeSql, unwrapRow, unwrapRows } from './dbHelpers';
import { logger } from './logger';
import { persistLargeJson, loadLargeJson, deleteLargeContent } from './largeContentStore';

const log = logger('CLIENT_REPORTS_CACHE');
const TABLE = 'ClientReports';

export type StoredReport<T> = {
  ROWID: string;
  payload: T;
  generated_at: string;
  expires_at: string;
  opened_count: number;
};

type RowShape = {
  ROWID: string;
  tenant_id: string;
  job_id: string;
  cache_key: string;
  bundle_payload: string;
  status: string;
  opened_count: number;
  last_opened_at: string | null;
  generated_at: string;
  expires_at: string;
};

let tableReady: boolean | null = null; // cache del check (memo per cold-start)

async function checkTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch (err) {
    log.debug('table not ready', { error: (err as Error).message });
    tableReady = false;
  }
  return tableReady;
}

/**
 * Lee un reporte cacheado por cache_key. Devuelve null si la tabla no existe,
 * el row no existe, está revocado, o expiró.
 */
export async function readStoredReport<T>(req: IncomingMessage, cacheKey: string): Promise<StoredReport<T> | null> {
  if (!(await checkTableReady(req))) return null;

  const q = `
    SELECT ROWID, bundle_payload, status, generated_at, expires_at, opened_count
    FROM ${TABLE}
    WHERE cache_key = '${escapeSql(cacheKey)}' AND status = 'active'
    ORDER BY generated_at DESC
    LIMIT 1
  `.replace(/\s+/g, ' ');

  const rows = unwrapRows<RowShape>((await zcql(req).executeZCQLQuery(q)) as unknown[], TABLE);
  const row = rows[0];
  if (!row) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    log.debug('cached report expired', { rowid: row.ROWID });
    return null;
  }

  let payload: T | null;
  try {
    payload = await loadLargeJson<T>(req, row.bundle_payload);
  } catch (err) {
    log.warn('cached report payload not loadable', { rowid: row.ROWID, error: (err as Error).message });
    return null;
  }
  if (payload == null) {
    log.warn('cached report payload empty/unparseable', { rowid: row.ROWID });
    return null;
  }

  return {
    ROWID: row.ROWID,
    payload,
    generated_at: row.generated_at,
    expires_at: row.expires_at,
    opened_count: row.opened_count ?? 0,
  };
}

/** Persiste un reporte en cache. Si la tabla no existe, no-op. */
export async function writeStoredReport<T>(
  req: IncomingMessage,
  args: { tenantId: string; jobId: string; cacheKey: string; payload: T; ttlMs: number },
): Promise<string | null> {
  if (!(await checkTableReady(req))) return null;

  const expiresAt = new Date(Date.now() + args.ttlMs).toISOString();
  const generatedAt = new Date().toISOString();

  let bundlePayload: string;
  try {
    bundlePayload = await persistLargeJson(req, args.payload, 'ClientReports.bundle_payload');
  } catch (err) {
    log.warn('persist bundle_payload failed', { error: (err as Error).message });
    return null;
  }

  try {
    const row = await datastore(req).table(TABLE).insertRow({
      tenant_id: args.tenantId,
      job_id: args.jobId,
      cache_key: args.cacheKey,
      bundle_payload: bundlePayload,
      status: 'active',
      opened_count: 0,
      last_opened_at: null,
      generated_at: generatedAt,
      expires_at: expiresAt,
    });
    const inserted = unwrapRow<{ ROWID: string }>(row, TABLE);
    return inserted?.ROWID ?? null;
  } catch (err) {
    log.warn('write cached report failed', { error: (err as Error).message });
    // Si la inserción falló pero ya subimos el archivo, limpiarlo (best-effort)
    deleteLargeContent(req, bundlePayload).catch(() => {});
    return null;
  }
}

/** Incrementa opened_count y actualiza last_opened_at. Best-effort, fire-and-forget. */
export async function trackOpened(req: IncomingMessage, rowId: string): Promise<void> {
  if (!(await checkTableReady(req))) return;
  try {
    // Catalyst datastore no soporta increment atómico. Leer y escribir.
    const rows = unwrapRows<RowShape>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, opened_count FROM ${TABLE} WHERE ROWID = '${escapeSql(rowId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    );
    const current = rows[0];
    if (!current) return;
    await datastore(req).table(TABLE).updateRow({
      ROWID: rowId,
      opened_count: (current.opened_count ?? 0) + 1,
      last_opened_at: new Date().toISOString(),
    });
  } catch (err) {
    log.warn('track opened failed', { rowid: rowId, error: (err as Error).message });
  }
}

/** Invalida el cache para un job (revoca todos los reportes activos). */
export async function invalidateForJob(req: IncomingMessage, jobId: string): Promise<number> {
  if (!(await checkTableReady(req))) return 0;
  try {
    const rows = unwrapRows<RowShape>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, bundle_payload FROM ${TABLE} WHERE job_id = '${escapeSql(jobId)}' AND status = 'active'`,
      )) as unknown[],
      TABLE,
    );
    let count = 0;
    for (const r of rows) {
      try {
        await datastore(req).table(TABLE).updateRow({ ROWID: r.ROWID, status: 'revoked' });
        // Limpiar File Store si el bundle vivía ahí (no-op si era inline)
        deleteLargeContent(req, r.bundle_payload).catch(() => {});
        count++;
      } catch {
        // continuar con los demás
      }
    }
    log.info('invalidated reports', { jobId, count });
    return count;
  } catch (err) {
    log.warn('invalidate failed', { jobId, error: (err as Error).message });
    return 0;
  }
}

/** Solo para tests — fuerza re-evaluar el check de tabla en próxima call */
export function _resetTableReadyForTests() {
  tableReady = null;
}
