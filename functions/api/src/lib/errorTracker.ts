/**
 * Error tracker para producción — envía errores a Sentry via HTTP envelope endpoint.
 *
 * Por qué fetch directo en lugar de @sentry/node:
 *   - @sentry/node trae instrumentación pesada (profiling, performance) que no aporta
 *     valor en Catalyst Advanced I/O (functions cortas)
 *   - Cold-start es crítico — agregar dependencia que infla 2MB de bundle no vale
 *   - El endpoint envelope es estable y documentado por Sentry
 *
 * No-op si SENTRY_DSN no está seteado (development/staging sin Sentry).
 *
 * Uso:
 *   import { reportError } from './errorTracker';
 *   try { ... } catch (err) {
 *     reportError(err, { traceId: ctx.traceId, route: '/api/jobs', tenant_id });
 *   }
 *
 * Llamadas son fire-and-forget — nunca rompen el flow del request.
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { logger } from './logger';

const log = logger('SENTRY');

type ErrorContext = {
  traceId?: string;
  route?: string;
  tenant_id?: string;
  user_id?: string;
  [key: string]: unknown;
};

type ParsedDsn = {
  host: string;
  projectId: string;
  publicKey: string;
};

function parseDsn(dsn: string): ParsedDsn | null {
  // Format: https://<publicKey>@<host>/<projectId>
  const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { publicKey: match[1], host: match[2], projectId: match[3] };
}

function getEnvelopeUrl(dsn: ParsedDsn): string {
  return `https://${dsn.host}/api/${dsn.projectId}/envelope/`;
}

function getAuthHeader(dsn: ParsedDsn): string {
  return `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=sharktalents-fetch/1.0`;
}

function buildEvent(err: Error, context: ErrorContext, environment: string, release: string) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    level: 'error',
    platform: 'node',
    server_name: 'catalyst-functions',
    environment,
    release,
    transaction: context.route ?? 'unknown',
    exception: {
      values: [{
        type: err.name ?? 'Error',
        value: err.message,
        stacktrace: err.stack ? {
          frames: parseStack(err.stack),
        } : undefined,
      }],
    },
    tags: {
      tenant_id: context.tenant_id,
      trace_id: context.traceId,
    },
    extra: { ...context },
    user: context.user_id ? { id: context.user_id } : undefined,
  };
}

function parseStack(stack: string): Array<{ filename: string; function?: string; lineno?: number; colno?: number }> {
  return stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const m = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
      if (!m) return null;
      return {
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .reverse();
}

let cachedDsn: ParsedDsn | null | undefined = undefined;

function getDsn(): ParsedDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  const raw = process.env.SENTRY_DSN;
  if (!raw) {
    cachedDsn = null;
    return null;
  }
  cachedDsn = parseDsn(raw);
  if (!cachedDsn) {
    log.warn('SENTRY_DSN set but invalid format');
  }
  return cachedDsn;
}

/**
 * Reporta un error a Sentry. Fire-and-forget — no bloquea el request.
 *
 * Si SENTRY_DSN no está seteado, no-op silencioso.
 */
export function reportError(err: unknown, context: ErrorContext = {}): void {
  const dsn = getDsn();
  if (!dsn) return;

  const error = err instanceof Error ? err : new Error(String(err));
  const event = buildEvent(error, context, process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'production', process.env.APP_VERSION ?? '0.0.0');

  // Sentry envelope format: header line + item header + item payload, separados por \n
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  // Fire and forget — no await, no throw
  fetchWithTimeout(getEnvelopeUrl(dsn), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': getAuthHeader(dsn),
    },
    body: envelope,
    timeoutMs: 5000,
  }).catch((sendErr) => {
    log.warn('failed to post to sentry', { error: (sendErr as Error).message });
  });
}

export function _resetDsnCache(): void {
  cachedDsn = undefined;
}
