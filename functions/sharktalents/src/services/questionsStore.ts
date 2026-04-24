import * as db from '../db';

export interface TechnicalQuestion {
  id: string;
  text: string;
  options: string[];
  correct: number;
  kind?: string;
}

export async function loadTechnicalQuestions(req: any, assessmentId: string, legacyJson?: string): Promise<TechnicalQuestion[]> {
  const rows = await db.queryAllPaginated(req,
    `SELECT ROWID, question_id, text, options, correct, kind, sort_order FROM AssessmentQuestions WHERE assessment_id = ${db.esc(String(assessmentId))} ORDER BY sort_order`,
    'AssessmentQuestions');
  if (rows.length > 0) {
    return rows.map((r: any) => ({
      id: r.question_id,
      text: r.text,
      options: safeParseOptions(r.options),
      correct: parseInt(r.correct) || 0,
      kind: r.kind || undefined,
    }));
  }
  // Fallback: read from legacy Assessments.questions column
  if (legacyJson && legacyJson !== '[]' && legacyJson !== '__FROM_SEEDS__') {
    try {
      const parsed = JSON.parse(legacyJson);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [];
}

function safeParseOptions(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

export async function saveTechnicalQuestions(req: any, assessmentId: string, questions: TechnicalQuestion[]): Promise<void> {
  // Delete existing rows for this assessment
  const existing = await db.queryAllPaginated(req,
    `SELECT ROWID FROM AssessmentQuestions WHERE assessment_id = ${db.esc(String(assessmentId))}`,
    'AssessmentQuestions');
  for (const row of existing) {
    try { await db.deleteRow(req, 'AssessmentQuestions', row.ROWID || row.id); } catch {}
  }
  // Insert new rows
  const ts = db.now();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await db.insert(req, 'AssessmentQuestions', {
      assessment_id: String(assessmentId),
      sort_order: String(i),
      question_id: String(q.id),
      text: q.text,
      options: JSON.stringify(q.options),
      correct: String(q.correct),
      kind: q.kind || '',
      created_at: ts,
    });
  }
}

export async function updateTechnicalQuestion(req: any, assessmentId: string, questionId: string, updates: Partial<TechnicalQuestion>): Promise<TechnicalQuestion | null> {
  const row = await db.queryOne(req,
    `SELECT ROWID, question_id, text, options, correct, kind FROM AssessmentQuestions WHERE assessment_id = ${db.esc(String(assessmentId))} AND question_id = ${db.esc(String(questionId))}`,
    'AssessmentQuestions');
  if (!row) return null;
  const patch: any = {};
  if (updates.text !== undefined) patch.text = updates.text;
  if (updates.options !== undefined) patch.options = JSON.stringify(updates.options);
  if (updates.correct !== undefined) patch.correct = String(updates.correct);
  if (Object.keys(patch).length === 0) return null;
  await db.update(req, 'AssessmentQuestions', row.ROWID || row.id, patch);
  return {
    id: row.question_id,
    text: patch.text ?? row.text,
    options: patch.options ? JSON.parse(patch.options) : safeParseOptions(row.options),
    correct: patch.correct ? parseInt(patch.correct) : (parseInt(row.correct) || 0),
    kind: row.kind || undefined,
  };
}

export async function countTechnicalQuestions(req: any, assessmentId: string, legacyJson?: string): Promise<number> {
  const rows = await db.queryAllPaginated(req,
    `SELECT ROWID FROM AssessmentQuestions WHERE assessment_id = ${db.esc(String(assessmentId))}`,
    'AssessmentQuestions');
  if (rows.length > 0) return rows.length;
  if (legacyJson && legacyJson !== '[]' && legacyJson !== '__FROM_SEEDS__') {
    try {
      const parsed = JSON.parse(legacyJson);
      if (Array.isArray(parsed)) return parsed.length;
    } catch {}
  }
  return 0;
}
