/**
 * Request Log Store — al finalizar cada request, guarda un JSON estructurado en el
 * Catalyst Cache con key = trc_<traceId>. Permite que un script local lea los logs
 * via endpoint /api/_dev/logs/:traceId sin abrir Catalyst Console.
 *
 * 2026-06-05: Stratus (zoho object storage) no se expone en SDK v2.5. File Store del
 * SDK v2.5 tampoco tiene listFiles. Usamos Catalyst Cache que SÍ está en v2.5: put(key,
 * value, expiry), get(key). Default segment, TTL 24h. Para listing usamos un index
 * separado guardado bajo key `log_index` que se actualiza on append.
 */
import type { IncomingMessage } from 'http';
import { catalyst } from './db';
import { getContext } from './requestContext';
import type { RequestContextStore } from './requestContext';

const CACHE_KEY_PREFIX = 'log_';
const CACHE_INDEX_KEY = 'log_index';
// El SDK Cache de Catalyst espera expiry en HORAS (no segundos), rango 1-48.
const TTL_HOURS = 24;
const INDEX_MAX_ENTRIES = 200;

function sanitizeHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, unknown> {
  const SENSITIVE = new Set(['authorization', 'x-clerk-token', 'x-internal-key', 'x-zoho-recruit-secret', 'cookie', 'x-e2e-test-key', 'x-api-key']);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(headers ?? {})) {
    out[k] = SENSITIVE.has(k.toLowerCase()) ? '[REDACTED]' : headers[k];
  }
  return out;
}

function getSegment(req: IncomingMessage): { put: (k: string, v: string, ttl?: number) => Promise<unknown>; getValue: (k: string) => Promise<string> } | null {
  try {
    const cache = (catalyst(req) as unknown as { cache: () => { segment: (id?: string | number) => unknown } }).cache();
    return cache.segment() as { put: (k: string, v: string, ttl?: number) => Promise<unknown>; getValue: (k: string) => Promise<string> };
  } catch (err) {
    process.stderr.write(`[request-log-store] getSegment failed: ${(err as Error)?.message?.slice(0, 200) ?? String(err)}\n`);
    return null;
  }
}

/** Sube el log buffer del request actual al Cache. Fire-and-forget — no rompe response. */
export async function uploadCurrentRequestLog(req: IncomingMessage): Promise<void> {
  const ctx = getContext();
  if (!ctx) return;
  const segment = getSegment(req);
  if (!segment) return;

  const payload = serializeContext(ctx, req);
  const key = `${CACHE_KEY_PREFIX}${ctx.traceId}`;
  try {
    await segment.put(key, JSON.stringify(payload), TTL_HOURS);
    process.stderr.write(`[request-log-store] put OK key=${key} bytes=${JSON.stringify(payload).length}\n`);
    // Mantenemos un index con los últimos N traceIds para que `listRecentTraceIds`
    // pueda devolver algo aunque Cache no tiene listAllKeys.
    await appendToIndex(segment, ctx.traceId).catch((err) => {
      process.stderr.write(`[request-log-store] index append failed: ${(err as Error)?.message?.slice(0, 200) ?? String(err)}\n`);
    });
  } catch (err) {
    process.stderr.write(`[request-log-store] cache put failed traceId=${ctx.traceId}: ${(err as Error)?.message?.slice(0, 200) ?? String(err)}\n`);
  }
}

async function appendToIndex(
  segment: { put: (k: string, v: string, ttl?: number) => Promise<unknown>; getValue: (k: string) => Promise<string> },
  traceId: string,
): Promise<void> {
  let existing: string[] = [];
  try {
    const raw = await segment.getValue(CACHE_INDEX_KEY);
    existing = JSON.parse(raw) as string[];
    if (!Array.isArray(existing)) existing = [];
  } catch { /* no index yet — empezamos vacío */ }
  // Push al frente, dedup, capamos.
  const next = [traceId, ...existing.filter((t) => t !== traceId)].slice(0, INDEX_MAX_ENTRIES);
  await segment.put(CACHE_INDEX_KEY, JSON.stringify(next), TTL_HOURS);
}

function serializeContext(ctx: RequestContextStore, req: IncomingMessage): Record<string, unknown> {
  return {
    traceId: ctx.traceId,
    startedAt: new Date(ctx.startedAt).toISOString(),
    durationMs: Date.now() - ctx.startedAt,
    method: ctx.method ?? req.method ?? 'UNKNOWN',
    path: ctx.path ?? req.url ?? 'UNKNOWN',
    status: ctx.status ?? null,
    tenantId: ctx.tenantId ?? null,
    userId: ctx.userId ?? null,
    headers: sanitizeHeaders(req.headers),
    entries: ctx.entries,
  };
}

/** Descarga un log del Cache por traceId. */
export async function downloadLogByTraceId(req: IncomingMessage, traceId: string): Promise<string | null> {
  const segment = getSegment(req);
  if (!segment) return null;
  try {
    const raw = await segment.getValue(`${CACHE_KEY_PREFIX}${traceId}`);
    return raw || null;
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    // Cache.get tira error si la key no existe.
    if (/not.?found|404|no.*record/i.test(msg)) return null;
    throw err;
  }
}

/** Lista los traceIds más recientes (lee del index que mantenemos en `log_index`). */
export async function listRecentTraceIds(req: IncomingMessage, _day?: string, limit = 50): Promise<string[]> {
  const segment = getSegment(req);
  if (!segment) return [];
  try {
    const raw = await segment.getValue(CACHE_INDEX_KEY);
    const list = JSON.parse(raw) as string[];
    if (!Array.isArray(list)) return [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
