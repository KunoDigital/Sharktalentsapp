import { GET } from '../router';
import { sendJson } from '../helpers';
import * as db from '../db';

export function registerAdminCandidateRoutes(): void {
  GET('/api/admin/candidates', async (req, res) => {
    const candidates = await db.queryAll(req, `SELECT * FROM Candidates ORDER BY created_at DESC`, 'Candidates');
    // Count jobs per candidate with separate queries (ZCQL doesn't support complex JOINs)
    for (const c of candidates) {
      const cid = c.ROWID || c.id;
      const results = await db.queryAll(req, `SELECT ROWID, assessment_id FROM Results WHERE candidate_id = ${db.esc(cid)}`, 'Results');
      const jobIds = new Set<string>();
      for (const r of results) {
        const a = await db.queryOne(req, `SELECT job_id FROM Assessments WHERE ROWID = ${db.esc(r.assessment_id)}`, 'Assessments');
        if (a?.job_id) jobIds.add(a.job_id);
      }
      c.jobs_count = jobIds.size;
    }
    sendJson(res, 200, candidates);
  });

  GET('/api/admin/candidates/search', async (req, res, _params, query) => {
    const q = (query.q || '').trim();
    if (!q) return sendJson(res, 200, []);
    const candidates = await db.queryAll(req, `SELECT * FROM Candidates WHERE name LIKE ${db.esc(`%${q}%`)} OR email LIKE ${db.esc(`%${q}%`)} ORDER BY created_at DESC`, 'Candidates');
    sendJson(res, 200, candidates);
  });
}
