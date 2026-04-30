import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';

const log = logger('HEALTH');

type HealthStatus = {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
  checks: Record<string, { status: 'ok' | 'fail'; latency_ms?: number; reason?: string }>;
};

export async function getHealth(ctx: RequestContext): Promise<void> {
  const started = Date.now();
  const checks: HealthStatus['checks'] = {};

  checks.process = { status: 'ok', latency_ms: Date.now() - started };

  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const status: HealthStatus['status'] = allOk ? 'ok' : 'degraded';

  if (status !== 'ok') log.warn('health degraded', { traceId: ctx.traceId, checks });

  const body: HealthStatus = {
    status,
    version: process.env.APP_VERSION ?? '0.0.0',
    timestamp: new Date().toISOString(),
    checks,
  };
  sendJson(ctx.res, status === 'ok' ? 200 : 503, body);
}
