import { GET } from '../router';
import { sendJson, sendError } from '../helpers';
import * as db from '../db';
import { loadTechnicalQuestions } from '../services/questionsStore';
import { loadReportJson } from '../services/reportFileStore';

export function registerPublicReportRoutes(): void {

  // Public report by company/job slug + optional reportId (latest if omitted)
  const handler = async (req: any, res: any, params: any, query: any) => {
    const lang = (query?.lang || 'es').toLowerCase();
    let enBundle: any = null;
    try {
      let report;
      if (params.reportId) {
        report = await db.queryOne(req,
          `SELECT * FROM ClientReports WHERE ROWID = ${db.esc(params.reportId)} AND company_slug = ${db.esc(params.companySlug)} AND job_slug = ${db.esc(params.jobSlug)} AND status = 'published'`,
          'ClientReports');
      } else {
        const reports = await db.queryAll(req,
          `SELECT * FROM ClientReports WHERE company_slug = ${db.esc(params.companySlug)} AND job_slug = ${db.esc(params.jobSlug)} AND status = 'published' ORDER BY created_at DESC`,
          'ClientReports');
        report = reports[0];
      }
      if (!report) return sendError(res, 404, 'Report not found');

      const rid = report.ROWID || report.id;

      // Load EN bundle if requesting English
      console.log(`[REPORT] lang=${lang}, en_file_id=${report.en_comparison_file_id || 'EMPTY'}, keys=${Object.keys(report).join(',')}`);
      if (lang === 'en' && report.en_comparison_file_id) {
        try {
          enBundle = await loadReportJson(req, report.en_comparison_file_id);
          console.log(`[REPORT] EN bundle loaded: ${enBundle ? 'YES, keys=' + Object.keys(enBundle).join(',') : 'NULL'}`);
        } catch (e: any) { console.warn('[REPORT] EN bundle load failed:', e.message); }
      }

      const job = await db.queryOne(req, `SELECT * FROM Jobs WHERE ROWID = ${db.esc(report.job_id)}`, 'Jobs');
      if (!job) return sendError(res, 404, 'Job not found');
      const ip = job.ideal_profile ? JSON.parse(job.ideal_profile) : {};

      const assessments = await db.queryAll(req, `SELECT ROWID, type, questions FROM Assessments WHERE job_id = ${db.esc(report.job_id)}`, 'Assessments');
      const rcList = await db.queryAll(req, `SELECT * FROM ReportCandidates WHERE report_id = ${db.esc(rid)} ORDER BY sort_order`, 'ReportCandidates');

      const candidates = [];
      for (const rc of rcList) {
        const cid = rc.candidate_id;
        const c = await db.queryOne(req, `SELECT ROWID, name, email, phone, age, salary_expectation, availability, interview_file_id FROM Candidates WHERE ROWID = ${db.esc(cid)}`, 'Candidates');

        const scores: any = {};
        const candidateAnswers: any = {};
        for (const a of assessments) {
          const aid = a.ROWID || a.id;
          const r = await db.queryOne(req, `SELECT score, answers FROM Results WHERE assessment_id = ${db.esc(aid)} AND candidate_id = ${db.esc(cid)} AND completed_at IS NOT NULL AND completed_at != ''`, 'Results');
          if (!r) continue;
          const s = r.score ? JSON.parse(r.score) : null;
          if (a.type === 'kudert' && s) { scores.disc = s.disc; scores.cognitive = s.cognitive; scores.emotional = s.emotional; scores.competencias = s.competencias; }
          if (a.type === 'technical' && s?.total != null) {
            const pct = Math.round((s.total / s.max) * 100);
            scores.technical = { score: pct, passed: pct >= (ip.min_technical_score || 60) };
            try {
              const answers = r.answers ? JSON.parse(r.answers) : {};
              const questions = await loadTechnicalQuestions(req, a.ROWID || a.id, a.questions);
              if (questions.length > 0) {
                candidateAnswers.technical = questions.map((q: any) => ({
                  text: q.text,
                  options: q.options,
                  selected: answers[q.id] ?? null,
                  correct: q.correct,
                }));
              }
            } catch {}
          }
          if (a.type === 'integrity') {
            scores.integrity = s;
            // Include questions and answers for integrity
            try {
              const answers = r.answers ? JSON.parse(r.answers) : {};
              const { getIntegrityQuestions } = require('../seeds/loadQuestions');
              const intQuestions = getIntegrityQuestions();
              if (intQuestions.length > 0) {
                candidateAnswers.integrity = intQuestions.map((q: any) => ({
                  text: q.text,
                  dimension: q.dimension,
                  options: q.options,
                  selected: answers[q.id] ?? null,
                  risk_weights: q.risk_weights,
                }));
              }
            } catch {}
          }
        }

        const { analyzeCandidateVsIdeal } = require('../services/candidateScoring');
        const analysis = analyzeCandidateVsIdeal(scores, ip);

        candidates.push({
          name: c?.name,
          age: c?.age || null,
          salary_expectation: c?.salary_expectation || null,
          availability: c?.availability || null,
          scores,
          analysis,
          answers: candidateAnswers,
          references: JSON.parse(rc.references_json || '[]'),
          curriculum_file_id: rc.curriculum_file_id || null,
          explanations: await (async () => {
            const { loadReportJson } = require('../services/reportFileStore');

            // Try English version first if lang=en
            if (lang === 'en' && enBundle?.candidates?.[rc.candidate_id]) {
              const enData = enBundle.candidates[rc.candidate_id];
              if (c?.interview_file_id && !enData.transcript_analysis) {
                try {
                  const iData = await loadReportJson(req, c.interview_file_id);
                  if (iData?.analysis) enData.transcript_analysis = iData.analysis;
                } catch {}
              }
              return enData;
            }

            // Spanish (default)
            let expls: any = null;
            if (rc.report_file_id) {
              expls = await loadReportJson(req, rc.report_file_id);
            }
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

            if (c?.interview_file_id && !expls.transcript_analysis) {
              const interviewData = await loadReportJson(req, c.interview_file_id);
              if (interviewData?.analysis) expls.transcript_analysis = interviewData.analysis;
            }

            return expls;
          })(),
        });
      }

      // Load comparison if exists
      let comparison: any = null;
      if (lang === 'en' && enBundle?.comparison) {
        comparison = enBundle.comparison;
      }
      if (!comparison && report.comparison_file_id) {
        try { comparison = await loadReportJson(req, report.comparison_file_id); } catch {}
      }

      sendJson(res, 200, {
        job: { title: job.title, company: job.company },
        lang,
        ideal_profile: ip,
        ideal_competencias: job.ideal_competencias ? JSON.parse(job.ideal_competencias) : [],
        candidates,
        comparison,
      });
    } catch (err: any) { sendError(res, 500, err.message); }
  };
  GET('/api/public/report/:companySlug/:jobSlug', handler);
  GET('/api/public/report/:companySlug/:jobSlug/:reportId', handler);
}
