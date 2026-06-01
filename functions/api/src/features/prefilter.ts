/**
 * PrefilterQuestions — cuestionario inicial OPCIONAL antes del test completo.
 *
 * Cuándo usarlo:
 *   El recruiter (o Cris) define 3-7 preguntas custom para un puesto. El candidato las
 *   contesta DESPUÉS de aplicar pero ANTES de empezar tests. Si las respuestas no son
 *   las buscadas, el candidato queda en stage `prefilter_pending` y NO recibe el link
 *   del test completo.
 *
 * Ejemplos de prefilter:
 *   - "¿Tenés visa de trabajo en Panamá?"
 *   - "¿Estás dispuesto a trabajar 100% presencial en Santiago?"
 *   - "¿Cuál es tu pretensión salarial mensual?"
 *
 * Tablas (Block 3 pendientes):
 *   - PrefilterQuestions (job_id, question_text, type [yes_no|multi_choice|number|text], options, expected_answer?, is_disqualifier, order_index)
 *   - PrefilterAnswers (result_id, question_id, answer_value, is_match, created_at)
 *
 * Si las tablas no existen, los endpoints devuelven graceful fallback (lista vacía o 503).
 *
 * Endpoints:
 *   GET    /api/jobs/:jobId/prefilter           → admin lista preguntas del job
 *   POST   /api/jobs/:jobId/prefilter           → admin agrega pregunta
 *   PATCH  /api/jobs/:jobId/prefilter/:qId      → admin edita pregunta
 *   DELETE /api/jobs/:jobId/prefilter/:qId      → admin borra pregunta
 *   GET    /test/:token/prefilter               → candidato lee preguntas (público)
 *   POST   /test/:token/prefilter               → candidato envía respuestas (público)
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, truncate, FIELD_LIMITS } from '../lib/dbLimits';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { verifyToken } from '../lib/urlSigning';

const log = logger('PREFILTER');
// Renombrada de "PrefilterQuestions" a "PrefQuestions" (2026-05-11): Catalyst envenenó el
// nombre original tras un orphan en POST /table API — ese nombre devuelve INVALID_ID
// permanentemente en columns API. Funcionalidad idéntica.
const TABLE_QUESTIONS = 'PrefQuestions';
const TABLE_ANSWERS = 'PrefilterAnswers';

export type PrefilterQuestionType = 'yes_no' | 'multi_choice' | 'number' | 'text';

export type PrefilterQuestion = {
  ROWID: string;
  job_id: string;
  question_text: string;
  type: PrefilterQuestionType;
  options: string | null;             // JSON array para multi_choice
  expected_answer: string | null;     // valor esperado para auto-match
  is_disqualifier: boolean;           // si no matchea el expected, descalifica directo
  order_index: number;
  created_at: string;
};

const tableReady: { questions: boolean | null; answers: boolean | null } = {
  questions: null,
  answers: null,
};

async function probeTable(req: IncomingMessage, name: 'questions' | 'answers'): Promise<boolean> {
  if (tableReady[name] !== null) return tableReady[name] as boolean;
  const tableName = name === 'questions' ? TABLE_QUESTIONS : TABLE_ANSWERS;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${tableName} LIMIT 1`);
    tableReady[name] = true;
  } catch {
    tableReady[name] = false;
  }
  return tableReady[name] as boolean;
}

export function _resetTableReadyForTests() {
  tableReady.questions = null;
  tableReady.answers = null;
}

function extractJobIdFromPath(url: string): string | null {
  return url.match(/^\/api\/jobs\/([^/]+)\/prefilter/)?.[1] ?? null;
}

function extractQuestionIdFromPath(url: string): string | null {
  return url.match(/^\/api\/jobs\/[^/]+\/prefilter\/([^/]+)/)?.[1] ?? null;
}

function extractTokenFromPath(url: string): string | null {
  return url.match(/^\/test\/([^/]+)\/prefilter/)?.[1] ?? null;
}

function validateQuestionType(type: unknown): PrefilterQuestionType {
  if (type !== 'yes_no' && type !== 'multi_choice' && type !== 'number' && type !== 'text') {
    throw new ValidationError(`type must be yes_no | multi_choice | number | text`);
  }
  return type;
}

// ===== Admin endpoints =====

export async function listPrefilterQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 200, { questions: [], table_ready: false });
    return;
  }

  const jobId = extractJobIdFromPath(ctx.req.url ?? '/');
  if (!jobId) throw new ValidationError('job id missing');

  // Validar ownership: el job debe pertenecer al tenant
  const job = unwrapRows<{ tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT tenant_id FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!job || job.tenant_id !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);

  const rows = unwrapRows<PrefilterQuestion>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE_QUESTIONS} WHERE job_id = '${escapeSql(jobId)}' ORDER BY order_index ASC`,
    )) as unknown[],
    TABLE_QUESTIONS,
  );

  sendJson(ctx.res, 200, { questions: rows, table_ready: true });
}

export async function createPrefilterQuestion(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 503, { error: 'PrefilterQuestions table not ready' });
    return;
  }

  const jobId = extractJobIdFromPath(ctx.req.url ?? '/');
  if (!jobId) throw new ValidationError('job id missing');

  // Validar ownership
  const job = unwrapRows<{ tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT tenant_id FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!job || job.tenant_id !== tenantId) throw new NotFoundError(`Job ${jobId} not found`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  if (typeof body.question_text !== 'string' || !body.question_text.trim()) {
    throw new ValidationError('question_text required');
  }
  const type = validateQuestionType(body.type);

  const inserted = await datastore(ctx.req).table(TABLE_QUESTIONS).insertRow({
    job_id: jobId,
    question_text: truncate(body.question_text.trim(), FIELD_LIMITS.PREFILTER_QUESTION_TEXT, 'PrefilterQuestions.question_text'),
    type,
    options: type === 'multi_choice' && Array.isArray(body.options)
      ? stringifyAndTruncate(body.options.slice(0, 10), FIELD_LIMITS.PREFILTER_OPTIONS, 'PrefilterQuestions.options')
      : null,
    expected_answer: typeof body.expected_answer === 'string'
      ? truncate(body.expected_answer, FIELD_LIMITS.PREFILTER_EXPECTED, 'PrefilterQuestions.expected_answer')
      : null,
    is_disqualifier: body.is_disqualifier === true,
    order_index: typeof body.order_index === 'number' ? Math.round(body.order_index) : 0,
    created_at: now(),
  });
  const row = unwrapRow<PrefilterQuestion>(inserted, TABLE_QUESTIONS);
  log.info('prefilter question created', { traceId: ctx.traceId, jobId, type });
  sendJson(ctx.res, 201, { question: row });
}

export async function patchPrefilterQuestion(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 503, { error: 'PrefilterQuestions table not ready' });
    return;
  }

  const questionId = extractQuestionIdFromPath(ctx.req.url ?? '/');
  if (!questionId) throw new ValidationError('question id missing');

  const existing = unwrapRows<PrefilterQuestion & { job_tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT PQ.*, J.tenant_id AS job_tenant_id
       FROM ${TABLE_QUESTIONS} PQ JOIN Jobs J ON J.ROWID = PQ.job_id
       WHERE PQ.ROWID = '${escapeSql(questionId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_QUESTIONS,
  )[0];
  if (!existing || existing.job_tenant_id !== tenantId) {
    throw new NotFoundError(`Question ${questionId} not found`);
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const patch: Record<string, unknown> = { ROWID: questionId };
  if (typeof body.question_text === 'string') patch.question_text = truncate(body.question_text, FIELD_LIMITS.PREFILTER_QUESTION_TEXT, 'PrefilterQuestions.question_text');
  if (typeof body.expected_answer === 'string') patch.expected_answer = truncate(body.expected_answer, FIELD_LIMITS.PREFILTER_EXPECTED, 'PrefilterQuestions.expected_answer');
  if (typeof body.is_disqualifier === 'boolean') patch.is_disqualifier = body.is_disqualifier;
  if (typeof body.order_index === 'number') patch.order_index = Math.round(body.order_index);

  if (Object.keys(patch).length === 1) throw new ValidationError('nothing to update');
  await datastore(ctx.req).table(TABLE_QUESTIONS).updateRow(patch as { ROWID: string });
  sendJson(ctx.res, 200, { updated: true });
}

export async function deletePrefilterQuestion(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  if (!(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 503, { error: 'PrefilterQuestions table not ready' });
    return;
  }

  const questionId = extractQuestionIdFromPath(ctx.req.url ?? '/');
  if (!questionId) throw new ValidationError('question id missing');

  const existing = unwrapRows<{ ROWID: string; job_tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT PQ.ROWID, J.tenant_id AS job_tenant_id
       FROM ${TABLE_QUESTIONS} PQ JOIN Jobs J ON J.ROWID = PQ.job_id
       WHERE PQ.ROWID = '${escapeSql(questionId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_QUESTIONS,
  )[0];
  if (!existing || existing.job_tenant_id !== tenantId) {
    throw new NotFoundError(`Question ${questionId} not found`);
  }

  await datastore(ctx.req).table(TABLE_QUESTIONS).deleteRow(questionId);
  sendJson(ctx.res, 200, { deleted: true });
}

// ===== Public endpoints (candidato) =====

export async function getPrefilterPublic(ctx: RequestContext): Promise<void> {
  if (!(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 200, { questions: [], table_ready: false });
    return;
  }

  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch {
    throw new NotFoundError('Test not found');
  }

  const result = unwrapRows<{ ROWID: string; assessment_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, assessment_id FROM Results WHERE ROWID = '${escapeSql(claims.ref)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];
  if (!result) throw new NotFoundError('Test not found');

  const questions = unwrapRows<PrefilterQuestion>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, question_text, type, options, order_index FROM ${TABLE_QUESTIONS}
       WHERE job_id = '${escapeSql(result.assessment_id)}' ORDER BY order_index ASC`,
    )) as unknown[],
    TABLE_QUESTIONS,
  );

  // No exponer expected_answer ni is_disqualifier al candidato
  const sanitized = questions.map((q) => ({
    id: q.ROWID,
    question_text: q.question_text,
    type: q.type,
    options: q.options ? safeJsonParse(q.options) : null,
    order_index: q.order_index,
  }));

  sendJson(ctx.res, 200, { questions: sanitized, count: sanitized.length });
}

export async function submitPrefilterAnswers(ctx: RequestContext): Promise<void> {
  if (!(await probeTable(ctx.req, 'answers')) || !(await probeTable(ctx.req, 'questions'))) {
    sendJson(ctx.res, 503, { error: 'Prefilter tables not ready' });
    return;
  }

  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch {
    throw new NotFoundError('Test not found');
  }

  const result = unwrapRows<{ ROWID: string; assessment_id: string; pipeline_stage: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, assessment_id, pipeline_stage FROM Results WHERE ROWID = '${escapeSql(claims.ref)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];
  if (!result) throw new NotFoundError('Test not found');

  const body = (await readJsonBody(ctx.req)) as { answers?: Array<{ question_id: string; value: string }> };
  if (!Array.isArray(body.answers)) throw new ValidationError('answers array required');

  const questions = unwrapRows<PrefilterQuestion>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM ${TABLE_QUESTIONS} WHERE job_id = '${escapeSql(result.assessment_id)}'`,
    )) as unknown[],
    TABLE_QUESTIONS,
  );

  let disqualified = false;

  for (const answer of body.answers) {
    if (typeof answer.question_id !== 'string' || typeof answer.value !== 'string') continue;
    const q = questions.find((qq) => qq.ROWID === answer.question_id);
    if (!q) continue;

    const isMatch = q.expected_answer
      ? answer.value.trim().toLowerCase() === q.expected_answer.trim().toLowerCase()
      : true;

    if (q.is_disqualifier && !isMatch) disqualified = true;

    try {
      await datastore(ctx.req).table(TABLE_ANSWERS).insertRow({
        result_id: result.ROWID,
        question_id: q.ROWID,
        answer_value: answer.value.slice(0, 1000),
        is_match: isMatch,
        created_at: now(),
      });
    } catch (err) {
      log.warn('prefilter answer insert failed', { error: (err as Error).message });
    }
  }

  // Si descalificado, mover a auto_rejected_low_score (es un terminal stage del state machine)
  // Si pasa, mover a prefilter_passed para que pueda continuar al test
  const newStage = disqualified ? 'auto_rejected_low_score' : 'prefilter_passed';
  try {
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: result.ROWID,
      pipeline_stage: newStage,
    });
  } catch (err) {
    log.warn('result stage update failed', { error: (err as Error).message });
  }

  sendJson(ctx.res, 200, {
    submitted: true,
    disqualified,
    next_stage: newStage,
  });
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ===== Admin: lee respuestas de un candidato =====

/**
 * GET /api/applications/:id/prefilter-answers
 *
 * Devuelve las respuestas del candidato a las preguntas del prefilter, con info
 * de si matchearon el expected_answer + si la pregunta era descalificadora.
 *
 * Útil para que Cris vea por qué un candidato fue rechazado por el prefilter, o
 * qué respondió cuando se va a entrevistar.
 */
export async function listPrefilterAnswersForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  if (!(await probeTable(ctx.req, 'answers'))) {
    sendJson(ctx.res, 200, { answers: [], table_ready: false });
    return;
  }

  const match = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/prefilter-answers/);
  const applicationId = match?.[1];
  if (!applicationId) throw new ValidationError('application id missing');

  // Validar ownership: el job del result debe pertenecer al tenant
  const ownership = unwrapRows<{ tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT J.tenant_id AS tenant_id FROM Results R
       JOIN Jobs J ON J.ROWID = R.assessment_id
       WHERE R.ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!ownership || ownership.tenant_id !== tenantId) {
    throw new NotFoundError(`Application ${applicationId} not found`);
  }

  // Join answers + questions para tener el text + expected
  const rows = unwrapRows<{
    ROWID: string;
    question_id: string;
    answer_value: string;
    is_match: boolean;
    created_at: string;
    question_text: string;
    type: string;
    expected_answer: string | null;
    is_disqualifier: boolean;
  }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT PA.ROWID, PA.question_id, PA.answer_value, PA.is_match, PA.created_at,
              PQ.question_text, PQ.type, PQ.expected_answer, PQ.is_disqualifier
       FROM ${TABLE_ANSWERS} PA
       JOIN ${TABLE_QUESTIONS} PQ ON PQ.ROWID = PA.question_id
       WHERE PA.result_id = '${escapeSql(applicationId)}'
       ORDER BY PA.CREATEDTIME ASC`,
    )) as unknown[],
    TABLE_ANSWERS,
  );

  sendJson(ctx.res, 200, {
    answers: rows,
    count: rows.length,
    table_ready: true,
  });
}
