/**
 * Endpoints del test de Mentalidades (McKinsey Forward — Adaptabilidad y Resiliencia).
 *
 * El test se hace dentro del flow del candidato (entre DISC y VELNA, sin nombre revelador).
 * El frontend lee las preguntas desde `shark/src/data/questions/mindset.json` (banco
 * estático en repo) y solo manda al backend las respuestas elegidas.
 *
 * Endpoints:
 *   POST /test/<token>/mindset/submit   → submit de respuestas, persiste score
 *
 * Tabla `MindsetScores` es opcional. Si no existe, devolvemos 503 con mensaje claro.
 */

import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { verifyToken, TokenError } from '../lib/urlSigning';
import { ValidationError, UnauthorizedError, NotFoundError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { publishOutboxEvent } from './outbox';
import { metrics } from '../lib/metrics';
import {
  scoreMindsetAnswers,
  type Mentalidad,
  type MindsetAnswer,
} from '../lib/mindsetScoring';

const log = logger('MINDSET_TEST');
const TABLE = 'MindsetScores';

const TABLE_NOT_READY = new AppError(
  503,
  'service_unavailable',
  'Tabla MindsetScores no creada en Catalyst. Crear con docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv',
);

let tableReady: boolean | null = null;
async function isTableReady(req: RequestContext['req']): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

/**
 * Submit de respuestas del test de mentalidades.
 *
 *   POST /test/<token>/mindset/submit
 *   Body: { answers: [{ question_id: "m1", chosen_mentalidad: "crecimiento" }, ...] }
 *   Response: { result_id, adaptability_score_pct, adaptability_pattern, perfil }
 */
export async function submitMindsetTest(ctx: RequestContext): Promise<void> {
  const token = ctx.req.url?.match(/^\/test\/([^/?]+)/)?.[1];
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const resultId = claims.ref;
  const tenantId = claims.tenant_id;

  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const body = await readJsonBody<{ answers?: unknown }>(ctx.req);
  if (!Array.isArray(body.answers)) {
    throw new ValidationError('answers required (array)');
  }
  const answers: MindsetAnswer[] = [];
  for (const raw of body.answers) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.question_id !== 'string' || typeof r.chosen_mentalidad !== 'string') continue;
    answers.push({
      question_id: r.question_id,
      chosen_mentalidad: r.chosen_mentalidad as Mentalidad,
    });
  }

  if (answers.length === 0) {
    throw new ValidationError('no valid answers in body');
  }

  const result = scoreMindsetAnswers(answers);

  // Persistir
  try {
    const inserted = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      result_id: resultId,
      started_at: now(),
      completed_at: now(),

      // Adaptables
      mindset_growth_pct: result.per_mentalidad_pct.crecimiento,
      mindset_curious_pct: result.per_mentalidad_pct.curiosa,
      mindset_creative_pct: result.per_mentalidad_pct.creativa,
      mindset_agent_pct: result.per_mentalidad_pct.agente,
      mindset_abundance_pct: result.per_mentalidad_pct.abundancia,
      mindset_exploration_pct: result.per_mentalidad_pct.exploracion,
      mindset_opportunity_pct: result.per_mentalidad_pct.oportunidad,

      // Limitantes
      mindset_fija_pct: result.per_mentalidad_pct.fija,
      mindset_experto_pct: result.per_mentalidad_pct.experto,
      mindset_reactiva_pct: result.per_mentalidad_pct.reactiva,
      mindset_victima_pct: result.per_mentalidad_pct.victima,
      mindset_escasez_pct: result.per_mentalidad_pct.escasez,
      mindset_certeza_pct: result.per_mentalidad_pct.certeza,
      mindset_proteccion_pct: result.per_mentalidad_pct.proteccion,

      adaptability_score_pct: result.adaptability_score_pct,
      adaptability_pattern: result.adaptability_pattern,
      answers_json: stringifyAndTruncate(answers, FIELD_LIMITS.OUTBOX_PAYLOAD, 'MindsetScores.answers_json'),
    });
    const row = unwrapRow<{ ROWID: string }>(inserted, TABLE);
    log.info('mindset test submitted', {
      traceId: ctx.traceId,
      resultId,
      adaptability_score_pct: result.adaptability_score_pct,
      pattern: result.adaptability_pattern,
      mindsetScoreId: row?.ROWID,
    });
  } catch (err) {
    log.warn('persist mindset score failed', { traceId: ctx.traceId, error: (err as Error).message });
    // Continuamos sin throw — devolvemos el score igual al candidato (frontend puede igual seguir el flow)
  }

  // Audit log (best-effort)
  void auditLog({ ...ctx, user: { ...(ctx.user ?? { clerk_user_id: 'candidate' }) } } as RequestContext, {
    action: 'application.transition',
    resource_type: 'application',
    resource_id: resultId,
    changes: {
      test: 'mindset',
      adaptability_score_pct: result.adaptability_score_pct,
      pattern: result.adaptability_pattern,
    },
  });

  // Publicar evento outbox (best-effort, no bloquea)
  try {
    await publishOutboxEvent(ctx.req, 'mindset_test_completed', {
      tenant_id: tenantId,
      result_id: resultId,
      adaptability_score_pct: result.adaptability_score_pct,
      pattern: result.adaptability_pattern,
    });
  } catch (err) {
    log.warn('outbox publish failed (mindset)', { error: (err as Error).message });
  }

  // Métrica
  metrics.incrementCounter('candidate_test_submitted_total', { test: 'mindset', pattern: result.adaptability_pattern });

  sendJson(ctx.res, 200, {
    result_id: resultId,
    adaptability_score_pct: result.adaptability_score_pct,
    adaptability_pattern: result.adaptability_pattern,
    perfil: result.per_mentalidad_pct,
  });
}

// ===== Tenant-side: GET /api/applications/:id/mindset =====

export async function getMindsetForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const match = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/mindset/);
  const applicationId = match?.[1];
  if (!applicationId) throw new ValidationError('application_id missing');

  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const q = `SELECT * FROM ${TABLE} WHERE result_id = '${escapeSql(applicationId)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const rows = unwrapRows<Record<string, unknown>>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE);
  const row = rows[0];

  if (!row) {
    throw new NotFoundError(`No mindset score for application ${applicationId}`);
  }

  sendJson(ctx.res, 200, { mindset_score: row });
}

/** Para tests: resetea el cache de table-readiness. */
export function _resetMindsetTableCache() {
  tableReady = null;
}
