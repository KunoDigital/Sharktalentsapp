import { GET, POST, PATCH } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import * as db from '../db';
import { getQuestionsForAssessment } from '../seeds/loadQuestions';
import { loadTechnicalQuestions, saveTechnicalQuestions, updateTechnicalQuestion, countTechnicalQuestions } from '../services/questionsStore';

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export function registerAdminAssessmentRoutes(): void {

  GET('/api/admin/jobs/:id/assessments', async (req, res, params) => {
    const job = await db.queryOne(req, `SELECT cognitive_level FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    const rows = await db.queryAll(req, `SELECT ROWID, type, public_token, status, questions, generated_at, created_at FROM Assessments WHERE job_id = ${db.esc(params.id)}`, 'Assessments');
    const result: any[] = [];
    for (const a of rows) {
      const aid = a.ROWID || a.id;
      let qc: number;
      if (a.type === 'technical') {
        qc = await countTechnicalQuestions(req, aid, a.questions);
      } else if (!a.questions || a.questions === '[]' || a.questions === '__FROM_SEEDS__') {
        const seeds = getQuestionsForAssessment(a.type, job?.cognitive_level || 'basic');
        if (Array.isArray(seeds) && seeds[0]?.name) qc = seeds.reduce((s: number, sec: any) => s + (sec.questions?.length || 0), 0);
        else qc = Array.isArray(seeds) ? seeds.length : 0;
      } else {
        try {
          const raw = JSON.parse(a.questions);
          if (Array.isArray(raw) && raw[0]?.name) qc = raw.reduce((s: number, sec: any) => s + (sec.questions?.length || 0), 0);
          else qc = Array.isArray(raw) ? raw.length : 0;
        } catch {
          console.warn('[ASSESSMENTS] Corrupted JSON in questions for', a.type, '- falling back to seeds');
          const seeds = getQuestionsForAssessment(a.type, job?.cognitive_level || 'basic');
          if (Array.isArray(seeds) && seeds[0]?.name) qc = seeds.reduce((s: number, sec: any) => s + (sec.questions?.length || 0), 0);
          else qc = Array.isArray(seeds) ? seeds.length : 0;
        }
      }
      result.push({ id: aid, type: a.type, public_token: a.public_token, status: a.status, questions_count: qc, generated_at: a.generated_at, created_at: a.created_at, link: `/test/${a.public_token}` });
    }
    sendJson(res, 200, result);
  });

  GET('/api/admin/jobs/:id/technical/questions', async (req, res, params) => {
    const a = await db.queryOne(req, `SELECT ROWID, questions FROM Assessments WHERE job_id = ${db.esc(params.id)} AND type = 'technical'`, 'Assessments');
    if (!a) return sendError(res, 404, 'Technical assessment not found');
    const questions = await loadTechnicalQuestions(req, a.ROWID || a.id, a.questions);
    sendJson(res, 200, questions);
  });

  PATCH('/api/admin/jobs/:id/technical/questions/:questionId', async (req, res, params) => {
    const body = await parseBody(req);
    const a = await db.queryOne(req, `SELECT ROWID FROM Assessments WHERE job_id = ${db.esc(params.id)} AND type = 'technical'`, 'Assessments');
    if (!a) return sendError(res, 404, 'Technical assessment not found');
    const updated = await updateTechnicalQuestion(req, a.ROWID || a.id, params.questionId, {
      text: body.text,
      options: body.options,
      correct: body.correct,
    });
    if (!updated) return sendError(res, 404, 'Question not found');
    sendJson(res, 200, updated);
  });

  POST('/api/admin/jobs/:id/generate-technical', async (req, res, params) => {
    try {
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const a = await db.queryOne(req, `SELECT ROWID FROM Assessments WHERE job_id = ${db.esc(params.id)} AND type = 'technical'`, 'Assessments');
      if (!a) return sendError(res, 404, 'Technical assessment not found');
      const aid = a.ROWID || a.id;
      const existingCount = await countTechnicalQuestions(req, aid);
      if (existingCount > 0) return sendError(res, 409, 'Already generated');
      const { generateTechnicalQuestions } = require('../services/anthropic');
      const { trackTokens } = require('../services/tokenTracker');
      const prompt = job.tech_prompt || `Puesto de ${job.title} en ${job.company}`;
      const [techPart, sitPart] = await Promise.all([
        generateTechnicalQuestions(prompt, job.title, { count: 12, kind: 'technical', idPrefix: 'ta' }),
        generateTechnicalQuestions(prompt, job.title, { count: 13, kind: 'situational', idPrefix: 'tb' }),
      ]);
      const withKind = [
        ...techPart.questions.map((q: any) => ({ ...q, kind: 'ta' })),
        ...sitPart.questions.map((q: any) => ({ ...q, kind: 'tb' })),
      ];
      const questions = interleave(
        withKind.filter((q: any) => q.kind === 'ta'),
        withKind.filter((q: any) => q.kind === 'tb')
      );
      const totalIn = techPart.usage.input_tokens + sitPart.usage.input_tokens;
      const totalOut = techPart.usage.output_tokens + sitPart.usage.output_tokens;
      await trackTokens(req, params.id, 'generate_technical', totalIn, totalOut);
      console.log(`[TECHNICAL] Generated ${questions.length} questions (${techPart.questions.length} tech + ${sitPart.questions.length} sit), tokens: ${totalIn}+${totalOut}`);
      await saveTechnicalQuestions(req, aid, questions);
      await db.update(req, 'Assessments', aid, { questions: '[]', generated_at: db.now() });
      const ex = await db.queryOne(req, `SELECT ROWID FROM TechLibrary WHERE name = ${db.esc(job.title)} AND company = ${db.esc(job.company)}`, 'TechLibrary');
      if (!ex) await db.insert(req, 'TechLibrary', { name: job.title, company: job.company, prompt, origin: 'ai', created_at: db.now() });
      sendJson(res, 200, { success: true, questions_count: questions.length });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  POST('/api/admin/jobs/:id/regenerate-technical', async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const a = await db.queryOne(req, `SELECT ROWID FROM Assessments WHERE job_id = ${db.esc(params.id)} AND type = 'technical'`, 'Assessments');
      if (!a) return sendError(res, 404, 'Technical assessment not found');
      const prompt = body.prompt || job.tech_prompt || `Puesto de ${job.title} en ${job.company}`;
      if (body.prompt) await db.update(req, 'Jobs', params.id, { tech_prompt: body.prompt, updated_at: db.now() });
      console.log(`[TECHNICAL] Regenerating for job ${params.id}, prompt length: ${prompt.length}`);
      const { generateTechnicalQuestions } = require('../services/anthropic');
      const { trackTokens } = require('../services/tokenTracker');
      const [techPart, sitPart] = await Promise.all([
        generateTechnicalQuestions(prompt, job.title, { count: 12, kind: 'technical', idPrefix: 'ta' }),
        generateTechnicalQuestions(prompt, job.title, { count: 13, kind: 'situational', idPrefix: 'tb' }),
      ]);
      const withKind = [
        ...techPart.questions.map((q: any) => ({ ...q, kind: 'ta' })),
        ...sitPart.questions.map((q: any) => ({ ...q, kind: 'tb' })),
      ];
      const questions = interleave(
        withKind.filter((q: any) => q.kind === 'ta'),
        withKind.filter((q: any) => q.kind === 'tb')
      );
      const totalIn = techPart.usage.input_tokens + sitPart.usage.input_tokens;
      const totalOut = techPart.usage.output_tokens + sitPart.usage.output_tokens;
      await trackTokens(req, params.id, 'regenerate_technical', totalIn, totalOut);
      console.log(`[TECHNICAL] Regenerated ${questions.length} questions (${techPart.questions.length} tech + ${sitPart.questions.length} sit), tokens: ${totalIn}+${totalOut}`);
      const aid = a.ROWID || a.id;
      await saveTechnicalQuestions(req, aid, questions);
      await db.update(req, 'Assessments', aid, { questions: '[]', generated_at: db.now() });
      try {
        const ex = await db.queryOne(req, `SELECT ROWID FROM TechLibrary WHERE name = ${db.esc(job.title)} AND company = ${db.esc(job.company)}`, 'TechLibrary');
        if (!ex) await db.insert(req, 'TechLibrary', { name: job.title, company: job.company, prompt, origin: 'ai', created_at: db.now() });
      } catch (libErr: any) { console.warn('[TECHNICAL] Library insert failed (non-critical):', libErr.message); }
      sendJson(res, 200, { success: true, questions_count: questions.length });
    } catch (err: any) {
      console.error(`[TECHNICAL] Regenerate FAILED:`, err.message);
      console.error(`[TECHNICAL] Stack:`, err.stack?.split('\n').slice(0, 3).join('\n'));
      sendError(res, 500, err.message);
    }
  });
}
