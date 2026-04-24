import { GET, POST } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import * as db from '../db';
import { getQuestionsForAssessment } from '../seeds/loadQuestions';
import { loadTechnicalQuestions } from '../services/questionsStore';

export function registerPublicTestRoutes(): void {

  GET('/api/public/test/:token', async (req, res, params) => {
    const a = await db.queryOne(req, `SELECT ROWID, type, questions, status, job_id FROM Assessments WHERE public_token = ${db.esc(params.token)}`, 'Assessments');
    if (!a) return sendError(res, 404, 'Test not found');
    if (a.status !== 'active') return sendError(res, 410, 'Test is no longer active');
    const job = await db.queryOne(req, `SELECT title, company, cognitive_level FROM Jobs WHERE ROWID = ${db.esc(a.job_id)}`, 'Jobs');
    a.job_title = job?.title || '';
    a.company = job?.company || '';

    if (a.type === 'technical') {
      const techQs = await loadTechnicalQuestions(req, a.ROWID || a.id, a.questions);
      return sendJson(res, 200, { id: a.ROWID || a.id, type: a.type, job_title: a.job_title, company: a.company, questions: strip(techQs) });
    }

    // Load questions from seeds if not stored in DB
    let raw: any;
    if (!a.questions || a.questions === '[]' || a.questions === '__FROM_SEEDS__') {
      raw = getQuestionsForAssessment(a.type, job?.cognitive_level || 'basic');
    } else {
      raw = JSON.parse(a.questions);
    }
    if (a.type === 'kudert') {
      const sections = (Array.isArray(raw) && raw[0]?.name) ? raw.map((sec: any) => ({ name: sec.name, questions: strip(sec.questions || []), timer: sec.timer ?? null })).filter((s: any) => s.questions.length > 0) : [];
      return sendJson(res, 200, { id: a.ROWID || a.id, type: a.type, job_title: a.job_title, company: a.company, sections });
    }
    sendJson(res, 200, { id: a.ROWID || a.id, type: a.type, job_title: a.job_title, company: a.company, questions: strip(Array.isArray(raw) ? raw : []) });
  });

  POST('/api/public/test/:token/start', async (req, res, params) => {
    const body = await parseBody(req);
    const { name, email, phone, age, salary_expectation, availability } = body;
    if (!name || !email) return sendError(res, 400, 'name and email are required');
    const a = await db.queryOne(req, `SELECT ROWID, status FROM Assessments WHERE public_token = ${db.esc(params.token)}`, 'Assessments');
    if (!a) return sendError(res, 404, 'Test not found');
    if (a.status !== 'active') return sendError(res, 410, 'Test is no longer active');

    let candidate = await db.queryOne(req, `SELECT ROWID FROM Candidates WHERE email = ${db.esc(email)}`, 'Candidates');
    if (candidate) {
      const upd: any = { name }; if (phone) upd.phone = phone; if (age) upd.age = String(age); if (salary_expectation) upd.salary_expectation = String(salary_expectation); if (availability) upd.availability = availability;
      await db.update(req, 'Candidates', candidate.ROWID || candidate.id, upd);
    } else {
      candidate = await db.insert(req, 'Candidates', { name, email, phone: phone || '', age: age ? String(age) : '', salary_expectation: salary_expectation ? String(salary_expectation) : '', availability: availability || '', created_at: db.now() });
    }
    const cid = candidate.ROWID || candidate.id, aid = a.ROWID || a.id;
    const existing = await db.queryOne(req, `SELECT ROWID, answers, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND candidate_id = ${db.esc(cid)}`, 'Results');
    if (existing) {
      const savedAnswers = existing.answers ? JSON.parse(existing.answers) : {};
      const answeredCount = typeof savedAnswers === 'object' ? Object.keys(savedAnswers).length : 0;
      return sendJson(res, 200, {
        result_id: existing.ROWID || existing.id,
        message: 'Test already started',
        already_completed: !!existing.completed_at,
        saved_answers: answeredCount > 0 ? savedAnswers : null,
        answered_count: answeredCount,
      });
    }
    const result = await db.insert(req, 'Results', { assessment_id: String(aid), candidate_id: String(cid), answers: '[]', score: '', ai_analysis: '', screen_exits: '0', report_downloaded_at: '', started_at: db.now(), completed_at: '' });
    sendJson(res, 201, { result_id: result.ROWID, message: 'Test started' });
  });

  // POST /api/public/test/:token/save — auto-save partial answers
  POST('/api/public/test/:token/save', async (req, res, params) => {
    const body = await parseBody(req);
    const { email, answers } = body;
    if (!email || !answers) return sendError(res, 400, 'email and answers are required');
    const a = await db.queryOne(req, `SELECT ROWID FROM Assessments WHERE public_token = ${db.esc(params.token)}`, 'Assessments');
    if (!a) return sendError(res, 404, 'Test not found');
    const candidate = await db.queryOne(req, `SELECT ROWID FROM Candidates WHERE email = ${db.esc(email)}`, 'Candidates');
    if (!candidate) return sendError(res, 404, 'Candidate not found');
    const aid = a.ROWID || a.id, cid = candidate.ROWID || candidate.id;
    const result = await db.queryOne(req, `SELECT ROWID, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND candidate_id = ${db.esc(cid)}`, 'Results');
    if (!result) return sendError(res, 404, 'No active test found');
    if (result.completed_at) return sendJson(res, 200, { message: 'Already completed' });
    await db.update(req, 'Results', result.ROWID || result.id, { answers: JSON.stringify(answers) });
    sendJson(res, 200, { message: 'Answers saved', answered_count: Object.keys(answers).length });
  });

  POST('/api/public/test/:token/submit', async (req, res, params) => {
    const body = await parseBody(req);
    const { email, answers, screen_exits, screen_exit_log } = body;
    if (!email || !answers) return sendError(res, 400, 'email and answers are required');
    const a = await db.queryOne(req, `SELECT ROWID, type, questions FROM Assessments WHERE public_token = ${db.esc(params.token)}`, 'Assessments');
    if (!a) return sendError(res, 404, 'Test not found');
    const candidate = await db.queryOne(req, `SELECT ROWID FROM Candidates WHERE email = ${db.esc(email)}`, 'Candidates');
    if (!candidate) return sendError(res, 404, 'Candidate not found');
    const aid = a.ROWID || a.id, cid = candidate.ROWID || candidate.id;
    const result = await db.queryOne(req, `SELECT ROWID, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND candidate_id = ${db.esc(cid)}`, 'Results');
    if (!result) return sendError(res, 404, 'No active test found');
    if (result.completed_at) return sendError(res, 409, 'Test already submitted');
    const { calculateScore } = require('../services/scoring');
    // Load questions: technical from AssessmentQuestions, others from stored JSON or seeds
    let raw: any;
    if (a.type === 'technical') {
      raw = await loadTechnicalQuestions(req, aid, a.questions);
    } else if (!a.questions || a.questions === '[]' || a.questions === '__FROM_SEEDS__') {
      const aInfo = await db.queryOne(req, `SELECT job_id FROM Assessments WHERE ROWID = ${db.esc(aid)}`, 'Assessments');
      const job2 = aInfo ? await db.queryOne(req, `SELECT cognitive_level FROM Jobs WHERE ROWID = ${db.esc(aInfo.job_id)}`, 'Jobs') : null;
      raw = getQuestionsForAssessment(a.type, job2?.cognitive_level || 'basic');
    } else {
      raw = JSON.parse(a.questions);
    }
    const score = calculateScore(a.type, raw, answers);
    const exitData = screen_exit_log && screen_exit_log.length > 0
      ? JSON.stringify({ count: screen_exits || 0, log: screen_exit_log })
      : String(screen_exits || 0);
    await db.update(req, 'Results', result.ROWID || result.id, { answers: JSON.stringify(answers), score: JSON.stringify(score), screen_exits: exitData, completed_at: db.now() });
    sendJson(res, 200, { result_id: result.ROWID || result.id, score, message: 'Test submitted successfully' });
  });
}

function strip(questions: any[]): any[] {
  return questions.map((q: any) => { const s: any = { id: q.id, text: q.text, options: q.options }; if (q.svg) s.svg = q.svg; if (q.options_svg) s.options_svg = q.options_svg; return s; });
}
