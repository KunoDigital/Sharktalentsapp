/**
 * Outbox processor: corre cada N minutos (cron job o trigger manual via admin).
 * Toma eventos pending de la tabla OutboxEvents y los procesa.
 *
 * Eventos soportados:
 * - email.send_pending → mandar email (pending: integración con Postmark/ZeptoMail)
 * - report.translate_en → traducir un reporte a inglés (pending: integración Anthropic)
 * - sync.recruit → propagar cambio a Zoho Recruit (pending)
 *
 * Endpoint:
 *   POST /admin/outbox/process    (X-Internal-Key)
 *
 * Body opcional: { batch_size: number }  (default 20)
 *
 * NOTA: Esta es una implementación in-memory simple. Cuando un evento falla,
 * incrementa retry_count. Si retry_count >= 5, lo marca como 'failed' y para de reintentarlo.
 * Eventos sent quedan en BD para auditoría (limpiar con un cron separado si es necesario).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { assertTenantId } from '../lib/tenantGuard';
import { unwrapRow, unwrapRows, escapeSql } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { requireInternalKey } from '../lib/internalAuth';
import { COMPETENCIAS as COMPETENCIAS_LIST, resolveCompetenciaId } from '../data/competencias';

const log = logger('OUTBOX');
const T_OUTBOX = 'OutboxEvents';
const MAX_RETRIES = 5;

type OutboxRow = {
  ROWID: string;
  event_type: string;
  payload: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  retry_count: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
};

type ProcessResult = {
  event_id: string;
  event_type: string;
  outcome: 'sent' | 'failed' | 'retried';
  error?: string;
};

async function fetchPending(req: RequestContext['req'], limit: number): Promise<OutboxRow[]> {
  const query = `SELECT * FROM ${T_OUTBOX} WHERE status = 'pending' ORDER BY CREATEDTIME ASC LIMIT ${limit}`;
  const rows = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<OutboxRow>(rows, T_OUTBOX);
}

/**
 * Reset de eventos atascados en 'processing' por más de N minutos.
 *
 * Si un worker crashea entre `markStatus('processing')` y el siguiente markStatus, el row
 * queda colgado. Sin reset, esos eventos nunca más se procesan. Llamar antes de fetchPending
 * en el cron para recuperarlos automáticamente.
 *
 * 5 min es generoso: cualquier dispatch razonable termina antes (timeout Catalyst 30s).
 *
 * 2026-06-04 (audit fix #4 complemento): incorporado junto al claim 'processing' del cron.
 */
async function resetStaleProcessing(req: RequestContext['req'], staleMinutes = 5): Promise<number> {
  // Calculamos cutoff = ahora - N min. Catalyst ZCQL rechaza ISO con Z/T/ms,
  // hay que usar 'YYYY-MM-DD HH:MM:SS'. Bug detectado 2026-06-05: el cron
  // outbox_reset_stuck fallaba 20 veces consecutivas por este formato y Catalyst
  // lo deshabilitó.
  const { formatCatalystDateTime } = await import('../lib/dbHelpers.js');
  const cutoff = formatCatalystDateTime(new Date(Date.now() - staleMinutes * 60_000));
  const query = `SELECT ROWID FROM ${T_OUTBOX} WHERE status = 'processing' AND CREATEDTIME < '${escapeSql(cutoff)}' LIMIT 50`;
  const stale = unwrapRows<{ ROWID: string }>(
    (await zcql(req).executeZCQLQuery(query)) as unknown[],
    T_OUTBOX,
  );
  for (const row of stale) {
    try {
      await datastore(req).table(T_OUTBOX).updateRow({
        ROWID: row.ROWID,
        status: 'pending',
        last_error: `[reset] stuck in processing >${staleMinutes}min, returned to pending`,
      });
    } catch (err) {
      log.warn('failed to reset stuck event', { rowId: row.ROWID, error: (err as Error).message });
    }
  }
  if (stale.length > 0) log.info('reset stuck processing rows', { count: stale.length });
  return stale.length;
}

async function markStatus(
  req: RequestContext['req'],
  rowId: string,
  status: OutboxRow['status'],
  retryCount: number,
  lastError: string | null,
): Promise<void> {
  const patch: { ROWID: string; status: string; retry_count: number; last_error: string | null; processed_at?: string } = {
    ROWID: rowId,
    status,
    retry_count: retryCount,
    last_error: lastError,
  };
  if (status === 'sent' || status === 'failed') {
    patch.processed_at = now();
  }
  await datastore(req).table(T_OUTBOX).updateRow(patch);
}

/**
 * Despacha un evento. Devuelve true si se procesó OK, false si falló.
 *
 * NOTA: Cada handler debe ser idempotente (si se procesa 2 veces, no rompe nada).
 *
 * IMPORTANTE: hasta que las integraciones reales existan, los handlers FALLAN explícitamente
 * en lugar de simular éxito. Esto evita el bug clásico "el sistema dice que mandó N emails
 * sin haber mandado ninguno". Los eventos quedan como `pending` y eventualmente `failed`
 * después de MAX_RETRIES, lo que es visible en `/admin/stats`.
 */
async function dispatch(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  log.info('dispatch event', {
    eventId: event.ROWID,
    type: event.event_type,
    payload_size: event.payload.length,
  });

  switch (event.event_type) {
    case 'email.send_pending':
      return await dispatchEmail(event, req);

    case 'report.translate_en':
    case 'report.translate_es':
      return await dispatchReportTranslation(event);

    case 'sync.recruit':
      return await dispatchRecruitSync(event, req);

    case 'outreach.send_dm':
      return await dispatchOutreachSendDM(event);

    case 'lead.captured':
      return await dispatchLeadToCrm(event, 'New');

    case 'lead.eval_completed':
      return await dispatchLeadToCrm(event, 'Demo Completed');

    case 'briefing.transcript_received':
      return await dispatchBriefingAutoDraft(event, req);

    case 'application.transitioned':
      // Este evento es solo para audit/sync.recruit downstream — el cambio ya
      // se aplicó al pipeline. Marcamos como 'sent' inmediatamente.
      return { ok: true };

    case 'whatsapp.send_text':
      return await dispatchWhatsAppText(event, req);

    case 'whatsapp.send_template':
      return await dispatchWhatsAppTemplate(event, req);

    case 'draft.client_approved':
      return await dispatchDraftClientApproved(event, req);

    case 'draft.client_requested_changes':
      return await dispatchDraftClientRequestedChanges(event, req);

    case 'client.notify.funnel_active':
      return await dispatchClientFunnelActive(event, req);

    case 'client.notify.finalists_ready':
      return await dispatchClientFinalistsReady(event, req);

    case 'application.created':
      return await dispatchApplicationCreated(event, req);

    case 'client.report_feedback':
      return await dispatchClientReportFeedback(event, req);

    case 'job.generate_tech_questions':
      return await dispatchGenerateTechQuestions(event, req);

    case 'job.generate_prescreening_questions':
      return await dispatchGeneratePrescreeningQuestions(event, req);

    default:
      log.warn('unknown event type', { type: event.event_type });
      return { ok: false, error: `Unknown event type: ${event.event_type}` };
  }
}

/**
 * Trigger manual del outbox processor desde la UI (auth tenant en lugar de
 * X-Internal-Key). Útil mientras no haya cron configurado — Cris clickea
 * "Procesar ahora" desde Settings y se mueven los eventos pending.
 *
 * Procesa hasta 5 eventos por llamada (más conservador que el cron).
 */
export async function processOutboxFromTenant(ctx: RequestContext): Promise<void> {
  // Auth via Clerk (tenant) — verificada por el router
  const { requireAuth } = await import('../lib/auth.js');
  await requireAuth(ctx);
  const { requireTenant } = await import('./tenants.js');
  await requireTenant(ctx);

  const pending = await fetchPending(ctx.req, 5);
  const results: ProcessResult[] = [];
  for (const event of pending) {
    try {
      await markStatus(ctx.req, event.ROWID, 'processing', event.retry_count, event.last_error);
      const dispatchResult = await dispatch(event, ctx.req);
      if (dispatchResult.ok) {
        await markStatus(ctx.req, event.ROWID, 'sent', event.retry_count, null);
        results.push({ event_id: event.ROWID, event_type: event.event_type, outcome: 'sent' });
      } else {
        const newRetry = event.retry_count + 1;
        const finalStatus: OutboxRow['status'] = newRetry >= MAX_RETRIES ? 'failed' : 'pending';
        await markStatus(ctx.req, event.ROWID, finalStatus, newRetry, dispatchResult.error ?? 'unknown');
        if (finalStatus === 'failed') {
          void alertOnOutboxFailure(ctx.req, event, dispatchResult.error ?? 'unknown');
        }
        results.push({
          event_id: event.ROWID,
          event_type: event.event_type,
          outcome: finalStatus === 'failed' ? 'failed' : 'retried',
          error: dispatchResult.error,
        });
      }
    } catch (err) {
      log.warn('manual outbox processing failed for event', {
        eventId: event.ROWID, error: (err as Error).message,
      });
      await markStatus(ctx.req, event.ROWID, 'pending', event.retry_count + 1, (err as Error).message);
    }
  }

  log.info('outbox manual trigger done', {
    traceId: ctx.traceId, processed: results.length,
  });
  sendJson(ctx.res, 200, { processed: results.length, results });
}

/**
 * Cronómetro destrabador dedicado (audit fix #19 + pedido de Cris 2026-06-04).
 *
 * Solo recupera eventos colgados en 'processing' >5 min y NO procesa nada nuevo.
 * Pensado para correr cada 2-3 min como cron separado al principal — da redundancia:
 * si el cron principal está caído o saturado, este sigue recuperando eventos.
 *
 *   POST /admin/outbox/reset-stuck
 *   Headers: X-Internal-Key: <INTERNAL_API_KEY>
 *   Body opcional: {"stale_minutes": 5}
 */
export async function resetStuckOutboxEvents(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  let staleMin = 5;
  try {
    const body = (await readJsonBody(ctx.req)) as { stale_minutes?: unknown };
    if (typeof body.stale_minutes === 'number' && body.stale_minutes >= 1 && body.stale_minutes <= 60) {
      staleMin = body.stale_minutes;
    }
  } catch { /* body opcional */ }

  const count = await resetStaleProcessing(ctx.req, staleMin);
  log.info('outbox reset-stuck endpoint', { traceId: ctx.traceId, staleMin, reset: count });
  sendJson(ctx.res, 200, { reset_count: count, stale_minutes: staleMin });
}

export async function processOutbox(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  let body: Record<string, unknown> = {};
  try {
    body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  } catch (err) {
    log.warn('outbox body parse failed, using defaults', {
      traceId: ctx.traceId,
      error: (err as Error).message,
    });
  }
  // 2026-06-04 (audit fix #19): default 5 (era 20). Eventos pesados (tech_questions
  // con Anthropic) tardan ~15s/u — un batch de 20 desborda el timeout 30s de Catalyst.
  // 5 garantiza que el batch entero quepa en 30s en el peor caso. Si el cron corre cada
  // 5 min, drena 60 eventos/h (suficiente para casos normales). Para drenes rápidos
  // post-incident, Cris puede llamar el endpoint con batch_size más alto manualmente.
  const batchSize = Math.min(100, Math.max(1, Number(body.batch_size ?? 5)));

  // Recuperar eventos colgados en 'processing' antes de fetch pending — evita pérdida si
  // un worker crasheó a mitad. Best-effort, no romper si falla.
  try { await resetStaleProcessing(ctx.req); } catch { /* tolerar */ }

  const pending = await fetchPending(ctx.req, batchSize);
  log.info('processing batch', { traceId: ctx.traceId, count: pending.length });

  const results: ProcessResult[] = [];

  for (const event of pending) {
    try {
      // 2026-06-04 (audit fix #4): claim antes de despachar para evitar que el cron y el
      // trigger manual procesen el mismo evento al mismo tiempo. Mismo patrón usado por
      // processOutboxFromTenant. Sin esto, si cron + manual coinciden, el cliente recibe
      // 2 emails idénticos.
      await markStatus(ctx.req, event.ROWID, 'processing', event.retry_count, event.last_error);

      const dispatchResult = await dispatch(event, ctx.req);

      if (dispatchResult.ok) {
        await markStatus(ctx.req, event.ROWID, 'sent', event.retry_count, null);
        results.push({ event_id: event.ROWID, event_type: event.event_type, outcome: 'sent' });
      } else {
        const newRetryCount = event.retry_count + 1;
        const finalStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';
        await markStatus(ctx.req, event.ROWID, finalStatus, newRetryCount, dispatchResult.error ?? null);
        if (finalStatus === 'failed') {
          void alertOnOutboxFailure(ctx.req, event, dispatchResult.error ?? 'unknown');
        }
        results.push({
          event_id: event.ROWID,
          event_type: event.event_type,
          outcome: finalStatus === 'failed' ? 'failed' : 'retried',
          error: dispatchResult.error,
        });
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      const newRetryCount = event.retry_count + 1;
      const finalStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';
      await markStatus(ctx.req, event.ROWID, finalStatus, newRetryCount, errorMsg);
      if (finalStatus === 'failed') {
        void alertOnOutboxFailure(ctx.req, event, errorMsg);
      }
      results.push({
        event_id: event.ROWID,
        event_type: event.event_type,
        outcome: finalStatus === 'failed' ? 'failed' : 'retried',
        error: errorMsg,
      });
    }
  }

  log.info('batch processed', {
    traceId: ctx.traceId,
    processed: results.length,
    sent: results.filter((r) => r.outcome === 'sent').length,
    retried: results.filter((r) => r.outcome === 'retried').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
  });

  sendJson(ctx.res, 200, {
    batch_size: batchSize,
    processed: results.length,
    results,
  });
}

/**
 * Helper público (para uso desde otros features): publica un evento al outbox.
 *
 * Uso:
 *   import { publishOutboxEvent } from './outbox';
 *   await publishOutboxEvent(ctx.req, 'email.send_pending', { to: 'x', template: 'y' });
 */
export async function publishOutboxEvent(
  req: RequestContext['req'],
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  if (!eventType || typeof eventType !== 'string') {
    throw new ValidationError('event_type required');
  }
  const inserted = await datastore(req).table(T_OUTBOX).insertRow({
    event_type: eventType,
    payload: stringifyAndTruncate(payload, FIELD_LIMITS.OUTBOX_PAYLOAD, `OutboxEvents.payload[${eventType}]`),
    status: 'pending',
    retry_count: 0,
    last_error: null,
    created_at: now(),
    processed_at: null,
  });
  const row = unwrapRow<OutboxRow>(inserted, T_OUTBOX) as OutboxRow;
  log.info('event published', { type: eventType, id: row.ROWID });
  return { id: row.ROWID };
}

/**
 * Publica + procesa un evento inmediatamente en el mismo request. Útil para casos
 * que necesitan ejecución sincrónica (ej: thank-you email al cliente al capturar
 * el lead — no podemos esperar al cron). El audit trail queda en OutboxEvents
 * igual que cualquier evento publicado.
 *
 * Si el dispatch falla, el evento queda en 'pending' y el cron lo va a retry.
 */
export async function publishAndProcessEvent(
  req: RequestContext['req'],
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; ok: boolean; error?: string }> {
  const { id } = await publishOutboxEvent(req, eventType, payload);

  const eventRow: OutboxRow = {
    ROWID: id,
    event_type: eventType,
    payload: JSON.stringify(payload),
    status: 'pending',
    retry_count: 0,
    last_error: null,
    created_at: now(),
    processed_at: null,
  };

  try {
    const result = await dispatch(eventRow, req);
    if (result.ok) {
      await markStatus(req, id, 'sent', 0, null);
      return { id, ok: true };
    }
    await markStatus(req, id, 'pending', 1, result.error ?? null);
    return { id, ok: false, error: result.error };
  } catch (err) {
    const msg = (err as Error).message;
    await markStatus(req, id, 'pending', 1, msg);
    return { id, ok: false, error: msg };
  }
}

/**
 * Handler de eventos `email.send_pending` usando Catalyst Email Service.
 *
 * Payload esperado:
 *   { to: string, subject: string, template: string, vars: object, from?: string }
 *
 * El template puede ser:
 *   - 'invitation_to_test' (candidato recibe link de prueba)
 *   - 'finalist_ready' (cliente recibe aviso de finalistas)
 *   - 'recovery_link' (candidato pide link nuevo)
 *
 * Resolución de templates en `lib/emailTemplates.ts`.
 */
async function dispatchEmail(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.payload) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Email payload not parseable JSON' };
  }

  const to = typeof payload.to === 'string' ? payload.to : '';
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const template = typeof payload.template === 'string' ? payload.template : '';
  const vars = (typeof payload.vars === 'object' && payload.vars !== null) ? payload.vars as Record<string, unknown> : {};
  const from = typeof payload.from === 'string' ? payload.from : 'no-reply@sharktalents.ai';

  if (!to || !template) {
    return { ok: false, error: 'Email payload missing to/template' };
  }

  // Resolver template + render. emailTemplates.ts expone TEMPLATES + renderTemplate(template, vars).
  let html: string;
  let text = '';
  let resolvedSubject = subject;
  try {
    const { TEMPLATES, renderTemplate, getTemplateWithOverride } = await import('../lib/emailTemplates.js');
    const locale = (typeof payload.locale === 'string' && (payload.locale === 'en' || payload.locale === 'es'))
      ? payload.locale : 'es';
    const tplKey = template as keyof typeof TEMPLATES;
    if (!(tplKey in TEMPLATES)) {
      return { ok: false, error: `Unknown template: ${template}` };
    }
    const tenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : null;
    const tpl = await getTemplateWithOverride(req, tplKey, locale, tenantId);
    const rendered = renderTemplate(tpl, vars as Record<string, string>);
    html = rendered.body_html;
    text = rendered.body_text;
    if (!resolvedSubject) resolvedSubject = rendered.subject;
  } catch (err) {
    return { ok: false, error: `Template render failed: ${(err as Error).message}` };
  }

  // ZeptoMail first (preferred — Cris tiene Zoho One, no costo adicional)
  let zeptoError: string | null = null;
  if (process.env.ZEPTOMAIL_API_TOKEN) {
    try {
      const { sendZeptoMail } = await import('../lib/zeptomailClient.js');
      // Reply-To: si el cliente responde, va al inbox real de Cris (no a un buzón vacío
      // del sender transactional). Configurable via env, default proyectos@kunodigital.com.
      const replyToEmail = process.env.ZEPTOMAIL_REPLY_TO || 'proyectos@kunodigital.com';
      const result = await sendZeptoMail({
        to: { email: to },
        subject: resolvedSubject,
        htmlBody: html,
        textBody: text,
        replyTo: { email: replyToEmail, name: 'SharkTalents' },
      });
      if (result.ok) {
        log.info('email sent (zeptomail)', { to: maskEmail(to), template, messageId: result.messageId });
        await trackEmailCost(req, payload, template);
        return { ok: true };
      }
      zeptoError = result.error;
      log.warn('zeptomail failed, fallback to Catalyst Email Service', { error: result.error });
      // Detectar caso "credit exhausted" → emitir SystemAlert crítica para que Cris se
      // entere en la UI sin debuggear logs. ZeptoMail devuelve TM_5001 + LE_102 +
      // "Resource Limit Exhausted" cuando se agotaron créditos del free tier.
      const errStr = String(result.error ?? '');
      const isCreditExhausted = /TM_5001|LE_102|credit exhausted|resource limit exhausted/i.test(errStr);
      if (isCreditExhausted) {
        log.error('ZEPTOMAIL BILLING: credit exhausted — recharge at zoho.com/zeptomail', {
          template, to: maskEmail(to),
        });
        try {
          const { alertCris } = await import('../lib/alerting.js');
          await alertCris(req, {
            severity: 'critical',
            code: 'zeptomail.credit_exhausted',
            message: 'ZeptoMail se quedó sin créditos. Los emails al candidato/cliente NO se están enviando. Recargá en zoho.com/zeptomail → Billing.',
            context: { template, recipient_masked: maskEmail(to), upstream_error: errStr.slice(0, 300) },
            resourceType: 'integration',
            resourceId: 'zeptomail',
          });
        } catch { /* alertCris ya tolera ausencia de SystemAlerts table */ }
      }
      // Fallthrough al Catalyst Email Service
    } catch (err) {
      zeptoError = (err as Error).message;
      log.warn('zeptomail import failed, fallback', { error: zeptoError });
    }
  } else {
    zeptoError = 'ZEPTOMAIL_API_TOKEN not set';
  }

  // Fallback: Catalyst Email Service.
  try {
    const { catalyst } = await import('../lib/db.js');
    const app = catalyst(req) as unknown as {
      email?: () => { sendMail: (opts: { from_email: string; to_email: string[]; subject: string; html_mode?: boolean; content: string }) => Promise<unknown> };
    };
    if (!app.email || typeof app.email !== 'function') {
      return { ok: false, error: `No email backend available. zepto_error=${zeptoError ?? 'none'}; catalyst_email=not_supported` };
    }
    await app.email().sendMail({
      from_email: from,
      to_email: [to],
      subject: resolvedSubject,
      html_mode: true,
      content: html,
    });
    log.info('email sent (catalyst)', { to: maskEmail(to), template, subject: resolvedSubject });
    await trackEmailCost(req, payload, template);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `email failed. zepto_error=${zeptoError ?? 'none'}; catalyst_error=${(err as Error).message}` };
  }
}

/**
 * Best-effort: registra el costo del email en JobCosts si el payload trae job_id.
 * Sin job_id no podemos atribuirlo a un puesto — skip.
 */
async function trackEmailCost(req: RequestContext['req'], payload: Record<string, unknown>, template: string): Promise<void> {
  const jobId = typeof payload.job_id === 'string' ? payload.job_id : undefined;
  if (!jobId) return;
  try {
    const { trackJobCost, SERVICE_COSTS } = await import('../lib/costTracking.js');
    await trackJobCost(req, {
      jobId,
      tenantId: typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined,
      type: 'email',
      amountUsd: SERVICE_COSTS.email_per_send_usd,
      count: 1,
      metadata: { template },
    });
  } catch (err) {
    log.debug('email cost tracking failed', { error: (err as Error).message });
  }
}

function maskEmail(s: string): string {
  if (!s.includes('@')) return '<redacted>';
  const [local, domain] = s.split('@');
  return `${local[0] ?? ''}***@${domain}`;
}

/**
 * Dispatch para `report.translate_en` y `report.translate_es`.
 *
 * Payload esperado: { narratives: NarrativesBundle, target_lang?: 'en'|'es' }
 *   - narratives: el bundle ya generado (con texto fuente).
 *   - target_lang: opcional; si no viene, se deriva del event_type.
 *
 * Llama a Anthropic para traducir manteniendo estructura JSON. Si la traducción tiene
 * éxito, devuelve ok=true; el caller (cron, etc.) es responsable de persistir el resultado
 * cuando ClientReports table esté lista. Hoy, la traducción se loggea y vuelve ok.
 */
async function dispatchReportTranslation(event: OutboxRow): Promise<{ ok: boolean; error?: string }> {
  let payload: { narratives?: unknown; target_lang?: string };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const inferredLang = event.event_type === 'report.translate_en' ? 'en' : 'es';
  const targetLang = payload.target_lang === 'es' || payload.target_lang === 'en'
    ? payload.target_lang
    : inferredLang;

  const narratives = payload.narratives;
  if (!narratives || typeof narratives !== 'object') {
    return { ok: false, error: 'payload.narratives missing or invalid' };
  }

  try {
    const { translateNarrativeBundle } = await import('../lib/reportNarratives.js');
    const translated = await translateNarrativeBundle(
      narratives as Parameters<typeof translateNarrativeBundle>[0],
      targetLang,
      event.ROWID,
    );
    log.info('report translated', {
      eventId: event.ROWID,
      target_lang: targetLang,
      status: translated.status,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `translation failed: ${(err as Error).message}` };
  }
}

/**
 * Dispatch para `lead.captured` y `lead.eval_completed` — sincroniza marketing leads
 * a Zoho CRM. Si CRM no está configurado, devuelve ok (no es crítico — el lead ya
 * está persistido en MarketingLeads).
 */
async function dispatchLeadToCrm(event: OutboxRow, leadStatus: string): Promise<{ ok: boolean; error?: string }> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) return { ok: false, error: 'email required' };

  try {
    const { createLead, _internal: crmInternal } = await import('../lib/zohoCrmClient.js');
    const fullName = typeof payload.contact_name === 'string' ? payload.contact_name : '';
    const { first_name, last_name } = crmInternal.splitName(fullName);

    const result = await createLead({
      email,
      first_name: first_name || undefined,
      last_name: last_name || undefined,
      company: typeof payload.company === 'string' ? payload.company : undefined,
      lead_source: 'SharkTalents Funnel',
      utm_campaign: typeof payload.utm_campaign === 'string' ? payload.utm_campaign : undefined,
      description: `Score: ${payload.score_quality ?? 'N/A'} | Urgency: ${payload.urgency ?? 'N/A'} | Status: ${leadStatus}`,
      // Tag 'SharkTalents' + opcional 'Demo Completed' para distinguir en CRM compartido de Kuno
      tags: leadStatus === 'Demo Completed' ? ['SharkTalents', 'Demo Completed'] : ['SharkTalents'],
    }, event.ROWID);

    if (!result.ok) {
      // Si CRM no está configurado, marcamos como ok igual (el lead vive en
      // MarketingLeads). No queremos retries infinitos en setup inicial.
      if (result.error.includes('not configured')) {
        log.info('crm not configured, lead stays only in MarketingLeads', { eventId: event.ROWID });
        return { ok: true };
      }
      return { ok: false, error: result.error };
    }

    log.info('lead synced to CRM', {
      eventId: event.ROWID,
      crm_lead_id: result.data.id,
      status: leadStatus,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `lead-to-crm sync failed: ${(err as Error).message}` };
  }
}

/**
 * Dispatch para `briefing.transcript_received` — auto-genera draft del job desde el
 * transcript de Zia.
 *
 * Llama Anthropic via drafts.ts logic (sin context HTTP). El draft generado se persiste
 * en JobProfileDrafts (Block 2 deferred). Si la tabla no existe, loggea el draft + marca
 * como sent (Cris puede usar el transcript manualmente).
 */
async function dispatchBriefingAutoDraft(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let raw: { meeting_id?: unknown; transcript_ref?: unknown; transcript?: unknown; booking_id?: unknown };
  try {
    raw = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  // Soporte forward-compat: nuevo formato usa transcript_ref (File Store o inline).
  // Legacy: transcript inline directo (eventos viejos pre-2026-05-08).
  let transcript: string;
  if (typeof raw.transcript_ref === 'string') {
    const { loadLargeContent } = await import('../lib/largeContentStore.js');
    const loaded = await loadLargeContent(req, raw.transcript_ref);
    if (!loaded) return { ok: false, error: 'transcript_ref empty after load' };
    transcript = loaded;
  } else if (typeof raw.transcript === 'string') {
    transcript = raw.transcript;
  } else {
    return { ok: false, error: 'transcript missing in payload (no transcript_ref nor transcript)' };
  }
  if (transcript.length < 100) {
    return { ok: false, error: 'transcript too short' };
  }
  const payload = { ...raw, transcript };

  try {
    const { anthropicMessage, extractJson } = await import('../lib/anthropic.js');
    const { logger } = await import('../lib/logger.js');
    const log2 = logger('AUTO_DRAFT');

    // Reusamos el mismo system prompt que drafts.generateDraft. Lo replicamos acá
    // (no podemos importar el handler porque requiere ctx HTTP).
    const SYSTEM = `Eres un reclutador senior LATAM con 15+ años de experiencia en evaluación conductual DISC y selección de personal IT/comercial/operativo. Tu trabajo: analizar la reunión entre Cris (reclutadora) y su cliente, y armar el perfil ideal del puesto con DISC analizado profundo.

IMPORTANTE — TONO DEL OUTPUT:
- Todo el contenido en ESPAÑOL NEUTRO LATAM (Panamá). NO uses voseo argentino ("vos", "tenés", "querés", "podés", "andá", "tomá", "mirá", "contame", "decime").
- Usa SIEMPRE "tú": "tienes", "quieres", "puedes", "anda", "toma", "mira", "cuéntame", "dime".
- Verbos imperativos en forma "tú": "ten en cuenta" (no "tené en cuenta"), "fíjate" (no "fijate"), "regístrate" (no "registrate").

Tu input: el transcript de una reunión entre la recruiter (Cris) y un cliente.
Tu output: JSON estructurado con el Job Profile Draft.

════════════════════════════════════════════════════════════
TEORÍA DISC — APLICALA EN SERIO, NO ES OPCIONAL
════════════════════════════════════════════════════════════

DISC mide 4 CONDUCTAS OBSERVABLES (no roles, no sectores):

• D (Dominancia): cómo enfrenta DESAFÍOS. Decide rápido, confronta, asume riesgos, busca resultados, no le tiembla decir "no".
• I (Influencia): cómo INFLUENCIA a otros. Persuade, conecta, motiva con energía, expresivo, social.
• S (Estabilidad): cómo responde al CAMBIO y al ritmo. Sostiene rutinas, evita conflicto, paciente, leal, ritmo constante.
• C (Cumplimiento): cómo cumple con REGLAS y procesos. Detalle, busca datos antes de decidir, sigue procesos, teme errores.

POLARIDADES — ESTRUCTURA DEL MODELO:
• D ↔ S = POLARIDAD FUERTE: decidir rápido vs sostener despacio. Si D >= 65, S <= 35 obligatorio.
• I ↔ C = POLARIDAD FUERTE: expresar vs analizar. Si I >= 65, C <= 35 obligatorio.
• D ↔ C = tensión secundaria: velocidad vs precisión. Pueden coexistir altos (PK-04, PK-17) pero ambos no >85.
• I ↔ S = tensión secundaria: energía social vs calma constante.

REGLAS DURAS:
1. Suma D + I + S + C = EXACTAMENTE 200. No 199, no 201.
2. Polaridades fuertes se respetan SIEMPRE (regla anterior).
3. NO generes perfiles "planitos" (todos 45-55). Si te sale así, está mal — releé el transcript y elegí ejes dominantes.
4. UN eje debe ser claramente DOMINANTE (>= 60), salvo perfil neutral muy excepcional.

════════════════════════════════════════════════════════════
CATÁLOGO PK — 27 anchors de Kudert (usalos para identificar curva)
════════════════════════════════════════════════════════════

Cada PK es una "curva" del gráfico DISC. NO importan los valores exactos, importa el PATRÓN (qué ejes son altos, medios, bajos).

PK-01 Flexible/Independiente/Cooperativo: D80 I20 S80 C20 (DS altos / IC bajos)
PK-02 Empático/Brinda apoyo/Escucha: D20 I80 S80 C20 (IS altos / DC bajos)
PK-03 Sociable/Persuasivo/Analítico: D20 I80 S20 C80 (IC altos / DS bajos)
PK-04 Perfeccionista/Planificado/Resultados: D80 I20 S20 C80 (DC altos / IS bajos)
PK-05 Decidido/Tenaz/Competitivo: D100 I35 S30 C35 (D puro extremo)
PK-06 Determinado/Directo/Persuasivo: D80 I80 S20 C20 (DI altos / SC bajos — líder comercial agresivo)
PK-07 Cauteloso/Planificado/Estructurado: D50 I10 S90 C50 (S dominante con orden)
PK-08 Preciso/Analítico/Calidad: D35 I30 S35 C100 (C puro extremo — analista riguroso)
PK-09 Preciso/Cauteloso/Paciente: D20 I20 S80 C80 (SC altos / DI bajos — sostiene calidad)
PK-10 Extrovertido/Entusiasta/Flexible: D50 I90 S10 C50 (I dominante con flexibilidad)
PK-11 Minucioso/Diplomático/Calidad: D0 I70 S50 C80 (IC con D bajísimo — experto suave)
PK-12 Cauteloso/Persuasivo/Cooperativo: D0 I65 S70 C65 (IS C medio — relacional confiable)
PK-13 Moderado/Amigable/Persistente: D10 I50 S90 C50 (S puro con I medio)
PK-14 Persuasivo/Acción/Disfruta retos: D90 I50 S10 C50 (D dominante con I)
PK-15 Comunicativo/Amigable/Multitarea: D10 I90 S50 C50 (I puro extremo)
PK-16 Independiente/Arriesgado/Resultados: D90 I50 S50 C10 (D alto / C muy bajo — emprendedor)
PK-17 Directo/Analítico/Arriesgado: D90 I10 S50 C50 (D + C medio — decisor con datos)
PK-18 Independiente/Sociable/Determinado: D60 I80 S60 C0 (DI medio-alto / C nulo)
PK-19 Socialmente hábil/Considerado/Rápido: D60 I80 S0 C60 (DI altos / S nulo)
PK-20 Pragmático/Cauteloso/Paciente: D60 I0 S80 C60 (DSC sin I — sólido sin show)
PK-21 Sociable/Rápido/Autoconfianza: D50 I90 S50 C10 (I dominante + D medio)
PK-22 Persistente/Estabilidad/Flexible: D50 I50 S90 C10 (S dominante / C bajo)
PK-23 Minucioso/Detalles/Multitarea: D50 I50 S10 C90 (C alto + DI medio)
PK-24 Minucioso/Cauteloso/Estructurado: D50 I10 S50 C90 (C dominante + D medio)
PK-25 Paciente/Estabilidad/Calmado: D35 I30 S100 C35 (S puro extremo)
PK-26 Metódico/Estabilidad/Relaciones: D10 I50 S50 C90 (C dominante + IS medio)
PK-27 Amigable/Comunicativo/Extrovertido: D30 I100 S35 C35 (I puro extremo)

CÓMO USAR EL CATÁLOGO:
1. Identificá qué ejes son ALTOS / MEDIOS / BAJOS según el transcript.
2. Buscá el PK que tiene la MISMA curva (mismos ejes altos/bajos).
3. Usá los valores del PK como BASE, ajustá ±5-15 según el transcript específico.
4. NO te quedes con los valores extremos del PK — ajustá a la realidad del puesto.

════════════════════════════════════════════════════════════
METODOLOGÍA — A + B SIEMPRE (Cris siempre busca 2 perfiles)
════════════════════════════════════════════════════════════

El cliente PIDE cualidades contradictorias casi siempre (rápido + paciente + organizado + comercial). Eso es matemáticamente imposible — D+I+S+C = 200. Hay que ELEGIR.

Cris no obliga al cliente a elegir uno. Genera 2 perfiles VÁLIDOS y busca candidatos que matcheen cualquiera. Esto le da mayor pool y respeta tradeoffs reales.

PASOS:

PASO 1 — Listá CUALIDADES PEDIDAS del transcript
   Extraé TODAS las palabras conductuales que el cliente menciona:
   "rápido", "asertivo", "organizado", "comercial", "directo", "paciente", "creativo", etc.

PASO 2 — Detectá TENSIONES
   Mapeá cada cualidad a su eje y detectá contradicciones:
   - rápido (D-I) + paciente (S) = tensión D↔S
   - expresivo (I) + analítico (C) = tensión I↔C
   - todos arriba = pide imposibles

PASO 3 — Identificá el JEFE del puesto
   Buscá el autorretrato del cliente o referencia al jefe directo del puesto.
   Estimá su DISC en base a cómo se describe ("soy rápida", "soy desordenada", "me gustan los detalles").
   Decidí patrón:
   - COMPENSACIÓN: jefe tiene gap → subordinado lo cubre (jefe desordenado → subordinado ordenado)
   - ALINEAMIENTO: jefe tiene exigencia clara → subordinado se alinea (jefe perfeccionista C alto → subordinado C alto)
   - NEUTRAL: el jefe no condiciona el perfil

PASO 4 — Generá PERFIL A (el más fuerte según el dolor principal del cliente)
   - Identificá el PATRÓN de curva (qué ejes altos/bajos según el transcript)
   - Elegí el PK del catálogo que más se acerca
   - Asigná D/I/S/C ajustando ±5-15 del PK
   - Respetá polaridades (D>=65 → S<=35, I>=65 → C<=35)
   - Suma = 200
   - Describí qué GANA (3-4 cualidades pedidas que cubre) y qué SACRIFICA (1-3 que no)

PASO 5 — Generá PERFIL B (alternativa válida con foco distinto)
   - B NO es A más débil — es un perfil DISTINTO que también cubre el rol
   - A toma un grupo de cualidades, B toma el grupo COMPLEMENTARIO
   - Ejemplo: si A es DC altos (rápido+organizado), B podría ser DI altos (rápido+comercial)
   - B tiene su propio PK anchor + DISC final + gana/sacrifica
   - Suma = 200
   - Respetá polaridades

PASO 6 — Validá
   - A y B son CLARAMENTE distintos (no copias con +/- 5)
   - Ambos son válidos para el rol
   - Suma de cada uno = 200
   - Polaridades cumplidas en ambos
   - Cada uno tiene PK anchor del catálogo

════════════════════════════════════════════════════════════
COMPETENCIAS — CATÁLOGO CERRADO
════════════════════════════════════════════════════════════

3 a 5 competencias siempre. El campo \`name\` DEBE ser uno de estos IDs exactos:

comunicacion_digital, colaboracion, adaptabilidad, iniciativa, planificacion, manejo_ambiguedad, trabajo_equipo, retroalimentacion, orientacion_cliente, aprendizaje_vuelo, resolucion_problemas, inteligencia_emocional, creatividad_innovacion, liderazgo, orientacion_logro, persuasion_negociacion, mentalidad_digital, foco_data, impacto_influencia, autoconfianza, comprension_interpersonal, desarrollo_interrelaciones, orden_calidad, asertividad, dinamismo_energia, habilidad_analitica, perseverancia, orientacion_accion, compromiso_organizacional, actitud_servicio, manejo_conflictos, toma_decisiones_oportuna, calidad_decisiones, capacidad_intelectual, capacidad_escuchar, paciencia, comunicacion_escrita, gestion_riesgo, pensamiento_critico, resiliencia

required_pct entre 60 y 85.

════════════════════════════════════════════════════════════
SCHEMA JSON — TODOS LOS CAMPOS OBLIGATORIOS
════════════════════════════════════════════════════════════

{
  "title": string,
  "sector": string,
  "context_summary": string,
  "cognitive_level": "basic" | "mid" | "senior",
  "modalidad": "Presencial" | "Híbrido" | "Remoto",
  "ubicacion": string,
  "viajes": string,
  "salario": string,
  "reporta_a": string,
  "a_cargo": string,
  "incorporacion": string,
  "objetivo_cargo": string,
  "responsabilidades": [string],            // 3-6 items
  "tareas_especificas": [string],           // 4-8 items
  "herramientas_conocimientos": [string],   // 3-7 items
  "formacion_requerida": string,
  "experiencia_requerida": string,

  // ============ NUEVO: análisis del jefe ============
  "jefe": {
    "descripcion": string,                  // "Luisa, dueña — autoritaria, rápida, comercial"
    "disc_estimado": { "d": int, "i": int, "s": int, "c": int },
    "patron_relacion": "compensacion" | "alineamiento" | "neutral"
  },

  // ============ NUEVO: análisis de cualidades pedidas ============
  "cualidades_pedidas": [string],           // 5-10 cualidades que el cliente menciona
  "tensiones_detectadas": [
    { "ejes": "D vs S" | "I vs C" | "D vs C" | "I vs S", "descripcion": string }
  ],

  // ============ PERFIL A (siempre) ============
  "disc_ideal_a": {
    "patron": string,                       // "DC altos / IS bajos"
    "pk_profile_code": string,              // "PK-04"
    "pk_profile_name": string,              // "Perfeccionista / Planificado / Resultados"
    "d": int, "i": int, "s": int, "c": int, // suma = 200
    "description": [string],                // 3 puntos clave del perfil
    "gana_en": [string],                    // 3-4 cualidades que CUBRE de las pedidas
    "sacrifica": [string]                   // 1-3 cualidades que NO cubre
  },

  // ============ PERFIL B (siempre - alternativa válida) ============
  "disc_ideal_b": {
    "patron": string,
    "pk_profile_code": string,
    "pk_profile_name": string,
    "d": int, "i": int, "s": int, "c": int,
    "description": [string],
    "gana_en": [string],
    "sacrifica": [string]
  },

  // ============ Resto ============
  "velna_ideal": { "verbal": int, "espacial": int, "logica": int, "numerica": int, "abstracta": int },
  "competencias": [
    {
      "name": string,                    // ID exacto del catálogo (ver lista arriba)
      "required_pct": int,                // 60-85
      "que_evaluamos": string             // OBLIGATORIO. 1 oración (15-25 palabras) explicando QUÉ aspecto concreto del rol se evalúa con esta competencia. NO definición genérica del término. SÍ específico al puesto. Ej: "Cómo prioriza decisiones en incidentes productivos sin trabar al equipo"
    }
  ],
  "tech_prompt_seed": string,
  "salary_range_usd": { "min": int, "max": int },
  "tecnica_minimo_pct": int,
  "highlights_from_transcript": [{ "type": "role"|"salary"|"urgency"|"context"|"concern", "text": string }]
}

ANTES DE DEVOLVER:
1. Suma de A = 200, suma de B = 200
2. Polaridades respetadas en ambos
3. A y B son distintos (no copias)
4. competencias entre 3 y 5 con IDs del catálogo
5. cualidades_pedidas tiene al menos 5 items
6. jefe tiene descripcion + disc_estimado + patron_relacion

Si algo no cumple, corregilo antes de devolver el JSON.

Devolvé SOLO el JSON sin markdown ni texto extra.`;

    // DATOS DEL LEAD = fuente de verdad para empresa y contacto. Los pasamos al
    // prompt para que la IA NO use lo que aparezca en el transcript (transcripts
    // tienen typos / nombres mal transcritos por Zia).
    const leadClientName = typeof (payload as Record<string, unknown>).client_name === 'string'
      ? ((payload as Record<string, unknown>).client_name as string).trim() : '';
    const leadClientCompany = typeof (payload as Record<string, unknown>).client_company === 'string'
      ? ((payload as Record<string, unknown>).client_company as string).trim() : '';
    const datosLeadBlock = (leadClientName || leadClientCompany)
      ? `\n\n════════════════════════════════════════════════════════════
DATOS DEL CLIENTE — YA REGISTRADOS EN EL SISTEMA
════════════════════════════════════════════════════════════
Empresa: "${leadClientCompany || '(no informada)'}"
Persona de contacto: "${leadClientName || '(no informada)'}"

IMPORTANTE:
- NO incluyas los campos "company" ni "client_name" en el JSON que devuelvas.
- El sistema los completa automáticamente con los valores de arriba.
- Si el transcript menciona un nombre de empresa distinto (typos de Zia, ej:
  "Cuno digital" cuando es "Kuno Digital"), IGNORALO. Solo importa el dato
  oficial de arriba.
- Tu trabajo es analizar el resto: perfil DISC, competencias, salario, etc.\n`
      : '';

    const response = await anthropicMessage({
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Transcript de la reunión:\n\n${payload.transcript}${datosLeadBlock}` }],
      maxTokens: 5000,
      temperature: 0.4,
    }, event.ROWID);

    const draft = extractJson<Record<string, unknown>>(response);

    // Diagnostic: ver shape exacta devuelta por IA
    log2.info('IA raw response keys', {
      eventId: event.ROWID,
      keys: Object.keys(draft).sort().join(','),
      has_disc_ideal_a: !!draft.disc_ideal_a,
      has_disc_ideal_b: !!draft.disc_ideal_b,
      has_jefe: !!draft.jefe,
      has_cualidades: Array.isArray(draft.cualidades_pedidas),
      has_tensiones: Array.isArray(draft.tensiones_detectadas),
      narrative_count: ['objetivo_cargo','responsabilidades','tareas_especificas','herramientas_conocimientos','formacion_requerida','experiencia_requerida','viajes','reporta_a','a_cargo','incorporacion','modalidad','ubicacion','sector'].filter((k) => draft[k] !== undefined && draft[k] !== null && (typeof draft[k] !== 'string' || (draft[k] as string).length > 0) && (!Array.isArray(draft[k]) || (draft[k] as unknown[]).length > 0)).length,
    });

    // 2026-06-06: defensa runtime para AMBOS perfiles (A y B). Haiku puede ignorar
    // las reglas del prompt — normalizamos antes de persistir.
    // Compat backward: si la IA devolvió disc_ideal (formato viejo) y no disc_ideal_a,
    // lo copiamos como A. Si no devolvió B, lo dejamos null (el adapter del frontend
    // lo tolera).
    if (!draft.disc_ideal_a && draft.disc_ideal) {
      draft.disc_ideal_a = draft.disc_ideal;
    }
    normalizeDiscProfile(draft, 'disc_ideal_a', event.ROWID);
    if (draft.disc_ideal_b) {
      normalizeDiscProfile(draft, 'disc_ideal_b', event.ROWID);
    } else {
      log2.warn('IA no generated perfil B — Cris will need to complete manually', { eventId: event.ROWID });
    }
    // Compat: mantener disc_ideal apuntando a disc_ideal_a por si algún consumer
    // viejo lo lee directo.
    draft.disc_ideal = draft.disc_ideal_a;

    warnIfCompetenciasEmpty(draft, event.ROWID);

    // SEGUNDA DEFENSA: aunque el prompt le diga a la IA usar empresa del lead,
    // si la IA se confunde igualmente la pisamos antes de persistir. El lead
    // siempre manda — no el transcript.
    if (leadClientCompany) {
      draft.company = leadClientCompany;
    }
    if (leadClientName) {
      draft.client_name = leadClientName;
    }

    // Intentar persistir en JobProfileDrafts si existe
    try {
      const { datastore: ds, now: nowFn } = await import('../lib/db.js');
      const { persistLargeContent, persistLargeJson } = await import('../lib/largeContentStore.js');
      const transcriptStored = await persistLargeContent(req, payload.transcript, 'JobProfileDrafts.transcript[zia]');
      const draftPayloadStored = await persistLargeJson(req, draft, 'JobProfileDrafts.draft_payload[zia]');
      // 2026-06-05: ANTES persistía tenant_id=null (asumía que era Cris la que cargaba
      // manualmente). Ahora el flujo manual viene desde uploadBriefingTranscript que
      // inyecta tenant_id en el payload del evento. Si está, lo usamos para que el
      // draft aparezca en el listado filtrado por tenant de Cris.
      // Guard defensivo: si nadie inyectó tenant_id, fallar visible en lugar de
      // crear data huérfana (que es lo que pasó antes).
      const payloadTenantId = (payload as Record<string, unknown>).tenant_id;
      assertTenantId(payloadTenantId, 'dispatchBriefingAutoDraft.JobProfileDrafts.insert');
      const tenantIdForDraft = payloadTenantId;
      // Email + name del cliente (también vienen del upload manual via uploadBriefingTranscript).
      const payloadClientEmail = (payload as Record<string, unknown>).client_email;
      const payloadClientName = (payload as Record<string, unknown>).client_name;
      const payloadClientCompany = (payload as Record<string, unknown>).client_company;
      await ds(req).table('JobProfileDrafts').insertRow({
        tenant_id: tenantIdForDraft,
        meeting_id: typeof payload.meeting_id === 'string' ? payload.meeting_id : null,
        booking_id: typeof payload.booking_id === 'string' ? payload.booking_id : null,
        client_email: typeof payloadClientEmail === 'string' ? payloadClientEmail : null,
        client_name: typeof payloadClientName === 'string' ? payloadClientName : null,
        client_company: typeof payloadClientCompany === 'string' ? payloadClientCompany : null,
        draft_payload: draftPayloadStored,
        transcript: transcriptStored,
        transcript_source: 'zia',
        status: 'draft_generated',
        version: 1,
        created_at: nowFn(),
        updated_at: nowFn(),
      });
      log2.info('auto-draft persisted', {
        eventId: event.ROWID,
        title: draft.title,
        company: draft.company,
      });
    } catch (err) {
      // Tabla puede no existir todavía. Loggeamos el draft completo para que Cris lo
      // pueda recuperar de logs si es necesario, pero retornamos ok=true para no spamear retries.
      log2.warn('JobProfileDrafts table not ready — draft generated but not persisted', {
        eventId: event.ROWID,
        error: (err as Error).message,
        draft_title: draft.title,
        draft_company: draft.company,
      });
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `auto-draft failed: ${(err as Error).message}` };
  }
}

/**
 * Dispatch para `outreach.send_dm` — manda un DM via HeyReach.
 *
 * Payload esperado: { campaign_id: string, contact_linkedin_url: string, message: string }
 */
async function dispatchOutreachSendDM(event: OutboxRow): Promise<{ ok: boolean; error?: string }> {
  let payload: { campaign_id?: unknown; contact_linkedin_url?: unknown; message?: unknown };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  if (typeof payload.campaign_id !== 'string' || typeof payload.contact_linkedin_url !== 'string' || typeof payload.message !== 'string') {
    return { ok: false, error: 'campaign_id + contact_linkedin_url + message required' };
  }

  try {
    const { sendDM } = await import('../lib/heyreachClient.js');
    const result = await sendDM({
      campaign_id: payload.campaign_id,
      contact_linkedin_url: payload.contact_linkedin_url,
      message: payload.message,
    }, event.ROWID);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    log.info('outreach DM sent via heyreach', { eventId: event.ROWID, campaign_id: payload.campaign_id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `outreach send_dm failed: ${(err as Error).message}` };
  }
}

/**
 * Dispatch para `sync.recruit` — propaga un cambio del pipeline a Zoho Recruit.
 *
 * Payload esperado: { application_id, action: 'transition'|'create', tenant_id, job_id,
 *                     from_stage?, to_stage, actor, reason?, transitioned_at }
 *
 * Usa el zohoRecruitClient (que internamente hace OAuth refresh con `ZOHO_OAUTH_*` env vars).
 *
 * Mapeo de stage SharkTalents → Candidate_Status en Recruit:
 *   - 'finalist'    → 'Pre-Screened' (o similar — depende del workflow del cliente en Recruit)
 *   - 'rejected'    → 'Rejected'
 *   - 'auto_rejected_*' → 'Rejected'
 *   - 'hired'       → 'Hired'
 *   - otros stages  → se intenta como custom status; si Recruit rechaza, queda en logs
 */
async function dispatchRecruitSync(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    application_id?: string;
    action?: string;
    tenant_id?: string;
    job_id?: string;
    from_stage?: string;
    to_stage?: string;
    actor?: string;
    reason?: string;
    candidate_id?: string;
    candidate_email?: string;
    candidate_name?: string;
    job_title?: string;
    company?: string;
    recruit_candidate_id?: string;
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  // Verificar config OAuth genérica (la usa zohoRecruitClient via zohoOAuth helper)
  if (!process.env.ZOHO_OAUTH_REFRESH_TOKEN || !process.env.ZOHO_OAUTH_CLIENT_ID) {
    return {
      ok: false,
      error: 'Zoho Recruit not configured — set ZOHO_OAUTH_CLIENT_ID + ZOHO_OAUTH_CLIENT_SECRET + ZOHO_OAUTH_REFRESH_TOKEN',
    };
  }

  // findJobApplication + updateApplicationStatus removidos — REST API de Recruit no
  // permite search por lookup fields. Ahora usamos Deluge function via fetch (ver código abajo).
  const { createRecruitCandidate } = await import('../lib/zohoRecruitClient.js');
  const traceId = event.ROWID;
  const toStage = payload.to_stage ?? '';

  // Mapeo stage SharkTalents → Application Status en Recruit (módulo JobApplications).
  // Estos valores tienen que matchear EXACTAMENTE los Application Statuses configurados
  // por Cris en su Recruit, porque sus workflow rules se disparan al cambiar este field.
  //
  // Etapas que NO están en el mapa NO disparan sync con Recruit — se loguean y skip.
  // Esto es intencional: `finalist`, `interview_scheduled` y `prefilter_*` se manejan
  // fuera de Recruit (manual / cliente).
  // STATUS_MAP confirmado con Cris 2026-06-03 — los valores deben matchear EXACTAMENTE
  // su picklist "Estado de Aplicación" en Solicitudes (Recruit). Cada cambio dispara
  // un workflow rule en Recruit que manda el email/WhatsApp del siguiente paso.
  // intelliscreen = donde se envía la prueba técnica (NO mapeado aquí — entran ahí
  // manualmente o cuando registramos al candidato).
  const STATUS_MAP: Record<string, string> = {
    tecnica_completed: 'Kudert',                     // dispara workflow "02 Prueba DISC"
    conductual_completed: 'veritas',                 // dispara workflow Integridad
    integridad_completed: 'Invitación entrevista',   // dispara workflow Video test
    rejected_by_admin: 'Rejected',
    auto_rejected_low_score: 'Rejected',
    hired: 'hired',
  };
  const applicationStatus = STATUS_MAP[toStage];
  if (payload.action === 'transition' && !applicationStatus) {
    log.info('recruit sync skipped — stage not mapped to Application Status', {
      eventId: event.ROWID, toStage,
    });
    return { ok: true };
  }

  // Payload puede traer recruit_candidate_id (cuando el caller lo conoce); si no viene,
  // intentamos resolverlo desde Candidates.recruit_candidate_id usando candidate_id.
  let recruitCandidateId = payload.recruit_candidate_id ?? null;
  if (!recruitCandidateId && (payload as { candidate_id?: string }).candidate_id) {
    try {
      const candidateId = (payload as { candidate_id: string }).candidate_id;
      const { zcql: zcqlFn } = await import('../lib/db.js');
      const { escapeSql, unwrapRows } = await import('../lib/dbHelpers.js');
      const rows = unwrapRows<{ recruit_candidate_id?: string | null }>(
        (await zcqlFn(req).executeZCQLQuery(
          `SELECT recruit_candidate_id FROM Candidates WHERE ROWID = '${escapeSql(candidateId)}' LIMIT 1`,
        )) as unknown[],
        'Candidates',
      );
      recruitCandidateId = rows[0]?.recruit_candidate_id ?? null;
    } catch (err) {
      log.debug('failed to lookup recruit_candidate_id from Candidates', {
        eventId: event.ROWID, error: (err as Error).message,
      });
    }
  }

  try {
    if (payload.action === 'create' && payload.candidate_email) {
      const parts = (payload.candidate_name ?? '').trim().split(/\s+/).filter(Boolean);
      const firstName = parts[0] || payload.candidate_email.split('@')[0];
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '-';
      const result = await createRecruitCandidate({
        First_Name: firstName,
        Last_Name: lastName,
        Email: payload.candidate_email,
        Source: 'SharkTalents',
        customFields: {
          ...(payload.job_id ? { Job_Opening: payload.job_id } : {}),
        },
      }, traceId);
      if (!result.ok) return { ok: false, error: result.error };
      const recruitId = result.data.data?.[0]?.details?.id ?? '';
      log.info('recruit candidate created', { eventId: event.ROWID, recruit_id: recruitId });

      // Persistir recruit_id en Candidates para futuras transiciones. Si la columna
      // no existe, log warning pero no fallar — el create en Recruit ya fue exitoso.
      const candidateId = (payload as { candidate_id?: string }).candidate_id;
      if (recruitId && candidateId) {
        try {
          // Candidates table NO tiene updated_at (2026-06-03). Sin remover esto, el
          // update fallaba con 400 INVALID_INPUT y nunca se persistía el recruit_id.
          const { datastore } = await import('../lib/db.js');
          await datastore(req).table('Candidates').updateRow({
            ROWID: candidateId,
            recruit_candidate_id: recruitId,
          });
          log.info('recruit_candidate_id persisted', { eventId: event.ROWID, candidateId, recruit_id: recruitId });
        } catch (err) {
          log.warn('Candidates.recruit_candidate_id update failed — may be missing column', {
            eventId: event.ROWID, candidateId, error: (err as Error).message,
          });
        }
      }
      return { ok: true };
    }

    if (payload.action === 'transition') {
      // 2026-06-03: Pivot a Deluge function. La REST API de Recruit no permite search
      // por lookup fields (Candidate_Id, Job_Opening) en Solicitudes/Applications.
      // Pivotamos a llamar una Deluge function (actualizarStatusCandidatoSharkTalents)
      // que recibe directamente el recruit_application_id y actualiza el status.
      // El application_id puede venir en payload (cuando se setea vía admin force-sync)
      // o se busca en Results.recruit_application_id (cuando esa columna esté creada).
      const recruitApplicationIdFromPayload = (payload as { recruit_application_id?: string }).recruit_application_id;
      let recruitApplicationId: string | null = (typeof recruitApplicationIdFromPayload === 'string' && recruitApplicationIdFromPayload)
        ? recruitApplicationIdFromPayload : null;

      // Fallback: buscar en Results.recruit_application_id (si la columna existe)
      if (!recruitApplicationId && payload.application_id) {
        try {
          const { zcql: zcqlFn } = await import('../lib/db.js');
          const { escapeSql: esc, unwrapRows: unr } = await import('../lib/dbHelpers.js');
          const rows = unr<{ recruit_application_id?: string | null }>(
            (await zcqlFn(req).executeZCQLQuery(
              `SELECT recruit_application_id FROM Results WHERE ROWID = '${esc(payload.application_id)}' LIMIT 1`,
            )) as unknown[],
            'Results',
          );
          recruitApplicationId = rows[0]?.recruit_application_id ?? null;
        } catch (err) {
          // La columna puede no existir todavía. Loguear y continuar.
          log.debug('Results.recruit_application_id lookup failed (column may be missing)', {
            error: (err as Error).message,
          });
        }
      }

      if (!recruitApplicationId) {
        log.warn('recruit sync skipped — no recruit_application_id available', {
          eventId: event.ROWID, applicationId: payload.application_id,
        });
        return { ok: true };
      }

      const delugeUrl = process.env.ZOHO_DELUGE_UPDATE_STATUS_URL;
      if (!delugeUrl) {
        return { ok: false, error: 'ZOHO_DELUGE_UPDATE_STATUS_URL no configurado en Catalyst env vars' };
      }

      // Call the Deluge function (POST con args como query params — patrón Zoho Functions REST API)
      const callUrl = new URL(delugeUrl);
      callUrl.searchParams.set('application_id', recruitApplicationId);
      callUrl.searchParams.set('new_status', applicationStatus);
      callUrl.searchParams.set('event_id', event.ROWID);

      const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
      const response = await fetchWithTimeout(callUrl.toString(), {
        method: 'POST',
        timeoutMs: 30000,
      });

      const respText = await response.text().catch(() => '');
      if (!response.ok) {
        return { ok: false, error: `Deluge HTTP ${response.status}: ${respText.slice(0, 300)}` };
      }

      // El response de Zoho Functions wrappa el output en details.output (string JSON)
      let delugeResp: { code?: string; details?: { output?: string }; message?: string } = {};
      try { delugeResp = JSON.parse(respText); } catch { /* ignore */ }
      let parsed: { applied?: boolean; action?: string; error?: string; previous_status?: string; new_status?: string; application_id?: string } = {};
      if (delugeResp.details && typeof delugeResp.details.output === 'string') {
        try { parsed = JSON.parse(delugeResp.details.output); } catch { /* ignore */ }
      }

      if (parsed.error) {
        log.warn('Deluge function returned error', {
          eventId: event.ROWID, error: parsed.error, raw: respText.slice(0, 300),
        });
        return { ok: false, error: `Deluge error: ${parsed.error}` };
      }

      log.info('recruit application status synced via Deluge', {
        eventId: event.ROWID,
        recruit_application_id: recruitApplicationId,
        new_status: applicationStatus,
        deluge_action: parsed.action,
        applied: parsed.applied,
        previous_status: parsed.previous_status,
      });
      return { ok: true };
    }

    // Sin recruit_candidate_id no podemos updatear. Marcamos sent (no error) para no spamear retries.
    log.warn('recruit sync skipped — falta recruit_candidate_id o action no soportada', {
      eventId: event.ROWID, action: payload.action, has_recruit_id: !!recruitCandidateId,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `recruit sync failed: ${(err as Error).message}` };
  }
}

/**
 * Lista eventos del outbox para visibilidad admin.
 *
 *   GET /admin/outbox?status=pending&limit=50
 */
/**
 * Listado de outbox events para mostrar en admin (Settings → Operacional).
 * Versión tenant-scoped (auth Clerk) — devuelve solo los últimos 20 eventos.
 */
/**
 * Busca eventos de email enviados a un recipient específico. Filtra cliente-side
 * por el campo `to` del payload (ZCQL no permite JSON extract).
 */
export async function searchOutboxByRecipient(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase();
  if (!email) {
    sendJson(ctx.res, 400, { error: { code: 'email_required', message: 'pass ?email=...' } });
    return;
  }

  try {
    const rows = unwrapRows<OutboxRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, event_type, payload, status, retry_count, last_error, created_at, processed_at
         FROM ${T_OUTBOX}
         WHERE event_type IN ('email.send_pending')
         ORDER BY CREATEDTIME DESC LIMIT 300`,
      )) as unknown[],
      T_OUTBOX,
    );

    const matching = rows.filter((r) => {
      try {
        const p = JSON.parse(r.payload) as { to?: string };
        return typeof p.to === 'string' && p.to.toLowerCase() === email;
      } catch { return false; }
    }).map((r) => {
      let template = '';
      try { template = (JSON.parse(r.payload) as { template?: string }).template ?? ''; } catch { /* ignore */ }
      return {
        id: r.ROWID,
        created_at: r.created_at,
        processed_at: r.processed_at,
        status: r.status,
        template,
        retry_count: r.retry_count,
        last_error: r.last_error,
      };
    });

    sendJson(ctx.res, 200, { count: matching.length, items: matching });
  } catch (err) {
    // 2026-06-04 (audit fix #25): distinguir "tabla no creada" (estado esperado de Block 3
    // deferred, no es error operacional) vs "fallo real de query/throttle" (debe alertar).
    const msg = (err as Error).message ?? '';
    if (isTableMissingError(msg)) {
      sendJson(ctx.res, 200, { count: 0, items: [], code: 'outbox_table_not_ready' });
    } else {
      log.warn('searchOutboxByRecipient query failed', { error: msg });
      sendJson(ctx.res, 503, { error: { code: 'outbox_query_failed', message: msg } });
    }
  }
}

/**
 * Detecta si un error de ZCQL es "la tabla no existe" (Block 3 deferred) vs un error real.
 * Catalyst no devuelve un error_code estable, así que matcheamos texto.
 */
function isTableMissingError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('no such table') ||
    lower.includes('table not found') ||
    lower.includes('does not exist') ||
    lower.includes('invalid_id') ||
    lower.includes('invalid table')
  );
}

export async function listOutboxFromTenant(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const query = `SELECT * FROM ${T_OUTBOX} ORDER BY CREATEDTIME DESC LIMIT 20`;
  try {
    const rows = unwrapRows<OutboxRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      T_OUTBOX,
    );

    // No exponemos el payload completo (puede tener PII / data sensible).
    // Solo metadata útil para timeline.
    const items = rows.map((r) => ({
      id: r.ROWID,
      event_type: r.event_type,
      status: r.status,
      retry_count: r.retry_count,
      last_error: r.last_error,
      created_at: r.created_at,
      processed_at: r.processed_at,
    }));

    sendJson(ctx.res, 200, { items, count: items.length });
  } catch (err) {
    // audit fix #25: 200 con outbox_table_not_ready SOLO si la tabla no existe.
    // Cualquier otro error → 503 para que la UI muestre el error real y vos puedas escalarlo.
    const msg = (err as Error).message ?? '';
    if (isTableMissingError(msg)) {
      log.info('listOutboxFromTenant — table not ready', { error: msg });
      sendJson(ctx.res, 200, { items: [], count: 0, code: 'outbox_table_not_ready' });
    } else {
      log.warn('listOutboxFromTenant failed', { error: msg });
      sendJson(ctx.res, 503, { error: { code: 'outbox_query_failed', message: msg } });
    }
  }
}

export async function listOutbox(ctx: RequestContext): Promise<void> {
  const { requireInternalKey } = await import('../lib/internalAuth.js');
  requireInternalKey(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));

  const filters: string[] = [];
  if (status) filters.push(`status = '${status.replace(/'/g, "''")}'`);
  const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';

  const query = `SELECT * FROM ${T_OUTBOX}${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  try {
    const rows = unwrapRows<OutboxRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      T_OUTBOX,
    );

    // Counts por status (fire-and-forget, no bloquea)
    const allCountsRaw = await zcql(ctx.req).executeZCQLQuery(
      `SELECT status FROM ${T_OUTBOX}`,
    );
    const allRows = unwrapRows<{ status: string }>(allCountsRaw as unknown[], T_OUTBOX);
    const counts: Record<string, number> = {};
    for (const r of allRows) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }

    sendJson(ctx.res, 200, {
      events: rows,
      count: rows.length,
      counts_by_status: counts,
    });
  } catch (err) {
    log.warn('outbox list failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, {
      error: { code: 'outbox_query_failed', message: (err as Error).message },
    });
  }
}

/**
 * Dispatcher para `whatsapp.send_text` — envía mensaje de texto plano via WhatsApp Business.
 *
 * Payload: { to: string, body: string }
 */
async function dispatchWhatsAppText(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: { to?: unknown; body?: unknown; job_id?: unknown; tenant_id?: unknown };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  if (typeof payload.to !== 'string' || typeof payload.body !== 'string') {
    return { ok: false, error: 'whatsapp.send_text requires to + body strings' };
  }

  try {
    const { sendText } = await import('../lib/whatsappDispatcher.js');
    const result = await sendText({ to_phone: payload.to, body: payload.body }, event.ROWID);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    log.info('whatsapp text sent', { eventId: event.ROWID, to_masked: maskPhone(payload.to) });
    await trackWhatsAppCost(req, payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `whatsapp send_text failed: ${(err as Error).message}` };
  }
}

/**
 * Dispatcher para `whatsapp.send_template` — envía mensaje con template aprobado por Meta.
 *
 * Payload: { to: string, template_name: string, language_code: string, params?: string[] }
 *
 * Templates típicos de SharkTalents:
 *   - candidate_invitation_to_test (params: [job_title, link])
 *   - candidate_test_reminder (params: [name])
 *   - finalist_announcement (params: [client_name, job_title])
 */
async function dispatchWhatsAppTemplate(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: { to?: unknown; template_name?: unknown; language_code?: unknown; params?: unknown; job_id?: unknown; tenant_id?: unknown };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  if (typeof payload.to !== 'string' || typeof payload.template_name !== 'string') {
    return { ok: false, error: 'whatsapp.send_template requires to + template_name' };
  }
  const language = typeof payload.language_code === 'string' ? payload.language_code : 'es';
  const params = Array.isArray(payload.params) ? payload.params.filter((p) => typeof p === 'string') as string[] : [];

  try {
    const { sendTemplate } = await import('../lib/whatsappDispatcher.js');
    const result = await sendTemplate(
      {
        to_phone: payload.to,
        template_name: payload.template_name,
        language_code: language,
        components: params.length > 0 ? [{
          type: 'body',
          parameters: params.map((text) => ({ type: 'text' as const, text })),
        }] : undefined,
      },
      event.ROWID,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    log.info('whatsapp template sent', {
      eventId: event.ROWID,
      template: payload.template_name,
      to_masked: maskPhone(payload.to),
    });
    await trackWhatsAppCost(req, payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `whatsapp send_template failed: ${(err as Error).message}` };
  }
}

function maskPhone(phone: string): string {
  if (phone.length < 5) return '<short>';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}

/**
 * Tracking de costo WhatsApp si el payload trae job_id.
 */
async function trackWhatsAppCost(req: RequestContext['req'], payload: { job_id?: unknown; tenant_id?: unknown }): Promise<void> {
  const jobId = typeof payload.job_id === 'string' ? payload.job_id : undefined;
  if (!jobId) return;
  try {
    const { trackJobCost, SERVICE_COSTS } = await import('../lib/costTracking.js');
    await trackJobCost(req, {
      jobId,
      tenantId: typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined,
      type: 'whatsapp',
      amountUsd: SERVICE_COSTS.whatsapp_per_send_usd,
      count: 1,
    });
  } catch (err) {
    log.debug('whatsapp cost tracking failed', { error: (err as Error).message });
  }
}

/**
 * Cuando un OutboxEvent agota retries y queda 'failed', alerta a Cris.
 * Severity = critical para eventos que afectan al candidato/cliente,
 * warning para eventos internos (sync.recruit etc).
 */
async function alertOnOutboxFailure(req: RequestContext['req'], event: OutboxRow, errorMsg: string): Promise<void> {
  try {
    const { alertCris } = await import('../lib/alerting.js');
    // Eventos que afectan UX del cliente o candidato = critical
    const CRITICAL_EVENTS = new Set([
      'email.send_pending',
      'whatsapp.send_text',
      'whatsapp.send_template',
      'draft.client_approved',
      'draft.client_requested_changes',
      'client.notify.funnel_active',
      'client.notify.finalists_ready',
      'job.generate_tech_questions',
    ]);
    const severity = CRITICAL_EVENTS.has(event.event_type) ? 'critical' : 'warning';
    await alertCris(req, {
      severity,
      code: `outbox.failed.${event.event_type}`,
      message: `OutboxEvent "${event.event_type}" agotó ${event.retry_count + 1} retries: ${errorMsg.slice(0, 200)}`,
      context: { event_id: event.ROWID, event_type: event.event_type, error: errorMsg.slice(0, 500) },
      resourceType: 'outbox_event',
      resourceId: event.ROWID,
    });
  } catch (err) {
    log.warn('alertOnOutboxFailure crashed (continuing)', { error: (err as Error).message });
  }
}

// ============================================================
// Client notification handlers (hitos del portal del cliente)
// ============================================================

type DraftRow = {
  ROWID: string;
  tenant_id: string;
  client_email: string | null;
  client_name: string | null;
  draft_payload: string | null;
  job_id: string | null;
};

async function loadDraftForNotify(req: RequestContext['req'], draftId: string): Promise<DraftRow | null> {
  try {
    const rows = unwrapRows<DraftRow>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, client_email, client_name, draft_payload, job_id FROM JobProfileDrafts WHERE ROWID = '${draftId.replace(/'/g, "''")}' LIMIT 1`,
      )) as unknown[],
      'JobProfileDrafts',
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function extractJobTitleFromDraftPayload(payloadJson: string | null): string {
  if (!payloadJson) return 'tu puesto';
  try {
    const p = JSON.parse(payloadJson) as { title?: string; company?: string };
    return p.title || 'tu puesto';
  } catch {
    return 'tu puesto';
  }
}

async function buildClientPortalUrl(req: RequestContext['req'], tenantId: string, clientEmail: string, clientName: string): Promise<string> {
  const { env } = await import('../lib/env.js');
  const { signPortalToken } = await import('../lib/clientPortalTokens.js');
  // Resolver company desde Tenants si está disponible
  let company = 'cliente';
  let agencyName = 'Kuno Digital';
  try {
    const rows = unwrapRows<{ name?: string; agency_name?: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT name, agency_name FROM Tenants WHERE ROWID = '${tenantId.replace(/'/g, "''")}' LIMIT 1`,
      )) as unknown[],
      'Tenants',
    );
    if (rows[0]?.name) agencyName = rows[0].name;
    if (rows[0]?.agency_name) agencyName = rows[0].agency_name;
  } catch { /* fallback to default */ }

  const token = signPortalToken({
    ref: tenantId,
    company,
    client_name: clientName,
    client_email: clientEmail,
    agency_name: agencyName,
    ttl_days: 90,
  });
  return `${env().APP_BASE_URL.replace(/\/$/, '')}/portal/${token}`;
}

function getRecruiterNotifyEmail(): string {
  return process.env.RECRUITER_NOTIFY_EMAIL
    || process.env.ZEPTOMAIL_REPLY_TO
    || 'proyectos@kunodigital.com';
}

async function dispatchDraftClientApproved(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: { tenant_id?: string; draft_id?: string; client_email?: string; job_id?: string | null };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const draftId = payload.draft_id;
  const tenantId = payload.tenant_id;
  if (!draftId || !tenantId) return { ok: false, error: 'draft_id + tenant_id required' };

  const draft = await loadDraftForNotify(req, draftId);
  if (!draft) return { ok: false, error: `draft ${draftId} not found` };

  const clientEmail = (draft.client_email || payload.client_email || '').trim();
  if (!clientEmail) return { ok: false, error: 'client_email missing on draft' };

  const clientName = (draft.client_name || 'cliente').trim();
  const jobTitle = extractJobTitleFromDraftPayload(draft.draft_payload);
  const portalUrl = await buildClientPortalUrl(req, tenantId, clientEmail, clientName);

  // Procesar inline el email para que el cliente lo reciba sin esperar al cron.
  // 2026-06-04 (audit fix #14): propagar el resultado real del child. Antes este
  // dispatcher devolvía siempre ok=true aunque el email falle silenciosamente.
  const result = await publishAndProcessEvent(req, 'email.send_pending', {
    to: clientEmail,
    template: 'client_search_started',
    locale: 'es',
    vars: {
      client_name: clientName,
      job_title: jobTitle,
      portal_url: portalUrl,
      agency_name: 'Kuno Digital',
    },
  });
  log.info('search_started email dispatched', { eventId: event.ROWID, draftId, to: maskEmail(clientEmail), email_ok: result.ok });
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'child email.send_pending failed' };
}

async function dispatchDraftClientRequestedChanges(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: { tenant_id?: string; draft_id?: string; client_email?: string; client_comment?: string };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const draftId = payload.draft_id;
  if (!draftId) return { ok: false, error: 'draft_id required' };

  const draft = await loadDraftForNotify(req, draftId);
  if (!draft) return { ok: false, error: `draft ${draftId} not found` };

  const jobTitle = extractJobTitleFromDraftPayload(draft.draft_payload);
  const clientName = (draft.client_name || 'cliente').trim();
  const clientEmail = (draft.client_email || payload.client_email || '').trim();
  const comment = (payload.client_comment || '').slice(0, 500);

  const { env } = await import('../lib/env.js');
  const adminUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/app/#/drafts/${draftId}`;

  // Email 1 — al RECRUITER (Chris) para que sepa que el cliente pidió cambios.
  const recruiterEmailResult = await publishAndProcessEvent(req, 'email.send_pending', {
    to: getRecruiterNotifyEmail(),
    template: 'recruiter_client_changes_requested',
    locale: 'es',
    vars: {
      client_name: clientName,
      client_email: clientEmail,
      job_title: jobTitle,
      client_comment: comment || '(sin comentario)',
      admin_url: adminUrl,
    },
  });

  // Email 2 — al CLIENTE confirmando que recibimos sus comentarios.
  // 2026-06-07: solicitado por Cris — el cliente nunca recibía confirmación, quedaba
  // con la duda de si su pedido llegó. Ahora siempre le contestamos en automático.
  if (clientEmail) {
    try {
      await publishAndProcessEvent(req, 'email.send_pending', {
        to: clientEmail,
        template: 'client_comments_received',
        locale: 'es',
        vars: {
          client_name: clientName,
          job_title: jobTitle,
          client_comment: comment || '(sin comentario)',
        },
      });
    } catch (err) {
      log.warn('client_comments_received email failed (non-blocking)', { eventId: event.ROWID, error: (err as Error).message });
    }
  }

  log.info('client_changes_requested emails dispatched', { eventId: event.ROWID, draftId, recruiter_ok: recruiterEmailResult.ok });
  // audit fix #14: propagar resultado real del envío al recruiter (lo crítico).
  return recruiterEmailResult.ok ? { ok: true } : { ok: false, error: recruiterEmailResult.error ?? 'child email.send_pending failed' };
}

async function dispatchClientFunnelActive(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: { tenant_id?: string; job_id?: string; client_email?: string; client_name?: string; job_title?: string; candidates_in_tests?: number };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const tenantId = payload.tenant_id;
  const clientEmail = (payload.client_email || '').trim();
  if (!tenantId || !clientEmail) return { ok: false, error: 'tenant_id + client_email required' };

  const clientName = (payload.client_name || 'cliente').trim();
  const jobTitle = payload.job_title || 'tu puesto';
  const count = typeof payload.candidates_in_tests === 'number' && payload.candidates_in_tests > 0
    ? String(payload.candidates_in_tests) : 'varios';

  const portalUrl = await buildClientPortalUrl(req, tenantId, clientEmail, clientName);

  const result = await publishAndProcessEvent(req, 'email.send_pending', {
    to: clientEmail,
    template: 'client_funnel_active',
    locale: 'es',
    vars: {
      client_name: clientName,
      job_title: jobTitle,
      candidates_in_tests: count,
      portal_url: portalUrl,
      agency_name: 'Kuno Digital',
    },
  });
  log.info('funnel_active email dispatched', { eventId: event.ROWID, jobId: payload.job_id, to: maskEmail(clientEmail), email_ok: result.ok });
  // audit fix #14: propagar resultado real del envío.
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'child email.send_pending failed' };
}

/**
 * Generación de tech questions vía Anthropic. Anthropic toma 35-50s — corre acá en
 * un request handler dedicado del processor (60s de margen). Si se publica via
 * `publishAndProcessEvent` desde el endpoint `/generate`, corre inline dentro de
 * ESE request handler (también 60s). Si falla por timeout, queda en pending y el
 * cron lo retoma con su propio handler.
 *
 * Persiste resultado en `Jobs.tech_questions_cache`. En failure, deja un marker
 * JSON `{status:"failed",error:"..."}` para que el GET status lo reporte.
 */
async function dispatchGenerateTechQuestions(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    tenant_id?: string;
    job_id?: string;
    count?: number;
    tech_prompt?: string;
    job_title?: string;
    job_company?: string;
    cognitive_level?: 'basic' | 'mid' | 'senior';
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  const jobId = payload.job_id;
  if (!jobId || !payload.tech_prompt || !payload.job_title) {
    return { ok: false, error: 'job_id + tech_prompt + job_title required' };
  }

  try {
    const { generateTechnicalQuestions } = await import('../lib/techQuestions.js');
    const { persistLargeJson, deleteLargeContent } = await import('../lib/largeContentStore.js');
    const { datastore: ds, now: nowFn } = await import('../lib/db.js');

    const questions = await generateTechnicalQuestions({
      jobTitle: payload.job_title,
      jobCompany: payload.job_company,
      techPrompt: payload.tech_prompt,
      level: payload.cognitive_level ?? 'mid',
      count: payload.count ?? 15,
      traceId: event.ROWID,
      jobId,
      tenantId: payload.tenant_id,
      req,
    });

    // Cargar el cache previo (puede ser file: ref) para limpiarlo después
    const prevRows = unwrapRows<{ tech_questions_cache: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT tech_questions_cache FROM Jobs WHERE ROWID = '${jobId.replace(/'/g, "''")}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const previousCache = prevRows[0]?.tech_questions_cache ?? null;

    const serialized = await persistLargeJson(req, questions, 'Jobs.tech_questions_cache');
    await ds(req).table('Jobs').updateRow({
      ROWID: jobId,
      tech_questions_cache: serialized,
      updated_at: nowFn(),
    });
    // Limpiar el File Store ref anterior si era una referencia (no-op si era inline/marker)
    if (previousCache && previousCache.startsWith('file:')) {
      deleteLargeContent(req, previousCache).catch(() => { /* ignore */ });
    }

    log.info('tech questions generated via outbox', { eventId: event.ROWID, jobId, count: questions.length });
    return { ok: true };
  } catch (err) {
    const e = err as Error & { details?: unknown };
    const msg = e.message || 'unknown error';
    const upstreamBody = (e.details && typeof e.details === 'object' && 'body' in e.details)
      ? String((e.details as { body: unknown }).body).slice(0, 500)
      : null;
    log.warn('tech questions generation failed', { eventId: event.ROWID, jobId, error: msg, upstream_body: upstreamBody });
    try {
      const { datastore: ds, now: nowFn } = await import('../lib/db.js');
      await ds(req).table('Jobs').updateRow({
        ROWID: jobId,
        tech_questions_cache: JSON.stringify({
          status: 'failed',
          error: msg.slice(0, 300),
          upstream_body: upstreamBody,
          failed_at: nowFn(),
        }),
        updated_at: nowFn(),
      });
    } catch { /* ignore persistence error of failure marker */ }
    return { ok: false, error: msg };
  }
}

async function dispatchGeneratePrescreeningQuestions(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    tenant_id?: string;
    job_id?: string;
    tech_prompt?: string;
    job_title?: string;
    job_company?: string;
    salary_range?: { min?: number; max?: number };
    location?: string;
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const jobId = payload.job_id;
  if (!jobId || !payload.tech_prompt || !payload.job_title) {
    return { ok: false, error: 'job_id + tech_prompt + job_title required' };
  }

  try {
    const { generatePrescreeningQuestions } = await import('../lib/prescreeningQuestions.js');
    const { datastore: ds, now: nowFn } = await import('../lib/db.js');

    const questions = await generatePrescreeningQuestions({
      jobTitle: payload.job_title,
      jobCompany: payload.job_company,
      techPrompt: payload.tech_prompt,
      salaryRange: payload.salary_range,
      location: payload.location,
      traceId: event.ROWID,
      jobId,
      tenantId: payload.tenant_id,
      req,
    });

    const serialized = JSON.stringify(questions);
    await ds(req).table('Jobs').updateRow({
      ROWID: jobId,
      prescreening_questions_cache: serialized,
      updated_at: nowFn(),
    });

    log.info('prescreening questions generated via outbox', { eventId: event.ROWID, jobId, count: questions.length });
    return { ok: true };
  } catch (err) {
    const e = err as Error & { details?: unknown };
    const msg = e.message || 'unknown error';
    const upstreamBody = (e.details && typeof e.details === 'object' && 'body' in e.details)
      ? String((e.details as { body: unknown }).body).slice(0, 500)
      : null;
    log.warn('prescreening generation failed', { eventId: event.ROWID, jobId, error: msg, upstream_body: upstreamBody });
    try {
      const { datastore: ds, now: nowFn } = await import('../lib/db.js');
      await ds(req).table('Jobs').updateRow({
        ROWID: jobId,
        prescreening_questions_cache: JSON.stringify({
          status: 'failed',
          error: msg.slice(0, 300),
          upstream_body: upstreamBody,
          failed_at: nowFn(),
        }),
        updated_at: nowFn(),
      });
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }
}

async function dispatchClientFinalistsReady(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    tenant_id?: string; job_id?: string; client_email?: string; client_name?: string;
    job_title?: string; finalist_count?: number; report_url?: string; recruiter_name?: string;
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  const clientEmail = (payload.client_email || '').trim();
  if (!clientEmail) return { ok: false, error: 'client_email required' };

  const clientName = (payload.client_name || 'cliente').trim();
  const jobTitle = payload.job_title || 'tu puesto';
  const finalistCount = typeof payload.finalist_count === 'number' ? String(payload.finalist_count) : '3';
  const reportUrl = payload.report_url || '';
  const recruiterName = payload.recruiter_name || 'Kuno Digital';

  if (!reportUrl) return { ok: false, error: 'report_url required for finalists_ready' };

  const result = await publishAndProcessEvent(req, 'email.send_pending', {
    to: clientEmail,
    template: 'client_report_ready',
    locale: 'es',
    vars: {
      client_name: clientName,
      job_title: jobTitle,
      finalist_count: finalistCount,
      report_url: reportUrl,
      recruiter_name: recruiterName,
    },
  });
  log.info('finalists_ready email dispatched', { eventId: event.ROWID, jobId: payload.job_id, to: maskEmail(clientEmail), email_ok: result.ok });
  // audit fix #14: propagar resultado real del envío.
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'child email.send_pending failed' };
}

/**
 * Handler para application.created — dispara el email "Recibimos tu aplicación"
 * al candidato con un link signed válido 2 semanas para que entre a hacer los tests.
 *
 * Payload esperado (del webhook de Recruit o publicApply):
 *   tenant_id, application_id, candidate_id, job_id, job_title, candidate_email,
 *   candidate_name, source
 *
 * Genera test_url con kind='test' ref=application_id (validez 2 semanas, viene del
 * recruitTestLink existente).
 */
async function dispatchApplicationCreated(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    tenant_id?: string;
    application_id?: string;
    candidate_id?: string;
    job_id?: string;
    job_title?: string;
    candidate_email?: string;
    candidate_name?: string;
    source?: string;
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  const applicationId = (payload.application_id || '').trim();
  const candidateEmail = (payload.candidate_email || '').trim();
  if (!applicationId || !candidateEmail) {
    return { ok: false, error: 'application_id + candidate_email required' };
  }

  const candidateName = (payload.candidate_name || candidateEmail.split('@')[0]).trim();
  const jobTitle = payload.job_title || 'tu próximo puesto';

  // Resolver company: si viene en el payload (caller modernos como publicCareerSite lo
  // mandan), usarlo directo. Si no, query a Jobs.company (NO `company_name` — fix 2026-06-08).
  let company = (payload as Record<string, unknown>).company as string | undefined ?? '';
  if (!company) {
    try {
      if (payload.job_id) {
        const { zcql } = await import('../lib/db.js');
        const { escapeSql } = await import('../lib/dbHelpers.js');
        const rows = await zcql(req).executeZCQLQuery(
          `SELECT company FROM Jobs WHERE ROWID = '${escapeSql(payload.job_id)}' LIMIT 1`,
        ) as Array<{ Jobs?: { company?: string } }> | unknown[];
        const first = (rows as Array<{ Jobs?: { company?: string } }>)[0];
        company = first?.Jobs?.company || '';
      }
    } catch (err) {
      log.warn('application.created: failed to fetch company', { error: (err as Error)?.message ?? String(err) });
    }
  }
  if (!company) company = 'la empresa';

  // Generar link signed (kind='test', ref=application_id, validez 2 semanas) — mismo
  // patrón que recruitTestLink.ts. APP_BASE_URL viene de env.
  const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
  const { env } = await import('../lib/env.js');
  const token = signToken({ kind: 'test', ref: applicationId, exp: expiresIn(2 * WEEK_SEC) });
  const baseUrl = env().APP_BASE_URL.replace(/\/$/, '');
  const testUrl = `${baseUrl}/app/#/test/${token}`;

  const result = await publishAndProcessEvent(req, 'email.send_pending', {
    to: candidateEmail,
    template: 'candidate_application_received',
    locale: 'es',
    vars: {
      candidate_name: candidateName,
      job_title: jobTitle,
      company,
      test_url: testUrl,
    },
  });

  log.info('application.created email dispatched', {
    eventId: event.ROWID,
    applicationId,
    to: maskEmail(candidateEmail),
    email_ok: result.ok,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'child email.send_pending failed' };
}

/**
 * Handler para client.report_feedback — el cliente final tocó "Entrevistar / Tal vez /
 * Descartar" en el reporte multi-candidato. Notifica a Cris (o al recruiter del tenant)
 * con un email indicando qué decisión tomó el cliente y sobre qué candidato.
 */
async function dispatchClientReportFeedback(event: OutboxRow, req: RequestContext['req']): Promise<{ ok: boolean; error?: string }> {
  let payload: {
    tenant_id?: string;
    job_id?: string;
    job_title?: string;
    application_id?: string;
    choice?: 'interview' | 'maybe' | 'pass';
    comment?: string;
  };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }

  const tenantId = payload.tenant_id;
  const choice = payload.choice;
  if (!tenantId || !choice) return { ok: false, error: 'tenant_id + choice required' };

  // Email del recruiter del tenant — TenantContact si existe, sino fallback a env.
  let recruiterEmail = '';
  try {
    const { zcql } = await import('../lib/db.js');
    const { escapeSql } = await import('../lib/dbHelpers.js');
    const rows = await zcql(req).executeZCQLQuery(
      `SELECT recruiter_email FROM Tenants WHERE ROWID = '${escapeSql(tenantId)}' LIMIT 1`,
    ) as Array<{ Tenants?: { recruiter_email?: string } }>;
    recruiterEmail = rows[0]?.Tenants?.recruiter_email || '';
  } catch { /* tolerar */ }
  if (!recruiterEmail) recruiterEmail = process.env.RECRUITER_FALLBACK_EMAIL || 'cris@kunodigital.com';

  // Resolver nombre del candidato.
  let candidateName = 'un candidato';
  try {
    const { zcql } = await import('../lib/db.js');
    const { escapeSql } = await import('../lib/dbHelpers.js');
    const r = await zcql(req).executeZCQLQuery(
      `SELECT candidate_id FROM Results WHERE ROWID = '${escapeSql(payload.application_id || '')}' LIMIT 1`,
    ) as Array<{ Results?: { candidate_id?: string } }>;
    const candId = r[0]?.Results?.candidate_id;
    if (candId) {
      const c = await zcql(req).executeZCQLQuery(
        `SELECT name FROM Candidates WHERE ROWID = '${escapeSql(candId)}' LIMIT 1`,
      ) as Array<{ Candidates?: { name?: string } }>;
      candidateName = c[0]?.Candidates?.name || candidateName;
    }
  } catch { /* tolerar */ }

  const choiceText: Record<typeof choice, string> = {
    interview: 'quiere ENTREVISTAR',
    maybe: 'lo marcó como TAL VEZ',
    pass: 'lo DESCARTÓ',
  };
  const subject = `[Cliente] ${choiceText[choice]}: ${candidateName} — ${payload.job_title || 'puesto'}`;
  const bodyText = `El cliente del puesto "${payload.job_title || 'sin título'}" tomó una decisión sobre ${candidateName}:

→ ${choiceText[choice].toUpperCase()}
${payload.comment ? `\nComentario del cliente:\n${payload.comment}\n` : ''}
Revisalo en SharkTalents — ya está marcado como nota en la ficha del candidato.`;

  // Mandamos via email.send_pending con template ad-hoc inline (no necesita template
  // tipado para esta notificación interna).
  const result = await publishAndProcessEvent(req, 'email.send_pending', {
    to: recruiterEmail,
    subject,
    body_text: bodyText,
    locale: 'es',
  });
  log.info('client report feedback notification dispatched', {
    eventId: event.ROWID,
    jobId: payload.job_id,
    choice,
    email_ok: result.ok,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'child email.send_pending failed' };
}

/**
 * Normaliza disc_ideal para que la suma sea exactamente 200 (regla del proyecto:
 * project_disc_suma_200.md). Haiku ignora a veces la regla aunque esté en el prompt.
 *
 * Estrategia: escalar proporcionalmente. Si suma=255, multiplicamos cada valor por 200/255.
 * Después redondeamos y ajustamos el último componente para que la suma sea EXACTA.
 */
// (función normalizeDiscSum200 eliminada — reemplazada por normalizeDiscProfile)

/**
 * Normaliza un perfil DISC (suma=200, polaridades, keys minúsculas).
 * fieldName puede ser 'disc_ideal', 'disc_ideal_a', 'disc_ideal_b'.
 * 2026-06-06: extraído del normalizeDiscSum200 viejo para reusar en A y B.
 */
function normalizeDiscProfile(draft: Record<string, unknown>, fieldName: string, eventId: string): void {
  const disc = draft[fieldName] as Record<string, unknown> | undefined;
  if (!disc || typeof disc !== 'object') {
    log.warn(`${fieldName} missing or not object — skip normalize`, { eventId, has_field: !!disc, type: typeof disc });
    return;
  }
  // Tolerante a varios shapes que Haiku puede devolver.
  const d = Number(disc.d ?? disc.D ?? disc.dominancia ?? 0);
  const i = Number(disc.i ?? disc.I ?? disc.influencia ?? 0);
  const s = Number(disc.s ?? disc.S ?? disc.estabilidad ?? 0);
  const c = Number(disc.c ?? disc.C ?? disc.cumplimiento ?? 0);
  const sum = d + i + s + c;
  log.info(`${fieldName} extracted for normalize`, { eventId, d, i, s, c, sum });
  if (sum === 200) {
    // Reescribir keys a minúsculas + aplicar polaridad final
    const adjusted = applyPolarities({ d, i, s, c }, eventId, fieldName);
    draft[fieldName] = { ...disc, ...adjusted };
    return;
  }
  if (sum <= 0) {
    log.warn(`${fieldName} sum invalid, using balanced default`, { eventId, sum, d, i, s, c });
    draft[fieldName] = { ...disc, d: 50, i: 50, s: 50, c: 50 };
    return;
  }
  const factor = 200 / sum;
  let nd = Math.round(d * factor);
  let ni = Math.round(i * factor);
  let ns = Math.round(s * factor);
  let nc = Math.round(c * factor);
  // Ajustar redondeo: la diferencia residual se aplica al mayor componente.
  const newSum = nd + ni + ns + nc;
  const diff = 200 - newSum;
  if (diff !== 0) {
    const maxVal = Math.max(nd, ni, ns, nc);
    if (nd === maxVal) nd += diff;
    else if (ni === maxVal) ni += diff;
    else if (ns === maxVal) ns += diff;
    else nc += diff;
  }
  log.info(`${fieldName} normalized to sum=200`, {
    eventId,
    original: `${d}/${i}/${s}/${c}=${sum}`,
    normalized: `${nd}/${ni}/${ns}/${nc}=${nd + ni + ns + nc}`,
  });
  const adjusted = applyPolarities({ d: nd, i: ni, s: ns, c: nc }, eventId, fieldName);
  draft[fieldName] = { ...disc, ...adjusted };
}

/**
 * Aplica polaridades DISC (D↔S, I↔C fuertes) — si un eje está alto, su polar
 * debe estar bajo. Si la IA generó D=70 y S=60, eso es inconsistente con el modelo:
 * forzamos S=200-D-I-C para que cumpla suma=200 con polaridad respetada.
 *
 * Regla: si max(D,I,S,C) >= 65 → su polar opuesto se baja a <=35, y el resto
 * se ajusta proporcionalmente para mantener suma=200.
 */
function applyPolarities(
  v: { d: number; i: number; s: number; c: number },
  eventId: string,
  fieldName: string,
): { d: number; i: number; s: number; c: number } {
  let { d, i, s, c } = v;
  let changed = false;
  // Polaridad D↔S fuerte
  if (d >= 65 && s > 35) {
    const delta = s - 35;
    s = 35; i += Math.round(delta / 2); c += delta - Math.round(delta / 2);
    changed = true;
  } else if (s >= 65 && d > 35) {
    const delta = d - 35;
    d = 35; i += Math.round(delta / 2); c += delta - Math.round(delta / 2);
    changed = true;
  }
  // Polaridad I↔C fuerte
  if (i >= 65 && c > 35) {
    const delta = c - 35;
    c = 35; d += Math.round(delta / 2); s += delta - Math.round(delta / 2);
    changed = true;
  } else if (c >= 65 && i > 35) {
    const delta = i - 35;
    i = 35; d += Math.round(delta / 2); s += delta - Math.round(delta / 2);
    changed = true;
  }
  // Reajuste de suma si se rompió por los ajustes anteriores
  const sum = d + i + s + c;
  if (sum !== 200) {
    const diff = 200 - sum;
    const maxVal = Math.max(d, i, s, c);
    if (d === maxVal) d += diff;
    else if (i === maxVal) i += diff;
    else if (s === maxVal) s += diff;
    else c += diff;
  }
  if (changed) {
    log.info(`${fieldName} polarity adjusted`, {
      eventId,
      from: `${v.d}/${v.i}/${v.s}/${v.c}`,
      to: `${d}/${i}/${s}/${c}`,
    });
  }
  return { d, i, s, c };
}

/**
 * Normaliza el array de competencias:
 *   1. Filtra items cuyo `name` (o `id`) no esté en el catálogo cerrado
 *   2. Si quedan <3, agrega defaults según cognitive_level
 *   3. Trunca a máximo 5
 *
 * Sin esto, la IA generaba nombres libres ("Liderazgo Técnico Pragmático") que el
 * frontend no podía matchear con el catálogo → mostraba placeholder "Elegir competencia".
 */
// Set derivado del catálogo cerrado (data/competencias.ts) — único source of truth.
// Incluye tanto IDs canónicos como aliases deprecados (retro-compat). Los aliases
// se normalizan a canónico en `warnIfCompetenciasEmpty()`.
const COMPETENCIAS_CATALOG_IDS = new Set(COMPETENCIAS_LIST.map((c) => c.id));

// Defaults por nivel — si la IA no logra elegir del catálogo, estos son los que aplican.
// Usar IDs canónicos (no aliases deprecados).
const DEFAULT_COMPETENCIAS_BY_LEVEL: Record<string, string[]> = {
  basic: ['adaptabilidad', 'trabajo_equipo', 'orientacion_cliente'],
  mid: ['resolucion_problemas', 'comunicacion_digital', 'orientacion_logro'],
  senior: ['liderazgo', 'pensamiento_critico', 'toma_decisiones_oportuna'],
};

function warnIfCompetenciasEmpty(draft: Record<string, unknown>, eventId: string): void {
  const rawComp = draft.competencias;
  const arr = Array.isArray(rawComp) ? rawComp as Array<Record<string, unknown>> : [];
  const rawCount = arr.length;

  // Paso 1: filtrar las que tengan name/id en el catálogo cerrado. La IA puede usar
  // "name" o "id" como campo según humor — aceptamos ambos. Si la IA usó un alias
  // deprecado (ej. 'colaboracion'), se normaliza al canónico ('trabajo_equipo').
  const seenCanonical = new Set<string>();
  const valid: Array<Record<string, unknown>> = arr
    .map((c) => {
      const key = (typeof c.name === 'string' ? c.name : typeof c.id === 'string' ? c.id : '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
      if (!COMPETENCIAS_CATALOG_IDS.has(key)) return null;
      const canonical = resolveCompetenciaId(key);
      if (seenCanonical.has(canonical)) return null;  // dedup post-aliasing
      seenCanonical.add(canonical);
      return { ...c, name: canonical } as Record<string, unknown>;
    })
    .filter((c): c is Record<string, unknown> => c !== null)
    .slice(0, 5);

  // Paso 2: si quedan <3, completar con defaults del cognitive_level
  if (valid.length < 3) {
    const level = (typeof draft.cognitive_level === 'string' ? draft.cognitive_level : 'mid').toLowerCase();
    const defaults = DEFAULT_COMPETENCIAS_BY_LEVEL[level] ?? DEFAULT_COMPETENCIAS_BY_LEVEL.mid;
    const usedIds = new Set(valid.map((c) => c.name));
    for (const id of defaults) {
      if (valid.length >= 3) break;
      if (!usedIds.has(id)) {
        valid.push({ name: id, required_pct: 70 });
      }
    }
    log.warn('competencias <3 valid from catalog — filled with defaults', {
      eventId,
      raw_count: rawCount,
      valid_after_filter: valid.length - (valid.length - defaults.length),
      defaults_added: valid.length - rawCount,
      final_count: valid.length,
    });
  } else {
    log.info('competencias normalized', { eventId, raw_count: rawCount, valid_count: valid.length });
  }

  draft.competencias = valid;
}
