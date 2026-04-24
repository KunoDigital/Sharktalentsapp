import { GET, POST, PATCH } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import * as db from '../db';
import { loadTechnicalQuestions } from '../services/questionsStore';

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function sendEnrichedReport(req: any, res: any, report: any, rid: string, jobId: string): Promise<void> {
  const candidates = await db.queryAll(req, `SELECT * FROM ReportCandidates WHERE report_id = ${db.esc(rid)} ORDER BY sort_order`, 'ReportCandidates');
  const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(jobId)}`, 'Jobs');
  const ip = job?.ideal_profile ? JSON.parse(job.ideal_profile) : {};
  const assessments = await db.queryAll(req, `SELECT ROWID, type, questions FROM Assessments WHERE job_id = ${db.esc(jobId)}`, 'Assessments');

  const enriched: any[] = [];
  for (const rc of candidates) {
    const cid = rc.candidate_id;
    const c = await db.queryOne(req, `SELECT ROWID, name, email, phone, salary_expectation, interview_file_id FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');
    const scores: any = {};
    const candidateAnswers: any = {};
    for (const a of assessments) {
      const r = await db.queryOne(req, `SELECT score, answers FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(cid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
      if (!r) continue;
      const s = r.score ? JSON.parse(r.score) : null;
      if (a.type === 'kudert' && s) { scores.disc = s.disc; scores.cognitive = s.cognitive; scores.emotional = s.emotional; scores.competencias = s.competencias; }
      if (a.type === 'technical' && s?.total != null) {
        const pct = Math.round((s.total / s.max) * 100);
        scores.technical = { score: pct, passed: pct >= (ip.min_technical_score || 60) };
        try {
          const answers = r.answers ? JSON.parse(r.answers) : {};
          const questions = await loadTechnicalQuestions(req, a.ROWID || a.id, a.questions);
          if (questions.length > 0) { candidateAnswers.technical = questions.map((q: any) => ({ text: q.text, options: q.options, selected: answers[q.id] ?? null, correct: q.correct })); }
        } catch {}
      }
      if (a.type === 'integrity') {
        scores.integrity = s;
        try {
          const answers = r.answers ? JSON.parse(r.answers) : {};
          const { getIntegrityQuestions } = require('../seeds/loadQuestions');
          const intQ = getIntegrityQuestions();
          if (intQ.length > 0) { candidateAnswers.integrity = intQ.map((q: any) => ({ text: q.text, dimension: q.dimension, options: q.options, selected: answers[q.id] ?? null, risk_weights: q.risk_weights })); }
        } catch {}
      }
    }

    const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');
    const analysis = analyzeCandidateVsIdeal(scores, ip);

    enriched.push({
      rc_id: rc.ROWID || rc.id,
      candidate: { id: cid, name: c?.name, email: c?.email, phone: c?.phone, salary_expectation: c?.salary_expectation },
      scores,
      analysis,
      answers: candidateAnswers,
      references: JSON.parse(rc.references_json || '[]'),
      curriculum_file_id: rc.curriculum_file_id || null,
      explanations: await (async () => {
        const { loadReportJson } = require('../services/reportFileStore');
        let expls: any = null;

        // 1. Try report-level File Store
        if (rc.report_file_id) {
          expls = await loadReportJson(req, rc.report_file_id);
        }
        // 2. Fallback: legacy columns
        if (!expls) {
          let transcriptData: any = null;
          try { const td = JSON.parse(rc.explanation_competencias || '{}'); if (td.analysis) transcriptData = td.analysis; } catch {}
          try {
            const full = JSON.parse(rc.explanation_summary || '{}');
            if (full.summary) {
              if (transcriptData && !full.transcript_analysis) full.transcript_analysis = transcriptData;
              expls = full;
            }
          } catch {}
          if (!expls) {
            let iq: any[] = [];
            try { iq = JSON.parse(rc.explanation_integrity || '[]'); } catch {}
            expls = {
              summary: rc.explanation_summary || '',
              disc: rc.explanation_disc || '',
              velna: rc.explanation_velna || '',
              emotion: rc.explanation_emotion || '',
              technical: rc.explanation_technical || '',
              interview_questions: Array.isArray(iq) ? iq : [],
              transcript_analysis: transcriptData,
            };
          }
        }

        // 3. Merge interview from Candidate (lives with the person, not the report)
        if (c?.interview_file_id && !expls.transcript_analysis) {
          const interviewData = await loadReportJson(req, c.interview_file_id);
          if (interviewData?.analysis) expls.transcript_analysis = interviewData.analysis;
        }

        return expls;
      })(),
      sort_order: parseInt(rc.sort_order) || 0,
    });
  }

  sendJson(res, 200, {
    report_id: rid,
    job_id: jobId,
    company_slug: report.company_slug,
    job_slug: report.job_slug,
    status: report.status,
    published_at: report.published_at || null,
    created_at: report.created_at,
    job: { title: job?.title, company: job?.company },
    ideal_profile: ip,
    ideal_competencias: job?.ideal_competencias ? JSON.parse(job.ideal_competencias) : [],
    candidates: enriched,
  });
}

export function registerAdminReportRoutes(): void {

  // Create a NEW draft report for a job (always creates new — multiple reports per job allowed)
  POST('/api/admin/jobs/:jobId/client-report', async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const { candidate_ids } = body;
      if (!candidate_ids || !Array.isArray(candidate_ids) || candidate_ids.length === 0) {
        return sendError(res, 400, 'candidate_ids required');
      }
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(params.jobId)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');

      const companySlug = slugify(job.company);
      const jobSlug = slugify(job.title);
      const ts = db.now();

      const report = await db.insert(req, 'ClientReports', {
        job_id: String(params.jobId),
        company_slug: companySlug,
        job_slug: jobSlug,
        status: 'draft',
        published_at: '',
        created_at: ts,
      });
      const reportId = report.ROWID;

      // Create report candidate entries
      for (let i = 0; i < candidate_ids.length; i++) {
        await db.insert(req, 'ReportCandidates', {
          report_id: String(reportId),
          candidate_id: String(candidate_ids[i]),
          references_json: '[]',
          curriculum_file_id: '',
          explanation_disc: '',
          explanation_velna: '',
          explanation_emotion: '',
          explanation_technical: '',
          explanation_integrity: '',
          explanation_competencias: '',
          explanation_summary: '',
          sort_order: String(i),
        });
      }

      sendJson(res, 201, { report_id: reportId, company_slug: companySlug, job_slug: jobSlug });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // List all reports for a job (with candidate names)
  GET('/api/admin/jobs/:jobId/client-reports', async (req, res, params) => {
    try {
      const reports = await db.queryAll(req, `SELECT * FROM ClientReports WHERE job_id = ${db.esc(params.jobId)} ORDER BY created_at`, 'ClientReports');
      const out: any[] = [];
      for (let i = 0; i < reports.length; i++) {
        const r = reports[i];
        const rid = r.ROWID || r.id;
        const rcs = await db.queryAll(req, `SELECT candidate_id FROM ReportCandidates WHERE report_id = ${db.esc(rid)} ORDER BY sort_order`, 'ReportCandidates');
        const names: string[] = [];
        for (const rc of rcs) {
          const c = await db.queryOne(req, `SELECT name FROM Candidates WHERE ROWID = ${db.esc(rc.candidate_id)}`, 'Candidates');
          if (c?.name) names.push(c.name);
        }
        out.push({
          report_id: rid,
          name: `Reporte ${i + 1}`,
          status: r.status,
          created_at: r.created_at,
          published_at: r.published_at || null,
          company_slug: r.company_slug,
          job_slug: r.job_slug,
          candidate_count: rcs.length,
          candidate_names: names,
        });
      }
      sendJson(res, 200, out);
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Get a specific report by reportId
  GET('/api/admin/client-report/:reportId', async (req, res, params) => {
    try {
      const report = await db.queryOne(req, `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)}`, 'ClientReports');
      if (!report) return sendJson(res, 200, null);
      const rid = report.ROWID || report.id;
      return await sendEnrichedReport(req, res, report, rid, report.job_id);
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Get LATEST report for a job (backward compat)
  GET('/api/admin/jobs/:jobId/client-report', async (req, res, params) => {
    try {
      const reports = await db.queryAll(req, `SELECT * FROM ClientReports WHERE job_id = ${db.esc(params.jobId)} ORDER BY created_at DESC`, 'ClientReports');
      const report = reports[0];
      if (!report) return sendJson(res, 200, null);
      const rid = report.ROWID || report.id;
      return await sendEnrichedReport(req, res, report, rid, params.jobId);
    } catch (err: any) { sendError(res, 500, err.message); }
  });


  // Generate AI explanations for all candidates in the report
  POST('/api/admin/client-report/:reportId/generate-explanations', async (req, res, params) => {
    try {
      const report = await db.queryOne(req, `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)}`, 'ClientReports');
      if (!report) return sendError(res, 404, 'Report not found');

      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(report.job_id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const ip = job.ideal_profile ? JSON.parse(job.ideal_profile) : {};

      const rcList = await db.queryAll(req, `SELECT * FROM ReportCandidates WHERE report_id = ${db.esc(params.reportId)} ORDER BY sort_order`, 'ReportCandidates');
      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(report.job_id)}`, 'Assessments');

      const { generateClientExplanations, generateProfileDescription, generateInterviewQuestions } = require('../services/clientReportGenerator');
      const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');
      const { trackTokens } = require('../services/tokenTracker');
      const ic = job.ideal_competencias ? JSON.parse(job.ideal_competencias) : [];

      // Generate profile description and store in job
      try {
        const idealDiscA = ip.disc ? `D:${ip.disc.D} I:${ip.disc.I} S:${ip.disc.S} C:${ip.disc.C}` : 'No definido';
        const idealDiscB = ip.disc_b ? `D:${ip.disc_b.D} I:${ip.disc_b.I} S:${ip.disc_b.S} C:${ip.disc_b.C}` : undefined;
        const profileResult = await generateProfileDescription({
          jobTitle: job.title, company: job.company,
          discIdealA: idealDiscA, discIdealB: idealDiscB,
          competencias: ic.map((c: any) => ({ nombre: c.id, nivel: c.nivel_esperado })),
          cognitiveIdeal: ip.cognitive || {},
          minTechnical: ip.min_technical_score || 60,
        });
        await trackTokens(req, report.job_id, 'profile_description', profileResult.usage.input_tokens, profileResult.usage.output_tokens);
        ip.report_profile_desc = profileResult.text;
      } catch (e: any) { console.warn('[REPORT] Profile desc generation failed:', e.message); }

      const promises = rcList.map(async (rc: any) => {
        const cid = rc.candidate_id;
        const c = await db.queryOne(req, `SELECT name FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');
        const scores: any = {};
        for (const a of assessments) {
          const r = await db.queryOne(req, `SELECT score FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(cid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
          if (!r) continue;
          const s = r.score ? JSON.parse(r.score) : null;
          if (a.type === 'kudert' && s) { scores.disc = s.disc; scores.cognitive = s.cognitive; scores.emotional = s.emotional; scores.competencias = s.competencias; }
          if (a.type === 'technical' && s?.total != null) { const pct = Math.round((s.total / s.max) * 100); scores.technical = { score: pct, passed: pct >= (ip.min_technical_score || 60) }; }
          if (a.type === 'integrity') scores.integrity = s;
        }

        // Pre-calculate analysis
        const analysis = analyzeCandidateVsIdeal(scores, ip);

        // Get PK profile name
        let discProfile = 'No evaluado';
        if (scores.disc) {
          const dims = ['D', 'I', 'S', 'C'];
          const sum = dims.reduce((s: number, d: string) => s + (scores.disc[d] || 0), 0);
          const norm: Record<string, number> = {};
          for (const d of dims) norm[d] = sum <= 100 ? Math.min(100, (scores.disc[d] || 0) * 5) : (scores.disc[d] || 0);
          // Simple PK identification inline (avoid cross-project import)
          const pkProfiles = [
            { id: 'PK-01', name: 'Flexible - Independiente - Cooperativo/a', D: 80, I: 20, S: 80, C: 20 },
            { id: 'PK-02', name: 'Empatico/a - Brinda apoyo - Escucha', D: 20, I: 80, S: 80, C: 20 },
            { id: 'PK-03', name: 'Sociable - Persuasivo/a - Analitico/a', D: 20, I: 80, S: 20, C: 80 },
            { id: 'PK-04', name: 'Perfeccionista - Planificado/a - Resultados', D: 80, I: 20, S: 20, C: 80 },
            { id: 'PK-05', name: 'Decidido/a - Tenaz - Competitivo/a', D: 100, I: 35, S: 30, C: 35 },
            { id: 'PK-06', name: 'Determinado/a - Directo/a - Persuasivo/a', D: 80, I: 80, S: 20, C: 20 },
            { id: 'PK-07', name: 'Cauteloso/a - Planificado/a - Estructurado/a', D: 50, I: 10, S: 90, C: 50 },
            { id: 'PK-08', name: 'Preciso/a - Analitico/a - Calidad', D: 35, I: 30, S: 35, C: 100 },
            { id: 'PK-09', name: 'Preciso/a - Cauteloso/a - Paciente', D: 20, I: 20, S: 80, C: 80 },
            { id: 'PK-10', name: 'Extrovertido/a - Entusiasta - Flexible', D: 50, I: 90, S: 10, C: 50 },
            { id: 'PK-14', name: 'Persuasivo/a - Accion - Disfruta retos', D: 90, I: 50, S: 10, C: 50 },
            { id: 'PK-15', name: 'Comunicativo/a - Amigable - Multitarea', D: 10, I: 90, S: 50, C: 50 },
            { id: 'PK-16', name: 'Independiente - Arriesgado/a - Resultados', D: 90, I: 50, S: 50, C: 10 },
            { id: 'PK-25', name: 'Paciente - Estabilidad - Calmado/a', D: 35, I: 30, S: 100, C: 35 },
            { id: 'PK-27', name: 'Amigable - Comunicativo/a - Extrovertido/a', D: 30, I: 100, S: 35, C: 35 },
          ];
          let bestDist = Infinity;
          for (const pk of pkProfiles) {
            const dist = Math.abs(norm.D - pk.D) + Math.abs(norm.I - pk.I) + Math.abs(norm.S - pk.S) + Math.abs(norm.C - pk.C);
            if (dist < bestDist) { bestDist = dist; discProfile = `${pk.id} - ${pk.name}`; }
          }
        }

        const emotionalProfile = scores.emotional?.perfil === 'espontaneo' ? 'Espontaneo' : scores.emotional?.perfil === 'mesura' ? 'Equilibrado' : scores.emotional?.perfil === 'reflexivo' ? 'Reflexivo' : 'No evaluado';

        const result = await generateClientExplanations({
          name: c?.name || 'Candidato',
          jobTitle: job.title,
          company: job.company,
          analysis,
          discProfile,
          emotionalProfile,
        });

        await trackTokens(req, report.job_id, `report_explanation_${c?.name}`, result.usage.input_tokens, result.usage.output_tokens);

        // Generate interview questions
        const integrityAlerts: string[] = [];
        if (scores.integrity?.dimensiones) {
          for (const [dim, d] of Object.entries(scores.integrity.dimensiones) as any) {
            if (d.nivel === 'medio' || d.nivel === 'alto') integrityAlerts.push(dim.replace(/_/g, ' '));
          }
        }
        let interviewQs: any[] = [];
        try {
          const iqResult = await generateInterviewQuestions({
            name: c?.name || 'Candidato',
            jobTitle: job.title,
            company: job.company,
            weaknesses: analysis.weaknesses || [],
            integrityAlerts,
            emotionalProfile,
            discProfile,
            companyContext: ip.company_context || '',
          });
          interviewQs = iqResult.questions || [];
          await trackTokens(req, report.job_id, `interview_questions_${c?.name}`, iqResult.usage.input_tokens, iqResult.usage.output_tokens);
        } catch (e: any) { console.warn('[REPORT] Interview questions failed:', e.message); }

        const rcId = rc.ROWID || rc.id;
        const allData = { ...result.explanations, interview_questions: interviewQs };

        // Save full report to File Store (no size limits)
        const { saveReportJson } = require('../services/reportFileStore');
        const fileId = await saveReportJson(req, params.reportId, String(rc.candidate_id), allData);
        await db.update(req, 'ReportCandidates', rcId, {
          report_file_id: fileId,
          explanation_summary: (allData.summary || '').substring(0, 9000),
          explanation_disc: '',
          explanation_velna: '',
          explanation_emotion: '',
          explanation_technical: '',
          explanation_integrity: '',
          explanation_competencias: '',
        });

        return { candidate: c?.name, analysis, explanations: allData };
      });

      const results = await Promise.all(promises);
      sendJson(res, 200, { generated: results.length, results });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Update a report candidate (references, explanations)
  PATCH('/api/admin/client-report/:reportId/candidates/:rcId', async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const updates: Record<string, string> = {};
      if (body.references !== undefined) updates.references_json = JSON.stringify(body.references);
      if (body.explanation_summary !== undefined) updates.explanation_summary = body.explanation_summary;
      if (body.explanation_disc !== undefined) updates.explanation_disc = body.explanation_disc;
      if (body.explanation_velna !== undefined) updates.explanation_velna = body.explanation_velna;
      if (body.explanation_emotion !== undefined) updates.explanation_emotion = body.explanation_emotion;
      if (body.explanation_technical !== undefined) updates.explanation_technical = body.explanation_technical;
      if (body.explanation_integrity !== undefined) updates.explanation_integrity = body.explanation_integrity;
      if (body.explanation_competencias !== undefined) updates.explanation_competencias = body.explanation_competencias;
      if (Object.keys(updates).length === 0) return sendError(res, 400, 'Nothing to update');
      await db.update(req, 'ReportCandidates', params.rcId, updates);
      sendJson(res, 200, { success: true });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Analyze interview transcript for a candidate
  POST('/api/admin/client-report/:reportId/candidates/:rcId/analyze-transcript', async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const { transcript } = body;
      if (!transcript) return sendError(res, 400, 'transcript required');

      const report = await db.queryOne(req, `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)}`, 'ClientReports');
      if (!report) return sendError(res, 404, 'Report not found');
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(report.job_id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const ip = job.ideal_profile ? JSON.parse(job.ideal_profile) : {};

      const rc = await db.queryOne(req, `SELECT * FROM ReportCandidates WHERE ROWID = ${db.esc(params.rcId)}`, 'ReportCandidates');
      if (!rc) return sendError(res, 404, 'Candidate not found');
      const candidate = await db.queryOne(req, `SELECT name FROM Candidates WHERE ROWID = ${db.esc(rc.candidate_id)}`, 'Candidates');

      // Get interview questions and analysis from stored data
      let interviewQs: any[] = [];
      let weaknesses: string[] = [];
      let integrityAlerts: string[] = [];
      try {
        const full = JSON.parse(rc.explanation_summary || '{}');
        interviewQs = full.interview_questions || [];
      } catch {}
      try {
        const iq = JSON.parse(rc.explanation_integrity || '[]');
        if (Array.isArray(iq)) interviewQs = iq.length > interviewQs.length ? iq : interviewQs;
      } catch {}

      // Get candidate scores for weaknesses/alerts
      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(report.job_id)}`, 'Assessments');
      const scores: any = {};
      for (const a of assessments) {
        const r = await db.queryOne(req, `SELECT score FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(rc.candidate_id)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
        if (!r) continue;
        const s = r.score ? JSON.parse(r.score) : null;
        if (a.type === 'integrity' && s?.dimensiones) {
          for (const [dim, d] of Object.entries(s.dimensiones) as any) {
            if (d.nivel === 'medio' || d.nivel === 'alto') integrityAlerts.push(dim.replace(/_/g, ' '));
          }
        }
      }
      const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');
      const analysis = analyzeCandidateVsIdeal(scores, ip);
      weaknesses = analysis.weaknesses || [];

      const { analyzeInterviewTranscript } = require('../services/clientReportGenerator');
      const { trackTokens } = require('../services/tokenTracker');

      const result = await analyzeInterviewTranscript({
        name: candidate?.name || 'Candidato',
        jobTitle: job.title,
        company: job.company,
        transcript,
        weaknesses,
        integrityAlerts,
        interviewQuestions: interviewQs,
        companyContext: ip.company_context || '',
      });

      await trackTokens(req, report.job_id, `transcript_analysis_${candidate?.name}`, result.usage.input_tokens, result.usage.output_tokens);

      // Save interview data to CANDIDATE (not report) via File Store
      const { saveReportJson } = require('../services/reportFileStore');
      const interviewData = {
        transcript_raw: transcript,
        analysis: result.analysis,
        analyzed_at: new Date().toISOString(),
        job_context: { title: job.title, company: job.company },
      };
      const fileId = await saveReportJson(req, 'interview', String(rc.candidate_id), interviewData);
      await db.update(req, 'Candidates', rc.candidate_id, { interview_file_id: fileId });

      sendJson(res, 200, { analysis: result.analysis });
    } catch (err: any) { sendError(res, 500, err.message); }
  });

  // Generate candidate comparison for report
  POST('/api/admin/client-report/:reportId/generate-comparison', async (req, res, params) => {
    try {
      const report = await db.queryOne(req, `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)}`, 'ClientReports');
      if (!report) return sendError(res, 404, 'Report not found');
      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(report.job_id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      let ip: any = {};
      try { ip = JSON.parse(job.ideal_profile || '{}'); } catch {}
      const ic = (() => { try { return JSON.parse(job.ideal_competencias || '[]'); } catch { return []; } })();

      const rcList = await db.queryAll(req, `SELECT * FROM ReportCandidates WHERE report_id = ${db.esc(params.reportId)} ORDER BY sort_order`, 'ReportCandidates');
      const assessments = await db.queryAll(req, `SELECT ROWID, type FROM Assessments WHERE job_id = ${db.esc(report.job_id)}`, 'Assessments');
      const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');
      const { loadReportJson, saveReportJson } = require('../services/reportFileStore');

      const compCandidates: any[] = [];
      let hasAnyInterview = false;

      for (const rc of rcList) {
        const cid = rc.candidate_id;
        const c = await db.queryOne(req, `SELECT ROWID, name, interview_file_id FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');
        const scores: any = {};
        for (const a of assessments) {
          const r = await db.queryOne(req, `SELECT score FROM Results WHERE assessment_id = ${db.esc(a.ROWID || a.id)} AND candidate_id = ${db.esc(cid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
          if (!r) continue;
          let s: any = null;
          try { s = JSON.parse(r.score); } catch { continue; }
          if (a.type === 'kudert' && s) { scores.disc = s.disc; scores.cognitive = s.cognitive; scores.emotional = s.emotional; }
          if (a.type === 'technical' && s?.total != null) { scores.technical = { score: Math.round((s.total / s.max) * 100) }; }
          if (a.type === 'integrity') scores.integrity = s;
        }

        const analysis = analyzeCandidateVsIdeal(scores, ip);

        // Load interview from candidate
        let interviewAnalysis: any = null;
        if (c?.interview_file_id) {
          const iData = await loadReportJson(req, c.interview_file_id);
          if (iData?.analysis) { interviewAnalysis = iData.analysis; hasAnyInterview = true; }
        }

        // Build DISC profile name
        let discProfile = 'No evaluado';
        if (scores.disc) {
          const dims = ['D', 'I', 'S', 'C'];
          const sum = dims.reduce((s: number, d: string) => s + (scores.disc[d] || 0), 0);
          const norm: Record<string, number> = {};
          for (const d of dims) norm[d] = sum <= 100 ? Math.min(100, (scores.disc[d] || 0) * 5) : (scores.disc[d] || 0);
          discProfile = `D:${norm.D} I:${norm.I} S:${norm.S} C:${norm.C}`;
        }
        const emotionalProfile = scores.emotional?.perfil === 'espontaneo' ? 'Espontaneo' : scores.emotional?.perfil === 'mesura' ? 'Equilibrado' : scores.emotional?.perfil === 'reflexivo' ? 'Reflexivo' : 'No evaluado';

        const integrityAlerts: string[] = [];
        if (scores.integrity?.dimensiones) {
          for (const [dim, d] of Object.entries(scores.integrity.dimensiones) as any) {
            if (d.nivel === 'medio' || d.nivel === 'alto') integrityAlerts.push(dim.replace(/_/g, ' '));
          }
        }

        compCandidates.push({
          name: c?.name || 'Candidato',
          discProfile,
          emotionalProfile,
          strengths: analysis.strengths || [],
          weaknesses: analysis.weaknesses || [],
          technicalScore: scores.technical?.score ?? null,
          integrityAlerts,
          interviewAnalysis,
        });
      }

      const { generateCandidateComparison } = require('../services/clientReportGenerator');
      const { trackTokens } = require('../services/tokenTracker');

      const result = await generateCandidateComparison({
        jobTitle: job.title,
        company: job.company,
        candidates: compCandidates,
        companyContext: ip.company_context || '',
      });

      await trackTokens(req, report.job_id, 'generate_comparison', result.usage.input_tokens, result.usage.output_tokens);

      // Save comparison to File Store
      const compData = {
        ...result.comparison,
        generated_at: new Date().toISOString(),
        has_interviews: hasAnyInterview,
      };
      const fileId = await saveReportJson(req, 'comparison', params.reportId, compData);
      await db.update(req, 'ClientReports', params.reportId, { comparison_file_id: fileId });

      sendJson(res, 200, { comparison: compData });
    } catch (err: any) {
      console.error('[COMPARISON] Generate failed:', err.message);
      sendError(res, 500, err.message);
    }
  });

  // Publish report — also generates English translations
  PATCH('/api/admin/client-report/:reportId/publish', async (req, res, params) => {
    try {
      const { translateToEnglish } = require('../services/clientReportGenerator');
      const { saveReportJson, loadReportJson } = require('../services/reportFileStore');
      const { trackTokens } = require('../services/tokenTracker');

      const rcList = await db.queryAll(req, `SELECT * FROM ReportCandidates WHERE report_id = ${db.esc(params.reportId)} ORDER BY sort_order`, 'ReportCandidates');
      const report = await db.queryOne(req, `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)}`, 'ClientReports');

      // Build one EN bundle: { candidates: { candidateId: {translated explanations} }, comparison: {translated} }
      const enBundle: any = { candidates: {} };

      for (const rc of rcList) {
        let expls: any = null;
        if (rc.report_file_id) expls = await loadReportJson(req, rc.report_file_id);
        if (!expls) {
          try { expls = JSON.parse(rc.explanation_summary || '{}'); } catch { expls = {}; }
        }
        if (expls && Object.keys(expls).length > 0) {
          try {
            const tr = await translateToEnglish(expls);
            enBundle.candidates[rc.candidate_id] = tr.translated;
            await trackTokens(req, report?.job_id || '', `translate_en_${rc.candidate_id}`, tr.usage.input_tokens, tr.usage.output_tokens);
          } catch (e: any) { console.warn('[TRANSLATE] Candidate translation failed:', e.message); }
        }
      }

      // Translate comparison if exists
      if (report?.comparison_file_id) {
        try {
          const comp = await loadReportJson(req, report.comparison_file_id);
          if (comp) {
            const tr = await translateToEnglish(comp);
            enBundle.comparison = tr.translated;
            await trackTokens(req, report.job_id, 'translate_en_comparison', tr.usage.input_tokens, tr.usage.output_tokens);
          }
        } catch (e: any) { console.warn('[TRANSLATE] Comparison translation failed:', e.message); }
      }

      // Save entire EN bundle as one file
      let enFileId = '';
      if (Object.keys(enBundle.candidates).length > 0 || enBundle.comparison) {
        enFileId = await saveReportJson(req, 'en_bundle', params.reportId, enBundle);
      }

      await db.update(req, 'ClientReports', params.reportId, {
        status: 'published',
        published_at: db.now(),
        en_comparison_file_id: enFileId || '',
      });
      sendJson(res, 200, { success: true });
    } catch (err: any) { sendError(res, 500, err.message); }
  });
}
