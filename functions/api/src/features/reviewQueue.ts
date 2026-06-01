/**
 * Cola de revisión humana del bot decisor.
 *
 * Endpoints:
 *   GET   /api/bot/review-queue                    → lista pendientes del tenant
 *   POST  /api/bot/review-queue/:id/decide         → humano resuelve item (confirm | override)
 */
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { ValidationError, NotFoundError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { isStage, transitionAllowed, type PipelineStage } from '../lib/pipelineStateMachine';
import {
  listReviewQueue,
  fetchReviewQueueItem,
  resolveReviewQueueItem,
  markBotDecisionOverridden,
  recordTrainingExample,
} from '../lib/botPersistence';

const log = logger('REVIEW_QUEUE');

export async function listReviewQueueHandler(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));

  const items = await listReviewQueue(ctx.req, tenantId, limit);

  // Para cada item, hacer lookup de la BotDecision relacionada (best-effort)
  const decisionIds = items.map((i) => `'${escapeSql(i.bot_decision_id)}'`);
  type DecisionPick = {
    ROWID: string;
    to_stage_proposed: string;
    confidence: number;
    rationale: string;
    from_stage: string;
  };
  let decisionsMap = new Map<string, DecisionPick>();
  if (decisionIds.length > 0) {
    try {
      const q = `SELECT ROWID, to_stage_proposed, confidence, rationale, from_stage FROM BotDecisions WHERE ROWID IN (${decisionIds.join(', ')})`;
      const rows = unwrapRows<DecisionPick>(
        (await zcql(ctx.req).executeZCQLQuery(q)) as unknown[],
        'BotDecisions',
      );
      decisionsMap = new Map(rows.map((r) => [r.ROWID, r]));
    } catch {
      // Tabla puede no existir; seguimos sin enriquecer
    }
  }

  // Mapeo review_priority (DB column, evita reserved word SQL) → priority (API contract)
  // para no romper el frontend que ya consume `priority`.
  const enriched = items.map((item) => ({
    ...item,
    priority: item.review_priority,
    bot_decision: decisionsMap.get(item.bot_decision_id) ?? null,
  }));

  sendJson(ctx.res, 200, { items: enriched, count: enriched.length });
}

export async function decideReviewQueueItem(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/');
  if (!id) throw new ValidationError('review queue item id missing');

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const action = body.action; // 'confirm' | 'override'
  const overrideStage = typeof body.override_stage === 'string' ? body.override_stage : null;
  const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';

  if (action !== 'confirm' && action !== 'override') {
    throw new ValidationError('action must be "confirm" or "override"');
  }
  if (action === 'override' && !overrideStage) {
    throw new ValidationError('override requires override_stage');
  }

  const item = await fetchReviewQueueItem(ctx.req, id, tenantId);
  if (!item) throw new NotFoundError(`Review queue item ${id} not found`);
  if (item.resolved_at) throw new ValidationError('item already resolved');

  // Cargar la BotDecision
  type DecisionRow = {
    ROWID: string;
    result_id: string;
    job_id: string;
    from_stage: string;
    to_stage_proposed: string;
    confidence: number;
  };
  const decisionRow = unwrapRows<DecisionRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, result_id, job_id, from_stage, to_stage_proposed, confidence FROM BotDecisions WHERE ROWID = '${escapeSql(item.bot_decision_id)}' LIMIT 1`,
    )) as unknown[],
    'BotDecisions',
  )[0];

  if (!decisionRow) {
    throw new AppError(500, 'decision_missing', 'BotDecision asociada no existe — datos inconsistentes');
  }

  const finalStage = action === 'confirm' ? decisionRow.to_stage_proposed : overrideStage!;

  // Validar transición state machine
  if (!isStage(decisionRow.from_stage) || !isStage(finalStage)) {
    throw new ValidationError(`Invalid stage values: from=${decisionRow.from_stage}, to=${finalStage}`);
  }
  if (!transitionAllowed(decisionRow.from_stage as PipelineStage, finalStage as PipelineStage)) {
    throw new ValidationError(`Transition ${decisionRow.from_stage} → ${finalStage} not allowed`);
  }

  // Aplicar transición: insert PipelineTransition + update Result
  await datastore(ctx.req).table('PipelineTransitions').insertRow({
    result_id: decisionRow.result_id,
    from_stage: decisionRow.from_stage,
    to_stage: finalStage,
    actor: ctx.user?.clerk_user_id ?? 'human',
    reason: rationale ? rationale.slice(0, 500) : `Review queue: ${action}`,
    transitioned_at: now(),
  });
  await datastore(ctx.req).table('Results').updateRow({
    ROWID: decisionRow.result_id,
    pipeline_stage: finalStage,
  });

  // Marcar review queue item resuelto
  await resolveReviewQueueItem(
    ctx.req,
    id,
    ctx.user?.clerk_user_id ?? 'human',
    action === 'confirm' ? 'confirmed' : 'overridden',
  );

  // Si fue override, marcar decisión y crear training example
  if (action === 'override') {
    await markBotDecisionOverridden(
      ctx.req,
      decisionRow.ROWID,
      ctx.user?.clerk_user_id ?? 'human',
      rationale || 'Manual override',
    );
  }

  // Cargar scores para el training example (best-effort)
  type ScorePick = {
    disc_norm_d?: number; disc_norm_i?: number; disc_norm_s?: number; disc_norm_c?: number;
    velna_indice?: number;
    tec_score_pct?: number;
    int_overall?: string;
  };
  let scores: ScorePick | null = null;
  try {
    const rows = unwrapRows<ScorePick>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT disc_norm_d, disc_norm_i, disc_norm_s, disc_norm_c, velna_indice, tec_score_pct, int_overall FROM Scores WHERE result_id = '${escapeSql(decisionRow.result_id)}' LIMIT 1`,
      )) as unknown[],
      'Scores',
    );
    scores = rows[0] ?? null;
  } catch {
    scores = null;
  }

  type JobPick = { cognitive_level?: string };
  let jobLevel = 'mid';
  try {
    const rows = unwrapRows<JobPick>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT cognitive_level FROM Jobs WHERE ROWID = '${escapeSql(decisionRow.job_id)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    jobLevel = rows[0]?.cognitive_level ?? 'mid';
  } catch {
    // ignore
  }

  await recordTrainingExample(ctx.req, {
    tenantId,
    applicationId: decisionRow.result_id,
    jobId: decisionRow.job_id,
    jobCognitiveLevel: jobLevel,
    candidateDiscD: scores?.disc_norm_d ?? null,
    candidateDiscI: scores?.disc_norm_i ?? null,
    candidateDiscS: scores?.disc_norm_s ?? null,
    candidateDiscC: scores?.disc_norm_c ?? null,
    candidateCognitiveIndice: scores?.velna_indice ?? null,
    candidateTechnicalPct: scores?.tec_score_pct ?? null,
    candidateIntegrityOverall: scores?.int_overall ?? null,
    fromStage: decisionRow.from_stage,
    toStageChosen: finalStage,
    chosenBy: ctx.user?.clerk_user_id ?? 'human',
    rationaleHuman: rationale,
    botHadSuggested: decisionRow.to_stage_proposed,
    botConfidence: decisionRow.confidence / 100, // back to 0-1
    wasOverride: action === 'override',
  });

  void auditLog(ctx, {
    action: action === 'override' ? 'bot.review_only' : 'application.transition',
    resource_type: 'application',
    resource_id: decisionRow.result_id,
    changes: { from: decisionRow.from_stage, to: finalStage, action, rationale: rationale.slice(0, 200) },
  });

  log.info('review queue item resolved', {
    traceId: ctx.traceId,
    queueItemId: id,
    action,
    from: decisionRow.from_stage,
    to: finalStage,
  });

  sendJson(ctx.res, 200, {
    resolved: true,
    action,
    final_stage: finalStage,
    application_id: decisionRow.result_id,
  });
}

function extractIdFromPath(url: string): string | null {
  return url.match(/^\/api\/bot\/review-queue\/([^/]+)\/decide/)?.[1] ?? null;
}

/**
 * Stats agregadas del bot para mostrar en Settings → Bot decisor.
 *
 *   GET /api/bot/stats
 *
 * Devuelve métricas de los últimos 30 días: cuántas decisiones tomó, cuántas auto-ejecutó,
 * confianza promedio, breakdown por outcome (advance/reject/needs_human).
 *
 * Si BotDecisions no existe (Block 2 deferred), devuelve `table_not_ready`.
 */
export async function getBotStats(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  type DecisionRow = {
    decision: string;
    confidence: number;
    auto_executed: boolean;
  };

  let rows: DecisionRow[] = [];
  try {
    rows = unwrapRows<DecisionRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT decision, confidence, auto_executed FROM BotDecisions
         WHERE tenant_id = '${escapeSql(tenantId)}'
         ORDER BY CREATEDTIME DESC LIMIT 500`,
      )) as unknown[],
      'BotDecisions',
    );
  } catch {
    throw new AppError(503, 'table_not_ready', 'BotDecisions todavía no fue creada en Catalyst (Block 2).');
  }

  const total = rows.length;
  const byDecision: Record<string, number> = { advance: 0, reject: 0, needs_human: 0 };
  let totalConfidence = 0;
  let autoExecutedCount = 0;
  for (const r of rows) {
    if (r.decision in byDecision) byDecision[r.decision]++;
    totalConfidence += r.confidence ?? 0;
    if (r.auto_executed) autoExecutedCount++;
  }

  // ReviewQueue pending count
  let pendingReview = 0;
  try {
    const pendingRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ReviewQueue WHERE tenant_id = '${escapeSql(tenantId)}' AND status = 'pending'`,
      )) as unknown[],
      'ReviewQueue',
    );
    pendingReview = pendingRows.length;
  } catch {
    // ReviewQueue puede no existir todavía — pendingReview queda en 0
  }

  sendJson(ctx.res, 200, {
    total_decisions_30d: total,
    by_decision: byDecision,
    auto_executed_count: autoExecutedCount,
    auto_executed_pct: total > 0 ? Math.round((autoExecutedCount / total) * 100) : 0,
    avg_confidence: total > 0 ? Math.round(totalConfidence / total) / 100 : 0, // 0-1
    pending_review: pendingReview,
  });
}
