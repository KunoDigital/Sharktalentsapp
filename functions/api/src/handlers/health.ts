import { logger } from '../lib/logger';

const log = logger('HEALTH');

type HealthStatus = {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
  checks: Record<string, { status: 'ok' | 'fail'; latency_ms?: number; reason?: string }>;
};

export async function getHealth(): Promise<HealthStatus> {
  const started = Date.now();
  const checks: HealthStatus['checks'] = {};

  checks.process = { status: 'ok', latency_ms: Date.now() - started };

  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const status: HealthStatus['status'] = allOk ? 'ok' : 'degraded';

  if (status !== 'ok') log.warn('health degraded', { checks });

  return {
    status,
    version: process.env.APP_VERSION ?? '0.0.0',
    timestamp: new Date().toISOString(),
    checks,
  };
}
