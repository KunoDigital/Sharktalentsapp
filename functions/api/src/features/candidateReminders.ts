/**
 * Endpoint para mandar recordatorios a candidatos que arrancaron una prueba y no
 * la completaron en N días.
 *
 *   POST /admin/candidate-reminders/send  (X-Internal-Key)
 *   Body opcional: { inactive_days?: 3, dry_run?: false, max_send?: 100 }
 *
 * Diseñado para correrse desde un Cron de Catalyst Console (1 vez al día).
 *
 * Reglas:
 *   - Busca Results en stages ACTIVOS (prefilter_pending, prefilter_passed,
 *     tecnica_completed, conductual_completed, etc.) que no completaron Y
 *     fueron actualizados hace ≥ N días.
 *   - Idempotencia: NO manda recordatorio si ya hay un OutboxEvent
 *     `email.send_pending` con template=candidate_test_reminder y mismo
 *     application_id en los últimos 7 días.
 *   - Cap de `max_send` para evitar floodear si hay backlog viejo (default 100).
 *
 * dry_run=true devuelve la lista de candidatos a notificar SIN encolar nada,
 * útil para que Cris valide qué se va a mandar.
 */

import type { RequestContext } from '../lib/context';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { signToken, expiresIn, WEEK_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';
import { requireInternalKey } from '../lib/internalAuth';

const log = logger('CANDIDATE_REMINDERS');

const PHASE_BY_STAGE: Record<string, string> = {
  prefilter_pending: 'prescreening',
  prefilter_passed: 'tecnica',
  tecnica_completed: 'disc',
  conductual_completed: 'integridad',
  integridad_completed: 'videos',
  videos_pending: 'videos',
};

type ApplicationToRemind = {
  ROWID: string;
  pipeline_stage: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string | null;
  job_title: string;
  job_tenant: string;
  job_id: string;
};

export async function sendCandidateReminders(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  let body: Record<string, unknown> = {};
  try {
    body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  } catch { /* allow empty */ }

  const inactiveDays = Math.max(1, Math.min(30, Number(body.inactive_days ?? 3)));
  const maxSend = Math.max(1, Math.min(500, Number(body.max_send ?? 100)));
  const dryRun = body.dry_run === true;

  const cutoffISO = new Date(Date.now() - inactiveDays * 86400_000).toISOString();
  const STAGES = Object.keys(PHASE_BY_STAGE).map((s) => `'${s}'`).join(',');

  // Buscar candidatos
  let candidates: ApplicationToRemind[] = [];
  try {
    candidates = unwrapRows<ApplicationToRemind>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT R.ROWID, R.pipeline_stage,
                C.name AS candidate_name, C.email AS candidate_email, C.phone AS candidate_phone,
                J.title AS job_title, J.tenant_id AS job_tenant, J.ROWID AS job_id
         FROM Results R
         JOIN Candidates C ON C.ROWID = R.candidate_id
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE R.pipeline_stage IN (${STAGES})
           AND R.completed_at IS NULL
           AND R.MODIFIEDTIME <= '${escapeSql(cutoffISO)}'
         ORDER BY R.MODIFIEDTIME ASC LIMIT ${maxSend}`,
      )) as unknown[],
      'Results',
    );
  } catch (err) {
    log.warn('candidates query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { sent: 0, candidates: 0, error: (err as Error).message });
    return;
  }

  log.info('reminders candidates found', { count: candidates.length, inactiveDays });

  if (candidates.length === 0) {
    sendJson(ctx.res, 200, { sent: 0, candidates: 0, dry_run: dryRun });
    return;
  }

  // Filtrar: descartar los que ya recibieron recordatorio en los últimos 7 días.
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 86400_000).toISOString();
  const eligible: ApplicationToRemind[] = [];
  for (const c of candidates) {
    try {
      const prior = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM OutboxEvents
           WHERE event_type = 'email.send_pending'
             AND payload LIKE '%"template":"candidate_test_reminder"%'
             AND payload LIKE '%"${escapeSql(c.candidate_email)}"%'
             AND created_at >= '${escapeSql(sevenDaysAgoISO)}'
           LIMIT 1`,
        )) as unknown[],
        'OutboxEvents',
      );
      if (prior.length === 0) eligible.push(c);
    } catch (err) {
      log.debug('idempotency check failed (allowing)', { error: (err as Error).message });
      eligible.push(c);
    }
  }

  log.info('reminders eligible after dedup', { eligible: eligible.length, total: candidates.length });

  if (dryRun) {
    sendJson(ctx.res, 200, {
      dry_run: true,
      candidates: candidates.length,
      eligible: eligible.length,
      preview: eligible.slice(0, 10).map((c) => ({
        application_id: c.ROWID,
        candidate_name: c.candidate_name,
        candidate_email_masked: c.candidate_email.slice(0, 2) + '***',
        job_title: c.job_title,
        stage: c.pipeline_stage,
        next_phase: PHASE_BY_STAGE[c.pipeline_stage] ?? 'unknown',
      })),
    });
    return;
  }

  // Mandar recordatorios
  let sent = 0;
  const e = env();
  const base = e.APP_BASE_URL.replace(/\/$/, '');
  const { publishOutboxEvent } = await import('./outbox.js');
  for (const c of eligible) {
    const phase = PHASE_BY_STAGE[c.pipeline_stage] ?? 'prescreening';
    const token = signToken({ kind: 'test', ref: c.ROWID, exp: expiresIn(2 * WEEK_SEC) });
    const testUrl = `${base}/app/#/test/${token}/${phase}`;
    try {
      await publishOutboxEvent(ctx.req, 'email.send_pending', {
        to: c.candidate_email,
        template: 'candidate_test_reminder',
        locale: 'es',
        job_id: c.job_id,
        tenant_id: c.job_tenant,
        vars: {
          candidate_name: (c.candidate_name ?? '').trim() || 'candidato',
          job_title: c.job_title,
          test_url: testUrl,
        },
      });
      // WhatsApp si hay phone
      if (c.candidate_phone) {
        await publishOutboxEvent(ctx.req, 'whatsapp.send_text', {
          to: c.candidate_phone,
          body: `Hola ${c.candidate_name}, te quedó pendiente la evaluación para ${c.job_title}. Continuá acá: ${testUrl}`,
          job_id: c.job_id,
          tenant_id: c.job_tenant,
        });
      }
      sent += 1;
    } catch (err) {
      log.warn('reminder enqueue failed for application', { applicationId: c.ROWID, error: (err as Error).message });
    }
  }

  log.info('reminders sent batch', { sent, eligible: eligible.length });

  sendJson(ctx.res, 200, {
    sent,
    eligible: eligible.length,
    candidates_total: candidates.length,
    inactive_days_threshold: inactiveDays,
  });
}
