/**
 * Videos dinámicos del candidato (doc 20).
 *
 * Endpoints:
 *   POST /api/applications/:id/videos/generate              → Cris dispara: IA arma 7 preguntas custom
 *   GET  /api/applications/:id/videos                       → Cris lista preguntas + responses
 *   POST /api/applications/:id/videos/:questionId/analyze   → Cris dispara análisis IA de un transcript
 *
 *   GET  /test/<token>/videos                                → candidato lista las preguntas
 *   POST /test/<token>/videos/:questionId/submit             → candidato registra respuesta (transcript opcional)
 *
 * Storage físico de videos (Catalyst File Store): cuando Cris esté lista para deploy, agregar
 * upload signed URL endpoint. Por ahora, las respuestas pueden persistir solo transcript
 * (cuando el frontend tenga Whisper o transcripción manual).
 */
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, UnauthorizedError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { verifyToken, TokenError } from '../lib/urlSigning';
import { requireFeature } from '../lib/featureFlags';
import { generateVideoQuestions, analyzeWeaknesses, type GeneratedVideoQuestion } from '../lib/videoQuestionsGenerator';
import { analyzeVideoAnswer } from '../lib/videoAnalysis';
import {
  persistVideoQuestions,
  listVideoQuestionsForApplication,
  fetchVideoQuestion,
  recordVideoResponse,
  listResponsesForApplication,
  fetchVideoResponse,
  updateResponseAnalysis,
  type VideoResponseRow,
} from '../lib/videoPersistence';

const log = logger('VIDEOS');

// ===== Tenant: Cris dispara generación =====

export async function generateVideosForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  await requireFeature(ctx, 'video_questions');

  const id = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/videos\/generate/)?.[1];
  if (!id) throw new ValidationError('application id missing');

  // Verificar tenant ownership + cargar contexto completo
  const ownership = await fetchOwnership(ctx, id);
  if (!ownership || ownership.tenant_id !== tenantId) {
    throw new NotFoundError(`Application ${id} not found`);
  }

  const ctxData = await loadContext(ctx, id);
  if (!ctxData?.result) throw new NotFoundError(`Application ${id} not found`);

  const weaknesses = analyzeWeaknesses(ctxData.scores);

  const questions = await generateVideoQuestions({
    jobTitle: String(ctxData.job?.title ?? ''),
    jobCompany: String(ctxData.job?.company ?? ''),
    jobContext: typeof ctxData.job?.company_context === 'string' ? ctxData.job.company_context : undefined,
    cognitiveLevel: (ctxData.job?.cognitive_level as 'basic' | 'mid' | 'senior') ?? 'mid',
    requiresEnglish: false,
    candidateName: String(ctxData.candidate?.name ?? 'Candidato'),
    scores: ctxData.scores,
    integrityDimensions: ctxData.integrity,
    weaknesses,
    traceId: ctx.traceId,
  });

  const { persisted, tableMissing } = await persistVideoQuestions(ctx.req, id, questions);

  // Auto-transition: si las preguntas se persistieron y el candidato está en
  // integridad_completed, pasa a videos_pending (esperando que responda).
  if (persisted > 0 && ctxData.result?.pipeline_stage === 'integridad_completed') {
    try {
      const { datastore, now } = await import('../lib/db.js');
      const { transitionAllowed, isStage } = await import('../lib/pipelineStateMachine.js');
      const fromStage = String(ctxData.result.pipeline_stage);
      if (isStage(fromStage) && transitionAllowed(fromStage, 'videos_pending')) {
        await datastore(ctx.req).table('PipelineTransitions').insertRow({
          result_id: id,
          from_stage: fromStage,
          to_stage: 'videos_pending',
          actor: 'system',
          reason: 'Video questions generated — waiting for candidate to respond',
          transitioned_at: now(),
        });
        await datastore(ctx.req).table('Results').updateRow({
          ROWID: id,
          pipeline_stage: 'videos_pending',
        });
        log.info('auto-transitioned to videos_pending', { traceId: ctx.traceId, applicationId: id });
      }
    } catch (err) {
      log.warn('auto-transition to videos_pending failed', { applicationId: id, error: (err as Error).message });
    }
  }

  void auditLog(ctx, {
    action: 'draft.generate',
    resource_type: 'application',
    resource_id: id,
    changes: { video_questions_count: questions.length, persisted },
  });

  log.info('video questions generated', {
    traceId: ctx.traceId,
    applicationId: id,
    count: questions.length,
    persisted,
    tableMissing,
  });

  sendJson(ctx.res, 200, {
    application_id: id,
    count: questions.length,
    persisted,
    table_missing: tableMissing,
    questions, // se devuelven con rationale_internal — solo Cris las ve por este endpoint
  });
}

// ===== Tenant: lista preguntas + responses =====

export async function listVideosForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const id = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/videos/)?.[1];
  if (!id) throw new ValidationError('application id missing');

  const ownership = await fetchOwnership(ctx, id);
  if (!ownership || ownership.tenant_id !== tenantId) {
    throw new NotFoundError(`Application ${id} not found`);
  }

  const [questions, responses] = await Promise.all([
    listVideoQuestionsForApplication(ctx.req, id),
    listResponsesForApplication(ctx.req, id),
  ]);

  sendJson(ctx.res, 200, {
    application_id: id,
    questions: questions.map((q) => ({
      ...q,
      expected_signals: tryParseArray(q.expected_signals),
    })),
    responses,
  });
}

// ===== Tenant: dispara análisis IA de un response =====

export async function analyzeVideoResponse(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  await requireFeature(ctx, 'video_questions');

  const match = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/videos\/([^/]+)\/analyze/);
  const [, applicationId, responseRowId] = match ?? [];
  if (!applicationId || !responseRowId) throw new ValidationError('path invalid');

  const ownership = await fetchOwnership(ctx, applicationId);
  if (!ownership || ownership.tenant_id !== tenantId) {
    throw new NotFoundError(`Application ${applicationId} not found`);
  }

  const response = await fetchVideoResponse(ctx.req, responseRowId);
  if (!response || response.application_id !== applicationId) {
    throw new NotFoundError(`Response ${responseRowId} not found`);
  }
  if (!response.transcript) {
    throw new ValidationError('Response no tiene transcript todavía — esperar a Whisper o cargar manual');
  }

  const question = await fetchVideoQuestion(ctx.req, applicationId, response.question_id);
  if (!question) throw new NotFoundError(`Question ${response.question_id} not found`);

  try {
    const analysis = await analyzeVideoAnswer({
      category: question.category,
      question_text: question.question_text,
      rationale_internal: question.rationale_internal,
      expected_signals: tryParseArray(question.expected_signals),
      transcript: response.transcript,
      traceId: ctx.traceId,
    });
    await updateResponseAnalysis(ctx.req, responseRowId, analysis, 'ok');
    sendJson(ctx.res, 200, { application_id: applicationId, response_id: responseRowId, analysis });
  } catch (err) {
    log.warn('analyze failed', { traceId: ctx.traceId, applicationId, responseRowId, error: (err as Error).message });
    await updateResponseAnalysis(ctx.req, responseRowId, { overall_pct: 0, signals_matched_pct: 0, observations: [], flags: ['analysis_failed'] }, 'failed');
    sendJson(ctx.res, 502, { error: { code: 'analysis_failed', message: (err as Error).message } });
  }
}

// ===== Public (token-signed): candidato lista preguntas =====

export async function listTestVideos(ctx: RequestContext): Promise<void> {
  const token = ctx.req.url?.match(/^\/test\/([^/?]+)/)?.[1];
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const applicationId = claims.ref;
  const questions = await listVideoQuestionsForApplication(ctx.req, applicationId);

  // Para el candidato: NO exponer rationale_internal (eso es solo para Cris).
  const sanitized = questions.map((q) => ({
    question_id: q.question_id,
    category: q.category,
    question_text: q.question_text,
    expected_signals: tryParseArray(q.expected_signals),
    max_duration_sec: q.max_duration_sec,
  }));

  sendJson(ctx.res, 200, {
    application_id: applicationId,
    questions: sanitized,
    count: sanitized.length,
  });
}

// ===== Public: candidato sube blob de video =====

/**
 * Endpoint que recibe el blob de video/audio del candidato y lo persiste en Catalyst
 * File Store. Devuelve `catalyst_file_id` que después se manda al `submit`.
 *
 *   POST /test/<token>/videos/<questionId>/upload
 *   Content-Type: video/webm | audio/webm | etc.
 *   Body: bytes raw del blob
 *
 * Límites:
 *   - Catalyst function tiene límite de body típicamente ~10MB. Para videos más largos,
 *     considerar chunked upload (futuro).
 *   - max_duration_sec del frontend ya limita a 60-90s, lo cual a webm comprimido = ~5-10MB.
 */
export async function uploadTestVideo(ctx: RequestContext): Promise<void> {
  const match = ctx.req.url?.match(/^\/test\/([^/]+)\/videos\/([^/]+)\/upload/);
  const [, token, questionId] = match ?? [];
  if (!token || !questionId) throw new ValidationError('path inválido');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const applicationId = claims.ref;

  // Verificar consentimiento explícito del candidato (Ley Panamá / GDPR).
  // Si la tabla VideoConsents no existe todavía (Block 3 deferred), hasActiveConsent
  // devuelve true graceful — no bloqueamos producción durante setup.
  const { hasActiveConsent } = await import('./videoConsents.js');
  const hasConsent = await hasActiveConsent(ctx.req, applicationId);
  if (!hasConsent) {
    throw new AppError(403, 'consent_required',
      'Debes aceptar el consentimiento de grabación antes de subir videos. POST /test/<token>/consent.',
    );
  }

  // Verificar que la pregunta existe + pertenece a esta application
  const q = await fetchVideoQuestion(ctx.req, applicationId, questionId);
  if (!q) throw new NotFoundError(`Pregunta ${questionId} no encontrada`);

  const { env } = await import('../lib/env.js');
  const folderId = env().FILESTORE_VIDEO_FOLDER_ID;
  if (!folderId) {
    throw new AppError(503, 'video_folder_not_configured',
      'FILESTORE_VIDEO_FOLDER_ID no está seteado en env vars. Crear folder en Catalyst Console → File Store y setear el ID.',
    );
  }

  // Leer el blob raw del request
  const chunks: Buffer[] = [];
  let totalSize = 0;
  const MAX_BYTES = 25 * 1024 * 1024; // 25MB hard limit

  await new Promise<void>((resolve, reject) => {
    ctx.req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BYTES) {
        reject(new ValidationError(`Body > ${MAX_BYTES / (1024 * 1024)}MB — video demasiado largo`));
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve());
    ctx.req.on('error', reject);
  });

  if (totalSize === 0) {
    throw new ValidationError('Body vacío');
  }

  const buffer = Buffer.concat(chunks);
  const contentType = (ctx.req.headers['content-type'] as string | undefined) ?? 'video/webm';
  const ext = contentType.includes('audio') ? 'webm' : (contentType.includes('mp4') ? 'mp4' : 'webm');
  const filename = `${applicationId}__${questionId}__${Date.now()}.${ext}`;

  log.info('uploading video to file store', {
    traceId: ctx.traceId,
    applicationId,
    questionId,
    bytes: totalSize,
    contentType,
    filename,
  });

  // Subir a Catalyst File Store
  let fileId: string | null = null;
  try {
    const { filestore } = await import('../lib/db.js');
    const folder = (filestore(ctx.req) as { folder: (id: string) => unknown }).folder(folderId);
    const uploadResult = await ((folder as { uploadFile: (opts: { name: string; file: Buffer }) => Promise<{ file_id?: string; ROWID?: string }> }).uploadFile({
      name: filename,
      file: buffer,
    }));
    fileId = String(uploadResult.file_id ?? uploadResult.ROWID ?? '');
  } catch (err) {
    log.error('file store upload failed', {
      traceId: ctx.traceId,
      applicationId,
      questionId,
      error: (err as Error).message,
    });
    throw new AppError(502, 'file_store_upload_failed',
      `No se pudo subir al File Store: ${(err as Error).message}`,
    );
  }

  if (!fileId) {
    throw new AppError(502, 'file_store_no_id', 'File Store no devolvió file_id');
  }

  log.info('video uploaded successfully', {
    traceId: ctx.traceId,
    applicationId,
    questionId,
    fileId,
    bytes: totalSize,
  });

  sendJson(ctx.res, 201, {
    catalyst_file_id: fileId,
    filename,
    bytes: totalSize,
    next_step: `POST /test/${token}/videos/${questionId}/submit con body { catalyst_file_id: "${fileId}" }`,
  });
}

// ===== Public: candidato submit respuesta =====

export async function submitTestVideo(ctx: RequestContext): Promise<void> {
  const match = ctx.req.url?.match(/^\/test\/([^/]+)\/videos\/([^/]+)\/submit/);
  const [, token, questionId] = match ?? [];
  if (!token || !questionId) throw new ValidationError('path invalid');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const applicationId = claims.ref;
  const body = await readJsonBody<Record<string, unknown>>(ctx.req);

  // Verificar que la pregunta exista para esta application
  const q = await fetchVideoQuestion(ctx.req, applicationId, questionId);
  if (!q) throw new NotFoundError(`Pregunta ${questionId} no encontrada`);

  // Validar que el candidato no haya enviado más de 2 respuestas para esta pregunta.
  // (la tabla no tiene columna `attempt`, entonces contamos rows existentes)
  try {
    const existing = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM VideoResponses WHERE application_id = '${escapeSql(applicationId)}' AND question_id = '${escapeSql(questionId)}'`,
      )) as unknown[],
      'VideoResponses',
    );
    if (existing.length >= 2) {
      throw new ValidationError('Máximo 2 attempts por pregunta. Ya alcanzaste el límite.');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    // Si la tabla no existe, recordVideoResponse manejará el table-not-ready.
  }

  const transcript = typeof body.transcript === 'string' && body.transcript.trim() ? body.transcript : null;
  const catalystFileId = typeof body.catalyst_file_id === 'string' ? body.catalyst_file_id : null;
  const durationSec = typeof body.duration_sec === 'number' ? Math.round(body.duration_sec) : null;
  const fileSizeBytes = typeof body.file_size_bytes === 'number' ? Math.round(body.file_size_bytes) : null;
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type : null;

  const { rowId, tableMissing } = await recordVideoResponse(ctx.req, {
    applicationId,
    questionId,
    catalystFileId,
    fileSizeBytes,
    durationSec,
    mimeType,
    transcript,
  });

  if (tableMissing) {
    sendJson(ctx.res, 503, {
      error: { code: 'table_not_ready', message: 'Tabla VideoResponses no creada todavía' },
    });
    return;
  }

  log.info('video response submitted', {
    traceId: ctx.traceId,
    applicationId,
    questionId,
    has_transcript: transcript != null,
    has_file: catalystFileId != null,
  });

  // Auto-transition videos_pending → videos_completed cuando el candidato respondió
  // todas las preguntas. Si quedan algunas sin responder, sigue en videos_pending.
  try {
    const allQs = await listVideoQuestionsForApplication(ctx.req, applicationId);
    const allRsRaw = await zcql(ctx.req).executeZCQLQuery(
      `SELECT DISTINCT question_id FROM VideoResponses WHERE application_id = '${escapeSql(applicationId)}'`,
    );
    const respondedQids = new Set(
      unwrapRows<{ question_id: string }>(allRsRaw as unknown[], 'VideoResponses').map((r) => r.question_id),
    );
    const allResponded = allQs.length > 0 && allQs.every((q) => respondedQids.has(q.question_id));

    if (allResponded) {
      const resultRow = unwrapRows<{ pipeline_stage: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT pipeline_stage FROM Results WHERE ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
        )) as unknown[],
        'Results',
      )[0];
      if (resultRow?.pipeline_stage === 'videos_pending') {
        const { datastore, now } = await import('../lib/db.js');
        await datastore(ctx.req).table('PipelineTransitions').insertRow({
          result_id: applicationId,
          from_stage: 'videos_pending',
          to_stage: 'videos_completed',
          actor: 'system',
          reason: `All ${allQs.length} videos submitted`,
          transitioned_at: now(),
        });
        await datastore(ctx.req).table('Results').updateRow({
          ROWID: applicationId,
          pipeline_stage: 'videos_completed',
        });
        log.info('auto-transitioned to videos_completed', { traceId: ctx.traceId, applicationId });
      }
    }
  } catch (err) {
    log.warn('auto-transition videos_completed check failed', {
      applicationId,
      error: (err as Error).message,
    });
  }

  sendJson(ctx.res, 201, {
    response_id: rowId,
    next_steps: transcript
      ? 'Transcript guardado. El análisis IA se dispara aparte (POST /api/applications/:id/videos/:responseId/analyze).'
      : 'Esperando transcripción. La integración de Whisper la procesará.',
  });
}

// ===== Helpers =====

type OwnershipPick = { tenant_id: string };
async function fetchOwnership(ctx: RequestContext, applicationId: string): Promise<OwnershipPick | null> {
  const q = `
    SELECT J.tenant_id AS tenant_id
    FROM Results R
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE R.ROWID = '${escapeSql(applicationId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const rows = unwrapRows<OwnershipPick>(
    (await zcql(ctx.req).executeZCQLQuery(q)) as unknown[],
    'Jobs',
  );
  return rows[0] ?? null;
}

type ContextResult = {
  result: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  candidate: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
  integrity: Array<{ dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number }>;
};

async function loadContext(ctx: RequestContext, applicationId: string): Promise<ContextResult | null> {
  const result = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM Results WHERE ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0] ?? null;
  if (!result) return null;

  const [job, candidate, scores, integrity] = await Promise.all([
    fetchOne(ctx, 'Jobs', `ROWID = '${escapeSql(String(result.assessment_id))}'`),
    fetchOne(ctx, 'Candidates', `ROWID = '${escapeSql(String(result.candidate_id))}'`),
    fetchOne(ctx, 'Scores', `result_id = '${escapeSql(applicationId)}'`),
    fetchAllIntegrity(ctx, applicationId),
  ]);

  return { result, job, candidate, scores, integrity };
}

async function fetchOne(ctx: RequestContext, table: string, where: string): Promise<Record<string, unknown> | null> {
  const rows = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`)) as unknown[],
    table,
  );
  return rows[0] ?? null;
}

async function fetchAllIntegrity(
  ctx: RequestContext,
  applicationId: string,
): Promise<Array<{ dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number }>> {
  type Row = { dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number };
  return unwrapRows<Row>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT dimension, nivel, pct FROM IntegrityDimensions WHERE result_id = '${escapeSql(applicationId)}'`,
    )) as unknown[],
    'IntegrityDimensions',
  );
}

function tryParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Re-export para tests
export type { GeneratedVideoQuestion, VideoResponseRow };
