/**
 * Persistencia de VideoQuestions y VideoResponses.
 *
 * Las 2 tablas son OPCIONALES (deferred Block 2). Si no existen, las funciones devuelven
 * fallbacks razonables: questions vacías, no-op writes.
 */
import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRow, unwrapRows } from './dbHelpers';
import { stringifyAndTruncate, truncate, FIELD_LIMITS } from './dbLimits';
import { logger } from './logger';
import type { GeneratedVideoQuestion, VideoQuestionCategory } from './videoQuestionsGenerator';
import type { VideoAnswerAnalysis } from './videoAnalysis';

const log = logger('VIDEO_PERSISTENCE');

const T_QUESTIONS = 'VideoQuestions';
const T_RESPONSES = 'VideoResponses';

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

export type VideoQuestionRow = {
  ROWID: string;
  application_id: string;
  question_id: string;
  category: VideoQuestionCategory;
  question_text: string;
  rationale_internal: string;
  expected_signals: string; // JSON array
  max_duration_sec: number;
  created_at: string;
};

export type VideoResponseRow = {
  ROWID: string;
  application_id: string;
  question_id: string;
  catalyst_file_id: string | null;
  file_size_bytes: number | null;
  duration_sec: number | null;
  mime_type: string | null;
  transcript: string | null;
  analysis_json: string | null;
  uploaded_at: string;
  analyzed_at: string | null;
};

// ===== VideoQuestions =====

export async function persistVideoQuestions(
  req: IncomingMessage,
  applicationId: string,
  questions: GeneratedVideoQuestion[],
): Promise<{ persisted: number; tableMissing: boolean }> {
  if (!(await checkTableReady(req, T_QUESTIONS))) {
    return { persisted: 0, tableMissing: true };
  }
  let persisted = 0;
  for (const q of questions) {
    try {
      await datastore(req).table(T_QUESTIONS).insertRow({
        application_id: applicationId,
        question_id: q.id,
        category: q.category,
        question_text: truncate(q.question_text, FIELD_LIMITS.VIDEO_QUESTION_TEXT, 'VideoQuestions.question_text'),
        rationale_internal: truncate(q.rationale_internal, FIELD_LIMITS.VIDEO_RATIONALE, 'VideoQuestions.rationale_internal'),
        expected_signals: stringifyAndTruncate(q.expected_signals, FIELD_LIMITS.VIDEO_EXPECTED_SIGNALS, 'VideoQuestions.expected_signals'),
        max_duration_sec: q.max_duration_sec,
        created_at: now(),
      });
      persisted++;
    } catch (err) {
      log.warn('persist video question failed', { applicationId, qid: q.id, error: (err as Error).message });
    }
  }
  return { persisted, tableMissing: false };
}

export async function listVideoQuestionsForApplication(
  req: IncomingMessage,
  applicationId: string,
): Promise<VideoQuestionRow[]> {
  if (!(await checkTableReady(req, T_QUESTIONS))) return [];
  const q = `
    SELECT * FROM ${T_QUESTIONS}
    WHERE application_id = '${escapeSql(applicationId)}'
    ORDER BY CREATEDTIME ASC
  `.replace(/\s+/g, ' ');
  return unwrapRows<VideoQuestionRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    T_QUESTIONS,
  );
}

export async function fetchVideoQuestion(
  req: IncomingMessage,
  applicationId: string,
  questionId: string,
): Promise<VideoQuestionRow | null> {
  if (!(await checkTableReady(req, T_QUESTIONS))) return null;
  const q = `
    SELECT * FROM ${T_QUESTIONS}
    WHERE application_id = '${escapeSql(applicationId)}' AND question_id = '${escapeSql(questionId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const rows = unwrapRows<VideoQuestionRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    T_QUESTIONS,
  );
  return rows[0] ?? null;
}

// ===== VideoResponses =====

/**
 * Registra que un candidato submiteó una respuesta. La transcripción + análisis IA
 * llegan asíncrono (Whisper + analyzeVideoAnswer) — empezamos en pending.
 */
export async function recordVideoResponse(
  req: IncomingMessage,
  input: {
    applicationId: string;
    questionId: string;
    catalystFileId?: string | null;
    fileSizeBytes?: number | null;
    durationSec?: number | null;
    mimeType?: string | null;
    transcript?: string | null;
  },
): Promise<{ rowId: string | null; tableMissing: boolean }> {
  if (!(await checkTableReady(req, T_RESPONSES))) {
    return { rowId: null, tableMissing: true };
  }
  try {
    const row = await datastore(req).table(T_RESPONSES).insertRow({
      application_id: input.applicationId,
      question_id: input.questionId,
      catalyst_file_id: input.catalystFileId ?? null,
      file_size_bytes: input.fileSizeBytes ?? null,
      duration_sec: input.durationSec ?? null,
      mime_type: input.mimeType ?? null,
      transcript: input.transcript ?? null,
      analysis_json: null,
      uploaded_at: now(),
      analyzed_at: null,
    });
    const inserted = unwrapRow<{ ROWID: string }>(row, T_RESPONSES);
    return { rowId: inserted?.ROWID ?? null, tableMissing: false };
  } catch (err) {
    log.warn('recordVideoResponse failed', { error: (err as Error).message });
    return { rowId: null, tableMissing: false };
  }
}

export async function updateResponseTranscript(
  req: IncomingMessage,
  rowId: string,
  transcript: string,
  _status: 'ok' | 'failed' = 'ok',
): Promise<void> {
  if (!(await checkTableReady(req, T_RESPONSES))) return;
  await datastore(req).table(T_RESPONSES).updateRow({
    ROWID: rowId,
    transcript: truncate(transcript, FIELD_LIMITS.VIDEO_TRANSCRIPT, 'VideoResponses.transcript'),
  });
}

export async function updateResponseAnalysis(
  req: IncomingMessage,
  rowId: string,
  analysis: VideoAnswerAnalysis,
  _status: 'ok' | 'failed' = 'ok',
): Promise<void> {
  if (!(await checkTableReady(req, T_RESPONSES))) return;
  await datastore(req).table(T_RESPONSES).updateRow({
    ROWID: rowId,
    analysis_json: stringifyAndTruncate(analysis, FIELD_LIMITS.VIDEO_ANALYSIS, 'VideoResponses.analysis_json'),
    analyzed_at: now(),
  });
}

export async function listResponsesForApplication(
  req: IncomingMessage,
  applicationId: string,
): Promise<VideoResponseRow[]> {
  if (!(await checkTableReady(req, T_RESPONSES))) return [];
  const q = `
    SELECT * FROM ${T_RESPONSES}
    WHERE application_id = '${escapeSql(applicationId)}'
    ORDER BY uploaded_at DESC
  `.replace(/\s+/g, ' ');
  return unwrapRows<VideoResponseRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    T_RESPONSES,
  );
}

export async function fetchVideoResponse(
  req: IncomingMessage,
  rowId: string,
): Promise<VideoResponseRow | null> {
  if (!(await checkTableReady(req, T_RESPONSES))) return null;
  const q = `SELECT * FROM ${T_RESPONSES} WHERE ROWID = '${escapeSql(rowId)}' LIMIT 1`;
  const rows = unwrapRows<VideoResponseRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    T_RESPONSES,
  );
  return rows[0] ?? null;
}

export function _resetTableReadyCache() {
  tableReady.clear();
}
