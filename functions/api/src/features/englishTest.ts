/**
 * Endpoints del test de inglés (4 niveles CEFR).
 *
 * El test tiene 3 bloques:
 *   1. Multiple-choice (vocab + grammar + reading)
 *   2. Listening (audio + preguntas)
 *   3. Writing (texto del candidato + análisis IA)
 *
 * El frontend lee bancos estáticos desde `shark/src/data/questions/english-{level}.json`.
 * El backend solo:
 *   - Recibe las respuestas y el texto escrito
 *   - Llama a Claude para analizar el writing
 *   - Computa el score total ponderado
 *   - Persiste en EnglishTestSessions
 *   - Devuelve passed: true/false al frontend (no le dice al candidato — sigue el flow)
 *
 * Endpoints:
 *   POST /test/<token>/english/submit   → submit completo + scoring
 *
 * Tabla `EnglishTestSessions` es opcional. Si no existe, devolvemos 503.
 */

import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, truncate, FIELD_LIMITS } from '../lib/dbLimits';
import { verifyToken, TokenError } from '../lib/urlSigning';
import { ValidationError, UnauthorizedError, NotFoundError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { publishOutboxEvent } from './outbox';
import { metrics } from '../lib/metrics';
import { scoreEnglishTest, multipleChoiceScorePct, type CefrLevel } from '../lib/englishScoring';
import { analyzeWriting } from '../lib/englishWritingAnalyzer';

const log = logger('ENGLISH_TEST');
const TABLE = 'EnglishTestSessions';

const TABLE_NOT_READY = new AppError(
  503,
  'service_unavailable',
  'Tabla EnglishTestSessions no creada en Catalyst. Ver docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv',
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

const VALID_LEVELS: CefrLevel[] = ['A2', 'B1', 'B2', 'C1'];

/**
 * Submit del test completo de inglés.
 *
 *   POST /test/<token>/english/submit
 *   Body: {
 *     level: "B2",
 *     mc_correct: 14,                       // cuántas multi-choice acertó
 *     mc_total: 20,                          // total preguntas multi-choice
 *     listening_correct: 2,
 *     listening_total: 2,
 *     writing_text: "...",
 *     writing_word_count: 152,
 *     writing_time_seconds: 540,
 *     writing_paste_attempts: 0,
 *     writing_focus_lost_count: 1
 *   }
 *
 *   Response: { result_id, passed, total_score_pct, threshold_pct, level }
 */
export async function submitEnglishTest(ctx: RequestContext): Promise<void> {
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

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);

  // Validate required fields
  const level = body.level as string | undefined;
  if (!level || !VALID_LEVELS.includes(level as CefrLevel)) {
    throw new ValidationError(`level required (${VALID_LEVELS.join('|')})`);
  }
  const writingText = typeof body.writing_text === 'string' ? body.writing_text : '';
  if (writingText.trim().length === 0) {
    throw new ValidationError('writing_text required');
  }

  const mcCorrect = Number(body.mc_correct ?? 0);
  const mcTotal = Number(body.mc_total ?? 20);
  const listeningCorrect = Number(body.listening_correct ?? 0);
  const listeningTotal = Number(body.listening_total ?? 2);

  const mcScorePct = multipleChoiceScorePct(mcCorrect, mcTotal);
  const listeningScorePct = multipleChoiceScorePct(listeningCorrect, listeningTotal);

  // Analyze writing with Claude
  let writingScorePct = 0;
  let writingAnalysisJson = '';
  try {
    const analysis = await analyzeWriting({
      text: writingText,
      level: level as CefrLevel,
      traceId: ctx.traceId,
    });
    writingScorePct = analysis.score_pct;
    writingAnalysisJson = JSON.stringify(analysis);
  } catch (err) {
    log.warn('writing analysis failed', { traceId: ctx.traceId, error: (err as Error).message });
    // Si el análisis falla, asumimos 0% writing — el candidato no debería ser eliminado por
    // un fallo de IA, pero registramos el evento para revisión manual.
  }

  // Compute final score
  const scoring = scoreEnglishTest({
    level: level as CefrLevel,
    mc_score_pct: mcScorePct,
    listening_score_pct: listeningScorePct,
    writing_score_pct: writingScorePct,
  });

  // Persist session
  try {
    const inserted = await datastore(ctx.req).table(TABLE).insertRow({
      tenant_id: tenantId,
      result_id: resultId,
      level_required: level,
      started_at: now(),
      completed_at: now(),
      mc_score_pct: mcScorePct,
      listening_score_pct: listeningScorePct,
      writing_score_pct: writingScorePct,
      total_score_pct: scoring.total_score_pct,
      passed: scoring.passed,
      writing_text: truncate(writingText, FIELD_LIMITS.ENGLISH_WRITING_TEXT, 'EnglishTestSessions.writing_text'),
      writing_word_count: Number(body.writing_word_count ?? 0),
      writing_time_seconds: Number(body.writing_time_seconds ?? 0),
      writing_paste_attempts: Number(body.writing_paste_attempts ?? 0),
      writing_focus_lost_count: Number(body.writing_focus_lost_count ?? 0),
      audio_listening_id: typeof body.audio_listening_id === 'string' ? body.audio_listening_id : null,
      writing_analysis_json: writingAnalysisJson
        ? stringifyAndTruncate(JSON.parse(writingAnalysisJson), FIELD_LIMITS.VIDEO_ANALYSIS, 'EnglishTestSessions.writing_analysis_json')
        : null,
    });
    const row = unwrapRow<{ ROWID: string }>(inserted, TABLE);
    log.info('english test submitted', {
      traceId: ctx.traceId,
      resultId,
      level,
      total_score_pct: scoring.total_score_pct,
      passed: scoring.passed,
      sessionId: row?.ROWID,
    });
  } catch (err) {
    log.warn('persist english session failed', { traceId: ctx.traceId, error: (err as Error).message });
  }

  // Audit log (best-effort)
  void auditLog({ ...ctx, user: { ...(ctx.user ?? { clerk_user_id: 'candidate' }) } } as RequestContext, {
    action: 'application.transition',
    resource_type: 'application',
    resource_id: resultId,
    changes: {
      test: 'english',
      level,
      total_score_pct: scoring.total_score_pct,
      passed: scoring.passed,
    },
  });

  // Publicar evento outbox
  try {
    await publishOutboxEvent(ctx.req, 'english_test_completed', {
      tenant_id: tenantId,
      result_id: resultId,
      level,
      total_score_pct: scoring.total_score_pct,
      passed: scoring.passed,
    });
  } catch (err) {
    log.warn('outbox publish failed (english)', { error: (err as Error).message });
  }

  // Métrica
  metrics.incrementCounter('candidate_test_submitted_total', {
    test: 'english',
    level,
    passed: scoring.passed ? 'true' : 'false',
  });

  sendJson(ctx.res, 200, {
    result_id: resultId,
    level,
    total_score_pct: scoring.total_score_pct,
    threshold_pct: scoring.threshold_pct,
    passed: scoring.passed,
    // No mostramos el score detallado al candidato — solo passed (que el frontend usa para gate del video).
  });
}

// ===== Tenant-side: GET /api/applications/:id/english =====

export async function getEnglishForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const match = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/english/);
  const applicationId = match?.[1];
  if (!applicationId) throw new ValidationError('application_id missing');

  if (!(await isTableReady(ctx.req))) throw TABLE_NOT_READY;

  const q = `SELECT * FROM ${TABLE} WHERE result_id = '${escapeSql(applicationId)}' AND tenant_id = '${escapeSql(tenantId)}' ORDER BY CREATEDTIME DESC LIMIT 1`;
  const rows = unwrapRows<Record<string, unknown>>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE);
  const row = rows[0];

  if (!row) {
    throw new NotFoundError(`No english test session for application ${applicationId}`);
  }

  sendJson(ctx.res, 200, { english_session: row });
}

/** Para tests: resetea el cache de table-readiness. */
export function _resetEnglishTableCache() {
  tableReady = null;
}
