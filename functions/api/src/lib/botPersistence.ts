/**
 * Persistencia del bot decisor: BotDecisions (log), ReviewQueue (cola humana),
 * BotTrainingExamples (dataset para RAG futuro).
 *
 * Las 3 tablas son OPCIONALES (deferred Block 2). Si no existen, las funciones
 * son no-op silencioso — el bot sigue funcionando con la lógica in-memory de bot.ts,
 * solo que no se persiste ni se acumula training data.
 */
import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRow, unwrapRows } from './dbHelpers';
import { logger } from './logger';

const log = logger('BOT_PERSISTENCE');

const T_BOT_DECISIONS = 'BotDecisions';
const T_REVIEW_QUEUE = 'ReviewQueue';
const T_TRAINING = 'BotTrainingExamples';

const tableReady = new Map<string, boolean>();

async function checkTableReady(req: IncomingMessage, table: string): Promise<boolean> {
  const cached = tableReady.get(table);
  if (cached !== undefined) return cached;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${table} LIMIT 1`);
    tableReady.set(table, true);
    return true;
  } catch (err) {
    log.debug('table not ready', { table, error: (err as Error).message });
    tableReady.set(table, false);
    return false;
  }
}

export type BotDecisionInput = {
  tenantId: string;
  resultId: string;
  jobId: string;
  fromStage: string;
  toStageProposed: string;
  decision: string; // 'advance' | 'reject' | 'needs_human' | etc
  confidence: number;
  rationale: string;
  similarCases?: string[];
  autoExecuted: boolean;
};

export type BotDecisionRow = BotDecisionInput & {
  ROWID: string;
  similar_cases: string;
  auto_executed: boolean;
  executed_at: string | null;
  overridden: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
  overridden_reason: string | null;
  created_at: string;
};

export type ReviewQueueRow = {
  ROWID: string;
  tenant_id: string;
  result_id: string;
  bot_decision_id: string;
  reason: string;
  review_priority: 'low' | 'normal' | 'high';
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null; // 'confirmed' | 'overridden'
  created_at: string;
};

export type TrainingExampleInput = {
  tenantId: string;
  applicationId: string;
  jobId: string;
  jobCognitiveLevel: string;
  candidateDiscD: number | null;
  candidateDiscI: number | null;
  candidateDiscS: number | null;
  candidateDiscC: number | null;
  candidateCognitiveIndice: number | null;
  candidateTechnicalPct: number | null;
  candidateIntegrityOverall: string | null;
  fromStage: string;
  toStageChosen: string;
  chosenBy: string;
  rationaleHuman: string;
  botHadSuggested: string | null;
  botConfidence: number | null;
  wasOverride: boolean;
};

// ===== BotDecisions =====

export async function persistBotDecision(req: IncomingMessage, input: BotDecisionInput): Promise<string | null> {
  if (!(await checkTableReady(req, T_BOT_DECISIONS))) return null;
  try {
    const row = await datastore(req).table(T_BOT_DECISIONS).insertRow({
      tenant_id: input.tenantId,
      result_id: input.resultId,
      job_id: input.jobId,
      from_stage: input.fromStage,
      to_stage_proposed: input.toStageProposed,
      decision: input.decision,
      confidence: Math.round(input.confidence * 100), // 0-100 entero
      rationale: input.rationale.slice(0, 5000),
      similar_cases: JSON.stringify(input.similarCases ?? []),
      auto_executed: input.autoExecuted,
      executed_at: input.autoExecuted ? now() : null,
      overridden: false,
      overridden_by: null,
      overridden_at: null,
      overridden_reason: null,
      created_at: now(),
    });
    const inserted = unwrapRow<{ ROWID: string }>(row, T_BOT_DECISIONS);
    return inserted?.ROWID ?? null;
  } catch (err) {
    log.warn('persistBotDecision failed', { error: (err as Error).message });
    return null;
  }
}

export async function markBotDecisionOverridden(
  req: IncomingMessage,
  decisionId: string,
  overriddenBy: string,
  reason: string,
): Promise<void> {
  if (!(await checkTableReady(req, T_BOT_DECISIONS))) return;
  try {
    await datastore(req).table(T_BOT_DECISIONS).updateRow({
      ROWID: decisionId,
      overridden: true,
      overridden_by: overriddenBy,
      overridden_at: now(),
      overridden_reason: reason.slice(0, 1000),
    });
  } catch (err) {
    log.warn('markBotDecisionOverridden failed', { decisionId, error: (err as Error).message });
  }
}

// ===== ReviewQueue =====

export async function enqueueForReview(
  req: IncomingMessage,
  input: { tenantId: string; resultId: string; botDecisionId: string; reason: string; priority?: 'low' | 'normal' | 'high' },
): Promise<string | null> {
  if (!(await checkTableReady(req, T_REVIEW_QUEUE))) return null;
  try {
    const row = await datastore(req).table(T_REVIEW_QUEUE).insertRow({
      tenant_id: input.tenantId,
      result_id: input.resultId,
      bot_decision_id: input.botDecisionId,
      reason: input.reason.slice(0, 500),
      review_priority: input.priority ?? 'normal',
      resolved_at: null,
      resolved_by: null,
      resolution: null,
      created_at: now(),
    });
    const inserted = unwrapRow<{ ROWID: string }>(row, T_REVIEW_QUEUE);
    return inserted?.ROWID ?? null;
  } catch (err) {
    log.warn('enqueueForReview failed', { error: (err as Error).message });
    return null;
  }
}

export async function listReviewQueue(req: IncomingMessage, tenantId: string, limit = 50): Promise<ReviewQueueRow[]> {
  if (!(await checkTableReady(req, T_REVIEW_QUEUE))) return [];
  const q = `
    SELECT * FROM ${T_REVIEW_QUEUE}
    WHERE tenant_id = '${escapeSql(tenantId)}' AND resolved_at IS NULL
    ORDER BY review_priority DESC, CREATEDTIME ASC
    LIMIT ${Math.max(1, Math.min(200, limit))}
  `.replace(/\s+/g, ' ');
  return unwrapRows<ReviewQueueRow>((await zcql(req).executeZCQLQuery(q)) as unknown[], T_REVIEW_QUEUE);
}

export async function fetchReviewQueueItem(req: IncomingMessage, id: string, tenantId: string): Promise<ReviewQueueRow | null> {
  if (!(await checkTableReady(req, T_REVIEW_QUEUE))) return null;
  const q = `SELECT * FROM ${T_REVIEW_QUEUE} WHERE ROWID = '${escapeSql(id)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const rows = unwrapRows<ReviewQueueRow>((await zcql(req).executeZCQLQuery(q)) as unknown[], T_REVIEW_QUEUE);
  return rows[0] ?? null;
}

export async function resolveReviewQueueItem(
  req: IncomingMessage,
  id: string,
  resolvedBy: string,
  resolution: 'confirmed' | 'overridden',
): Promise<void> {
  if (!(await checkTableReady(req, T_REVIEW_QUEUE))) return;
  await datastore(req).table(T_REVIEW_QUEUE).updateRow({
    ROWID: id,
    resolved_at: now(),
    resolved_by: resolvedBy,
    resolution,
  });
}

// ===== BotTrainingExamples =====

export async function recordTrainingExample(req: IncomingMessage, input: TrainingExampleInput): Promise<string | null> {
  if (!(await checkTableReady(req, T_TRAINING))) return null;
  try {
    const row = await datastore(req).table(T_TRAINING).insertRow({
      tenant_id: input.tenantId,
      application_id: input.applicationId,
      job_id: input.jobId,
      job_cognitive_level: input.jobCognitiveLevel,
      candidate_disc_d: input.candidateDiscD,
      candidate_disc_i: input.candidateDiscI,
      candidate_disc_s: input.candidateDiscS,
      candidate_disc_c: input.candidateDiscC,
      candidate_cognitive_indice: input.candidateCognitiveIndice,
      candidate_technical_pct: input.candidateTechnicalPct,
      candidate_integrity_overall: input.candidateIntegrityOverall,
      from_stage: input.fromStage,
      to_stage_chosen: input.toStageChosen,
      chosen_by: input.chosenBy,
      rationale_human: input.rationaleHuman.slice(0, 2000),
      bot_had_suggested: input.botHadSuggested,
      bot_confidence: input.botConfidence != null ? Math.round(input.botConfidence * 100) : null,
      was_override: input.wasOverride,
      quality: 'standard',
      created_at: now(),
    });
    const inserted = unwrapRow<{ ROWID: string }>(row, T_TRAINING);
    return inserted?.ROWID ?? null;
  } catch (err) {
    log.warn('recordTrainingExample failed', { error: (err as Error).message });
    return null;
  }
}

/** Para tests: resetea el cache de table-readiness. */
export function _resetTableReadyCache() {
  tableReady.clear();
}
