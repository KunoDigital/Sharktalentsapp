/**
 * Per-request log buffer usando AsyncLocalStorage.
 *
 * Permite que el logger capture todas las entradas de un request (incluso de
 * imports dinámicos / funciones lejanas) y las suba a Stratus al final del request
 * con clave = traceId.
 *
 * Diseñado para uso en Catalyst Functions (Advanced I/O) donde cada instancia
 * atiende 1 request a la vez. Para concurrencia real, AsyncLocalStorage también
 * funciona — cada request tiene su propio store.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  level: LogLevel;
  ts: string;
  prefix: string;
  msg: string;
  meta?: Record<string, unknown>;
};

export type RequestContextStore = {
  traceId: string;
  startedAt: number;
  entries: LogEntry[];
  /** Method + path + status del request. Se setea desde el router. */
  method?: string;
  path?: string;
  status?: number;
  /** tenant + user para correlacionar. */
  tenantId?: string | null;
  userId?: string | null;
};

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithContext<T>(store: RequestContextStore, fn: () => Promise<T>): Promise<T> {
  return storage.run(store, fn);
}

export function getContext(): RequestContextStore | undefined {
  return storage.getStore();
}

export function pushLog(entry: LogEntry): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  // Cap defensivo: 2000 entries por request (más que suficiente).
  if (ctx.entries.length >= 2000) return;
  ctx.entries.push(entry);
}
