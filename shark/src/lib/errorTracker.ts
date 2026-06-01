/**
 * Error tracker frontend — envía errores a Sentry via HTTP envelope endpoint.
 *
 * No-op si VITE_SENTRY_DSN no está configurado (development sin Sentry).
 *
 * Por qué fetch directo en lugar de @sentry/react:
 *   - @sentry/react agrega ~80KB al bundle. Estamos optimizando bundle size.
 *   - El endpoint envelope es estable.
 *   - No usamos features avanzadas (replay, profiling) — solo "algo se rompió → avisame".
 *
 * Captura:
 *   - window.onerror (errores no-controlados)
 *   - window.onunhandledrejection (promesas rechazadas)
 *   - reportError() manual (desde ErrorBoundary)
 */

type ErrorContext = {
  route?: string;
  tenant_id?: string;
  user_id?: string;
  [key: string]: unknown;
};

type ParsedDsn = { host: string; projectId: string; publicKey: string };

function parseDsn(dsn: string): ParsedDsn | null {
  const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { publicKey: match[1], host: match[2], projectId: match[3] };
}

function getDsn(): ParsedDsn | null {
  const raw = import.meta.env.VITE_SENTRY_DSN;
  if (!raw) return null;
  return parseDsn(raw as string);
}

function buildEvent(err: Error, context: ErrorContext) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    level: 'error' as const,
    platform: 'javascript' as const,
    environment: import.meta.env.VITE_SENTRY_ENV ?? 'production',
    release: import.meta.env.VITE_APP_VERSION ?? '0.0.0',
    transaction: context.route ?? location.hash,
    request: {
      url: location.href,
      headers: { 'User-Agent': navigator.userAgent },
    },
    exception: {
      values: [{
        type: err.name ?? 'Error',
        value: err.message,
        stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
      }],
    },
    tags: {
      tenant_id: context.tenant_id,
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

const cachedDsn: ParsedDsn | null = getDsn();
let initialized = false;

export function reportError(err: unknown, context: ErrorContext = {}): void {
  if (!cachedDsn) return;

  const error = err instanceof Error ? err : new Error(String(err));
  const event = buildEvent(error, context);

  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  const url = `https://${cachedDsn.host}/api/${cachedDsn.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_key=${cachedDsn.publicKey}, sentry_client=sharktalents-frontend/1.0`;

  // sendBeacon si está disponible (más confiable en page-unload)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([envelope], { type: 'application/x-sentry-envelope' });
    if (navigator.sendBeacon(url, blob)) return;
  }

  // Fallback: fetch fire-and-forget
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': auth,
    },
    body: envelope,
    keepalive: true,
  }).catch(() => {
    // silent — no logging to console acá (loop si console.error está hookeado)
  });
}

/**
 * Setup de handlers globales. Llamar una vez al boot de la app.
 */
export function initErrorTracker(): void {
  if (initialized || !cachedDsn) return;
  initialized = true;

  window.addEventListener('error', (event) => {
    reportError(event.error ?? new Error(event.message), {
      route: location.hash,
      source: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    reportError(reason, {
      route: location.hash,
      source: 'unhandledrejection',
    });
  });
}
