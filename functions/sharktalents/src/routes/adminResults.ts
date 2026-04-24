import { GET, PATCH, POST } from '../router';
import { sendJson, sendError, sendPdf, parseBody } from '../helpers';
import * as db from '../db';

function safeParseJson(raw: string | null | undefined, fallback: any = {}): any {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch {
    console.warn('[SAFE_PARSE] JSON corrupted/truncated, using fallback. First 100 chars:', raw.substring(0, 100));
    return fallback;
  }
}

export function registerAdminResultRoutes(): void {

  // GET /api/admin/jobs/:id/results
  GET('/api/admin/jobs/:id/results', async (req, res, params) => {
    const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.id)}`, 'Assessments');
    const allResults: any[] = [];
    for (const a of assessments) {
      const aid = a.ROWID || a.id;
      const results = await db.queryAll(req, `SELECT ROWID, assessment_id, candidate_id, answers, score, screen_exits, started_at, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} ORDER BY started_at DESC`, 'Results');
      for (const r of results) {
        const c = await db.queryOne(req, `SELECT ROWID, name, email FROM Candidates WHERE ROWID = ${db.esc(r.candidate_id)}`, 'Candidates');
        allResults.push({ ...r, assessment_type: a.type, candidate_name: c?.name, candidate_email: c?.email });
      }
    }
    sendJson(res, 200, allResults);
  });

  // GET /api/admin/jobs/:id/comparison
  GET('/api/admin/jobs/:id/comparison', async (req, res, params) => {
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    const ip = safeParseJson(job.ideal_profile, { disc: { D: 50, I: 50, S: 50, C: 50 }, cognitive: { verbal: 50, espacial: 50, logica: 50, numerica: 50, abstracta: 50 }, min_technical_score: 60 });
    const ic = job.ideal_competencias ? JSON.parse(job.ideal_competencias) : [];

    const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.id)}`, 'Assessments');

    // Filter 1: Technical pipeline filter
    // - Candidates with a technical result marked "next_stage": allowed
    // - Candidates WITHOUT a technical result: pass through
    const techAssessment = assessments.find((a: any) => a.type === 'technical');
    const allowedByTech = new Set<string>();
    const hasAnyTechResult = new Set<string>();
    if (techAssessment) {
      const tid = techAssessment.ROWID || techAssessment.id;
      try {
        const nextStageResults = await db.queryAllPaginated(req, `SELECT candidate_id FROM Results WHERE assessment_id = ${db.esc(tid)} AND pipeline_stage = 'next_stage'`, 'Results');
        for (const r of nextStageResults) allowedByTech.add(r.candidate_id);
        const completedTechResults = await db.queryAllPaginated(req, `SELECT candidate_id FROM Results WHERE assessment_id = ${db.esc(tid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        for (const r of completedTechResults) hasAnyTechResult.add(r.candidate_id);
      } catch { /* pipeline_stage column may not exist */ }
    }

    // Filter 2: Exclude candidates marked "rejected_kudert" in kudert pipeline
    const kudertAssessment = assessments.find((a: any) => a.type === 'kudert');
    const rejectedByKudert = new Set<string>();
    if (kudertAssessment) {
      const kid = kudertAssessment.ROWID || kudertAssessment.id;
      try {
        const kudertResults = await db.queryAllPaginated(req, `SELECT candidate_id FROM Results WHERE assessment_id = ${db.esc(kid)} AND pipeline_stage = 'rejected_kudert'`, 'Results');
        for (const r of kudertResults) rejectedByKudert.add(r.candidate_id);
      } catch { /* pipeline_stage column may not exist */ }
    }

    // Filter 3: Exclude candidates marked "rejected_integrity" in integrity pipeline
    const integrityAssessment = assessments.find((a: any) => a.type === 'integrity');
    const rejectedByIntegrity = new Set<string>();
    if (integrityAssessment) {
      const iid = integrityAssessment.ROWID || integrityAssessment.id;
      try {
        const intResults = await db.queryAllPaginated(req, `SELECT candidate_id FROM Results WHERE assessment_id = ${db.esc(iid)} AND pipeline_stage = 'rejected_integrity'`, 'Results');
        for (const r of intResults) rejectedByIntegrity.add(r.candidate_id);
      } catch { /* pipeline_stage column may not exist */ }
    }

    // Filter 4: Only include candidates who completed kudert (DISC)
    const completedKudert = new Set<string>();
    if (kudertAssessment) {
      const kid = kudertAssessment.ROWID || kudertAssessment.id;
      const kudertCompleted = await db.queryAllPaginated(req, `SELECT candidate_id FROM Results WHERE assessment_id = ${db.esc(kid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      for (const r of kudertCompleted) completedKudert.add(r.candidate_id);
    }

    const map = new Map<string, any>();

    for (const a of assessments) {
      const aid = a.ROWID || a.id;
      // Query all fields we need; columns may not exist yet so fallback progressively
      let results: any[];
      try {
        results = await db.queryAllPaginated(req, `SELECT ROWID, candidate_id, score, pipeline_stage, screen_exits, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      } catch (e1: any) {
        console.log('[COMPARISON] Full query failed:', e1.message?.substring(0, 80));
        try {
          results = await db.queryAllPaginated(req, `SELECT ROWID, candidate_id, score, screen_exits, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        } catch {
          results = await db.queryAllPaginated(req, `SELECT ROWID, candidate_id, score, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        }
      }
      for (const r of results) {
        const cid = r.candidate_id;
        // Technical filter: if candidate did the technical test, must be in "next_stage"
        // If candidate never did technical, let them through
        if (hasAnyTechResult.has(cid) && allowedByTech.size > 0 && !allowedByTech.has(cid)) continue;
        if (rejectedByKudert.has(cid)) continue;
        if (rejectedByIntegrity.has(cid)) continue;
        if (completedKudert.size > 0 && !completedKudert.has(cid)) continue;
        if (!map.has(cid)) {
          const c = await db.queryOne(req, `SELECT ROWID, name, email, salary_expectation FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');
          map.set(cid, { candidate: { id: cid, name: c?.name, email: c?.email, salary_expectation: c?.salary_expectation || null }, results: {} });
        }
        const entry = map.get(cid)!;
        let s: any = null;
        try { s = r.score ? JSON.parse(r.score) : null; } catch { console.warn('[COMPARISON] Failed to parse score for candidate', cid, 'assessment', a.type); }
        // Parse screen exits per test type
        const rawExits = r.screen_exits != null ? String(r.screen_exits) : '0';
        let exitCount = 0, exitLog: any[] = [];
        try {
          if (rawExits.startsWith('{')) {
            const p = JSON.parse(rawExits);
            exitCount = p.count || 0;
            exitLog = p.log || [];
          } else {
            exitCount = parseInt(rawExits) || 0;
          }
        } catch { exitCount = parseInt(rawExits) || 0; }
        if (!entry.screen_exits) entry.screen_exits = { total: 0, by_test: {}, log: [] };
        entry.screen_exits.total += exitCount;
        entry.screen_exits.by_test[a.type] = (entry.screen_exits.by_test[a.type] || 0) + exitCount;
        entry.screen_exits.log.push(...exitLog.map((l: any) => ({ ...l, test: a.type })));

        if (a.type === 'kudert') {
          entry.kudert_result_id = r.ROWID || r.id;
          entry.kudert_pipeline_stage = r.pipeline_stage || null;
          if (s) {
            if (s.disc) entry.results.disc = { score: s.disc, perfil_dominante: s.disc.perfil_dominante, match_percentage: 50 };
            if (s.cognitive) entry.results.cognitive = { score: s.cognitive, match_percentage: 50 };
            if (s.emotional) entry.results.emotional = s.emotional;
            if (s.competencias) entry.results.competencias = s.competencias;
          }
        }
        if (a.type === 'technical' && s?.total != null) {
          const pct = Math.round((s.total / s.max) * 100);
          entry.results.technical = { score: pct, passed: pct >= ip.min_technical_score };
        }
        if (a.type === 'integrity') {
          entry.results.integrity = s;
          entry.integrity_result_id = r.ROWID || r.id;
        }
      }
    }
    sendJson(res, 200, { ideal_profile: ip, ideal_competencias: ic, candidates: Array.from(map.values()) });
  });

  // GET /api/admin/jobs/:id/pipeline
  GET('/api/admin/jobs/:id/pipeline', async (req, res, params) => {
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    const ip = safeParseJson(job.ideal_profile, { min_technical_score: 70 });

    const assessments = await db.queryAll(req, `SELECT ROWID, type, public_token FROM Assessments WHERE job_id = ${db.esc(params.id)}`, 'Assessments');
    const pipeline: Record<string, any> = {};

    for (const a of assessments) {
      const aid = a.ROWID || a.id;
      let results: any[];
      try {
        results = await db.queryAll(req, `SELECT ROWID, candidate_id, answers, score, screen_exits, report_downloaded_at, pipeline_stage, started_at, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} ORDER BY started_at DESC`, 'Results');
      } catch {
        // pipeline_stage column may not exist yet — query without it
        results = await db.queryAll(req, `SELECT ROWID, candidate_id, answers, score, screen_exits, report_downloaded_at, started_at, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} ORDER BY started_at DESC`, 'Results');
      }

      const candidates = [];
      for (const row of results) {
        const c = await db.queryOne(req, `SELECT ROWID, name, email, age, salary_expectation FROM Candidates WHERE ROWID = ${db.esc(row.candidate_id)}`, 'Candidates');
        const s = row.score ? JSON.parse(row.score) : null;
        const ans = row.answers ? JSON.parse(row.answers) : {};
        const ac = typeof ans === 'object' ? Object.keys(ans).length : 0;
        let status = 'opened';
        if (row.completed_at) status = 'completed';
        else if (ac > 0 || row.started_at) status = 'in_progress';

        const base: any = {
          result_id: row.ROWID || row.id,
          candidate: { id: row.candidate_id, name: c?.name, email: c?.email, age: c?.age, salary_expectation: c?.salary_expectation },
          status, screen_exits: (() => { const raw = row.screen_exits != null ? String(row.screen_exits) : '0'; if (raw.startsWith('{')) { try { return JSON.parse(raw).count || 0; } catch { return 0; } } return parseInt(raw) || 0; })(),
          screen_exit_log: (() => { const raw = row.screen_exits != null ? String(row.screen_exits) : '0'; if (raw.startsWith('{')) { try { return JSON.parse(raw).log || []; } catch { return []; } } return []; })(),
          report_downloaded_at: row.report_downloaded_at || null,
          pipeline_stage: row.pipeline_stage || null,
          started_at: row.started_at, completed_at: row.completed_at,
        };
        if (a.type === 'technical' && s) { const pct = s.total != null ? Math.round((s.total / s.max) * 100) : null; base.score_pct = pct; base.passed = pct != null ? pct >= ip.min_technical_score : null; }
        if (a.type === 'kudert' && s) { base.disc_letter = s.disc?.perfil_dominante || null; base.cognitive_score = s.cognitive ? { total: s.cognitive.total, max: s.cognitive.max } : null; base.emotional = s.emotional || null; }
        if (a.type === 'integrity' && s) { base.integrity_overall = s.overall || null; base.integrity_recomendacion = s.recomendacion || null; }
        candidates.push(base);
      }
      pipeline[a.type] = { assessment_id: aid, public_token: a.public_token, candidates };
    }
    sendJson(res, 200, pipeline);
  });

  // GET /api/admin/jobs/:id/integrity-results — full integrity scores
  GET('/api/admin/jobs/:id/integrity-results', async (req, res, params) => {
    const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.id)} AND type = 'integrity'`, 'Assessments');
    if (assessments.length === 0) return sendJson(res, 200, []);
    const aid = assessments[0].ROWID || assessments[0].id;
    const results = await db.queryAll(req, `SELECT ROWID, candidate_id, score, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
    const out = [];
    for (const r of results) {
      const c = await db.queryOne(req, `SELECT ROWID, name, email FROM Candidates WHERE ROWID = ${db.esc(r.candidate_id)}`, 'Candidates');
      const score = safeParseJson(r.score, null);
      out.push({
        result_id: r.ROWID || r.id,
        candidate: { id: r.candidate_id, name: c?.name, email: c?.email },
        completed_at: r.completed_at,
        integrity: score,
      });
    }
    sendJson(res, 200, out);
  });

  // POST /api/admin/recalculate-competencias — recalculate for all kudert results
  POST('/api/admin/recalculate-competencias', async (req, res) => {
    try {
      const { calculateCompetencias } = require('../data/competencias');
      const allAssessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE type = 'kudert'`, 'Assessments');
      let updated = 0;
      for (const a of allAssessments) {
        const aid = a.ROWID || a.id;
        const results = await db.queryAll(req, `SELECT ROWID, score FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        for (const r of results) {
          if (!r.score) continue;
          let s: any;
          try { s = JSON.parse(r.score); } catch { continue; }
          if (!s.disc && !s.cognitive) continue;
          const newCompetencias = calculateCompetencias(s.disc || null, s.cognitive || null, s.emotional || null);
          s.competencias = newCompetencias;
          await db.update(req, 'Results', r.ROWID || r.id, { score: JSON.stringify(s) });
          updated++;
        }
      }
      sendJson(res, 200, { message: `Recalculated competencias for ${updated} results` });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // POST /api/admin/jobs/:jobId/recalculate-integrity — recalculate integrity scores with new thresholds
  POST('/api/admin/jobs/:jobId/recalculate-integrity', async (req, res, params) => {
    try {
      const { calculateScore } = require('../services/scoring');
      const { getIntegrityQuestions } = require('../seeds/loadQuestions');
      const assessments = await db.queryAll(req, `SELECT ROWID FROM Assessments WHERE job_id = ${db.esc(params.jobId)} AND type = 'integrity'`, 'Assessments');
      if (assessments.length === 0) return sendError(res, 404, 'No integrity assessment found');
      const aid = assessments[0].ROWID || assessments[0].id;
      const results = await db.queryAllPaginated(req, `SELECT ROWID, answers, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      const intQuestions = getIntegrityQuestions();
      let updated = 0;
      for (const r of results) {
        if (!r.answers || r.answers === '{}' || r.answers === '[]') continue;
        try {
          const answers = JSON.parse(r.answers);
          if (Object.keys(answers).length === 0) continue;
          const score = calculateScore('integrity', intQuestions, answers);
          await db.update(req, 'Results', r.ROWID || r.id, { score: JSON.stringify(score) });
          updated++;
        } catch (e: any) { console.warn('[RECALC] Skip result:', r.ROWID, e.message); }
      }
      sendJson(res, 200, { message: `Recalculated integrity for ${updated} results in job ${params.jobId}` });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // POST /api/admin/jobs/:jobId/reset-integrity — reset all integrity results for a job
  POST('/api/admin/jobs/:jobId/reset-integrity', async (req, res, params) => {
    try {
      const assessments = await db.queryAll(req, `SELECT ROWID FROM Assessments WHERE job_id = ${db.esc(params.jobId)} AND type = 'integrity'`, 'Assessments');
      if (assessments.length === 0) return sendError(res, 404, 'No integrity assessment found');
      const aid = assessments[0].ROWID || assessments[0].id;
      const results = await db.queryAllPaginated(req, `SELECT ROWID FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      let reset = 0;
      for (const r of results) {
        await db.update(req, 'Results', r.ROWID || r.id, { score: '', completed_at: '', answers: '{}' });
        reset++;
      }
      sendJson(res, 200, { message: `Reset ${reset} integrity results for job ${params.jobId}` });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // PATCH /api/admin/results/:resultId/mark-reviewed
  PATCH('/api/admin/results/:resultId/mark-reviewed', async (req, res, params) => {
    await db.update(req, 'Results', params.resultId, { report_downloaded_at: db.now() });
    sendJson(res, 200, { success: true });
  });

  // PATCH /api/admin/results/:resultId/pipeline-stage
  PATCH('/api/admin/results/:resultId/pipeline-stage', async (req, res, params) => {
    const body = await parseBody(req);
    const { stage } = body; // null, 'next_stage', 'salary_out_of_range'
    await db.update(req, 'Results', params.resultId, { pipeline_stage: stage || '' });
    sendJson(res, 200, { success: true });
  });

  // GET /api/admin/results/candidate/:candidateId/profile
  GET('/api/admin/results/candidate/:candidateId/profile', async (req, res, params, query) => {
    const candidate = await db.queryOne(req, `SELECT * FROM Candidates WHERE ROWID = ${db.esc(params.candidateId)}`, 'Candidates');
    if (!candidate) return sendError(res, 404, 'Candidate not found');
    const cData = { id: candidate.ROWID || candidate.id, name: candidate.name, email: candidate.email, phone: candidate.phone, age: candidate.age, salary_expectation: candidate.salary_expectation, availability: candidate.availability, created_at: candidate.created_at };
    const jobId = query.jobId;

    if (!jobId) {
      // Find all jobs this candidate participated in
      const allResults = await db.queryAll(req, `SELECT ROWID, assessment_id, score, completed_at FROM Results WHERE candidate_id = ${db.esc(params.candidateId)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      const jobMap = new Map<string, any>();
      for (const r of allResults) {
        const a = await db.queryOne(req, `SELECT ROWID, job_id, type FROM Assessments WHERE ROWID = ${db.esc(r.assessment_id)}`, 'Assessments');
        if (!a) continue;
        const jid = a.job_id;
        if (!jobMap.has(jid)) {
          const j = await db.queryOne(req, `SELECT ROWID, title, company FROM Jobs WHERE ROWID = ${db.esc(jid)}`, 'Jobs');
          jobMap.set(jid, { jobId: jid, jobTitle: j?.title, jobCompany: j?.company, results: {} });
        }
        const entry = jobMap.get(jid)!;
        const s = r.score ? JSON.parse(r.score) : null;
        if (a.type === 'kudert' && s) { entry.results.disc = s.disc; entry.results.cognitive = s.cognitive; entry.results.emotional = s.emotional; }
        if (a.type === 'integrity') entry.results.integrity = s;
      }
      return sendJson(res, 200, { candidate: cData, jobs: Array.from(jobMap.values()) });
    }

    // Single job mode
    const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(jobId)}`, 'Jobs');
    if (!job) return sendError(res, 404, 'Job not found');
    const ip = safeParseJson(job.ideal_profile, { disc: {}, cognitive: {}, min_technical_score: 70 });
    const ic = job.ideal_competencias ? JSON.parse(job.ideal_competencias) : [];

    const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(jobId)}`, 'Assessments');
    const results: any = {};
    let te = 0;
    for (const a of assessments) {
      const r = await db.queryOne(req, `SELECT score, screen_exits FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(params.candidateId)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      if (!r) continue;
      const s = r.score ? JSON.parse(r.score) : null;
      te += parseInt(r.screen_exits) || 0;
      if (a.type === 'kudert' && s) { results.disc = s.disc; results.cognitive = s.cognitive; results.emotional = s.emotional; results.competencias = s.competencias; }
      if (a.type === 'technical' && s?.total != null) { const pct = Math.round((s.total / s.max) * 100); results.technical = { score: pct, passed: pct >= ip.min_technical_score, screen_exits: parseInt(r.screen_exits) || 0 }; }
      if (a.type === 'integrity') results.integrity = s;
    }
    results.monitoring = { total_screen_exits: te, by_test: [] };
    sendJson(res, 200, { candidate: cData, job: { id: job.ROWID || job.id, title: job.title, company: job.company }, ideal_competencias: ic, results });
  });

  // GET /api/admin/jobs/:jobId/report-data/:candidateId
  GET('/api/admin/jobs/:jobId/report-data/:candidateId', async (req, res, params) => {
    try {
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.jobId)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const candidate = await db.queryOne(req, `SELECT * FROM Candidates WHERE ROWID = ${db.esc(params.candidateId)}`, 'Candidates');
      if (!candidate) return sendError(res, 404, 'Candidate not found');
      const ip = safeParseJson(job.ideal_profile, { disc: {}, cognitive: {}, min_technical_score: 70 });

      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.jobId)}`, 'Assessments');
      let disc = null, cognitive = null, technical = null, integrity = null, emotional = null, competencias = null, te = 0;
      for (const a of assessments) {
        const r = await db.queryOne(req, `SELECT score, screen_exits FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(params.candidateId)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        if (!r) continue;
        const s = r.score ? JSON.parse(r.score) : null;
        te += parseInt(r.screen_exits) || 0;
        if (a.type === 'kudert' && s) { disc = s.disc ? { score: s.disc, perfil_dominante: s.disc.perfil_dominante, match_percentage: 50 } : null; cognitive = s.cognitive ? { score: s.cognitive, match_percentage: 50 } : null; emotional = s.emotional; competencias = s.competencias; }
        if (a.type === 'technical' && s?.total != null) { const pct = Math.round((s.total / s.max) * 100); technical = { score: pct, passed: pct >= ip.min_technical_score }; }
        if (a.type === 'integrity') integrity = s;
      }

      const { generateCandidateReport } = require('../services/reportGenerator');
      const { trackTokens } = require('../services/tokenTracker');
      const reportResult = await generateCandidateReport({ candidate: { name: candidate.name, email: candidate.email }, job: { title: job.title, company: job.company }, disc, cognitive, technical, integrity, ideal_profile: ip });
      await trackTokens(req, params.jobId, 'report_data', reportResult.usage.input_tokens, reportResult.usage.output_tokens);
      sendJson(res, 200, { candidate: { name: candidate.name, email: candidate.email, age: candidate.age }, job: { title: job.title, company: job.company }, disc, cognitive, emotional, technical, integrity, screen_exits: te, ideal_competencias: job.ideal_competencias ? JSON.parse(job.ideal_competencias) : [], competencias, reportText: reportResult.text });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // GET /api/admin/jobs/:jobId/report/:candidateId — PDF
  GET('/api/admin/jobs/:jobId/report/:candidateId', async (req, res, params) => {
    try {
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.jobId)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const candidate = await db.queryOne(req, `SELECT * FROM Candidates WHERE ROWID = ${db.esc(params.candidateId)}`, 'Candidates');
      if (!candidate) return sendError(res, 404, 'Candidate not found');
      const ip = safeParseJson(job.ideal_profile, { disc: {}, cognitive: {}, min_technical_score: 70 });

      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.jobId)}`, 'Assessments');
      let disc = null, cognitive = null, technical = null, integrity = null, emotional = null;
      for (const a of assessments) {
        const r = await db.queryOne(req, `SELECT score FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(params.candidateId)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        if (!r) continue;
        const s = r.score ? JSON.parse(r.score) : null;
        if (a.type === 'kudert' && s) { disc = s.disc ? { score: s.disc, perfil_dominante: s.disc.perfil_dominante, match_percentage: 50 } : null; cognitive = s.cognitive ? { score: s.cognitive, match_percentage: 50 } : null; emotional = s.emotional; }
        if (a.type === 'technical' && s?.total != null) { const pct = Math.round((s.total / s.max) * 100); technical = { score: pct, passed: pct >= ip.min_technical_score }; }
        if (a.type === 'integrity') integrity = s;
      }

      const { generateCandidateReport } = require('../services/reportGenerator');
      const { trackTokens } = require('../services/tokenTracker');
      const reportResult = await generateCandidateReport({ candidate: { name: candidate.name, email: candidate.email }, job: { title: job.title, company: job.company }, disc, cognitive, technical, integrity, ideal_profile: ip });
      await trackTokens(req, params.jobId, 'report_pdf', reportResult.usage.input_tokens, reportResult.usage.output_tokens);
      const { generatePDF } = require('../services/pdfGenerator');
      const pdfBuffer = await generatePDF({ reportText: reportResult.text, candidateName: candidate.name, jobTitle: job.title, company: job.company, disc, cognitive, technical, integrity, emotional });
      sendPdf(res, pdfBuffer, `informe-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Export all candidates for a job as CSV
  GET('/api/admin/jobs/:id/export-candidates', async (req, res, params) => {
    try {
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const ip = safeParseJson(job.ideal_profile, { disc: {}, cognitive: {}, min_technical_score: 60 });
      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(params.id)}`, 'Assessments');
      const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');

      // Gather all candidates who completed at least one assessment
      const candidateMap = new Map<string, any>();
      for (const a of assessments) {
        const aid = a.ROWID || a.id;
        const results = await db.queryAllPaginated(req, `SELECT candidate_id, score, screen_exits, completed_at FROM Results WHERE assessment_id = ${db.esc(aid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        for (const r of results) {
          const cid = r.candidate_id;
          if (!candidateMap.has(cid)) candidateMap.set(cid, { scores: {}, screen_exits: 0 });
          const entry = candidateMap.get(cid)!;
          let s: any = null;
          try { s = JSON.parse(r.score); } catch { continue; }
          if (a.type === 'kudert' && s) {
            entry.scores.disc = s.disc;
            entry.scores.cognitive = s.cognitive;
            entry.scores.emotional = s.emotional;
            entry.scores.competencias = s.competencias;
          }
          if (a.type === 'technical' && s?.total != null) {
            entry.scores.technical = { score: Math.round((s.total / s.max) * 100) };
          }
          if (a.type === 'integrity') entry.scores.integrity = s;
          if (r.screen_exits) {
            let exits = 0;
            try { const se = JSON.parse(r.screen_exits); exits = se.count || parseInt(r.screen_exits) || 0; } catch { exits = parseInt(r.screen_exits) || 0; }
            entry.screen_exits = Math.max(entry.screen_exits, exits);
          }
          if (r.pipeline_stage) entry.pipeline_stage = r.pipeline_stage;
        }
      }

      // Build CSV rows
      const header = ['Nombre','Email','Teléfono','Edad','Expectativa salarial','Disponibilidad','Afinidad %','DISC D','DISC I','DISC S','DISC C','Cognitivo Verbal','Cognitivo Espacial','Cognitivo Lógica','Cognitivo Numérica','Cognitivo Abstracta','Técnico %','Perfil emocional','Integridad alertas','Salidas pantalla','Fortalezas','Debilidades'];

      const rows: string[] = [header.join(',')];

      for (const [cid, entry] of candidateMap) {
        const c = await db.queryOne(req, `SELECT name, email, phone, age, salary_expectation, availability FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');
        if (!c) continue;
        const analysis = analyzeCandidateVsIdeal(entry.scores, ip);
        const disc = entry.scores.disc || {};
        const cog = entry.scores.cognitive || {};
        const emo = entry.scores.emotional;
        const tech = entry.scores.technical;
        const integ = entry.scores.integrity;

        // Normalize DISC
        const dims = ['D', 'I', 'S', 'C'];
        const sum = dims.reduce((s: number, d: string) => s + (disc[d] || 0), 0);
        const norm: Record<string, number> = {};
        for (const d of dims) norm[d] = sum <= 100 ? Math.min(100, (disc[d] || 0) * 5) : (disc[d] || 0);

        const emoLabel = emo?.perfil === 'espontaneo' ? 'Espontáneo' : emo?.perfil === 'mesura' ? 'Equilibrado' : emo?.perfil === 'reflexivo' ? 'Reflexivo' : '';
        const alertCount = integ?.dimensiones ? Object.values(integ.dimensiones).filter((d: any) => d.nivel !== 'bajo').length : 0;
        const alertText = alertCount === 0 ? 'Sin alertas' : `${alertCount} alertas`;
        const strengths = (analysis.strengths || []).join(' | ');
        const weaknesses = (analysis.weaknesses || []).join(' | ');

        const csvEsc = (v: any) => {
          const str = String(v ?? '');
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
        };

        rows.push([
          csvEsc(c.name), csvEsc(c.email), csvEsc(c.phone), csvEsc(c.age),
          csvEsc(c.salary_expectation), csvEsc(c.availability),
          analysis.overall_score ?? '', norm.D ?? '', norm.I ?? '', norm.S ?? '', norm.C ?? '',
          cog.verbal ?? '', cog.espacial ?? '', cog.logica ?? '', cog.numerica ?? '', cog.abstracta ?? '',
          tech?.score ?? '', csvEsc(emoLabel), csvEsc(alertText), entry.screen_exits || 0,
          csvEsc(strengths), csvEsc(weaknesses),
        ].join(','));
      }

      const csv = '\uFEFF' + rows.join('\n'); // BOM for Excel UTF-8
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${job.title.replace(/[^a-z0-9]/gi, '_')}_candidatos.csv"`,
      });
      res.end(csv);
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Copy candidate results (kudert + integrity) to another job
  POST('/api/admin/candidates/:candidateId/copy-to-job/:targetJobId', async (req, res, params) => {
    try {
      const { candidateId, targetJobId } = params;
      const candidate = await db.queryOne(req, `SELECT ROWID, name FROM Candidates WHERE ROWID = ${db.esc(candidateId)}`, 'Candidates');
      if (!candidate) return sendError(res, 404, 'Candidate not found');

      const targetJob = await db.queryOne(req, `SELECT ROWID, title FROM Jobs WHERE ROWID = ${db.esc(targetJobId)}`, 'Jobs');
      if (!targetJob) return sendError(res, 404, 'Target job not found');

      const targetAssessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(targetJobId)}`, 'Assessments');

      // Find ALL source results for this candidate (across all jobs)
      let sourceKudertResult: any = null;
      let sourceIntegrityResult: any = null;

      // Search in all assessments of all jobs for this candidate's completed results
      const allKudert = await db.queryAllPaginated(req, `SELECT ROWID, assessment_id, score, answers, screen_exits, started_at, completed_at FROM Results WHERE candidate_id = ${db.esc(candidateId)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');

      for (const r of allKudert) {
        const a = await db.queryOne(req, `SELECT type FROM Assessments WHERE ROWID = ${db.esc(r.assessment_id)}`, 'Assessments');
        if (!a) continue;
        if (a.type === 'kudert' && !sourceKudertResult) sourceKudertResult = r;
        if (a.type === 'integrity' && !sourceIntegrityResult) sourceIntegrityResult = r;
        if (sourceKudertResult && sourceIntegrityResult) break;
      }

      let copied = 0;

      // Copy kudert result
      const targetKudert = targetAssessments.find((a: any) => a.type === 'kudert');
      if (targetKudert && sourceKudertResult) {
        const targetAid = targetKudert.ROWID || targetKudert.id;
        const existing = await db.queryOne(req, `SELECT ROWID FROM Results WHERE assessment_id = ${db.esc(targetAid)} AND candidate_id = ${db.esc(candidateId)}`, 'Results');
        if (!existing) {
          await db.insert(req, 'Results', {
            assessment_id: String(targetAid),
            candidate_id: String(candidateId),
            answers: sourceKudertResult.answers || '{}',
            score: sourceKudertResult.score || '',
            screen_exits: sourceKudertResult.screen_exits || '0',
            ai_analysis: '',
            report_downloaded_at: '',
            started_at: sourceKudertResult.started_at || db.now(),
            completed_at: sourceKudertResult.completed_at || db.now(),
          });
          copied++;
          console.log(`[COPY] Kudert result copied for ${candidate.name} to job ${targetJob.title}`);
        } else {
          console.log(`[COPY] Kudert result already exists for ${candidate.name} in job ${targetJob.title}`);
        }
      }

      // Copy integrity result
      const targetIntegrity = targetAssessments.find((a: any) => a.type === 'integrity');
      if (targetIntegrity && sourceIntegrityResult) {
        const targetAid = targetIntegrity.ROWID || targetIntegrity.id;
        const existing = await db.queryOne(req, `SELECT ROWID FROM Results WHERE assessment_id = ${db.esc(targetAid)} AND candidate_id = ${db.esc(candidateId)}`, 'Results');
        if (!existing) {
          await db.insert(req, 'Results', {
            assessment_id: String(targetAid),
            candidate_id: String(candidateId),
            answers: sourceIntegrityResult.answers || '{}',
            score: sourceIntegrityResult.score || '',
            screen_exits: sourceIntegrityResult.screen_exits || '0',
            ai_analysis: '',
            report_downloaded_at: '',
            started_at: sourceIntegrityResult.started_at || db.now(),
            completed_at: sourceIntegrityResult.completed_at || db.now(),
          });
          copied++;
          console.log(`[COPY] Integrity result copied for ${candidate.name} to job ${targetJob.title}`);
        } else {
          console.log(`[COPY] Integrity result already exists for ${candidate.name} in job ${targetJob.title}`);
        }
      }

      sendJson(res, 200, {
        success: true,
        copied,
        candidate: candidate.name,
        target_job: targetJob.title,
        kudert: sourceKudertResult ? 'copied' : 'not found',
        integrity: sourceIntegrityResult ? 'copied' : 'not found',
      });
    } catch (err: any) { sendError(res, 500, err.message); }
  });
}
