import { GET, POST, PUT, DELETE } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import * as db from '../db';
import { v4 as uuidv4 } from 'uuid';
import { getQuestionsForAssessment } from '../seeds/loadQuestions';

async function createMissingAssessments(req: any, jobId: string | number): Promise<Record<string, string>> {
  const existing = await db.queryAll(req, `SELECT type FROM Assessments WHERE job_id = ${db.esc(String(jobId))}`, 'Assessments');
  const existingTypes = existing.map((a: any) => a.type);
  const ts = db.now();
  const types = ['technical', 'kudert', 'integrity'];
  const links: Record<string, string> = {};
  for (const type of types) {
    if (existingTypes.includes(type)) {
      // Already exists, skip
      const row = await db.queryOne(req, `SELECT public_token FROM Assessments WHERE job_id = ${db.esc(String(jobId))} AND type = ${db.esc(type)}`, 'Assessments');
      if (row) links[type] = `/test/${row.public_token}`;
      continue;
    }
    const token = uuidv4();
    await db.insert(req, 'Assessments', { job_id: String(jobId), type, public_token: token, questions: type === 'technical' ? '[]' : '__FROM_SEEDS__', status: 'active', generated_at: ts, created_at: ts });
    links[type] = `/test/${token}`;
  }
  return links;
}

export function registerAdminJobRoutes(): void {

  POST('/api/admin/jobs', async (req, res) => {
    const body = await parseBody(req);
    const { title, company, tech_prompt, cognitive_level, ideal_profile, ideal_competencias } = body;
    if (!title || !company) return sendError(res, 400, 'title and company are required');
    const level = cognitive_level || 'basic';
    const ts = db.now();
    const job = await db.insert(req, 'Jobs', { title, company, tech_prompt: tech_prompt || '', cognitive_level: level, is_active: '1', created_by: '', ideal_profile: ideal_profile ? JSON.stringify(ideal_profile) : '', ideal_competencias: ideal_competencias ? JSON.stringify(ideal_competencias) : '', created_at: ts, updated_at: ts });
    const jobId = job.ROWID;
    const links = await createMissingAssessments(req, jobId);
    sendJson(res, 201, { id: jobId, title, company, cognitive_level: level, is_active: 1, links });
  });

  // Repair endpoint: create missing assessments for an existing job
  POST('/api/admin/jobs/:id/create-assessments', async (req, res, params) => {
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    const links = await createMissingAssessments(req, params.id);
    sendJson(res, 201, { message: 'Assessments created', links });
  });

  GET('/api/admin/jobs', async (req, res) => {
    const jobs = await db.queryAll(req, "SELECT * FROM Jobs ORDER BY created_at DESC", 'Jobs');
    sendJson(res, 200, jobs);
  });

  // GET /api/admin/jobs/costs — get cost data for all jobs (MUST be before :id route)
  GET('/api/admin/jobs/costs', async (req, res) => {
    const jobs = await db.queryAll(req, "SELECT * FROM Jobs ORDER BY created_at DESC", 'Jobs');
    const result = [];
    for (const job of jobs) {
      const jid = job.ROWID || job.id;
      const ip = job.ideal_profile ? JSON.parse(job.ideal_profile) : {};
      const costConfig = ip.cost_config || {};
      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(jid)}`, 'Assessments');
      let kudertCount = 0, integrityCount = 0, hasTechnical = false, pdfCount = 0;
      for (const a of assessments) {
        const aid = a.ROWID || a.id;
        const completed = await db.queryAll(req, `SELECT ROWID, report_downloaded_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        if (a.type === 'kudert') kudertCount = completed.length;
        if (a.type === 'integrity') integrityCount = completed.length;
        if (a.type === 'technical') {
          const techRows = await db.query(req, `SELECT ROWID FROM AssessmentQuestions WHERE assessment_id = ${db.esc(String(aid))} LIMIT 1`);
          if (techRows.length > 0) { hasTechnical = true; }
          else {
            const techA = await db.queryOne(req, `SELECT questions FROM Assessments WHERE ROWID = ${db.esc(aid)}`, 'Assessments');
            try { const q = JSON.parse(techA?.questions || '[]'); hasTechnical = Array.isArray(q) && q.length > 0; } catch { hasTechnical = false; }
          }
        }
        for (const r of completed) { if (r.report_downloaded_at) pdfCount++; }
      }
      const tokenUsage = ip.token_usage || { total_input: 0, total_output: 0 };
      // Estimate tokens for jobs without real tracking
      // Haiku: ~1500 input + ~4000 output per technical gen, ~2000 input + ~2000 output per PDF
      let estInput = tokenUsage.total_input || 0;
      let estOutput = tokenUsage.total_output || 0;
      if (estInput === 0 && estOutput === 0) {
        if (hasTechnical) { estInput += 1500; estOutput += 4000; }
        estInput += pdfCount * 2000;
        estOutput += pdfCount * 2000;
      }
      result.push({
        id: jid, title: job.title, company: job.company, is_active: job.is_active,
        client_type: costConfig.client_type || 'normal', salary: costConfig.salary || 0,
        advertising: costConfig.advertising || 0, hours: costConfig.hours || 0,
        kudert_count: kudertCount, integrity_count: integrityCount,
        tokens_input: estInput, tokens_output: estOutput,
        tokens_estimated: (tokenUsage.total_input || 0) === 0 && (estInput > 0),
      });
    }
    sendJson(res, 200, result);
  });

  GET('/api/admin/jobs/competencias/list', async (_req, res) => {
    const { COMPETENCIAS } = require('../data/competencias');
    sendJson(res, 200, COMPETENCIAS.map((c: any) => ({ id: c.id, nombre: c.nombre })));
  });

  GET('/api/admin/jobs/:id', async (req, res, params) => {
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    // Safe-parse JSON fields to avoid sending truncated JSON to frontend
    try { job.ideal_profile = JSON.parse(job.ideal_profile); } catch { job.ideal_profile = {}; }
    try { job.ideal_competencias = JSON.parse(job.ideal_competencias); } catch { job.ideal_competencias = []; }
    sendJson(res, 200, job);
  });

  PUT('/api/admin/jobs/:id', async (req, res, params) => {
    const body = await parseBody(req);
    const existing = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!existing) return sendError(res, 404, 'Job not found');
    const updates: Record<string, any> = { updated_at: db.now() };
    if (body.title) updates.title = body.title;
    if (body.company) updates.company = body.company;
    if (body.tech_prompt !== undefined) updates.tech_prompt = body.tech_prompt;
    if (body.cognitive_level) updates.cognitive_level = body.cognitive_level;
    if (body.ideal_profile !== undefined) updates.ideal_profile = JSON.stringify(body.ideal_profile);
    if (body.ideal_competencias !== undefined) updates.ideal_competencias = JSON.stringify(body.ideal_competencias);
    await db.update(req, 'Jobs', params.id, updates);
    const updated = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    sendJson(res, 200, updated);
  });

  DELETE('/api/admin/jobs/:id', async (req, res, params) => {
    const existing = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!existing) return sendError(res, 404, 'Job not found');
    await db.update(req, 'Jobs', params.id, { is_active: '0', updated_at: db.now() });
    sendJson(res, 200, { message: 'Job deactivated' });
  });

  // PUT /api/admin/jobs/:id/cost-config — update cost configuration
  PUT('/api/admin/jobs/:id/cost-config', async (req, res, params) => {
    const body = await parseBody(req);
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    const ip = job.ideal_profile ? JSON.parse(job.ideal_profile) : {};
    ip.cost_config = {
      client_type: body.client_type || 'normal',
      salary: body.salary || 0,
      advertising: body.advertising || 0,
      hours: body.hours || 0,
    };
    await db.update(req, 'Jobs', params.id, { ideal_profile: JSON.stringify(ip), updated_at: db.now() });
    sendJson(res, 200, { success: true });
  });

  POST('/api/admin/jobs/suggest-profile', async (req, res) => {
    try {
      const body = await parseBody(req);
      const { COMPETENCIAS } = require('../data/competencias');
      const compDetails = (body.competencias || []).map((c: any) => { const full = COMPETENCIAS.find((x: any) => x.id === c.id); const factors = full ? full.factores.join(', ') : ''; return `${c.nombre} (${factors})`; }).join('\n');
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default();
      const response = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, system: 'Responde SOLO con JSON válido, sin markdown.', messages: [{ role: 'user', content: `Para "${body.jobTitle || ''}" con competencias:\n${compDetails}\n\nSugiere: {"disc":{"D":X,"I":X,"S":X,"C":X},"velna":{"verbal":X,"espacial":X,"logica":X,"numerica":X,"abstracta":X}}` }] });
      let raw = response.content.find((b: any) => b.type === 'text')?.text?.trim() || '{}';
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      sendJson(res, 200, JSON.parse(raw));
    } catch (err: any) { sendError(res, 500, err.message); }
  });
}
