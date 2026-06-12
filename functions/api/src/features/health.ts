import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { getBreakerState } from '../lib/circuitBreaker';
import { getRateLimiterStats } from '../lib/rateLimiter';
import { requireInternalKey } from '../lib/internalAuth';

const log = logger('HEALTH');

type CheckResult = { status: 'ok' | 'fail'; latency_ms?: number; reason?: string };

type HealthStatus = {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
  uptime_sec: number;
  checks: Record<string, CheckResult>;
  metrics?: {
    rate_limiter_buckets: number;
    anthropic_breaker_calls: number;
    anthropic_breaker_failures: number;
  };
};

const STARTED_AT = Date.now();

export async function getHealth(ctx: RequestContext): Promise<void> {
  const checks: Record<string, CheckResult> = {};

  // Process check (siempre ok si llegamos acá)
  checks.process = { status: 'ok' };

  // DB connectivity check (lightweight: SELECT 1 from Tenants LIMIT 1)
  const dbStart = Date.now();
  try {
    await zcql(ctx.req).executeZCQLQuery('SELECT ROWID FROM Tenants LIMIT 1');
    checks.database = { status: 'ok', latency_ms: Date.now() - dbStart };
  } catch (err) {
    checks.database = {
      status: 'fail',
      latency_ms: Date.now() - dbStart,
      reason: (err as Error).message.slice(0, 120),
    };
  }

  // Env vars check (que las críticas estén seteadas, sin exponer valores)
  const requiredEnvs = ['CLERK_SECRET_KEY', 'INTERNAL_API_KEY', 'ANTHROPIC_API_KEY'];
  const missing = requiredEnvs.filter((k) => !process.env[k]);
  checks.env_vars = missing.length === 0
    ? { status: 'ok' }
    : { status: 'fail', reason: `Missing: ${missing.join(', ')}` };

  // Circuit breakers: si Anthropic está abierto, status degraded
  const anthropicBreaker = getBreakerState('anthropic');
  if (anthropicBreaker?.state === 'open') {
    checks.anthropic_breaker = {
      status: 'fail',
      reason: `Open since ${anthropicBreaker.opened_at ? new Date(anthropicBreaker.opened_at).toISOString() : 'unknown'}`,
    };
  } else if (anthropicBreaker?.state === 'half_open') {
    checks.anthropic_breaker = {
      status: 'ok',
      reason: 'recovering (half_open)',
    };
  } else {
    // closed or never used
    checks.anthropic_breaker = { status: 'ok' };
  }

  // Optional integrations: presencia de env vars (no testea conectividad — eso es admin/health-check)
  const optionalIntegrations: Array<{ name: string; envVars: string[] }> = [
    { name: 'zeptomail', envVars: ['ZEPTOMAIL_API_TOKEN'] },
    { name: 'elevenlabs', envVars: [] },  // ElevenLabs solo se usa offline (audio gen)
    { name: 'sentry', envVars: ['SENTRY_DSN'] },
    { name: 'zoho_oauth', envVars: ['ZOHO_OAUTH_CLIENT_ID', 'ZOHO_OAUTH_REFRESH_TOKEN'] },
    { name: 'whatsapp', envVars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] },
    { name: 'heyreach', envVars: ['HEYREACH_API_KEY'] },
    { name: 'slack', envVars: ['SLACK_WEBHOOK_URL'] },
  ];

  for (const integ of optionalIntegrations) {
    const allSet = integ.envVars.every((v) => !!process.env[v]);
    // Status 'ok' si configurado o si es opcional sin configurar (no degrada el sistema general)
    checks[`integration_${integ.name}`] = {
      status: 'ok',
      reason: allSet ? 'configured' : 'not_configured',
    };
  }

  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const status: HealthStatus['status'] = allOk ? 'ok' : 'degraded';

  if (status !== 'ok') log.warn('health degraded', { traceId: ctx.traceId, checks });

  const rateLimiterStats = getRateLimiterStats();

  const body: HealthStatus = {
    status,
    version: process.env.APP_VERSION ?? '0.0.0',
    timestamp: new Date().toISOString(),
    uptime_sec: Math.round((Date.now() - STARTED_AT) / 1000),
    checks,
    metrics: {
      rate_limiter_buckets: rateLimiterStats.total_buckets,
      anthropic_breaker_calls: anthropicBreaker?.total_calls ?? 0,
      anthropic_breaker_failures: anthropicBreaker?.total_failures ?? 0,
    },
  };
  sendJson(ctx.res, status === 'ok' ? 200 : 503, body);
}

/**
 * Health check detallado para admin/observability.
 *
 *   GET /admin/health-check
 *   Headers: X-Internal-Key: <INTERNAL_API_KEY>
 *
 * A diferencia de /health (uptime monitoring, mínima info), este expone:
 * - Pending/failed counts del outbox
 * - State de TODOS los circuit breakers (anthropic, zoho_recruit, heyreach, etc.)
 * - Stats del rate limiter
 * - DB latency
 * - Últimos 5 eventos con error en outbox (para debug rápido)
 *
 * Pensado para que un dashboard interno (Grafana o similar) lo consulte cada 30s,
 * o para que Cris lo cure manualmente cuando hay un incident.
 */
/**
 * GET /api/admin/health-tenant
 * Versión auth=tenant del health check para que Cris lo vea en /alerts o /health en admin.
 * No expone INTERNAL_API_KEY-specific data, pero sí breakers + outbox + alerts.
 */
export async function getTenantHealthCheck(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const { listBreakers } = await import('../lib/circuitBreaker.js');
  const breakers = listBreakers();

  // Outbox stats
  let outboxPending = 0;
  let outboxFailed = 0;
  let outboxOldestPendingMin: number | null = null;
  try {
    const pendingRows = unwrapRows<{ ROWID: string; created_at: string }>(
      (await zcql(ctx.req).executeZCQLQuery(`SELECT ROWID, created_at FROM OutboxEvents WHERE status = 'pending' ORDER BY CREATEDTIME ASC LIMIT 300`)) as unknown[],
      'OutboxEvents',
    );
    outboxPending = pendingRows.length;
    if (pendingRows[0]?.created_at) {
      const ageMs = Date.now() - new Date(pendingRows[0].created_at).getTime();
      outboxOldestPendingMin = Math.round(ageMs / 60000);
    }
    const failedRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(`SELECT ROWID FROM OutboxEvents WHERE status = 'failed'`)) as unknown[],
      'OutboxEvents',
    );
    outboxFailed = failedRows.length;
  } catch { /* table may not exist */ }

  // Alerts críticas abiertas
  let alertsOpenCritical = 0;
  try {
    const rows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(`SELECT ROWID FROM SystemAlerts WHERE status = 'open' AND severity = 'critical'`)) as unknown[],
      'SystemAlerts',
    );
    alertsOpenCritical = rows.length;
  } catch { /* table may not exist */ }

  // 2026-06-04: 500s en la última hora (auto-alertas del router con code = router.unhandled_5xx).
  // Si > 0, el sistema está degradado aunque circuit breakers estén OK — endpoints están rotos.
  let recentUnhandled5xx = 0;
  let recentUnhandled5xxEndpoints: string[] = [];
  try {
    const { formatCatalystDateTime } = await import('../lib/dbHelpers.js');
    const cutoff = formatCatalystDateTime(new Date(Date.now() - 60 * 60_000));
    const rows = unwrapRows<{ resource_id: string; occurrence_count: number }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT resource_id, occurrence_count FROM SystemAlerts
         WHERE code = 'router.unhandled_5xx' AND status = 'open' AND last_occurred_at >= '${cutoff}'
         LIMIT 100`,
      )) as unknown[],
      'SystemAlerts',
    );
    recentUnhandled5xx = rows.reduce((acc, r) => acc + (Number(r.occurrence_count) || 1), 0);
    recentUnhandled5xxEndpoints = Array.from(new Set(rows.map((r) => r.resource_id).filter(Boolean))).slice(0, 10);
  } catch { /* table may not exist */ }

  // Env presence (sin valores)
  const env = {
    zeptomail: !!process.env.ZEPTOMAIL_API_TOKEN,
    twilio_whatsapp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM),
    meta_whatsapp: !!(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_ACCESS_TOKEN),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    zoho_recruit_oauth: !!(process.env.ZOHO_OAUTH_CLIENT_ID && process.env.ZOHO_OAUTH_REFRESH_TOKEN),
    recruiter_notify_email: !!process.env.RECRUITER_NOTIFY_EMAIL,
  };

  // Status global
  const breakersOpen = breakers.filter((b) => b.state === 'open');
  const outboxStuck = outboxOldestPendingMin != null && outboxOldestPendingMin > 30;
  // 2026-06-04: 500s en última hora también degradan el status.
  //   > 0  → degraded (algo está roto pero podría ser puntual)
  //   ≥ 5 alertas distintas O ≥ 50 ocurrencias totales → critical (varios endpoints rotos / loop)
  const many5xxOccurrences = recentUnhandled5xx >= 50;
  const many5xxEndpoints = recentUnhandled5xxEndpoints.length >= 5;
  const status: 'ok' | 'degraded' | 'critical' =
    breakersOpen.length > 1 || alertsOpenCritical > 5 || many5xxOccurrences || many5xxEndpoints ? 'critical'
      : breakersOpen.length > 0 || alertsOpenCritical > 0 || outboxFailed > 0 || outboxStuck || recentUnhandled5xx > 0 ? 'degraded'
        : 'ok';

  sendJson(ctx.res, 200, {
    status,
    checked_at: new Date().toISOString(),
    breakers,
    outbox: { pending: outboxPending, failed: outboxFailed, oldest_pending_min: outboxOldestPendingMin },
    alerts: { open_critical: alertsOpenCritical },
    recent_5xx: {
      count_last_hour: recentUnhandled5xx,
      endpoints: recentUnhandled5xxEndpoints,
    },
    env_configured: env,
  });
}

export async function getAdminHealthCheck(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const startTime = Date.now();

  const breakerNames = ['anthropic', 'zoho_recruit', 'heyreach', 'whisper'];
  const breakers: Record<string, ReturnType<typeof getBreakerState>> = {};
  for (const name of breakerNames) {
    breakers[name] = getBreakerState(name);
  }

  // Outbox counts (best-effort — si tabla no existe, devolvemos null)
  let outbox: {
    pending_count: number | null;
    failed_count: number | null;
    sent_last_24h: number | null;
    recent_failures: Array<{ event_type: string; last_error: string; retry_count: number }>;
  } = { pending_count: null, failed_count: null, sent_last_24h: null, recent_failures: [] };

  try {
    const pendingRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(`SELECT ROWID FROM OutboxEvents WHERE status = 'pending'`)) as unknown[],
      'OutboxEvents',
    );
    outbox.pending_count = pendingRows.length;

    const failedRows = unwrapRows<{ ROWID: string; event_type: string; last_error: string | null; retry_count: number }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, event_type, last_error, retry_count FROM OutboxEvents WHERE status = 'failed' ORDER BY MODIFIEDTIME DESC LIMIT 5`,
      )) as unknown[],
      'OutboxEvents',
    );
    outbox.failed_count = failedRows.length;
    outbox.recent_failures = failedRows.map((r) => ({
      event_type: r.event_type,
      last_error: (r.last_error ?? 'unknown').slice(0, 200),
      retry_count: r.retry_count,
    }));

    // Best-effort: contar sent en las últimas 24h. Si la query falla, queda null.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const sentRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM OutboxEvents WHERE status = 'sent' AND processed_at >= '${escapeSql(since)}'`,
      )) as unknown[],
      'OutboxEvents',
    );
    outbox.sent_last_24h = sentRows.length;
  } catch (err) {
    log.debug('outbox stats unavailable', { error: (err as Error).message });
  }

  // DB latency probe
  const dbStart = Date.now();
  let dbLatency = -1;
  let dbOk = true;
  try {
    await zcql(ctx.req).executeZCQLQuery('SELECT ROWID FROM Tenants LIMIT 1');
    dbLatency = Date.now() - dbStart;
  } catch {
    dbOk = false;
  }

  const rateLimiter = getRateLimiterStats();

  // Determinar status global
  const anyBreakerOpen = Object.values(breakers).some((b) => b?.state === 'open');
  const tooManyPending = (outbox.pending_count ?? 0) > 100;
  const tooManyFailed = (outbox.failed_count ?? 0) > 0;

  const status: 'ok' | 'degraded' | 'critical' =
    !dbOk ? 'critical' :
    anyBreakerOpen || tooManyFailed ? 'degraded' :
    tooManyPending ? 'degraded' :
    'ok';

  sendJson(ctx.res, status === 'critical' ? 503 : 200, {
    status,
    timestamp: new Date().toISOString(),
    response_time_ms: Date.now() - startTime,
    database: {
      ok: dbOk,
      latency_ms: dbLatency,
    },
    circuit_breakers: breakers,
    outbox,
    rate_limiter: rateLimiter,
    env_summary: {
      anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
      clerk_configured: !!process.env.CLERK_SECRET_KEY,
      heyreach_configured: !!process.env.HEYREACH_API_KEY,
      zoho_recruit_configured: !!process.env.ZOHO_RECRUIT_API_URL && !!process.env.ZOHO_RECRUIT_OAUTH_TOKEN,
    },
  });
}

/**
 * Tenant-level integrations status — para Settings UI.
 *
 *   GET /api/integrations/status
 *
 * Devuelve solo qué integraciones tienen env vars configuradas (sin valores).
 * Auth: tenant. No expone secrets ni circuit breaker internals.
 */
export async function getIntegrationsStatus(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const integrations = [
    {
      key: 'anthropic',
      name: 'Anthropic Claude',
      desc: 'IA para drafts, narrativas de reportes, bot decisor.',
      configured: !!process.env.ANTHROPIC_API_KEY,
      required: true,
    },
    {
      key: 'clerk',
      name: 'Clerk',
      desc: 'Auth + organizations multi-tenant.',
      configured: !!process.env.CLERK_SECRET_KEY && !!process.env.CLERK_WEBHOOK_SECRET,
      required: true,
    },
    {
      key: 'zoho_oauth',
      name: 'Zoho OAuth (compartido)',
      desc: 'OAuth refresh token compartido por Recruit / Sign / Bookings / CRM.',
      configured: !!process.env.ZOHO_OAUTH_CLIENT_ID && !!process.env.ZOHO_OAUTH_CLIENT_SECRET && !!process.env.ZOHO_OAUTH_REFRESH_TOKEN,
      required: false,
    },
    {
      key: 'zoho_recruit',
      name: 'Zoho Recruit',
      desc: 'CRM candidatos. Sync saliente + webhook entrante.',
      configured: !!process.env.ZOHO_OAUTH_REFRESH_TOKEN && !!process.env.ZOHO_RECRUIT_WEBHOOK_SECRET,
      required: false,
    },
    {
      key: 'zoho_bookings',
      name: 'Zoho Bookings',
      desc: 'Agendar reuniones con cliente para briefing.',
      configured: !!process.env.ZOHO_OAUTH_REFRESH_TOKEN
        && !!process.env.ZOHO_BOOKINGS_WORKSPACE_ID
        && !!process.env.ZOHO_BOOKINGS_BRIEFING_SERVICE_ID,
      required: false,
    },
    {
      key: 'zoho_sign',
      name: 'Zoho Sign',
      desc: 'Firma electrónica de contratos (cliente) + ofertas (candidato).',
      configured: !!process.env.ZOHO_OAUTH_REFRESH_TOKEN && !!process.env.ZOHO_SIGN_WEBHOOK_SECRET,
      required: false,
    },
    {
      key: 'zoho_sign_contract',
      name: 'Zoho Sign · Template Contrato',
      desc: 'Template del contrato marketing en Sign (ID env var). Sin esto, "Mandar contrato" no funciona.',
      configured: !!process.env.ZOHO_SIGN_CONTRACT_TEMPLATE_ID,
      required: false,
    },
    {
      key: 'zoho_crm',
      name: 'Zoho CRM',
      desc: 'Sync de leads del funnel + clientes. Tag SharkTalents automático.',
      configured: !!process.env.ZOHO_OAUTH_REFRESH_TOKEN && !!process.env.ZOHO_CRM_API_URL,
      required: false,
    },
    {
      key: 'zia',
      name: 'Zia (transcripción)',
      desc: 'Transcripción automática de meetings (webhook entrante).',
      configured: !!process.env.ZIA_WEBHOOK_SECRET,
      required: false,
    },
    {
      key: 'whisper',
      name: 'Whisper (fallback)',
      desc: 'Transcripción fallback cuando Zia no procesa.',
      configured: !!process.env.WHISPER_API_KEY,
      required: false,
    },
    {
      key: 'heyreach',
      name: 'HeyReach',
      desc: 'Outbound LinkedIn — campañas + inbox unificado.',
      configured: !!process.env.HEYREACH_API_URL && !!process.env.HEYREACH_API_KEY
        && !!process.env.HEYREACH_WEBHOOK_SECRET,
      required: false,
    },
    {
      key: 'sentry',
      name: 'Sentry',
      desc: 'Error tracking en producción.',
      configured: !!process.env.SENTRY_DSN,
      required: false,
    },
    {
      key: 'marketing_funnel',
      name: 'Marketing funnel',
      desc: 'Captura de leads desde landing externa.',
      configured: !!process.env.MARKETING_SITE_KEY,
      required: false,
    },
    {
      key: 'turnstile',
      name: 'Cloudflare Turnstile',
      desc: 'Captcha para landing marketing.',
      configured: !!process.env.TURNSTILE_SECRET_KEY,
      required: false,
    },
    {
      key: 'catalyst_files_videos',
      name: 'File Store · candidate videos',
      desc: 'Folder para videos del speaking + preguntas abiertas del candidato.',
      configured: !!process.env.FILESTORE_VIDEO_FOLDER_ID,
      required: false,
    },
    {
      key: 'catalyst_files_english',
      name: 'File Store · english listening',
      desc: 'Folder con los 4 MP3 del listening (CEFR A2/B1/B2/C1).',
      configured: !!process.env.FILESTORE_ENGLISH_AUDIOS_FOLDER_ID,
      required: false,
    },
    {
      key: 'catalyst_files_large',
      name: 'File Store · large content',
      desc: 'Folder para overflow de columnas Text >9.5K (transcripts, reportes grandes).',
      configured: !!process.env.FILESTORE_LARGE_CONTENT_FOLDER_ID,
      required: false,
    },
    {
      key: 'zeptomail',
      name: 'ZeptoMail (transactional email)',
      desc: 'Envío de los 2 emails al cliente (portal_access + report_ready) + recovery_link al candidato.',
      configured: !!process.env.ZEPTOMAIL_API_TOKEN && !!(process.env.ZEPTOMAIL_FROM_EMAIL || 'reportes@sharktalents.ai'),
      required: false,
    },
  ];

  const requiredOk = integrations.filter((i) => i.required && i.configured).length;
  const requiredTotal = integrations.filter((i) => i.required).length;
  const optionalOk = integrations.filter((i) => !i.required && i.configured).length;
  const optionalTotal = integrations.filter((i) => !i.required).length;

  sendJson(ctx.res, 200, {
    integrations,
    summary: {
      required_configured: requiredOk,
      required_total: requiredTotal,
      optional_configured: optionalOk,
      optional_total: optionalTotal,
      health: requiredOk === requiredTotal ? 'ok' : 'incomplete',
    },
  });
}
