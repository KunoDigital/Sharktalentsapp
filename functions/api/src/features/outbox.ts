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
import { unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { requireInternalKey } from '../lib/internalAuth';

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
      return await dispatchWhatsAppText(event);

    case 'whatsapp.send_template':
      return await dispatchWhatsAppTemplate(event);

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
  const batchSize = Math.min(100, Math.max(1, Number(body.batch_size ?? 20)));

  const pending = await fetchPending(ctx.req, batchSize);
  log.info('processing batch', { traceId: ctx.traceId, count: pending.length });

  const results: ProcessResult[] = [];

  for (const event of pending) {
    try {
      const dispatchResult = await dispatch(event, ctx.req);

      if (dispatchResult.ok) {
        await markStatus(ctx.req, event.ROWID, 'sent', event.retry_count, null);
        results.push({ event_id: event.ROWID, event_type: event.event_type, outcome: 'sent' });
      } else {
        const newRetryCount = event.retry_count + 1;
        const finalStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';
        await markStatus(ctx.req, event.ROWID, finalStatus, newRetryCount, dispatchResult.error ?? null);
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
    const { TEMPLATES, renderTemplate, getTemplate } = await import('../lib/emailTemplates.js');
    const locale = (typeof payload.locale === 'string' && (payload.locale === 'en' || payload.locale === 'es'))
      ? payload.locale : 'es';
    const tplKey = template as keyof typeof TEMPLATES;
    if (!(tplKey in TEMPLATES)) {
      return { ok: false, error: `Unknown template: ${template}` };
    }
    const tpl = getTemplate(tplKey, locale);
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
        return { ok: true };
      }
      zeptoError = result.error;
      log.warn('zeptomail failed, fallback to Catalyst Email Service', { error: result.error });
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `email failed. zepto_error=${zeptoError ?? 'none'}; catalyst_error=${(err as Error).message}` };
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
    const SYSTEM = `Sos un experto en evaluación de talento que ayuda a una recruiter a estructurar puestos.

Tu input: el transcript (texto plano) de una reunión entre la recruiter y un cliente que necesita contratar.
Tu output: un JSON con el Job Profile Draft listo para revisar.

Reglas:
- Inferí el rol del cliente, la empresa, los requisitos técnicos y soft del puesto.
- DISC ideal: basate en lo que el cliente describe.
- Cognitive level: 'basic' para roles operativos, 'mid' para profesionales, 'senior' para liderazgo.
- VELNA ideal: 50-70 basic, 65-80 mid, 75-90 senior.
- Competencias: extraer hasta 5 críticas. required_pct = 60-80.
- Highlights: 3-5 fragmentos del transcript.

Devolvé SOLO el JSON sin markdown.

Schema:
{
  "title": string,
  "company": string,
  "context_summary": string,
  "cognitive_level": "basic" | "mid" | "senior",
  "disc_ideal": { "d": 0-100, "i": 0-100, "s": 0-100, "c": 0-100, "description": [3 strings] },
  "velna_ideal": { "verbal": 0-100, "espacial": 0-100, "logica": 0-100, "numerica": 0-100, "abstracta": 0-100 },
  "competencias": [{ "name": string, "required_pct": 0-100 }],
  "tech_prompt_seed": string,
  "salary_range_usd": { "min": number, "max": number },
  "tecnica_minimo_pct": 50-80,
  "highlights_from_transcript": [{ "type": "role"|"salary"|"urgency"|"context"|"concern", "text": string }]
}`;

    const response = await anthropicMessage({
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Transcript de la reunión:\n\n${payload.transcript}` }],
      maxTokens: 3000,
      temperature: 0.4,
    }, event.ROWID);

    const draft = extractJson<Record<string, unknown>>(response);

    // Intentar persistir en JobProfileDrafts si existe
    try {
      const { datastore: ds, now: nowFn } = await import('../lib/db.js');
      const { persistLargeContent, persistLargeJson } = await import('../lib/largeContentStore.js');
      const transcriptStored = await persistLargeContent(req, payload.transcript, 'JobProfileDrafts.transcript[zia]');
      const draftPayloadStored = await persistLargeJson(req, draft, 'JobProfileDrafts.draft_payload[zia]');
      await ds(req).table('JobProfileDrafts').insertRow({
        tenant_id: null, // Sin tenant context — Cris asignará al revisar
        meeting_id: typeof payload.meeting_id === 'string' ? payload.meeting_id : null,
        booking_id: typeof payload.booking_id === 'string' ? payload.booking_id : null,
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

  const { createRecruitCandidate, findJobApplication, updateApplicationStatus } = await import('../lib/zohoRecruitClient.js');
  const traceId = event.ROWID;
  const toStage = payload.to_stage ?? '';

  // Mapeo stage SharkTalents → Application Status en Recruit (módulo JobApplications).
  // Estos valores tienen que matchear EXACTAMENTE los Application Statuses configurados
  // por Cris en su Recruit, porque sus workflow rules se disparan al cambiar este field.
  //
  // Etapas que NO están en el mapa NO disparan sync con Recruit — se loguean y skip.
  // Esto es intencional: `finalist`, `interview_scheduled` y `prefilter_*` se manejan
  // fuera de Recruit (manual / cliente).
  const STATUS_MAP: Record<string, string> = {
    tecnica_completed: 'Kudert',
    conductual_completed: 'veritas',
    integridad_completed: 'Invitación entrevista',
    rejected_by_admin: 'Rejected',
    auto_rejected_low_score: 'Rejected',
    auto_rejected_disc_mismatch: 'Rejected',
    auto_rejected_english_failed: 'Rejected',
    auto_rejected_mindset_limiting: 'Rejected',
    hired: 'Hired',
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
          const { datastore, now: nowFn } = await import('../lib/db.js');
          await datastore(req).table('Candidates').updateRow({
            ROWID: candidateId,
            recruit_candidate_id: recruitId,
            updated_at: nowFn(),
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

    if (payload.action === 'transition' && recruitCandidateId) {
      // Buscar la JobApplication (relación candidato↔job) en Recruit. Los workflow
      // rules se disparan en esta entidad, no en Candidates.
      //
      // Necesitamos el recruit_job_id (ID del Job Opening en Recruit). Si lo tenemos
      // guardado en Jobs.recruit_job_id, lo usamos; si no, intentamos buscar por
      // candidate solo y actualizar la más reciente.
      let recruitJobOpeningId: string | null = null;
      if (payload.job_id) {
        try {
          const { zcql: zcqlFn } = await import('../lib/db.js');
          const { escapeSql: esc, unwrapRows: unr } = await import('../lib/dbHelpers.js');
          const rows = unr<{ recruit_job_id?: string | null }>(
            (await zcqlFn(req).executeZCQLQuery(
              `SELECT recruit_job_id FROM Jobs WHERE ROWID = '${esc(payload.job_id)}' LIMIT 1`,
            )) as unknown[],
            'Jobs',
          );
          recruitJobOpeningId = rows[0]?.recruit_job_id ?? null;
        } catch (err) {
          log.debug('failed to lookup Jobs.recruit_job_id', { error: (err as Error).message });
        }
      }

      if (!recruitJobOpeningId) {
        log.warn('recruit sync skipped — no recruit_job_id linked for Job', {
          eventId: event.ROWID, sharkJobId: payload.job_id,
        });
        return { ok: true };
      }

      const findResult = await findJobApplication(recruitCandidateId, recruitJobOpeningId, traceId);
      if (!findResult.ok) return { ok: false, error: `findJobApplication: ${findResult.error}` };
      if (!findResult.data) {
        log.warn('recruit sync skipped — JobApplication not found in Recruit', {
          eventId: event.ROWID, recruit_candidate_id: recruitCandidateId, recruit_job_opening_id: recruitJobOpeningId,
        });
        return { ok: true };
      }

      const result = await updateApplicationStatus(findResult.data.id, applicationStatus, traceId);
      if (!result.ok) return { ok: false, error: result.error };
      log.info('recruit application status updated', {
        eventId: event.ROWID,
        job_application_id: findResult.data.id,
        recruit_candidate_id: recruitCandidateId,
        new_status: applicationStatus,
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
    sendJson(ctx.res, 200, { count: 0, items: [], error: (err as Error).message });
  }
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
    log.warn('listOutboxFromTenant failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { items: [], count: 0, error: 'outbox_table_not_ready' });
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
async function dispatchWhatsAppText(event: OutboxRow): Promise<{ ok: boolean; error?: string }> {
  let payload: { to?: unknown; body?: unknown };
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return { ok: false, error: 'invalid JSON payload' };
  }
  if (typeof payload.to !== 'string' || typeof payload.body !== 'string') {
    return { ok: false, error: 'whatsapp.send_text requires to + body strings' };
  }

  try {
    const { sendText } = await import('../lib/whatsappClient.js');
    const result = await sendText({ to_phone: payload.to, body: payload.body }, event.ROWID);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    log.info('whatsapp text sent', { eventId: event.ROWID, to_masked: maskPhone(payload.to) });
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
async function dispatchWhatsAppTemplate(event: OutboxRow): Promise<{ ok: boolean; error?: string }> {
  let payload: { to?: unknown; template_name?: unknown; language_code?: unknown; params?: unknown };
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
    const { sendTemplate } = await import('../lib/whatsappClient.js');
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `whatsapp send_template failed: ${(err as Error).message}` };
  }
}

function maskPhone(phone: string): string {
  if (phone.length < 5) return '<short>';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}
