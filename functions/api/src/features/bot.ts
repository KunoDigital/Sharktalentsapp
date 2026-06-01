/**
 * Bot decisor: analiza una aplicación + scores, devuelve recomendación de stage + rationale.
 *
 * Modos (env BOT_MODE):
 * - cold: solo recomienda, NUNCA aplica auto. Cris siempre confirma.
 * - warm: aplica auto si confidence > threshold (BOT_CONFIDENCE_THRESHOLD_DEFAULT, default 0.75).
 * - hot: aplica auto en todos los casos donde no haya conflicto. (futuro)
 *
 * Endpoint:
 *   POST /api/applications/:id/bot-review
 *   Body: { auto_apply?: boolean }  (default false; si true, intenta transitar)
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, UpstreamError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { anthropicMessage, extractJson, extractText } from '../lib/anthropic';
import { datastore, zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { env } from '../lib/env';
import { isStage, transitionAllowed, type PipelineStage } from '../lib/pipelineStateMachine';
import { persistBotDecision, enqueueForReview } from '../lib/botPersistence';
import { enqueueNotification } from './notifications';
import { findSimilarCases, buildFewShotBlock } from '../lib/botRAG';

const log = logger('BOT');

type BotRecommendation = {
  stage: string;
  confidence: number;
  rationale: string;
  factors: { label: string; signal: string; weight: number }[];
  needs_human_review: boolean;
};

const BOT_SYSTEM_PROMPT = `Sos un asesor experto en reclutamiento que analiza candidatos y recomienda al recruiter el siguiente paso.

Tu input: la aplicación de un candidato a un puesto, con todos sus scores (técnica, DISC, VELNA, integridad, anti-trampa).
Tu output: una recomendación estructurada en JSON.

Reglas:
- Tu rol es ASISTIR a la recruiter, no reemplazarla. Si dudás, marca needs_human_review=true.
- Confidence baja (< 0.6) si: scores contradictorios, anti-trampa flags, datos incompletos, perfil no alineado pero técnica fuerte.
- Confidence alta (> 0.8) si: todos los factores van en la misma dirección.
- Stages válidos para recomendar:
  * 'tecnica_completed' (avanzar de prefilter a técnica)
  * 'conductual_completed' (avanzar de técnica a conductual)
  * 'integridad_completed' (avanzar de conductual a integridad)
  * 'finalist' (marcar finalista para entrevista 1:1)
  * 'auto_rejected_low_score' (rechazar por bajo desempeño técnico)
  * 'rejected_by_admin' (recomendar rechazo por otros motivos)
- Factores: 5 dimensiones con weights que suman 1.0 (técnica 0.25, DISC 0.25, VELNA 0.20, integridad 0.20, anti-trampa 0.10).
- Rationale: 2-3 frases en español plano, sin jerga.

Devolvé SOLO el JSON:
{
  "stage": "...",
  "confidence": 0.0-1.0,
  "rationale": "string en español plano",
  "factors": [{ "label": string, "signal": string, "weight": 0-1 }],
  "needs_human_review": boolean
}`;

async function getResultTenantId(ctx: RequestContext, resultId: string): Promise<string | null> {
  const query = `
    SELECT J.tenant_id AS tenant_id
    FROM Results R
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE R.ROWID = '${escapeSql(resultId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const result = (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[];
  type Pick = { tenant_id: string };
  return unwrapRows<Pick>(result, 'Jobs')[0]?.tenant_id ?? null;
}

async function loadApplicationFullContext(ctx: RequestContext, resultId: string): Promise<{
  result: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  candidate: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
  mindset: Record<string, unknown> | null;
  english: Record<string, unknown> | null;
} | null> {
  const query = `
    SELECT R.* FROM Results R WHERE R.ROWID = '${escapeSql(resultId)}' LIMIT 1
  `;
  const r = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
    'Results',
  )[0];
  if (!r) return null;

  const [job, candidate, scores, mindset, english] = await Promise.all([
    fetchOne(ctx, 'Jobs', `ROWID = '${escapeSql(String(r.assessment_id))}'`),
    fetchOne(ctx, 'Candidates', `ROWID = '${escapeSql(String(r.candidate_id))}'`),
    fetchOne(ctx, 'Scores', `result_id = '${escapeSql(resultId)}'`),
    fetchOneSafe(ctx, 'MindsetScores', `result_id = '${escapeSql(resultId)}'`),
    fetchOneSafe(ctx, 'EnglishTestSessions', `result_id = '${escapeSql(resultId)}' ORDER BY CREATEDTIME DESC`),
  ]);

  return { result: r, job, candidate, scores, mindset, english };
}

async function fetchOneSafe(
  ctx: RequestContext,
  table: string,
  whereClause: string,
): Promise<Record<string, unknown> | null> {
  // Tablas opcionales (Block 2) — si no existen, devolvemos null en lugar de throw
  try {
    return await fetchOne(ctx, table, whereClause);
  } catch {
    return null;
  }
}

async function fetchOne(
  ctx: RequestContext,
  table: string,
  whereClause: string,
): Promise<Record<string, unknown> | null> {
  const q = `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`;
  const rows = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(q)) as unknown[],
    table,
  );
  return rows[0] ?? null;
}

export async function botReview(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const resultId = extractResultIdFromBotPath(ctx.req.url ?? '/');
  if (!resultId) throw new ValidationError('result_id missing in path');

  const ownerTenant = await getResultTenantId(ctx, resultId);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Result ${resultId} not found`);

  const ctxData = await loadApplicationFullContext(ctx, resultId);
  if (!ctxData?.result) throw new NotFoundError(`Result ${resultId} not found`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const autoApply = body.auto_apply === true;

  const promptContext = JSON.stringify({
    job: {
      title: ctxData.job?.title,
      cognitive_level: ctxData.job?.cognitive_level,
      company: ctxData.job?.company,
      english_required: ctxData.job?.english_required ?? false,
      english_min_level: ctxData.job?.english_min_level ?? null,
    },
    candidate: {
      name: ctxData.candidate?.name,
      age: ctxData.candidate?.age,
      salary_expectation: ctxData.candidate?.salary_expectation,
    },
    pipeline_stage: ctxData.result?.pipeline_stage,
    scores: ctxData.scores, // contiene todos los bloques: disc_*, velna_*, emo_*, tec_*, int_*
    mindset: ctxData.mindset
      ? {
          adaptability_score_pct: ctxData.mindset.adaptability_score_pct,
          adaptability_pattern: ctxData.mindset.adaptability_pattern,
        }
      : null,
    english: ctxData.english
      ? {
          level_required: ctxData.english.level_required,
          total_score_pct: ctxData.english.total_score_pct,
          passed: ctxData.english.passed,
        }
      : null,
  }, null, 2);

  // RAG: buscar casos similares de BotTrainingExamples (si la tabla existe).
  // Sirve para que el bot calibre su confidence en base al criterio histórico de Cris.
  const scores = ctxData.scores ?? {};
  const similarCases = await findSimilarCases(ctx.req, {
    tenantId,
    fromStage: String(ctxData.result?.pipeline_stage ?? ''),
    jobCognitiveLevel: String(ctxData.job?.cognitive_level ?? 'mid'),
    candidateDiscD: typeof scores.disc_norm_d === 'number' ? scores.disc_norm_d : null,
    candidateDiscI: typeof scores.disc_norm_i === 'number' ? scores.disc_norm_i : null,
    candidateDiscS: typeof scores.disc_norm_s === 'number' ? scores.disc_norm_s : null,
    candidateDiscC: typeof scores.disc_norm_c === 'number' ? scores.disc_norm_c : null,
    candidateTechnicalPct: typeof scores.tec_score_pct === 'number' ? scores.tec_score_pct : null,
  }, 5);

  const fewShotBlock = buildFewShotBlock(similarCases);
  const userMessage = fewShotBlock
    ? `${fewShotBlock}\n\nAplicación a analizar:\n\`\`\`json\n${promptContext}\n\`\`\``
    : `Aplicación a analizar:\n\`\`\`json\n${promptContext}\n\`\`\``;

  const response = await anthropicMessage({
    system: [
      { type: 'text', text: BOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1500,
    temperature: 0.3,
  }, ctx.traceId);

  log.info('bot prompt prepared', {
    traceId: ctx.traceId,
    similar_cases: similarCases.length,
    has_few_shot: similarCases.length > 0,
  });

  let recommendation: BotRecommendation;
  try {
    recommendation = extractJson<BotRecommendation>(response);
  } catch (err) {
    log.error('bot returned invalid JSON', {
      traceId: ctx.traceId,
      error: (err as Error).message,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      raw_preview: extractText(response).slice(0, 300),
    });
    // 502 (UpstreamError) — el cliente no hizo nada mal, el modelo falló.
    throw new UpstreamError('anthropic', 'Bot returned malformed JSON', {
      stop_reason: response.stop_reason,
      preview: extractText(response).slice(0, 200),
    });
  }

  const e = env();
  const threshold = e.BOT_CONFIDENCE_THRESHOLD_DEFAULT;
  const fromStage = String(ctxData.result?.pipeline_stage);

  // Validar que la transición recomendada por la IA sea legítima en el state machine.
  // Si el bot recomienda un salto inválido (ej: prefilter_pending → finalist), descartamos
  // el auto-apply y forzamos human review.
  const recommendedStage = isStage(recommendation.stage) ? (recommendation.stage as PipelineStage) : null;
  const transitionIsValid = recommendedStage != null
    && isStage(fromStage)
    && transitionAllowed(fromStage as PipelineStage, recommendedStage);

  if (!transitionIsValid) {
    log.warn('bot recommended invalid transition — forcing human review', {
      traceId: ctx.traceId,
      resultId,
      from: fromStage,
      recommended: recommendation.stage,
    });
    recommendation.needs_human_review = true;
  }

  // Modos:
  // - cold: NUNCA aplica auto, todo va a queue (si la tabla existe).
  // - warm: aplica auto si confidence >= threshold (default 0.75) Y autoApply=true en body.
  // - hot: aplica auto siempre que la transición sea válida (sin requerir autoApply).
  const isWarm = e.BOT_MODE === 'warm';
  const isHot = e.BOT_MODE === 'hot';
  const passesThreshold = recommendation.confidence >= threshold && !recommendation.needs_human_review;
  const wouldAutoApply = transitionIsValid && (
    (isWarm && autoApply && passesThreshold) ||
    (isHot && passesThreshold)
  );

  let applied = false;
  if (wouldAutoApply && recommendedStage) {
    // Orden importa: PRIMERO insert el transition record (append-only), DESPUÉS update Result.
    // Razón: si el insert falla, no actualizamos Result → estado consistente (no avanza).
    // Si el update falla DESPUÉS del insert, queda un transition huérfano pero el state
    // no avanzó — lo cual es el caso menos malo (admin puede limpiar el huérfano).
    try {
      await datastore(ctx.req).table('PipelineTransitions').insertRow({
        result_id: resultId,
        from_stage: fromStage,
        to_stage: recommendedStage,
        actor: 'bot',
        reason: recommendation.rationale.slice(0, 200),
        transitioned_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });

      await datastore(ctx.req).table('Results').updateRow({
        ROWID: resultId,
        pipeline_stage: recommendedStage,
      });

      applied = true;
      log.info('bot applied transition', { traceId: ctx.traceId, resultId, from: fromStage, to: recommendedStage });
    } catch (err) {
      log.error('bot transition failed mid-write — manual cleanup may be needed', {
        traceId: ctx.traceId,
        resultId,
        from: fromStage,
        to: recommendedStage,
        error: (err as Error).message,
      });
      // No re-throw: devolvemos la recomendación con applied=false. Cris ve la rec y aplica
      // manualmente. La alternativa (re-throw 500) destruiría la recomendación de IA
      // que costó tokens — preferimos preservarla y degradar gracefully.
    }
  } else {
    log.info('bot recommendation only', {
      traceId: ctx.traceId,
      resultId,
      stage: recommendation.stage,
      confidence: recommendation.confidence,
      mode: e.BOT_MODE,
    });
  }

  // Persistir la decisión del bot (si la tabla BotDecisions existe).
  const botDecisionId = await persistBotDecision(ctx.req, {
    tenantId,
    resultId,
    jobId: String(ctxData.result?.assessment_id ?? ''),
    fromStage,
    toStageProposed: recommendation.stage,
    decision: recommendation.needs_human_review ? 'needs_human' : (recommendedStage ? 'advance' : 'reject'),
    confidence: recommendation.confidence,
    rationale: recommendation.rationale,
    autoExecuted: applied,
  });

  // Si NO se aplicó auto y el modo es warm/hot (no cold), agregar a ReviewQueue
  // para que humano lo resuelva. En cold mode no agregamos a queue — todo es manual desde la UI.
  let reviewQueueId: string | null = null;
  if (!applied && botDecisionId && (isWarm || isHot)) {
    const reason = !transitionIsValid
      ? 'Bot recommended invalid transition'
      : recommendation.needs_human_review
        ? 'Bot escalated for human review'
        : `Low confidence (${recommendation.confidence})`;
    reviewQueueId = await enqueueForReview(ctx.req, {
      tenantId,
      resultId,
      botDecisionId,
      reason,
      priority: recommendation.confidence < 0.5 ? 'high' : 'normal',
    });

    // Notificar al tenant que hay un item nuevo en la cola del bot.
    void enqueueNotification(ctx.req, {
      tenantId,
      type: 'bot_review',
      message: `Bot decisor necesita tu revisión: ${reason}`,
      resourceType: 'application',
      resourceId: resultId,
      link: `/bot/review`,
    });
  }

  sendJson(ctx.res, 200, {
    recommendation,
    bot_mode: e.BOT_MODE,
    threshold,
    auto_applied: applied,
    bot_decision_id: botDecisionId,
    review_queue_id: reviewQueueId,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  });
}

function extractResultIdFromBotPath(url: string): string | null {
  const match = url.match(/^\/api\/applications\/([^/]+)\/bot-review/);
  return match?.[1] ?? null;
}
