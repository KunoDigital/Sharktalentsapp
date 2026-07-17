/**
 * Helper compartido para transicionar el pipeline_stage del candidato.
 * Extraído de features/publicTest.ts para poder reusarse desde englishTest, mindsetTest
 * y videos.ts sin duplicar la lógica de side-effects (audit + notif + pool + sync Recruit).
 *
 * Fuente de verdad: memoria project_reglas_pipeline_candidato.md.
 *
 * Uso:
 *   import { transitResult } from '../lib/pipelineTransition.js';
 *   await transitResult(ctx, result, 'conductual_completed', 'webhook');
 *
 * Cuando la transición no es legal según el state machine (`transitionAllowed`), el
 * helper hace skip silently y loguea warning. NO tira error — el submit del candidato
 * no debe fallar por una transición ilegal.
 */

import type { RequestContext } from './context';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { isStage, transitionAllowed, type PipelineStage } from './pipelineStateMachine';
import { logger } from './logger';

const log = logger('PIPELINE_TRANSITION');
const T_RESULTS = 'Results';
const T_TRANSITIONS = 'PipelineTransitions';

/** Shape mínimo del Result que necesita transitResult. */
export type TransitionResultRow = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: string;
};

export async function transitResult(
  ctx: RequestContext,
  result: TransitionResultRow,
  toStage: string,
  actor: string,
): Promise<void> {
  if (!isStage(toStage) || !isStage(result.pipeline_stage)
      || !transitionAllowed(result.pipeline_stage as PipelineStage, toStage as PipelineStage)) {
    log.warn('skipping invalid transition', {
      traceId: ctx.traceId,
      resultId: result.ROWID,
      from: result.pipeline_stage,
      to: toStage,
    });
    return;
  }

  await datastore(ctx.req).table(T_RESULTS).updateRow({
    ROWID: result.ROWID,
    pipeline_stage: toStage,
    ...(toStage.includes('completed') || toStage.includes('rejected') || toStage === 'finalist'
      ? { completed_at: now() }
      : {}),
  });

  // Results es la fuente de verdad. PipelineTransitions es auditoría — si falla, log.warn.
  try {
    await datastore(ctx.req).table(T_TRANSITIONS).insertRow({
      result_id: result.ROWID,
      from_stage: result.pipeline_stage,
      to_stage: toStage,
      actor,
      reason: `Auto-transition on submit`,
      transitioned_at: now(),
    });
  } catch (err) {
    log.warn('PipelineTransitions insert failed (Results already updated)', {
      traceId: ctx.traceId,
      resultId: result.ROWID,
      from: result.pipeline_stage,
      to: toStage,
      error: (err as Error).message,
    });
  }

  // Pool populate cuando entra a fases intermedias
  if (toStage === 'integridad_completed' || toStage === 'videos_completed' || toStage === 'finalist') {
    const { upsertPoolFromApplication } = await import('./poolAutoPopulate.js');
    void upsertPoolFromApplication(ctx.req, result.ROWID);
  }

  // Notif al candidato (email + WhatsApp)
  const { fireAndForget } = await import('./fireAndForget.js');
  fireAndForget('notifyCandidateOnTransition', async () => {
    const { notifyCandidateOnTransition } = await import('./candidateNotifier.js');
    await notifyCandidateOnTransition(ctx.req, {
      applicationId: result.ROWID,
      toStage,
    });
  });

  // Notif a Cris en stages importantes
  void (async () => {
    try {
      const { enqueueNotification } = await import('../features/notifications.js');
      const meta = unwrapRows<{ tenant_id: string; candidate_name: string; job_title: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT J.tenant_id AS tenant_id, C.name AS candidate_name, J.title AS job_title
           FROM Results R JOIN Jobs J ON J.ROWID = R.assessment_id
           JOIN Candidates C ON C.ROWID = R.candidate_id
           WHERE R.ROWID = '${escapeSql(result.ROWID)}' LIMIT 1`,
        )) as unknown[],
        'Results',
      )[0];
      if (!meta) return;
      const candName = meta.candidate_name || 'Candidato';
      const NOTIFY_ON: Record<string, { type: 'candidate_auto_rejected' | 'candidate_stage_advanced'; msg: string }> = {
        auto_rejected_low_score: { type: 'candidate_auto_rejected', msg: `${candName} fue auto-rechazado por score bajo en ${meta.job_title}` },
        integridad_completed: { type: 'candidate_stage_advanced', msg: `${candName} completó integridad para ${meta.job_title}` },
        videos_completed: { type: 'candidate_stage_advanced', msg: `${candName} completó los videos para ${meta.job_title}` },
        duda_cv: { type: 'candidate_stage_advanced', msg: `${candName} quedó en Duda CV para ${meta.job_title} — revisar manualmente` },
        finalist: { type: 'candidate_stage_advanced', msg: `${candName} pasó a finalistas para ${meta.job_title}` },
      };
      const cfg = NOTIFY_ON[toStage];
      if (!cfg) return;
      await enqueueNotification(ctx.req, {
        tenantId: meta.tenant_id,
        type: cfg.type,
        message: cfg.msg,
        resourceType: 'application',
        resourceId: result.ROWID,
        link: `/candidates/${result.ROWID}`,
      });
    } catch (err) {
      log.warn('cris notification failed', { error: (err as Error).message });
    }
  })();

  // Marketing demo flow — para el funnel público de landing SharkTalents
  if (toStage === 'integridad_completed' || toStage === 'conductual_completed') {
    const { tryCompleteMarketingDemo } = await import('../features/marketing.js');
    void tryCompleteMarketingDemo(ctx, result.ROWID);
  }

  // Sync con Recruit — cada transition emite el evento
  void (async () => {
    try {
      const { publishRecruitSync } = await import('./recruitSyncPublisher.js');
      await publishRecruitSync(ctx.req, {
        application_id: result.ROWID,
        job_id: String(result.assessment_id ?? ''),
        tenant_id: '',
        from_stage: result.pipeline_stage,
        to_stage: toStage,
        actor,
        transitioned_at: now(),
        candidate_id: String(result.candidate_id ?? ''),
      });
    } catch (err) {
      log.warn('publishRecruitSync failed on transition', {
        traceId: ctx.traceId, resultId: result.ROWID, error: (err as Error).message,
      });
    }
  })();
}
