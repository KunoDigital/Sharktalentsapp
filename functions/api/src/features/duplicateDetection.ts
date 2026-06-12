/**
 * Detección de candidatos duplicados.
 *
 *   GET /api/candidates/_duplicates
 *
 * Detecta candidatos que probablemente sean la misma persona:
 *   - Mismo phone con emails distintos
 *   - Mismo nombre (normalizado) con emails distintos
 *   - Mismo email con phones distintos (caso raro pero existe)
 *
 * Útil para identificar gente que aplicó con datos distintos al mismo tenant
 * y evitar evaluar dos veces.
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';

const log = logger('DUPLICATES');

type CandidateRow = {
  ROWID: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: string;
};

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  // Solo digits, ignorar formato
  return phone.replace(/\D/g, '') || null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // sacar acentos
    .replace(/\s+/g, ' ');
}

export async function findDuplicateCandidates(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  // 2026-06-04: refactor sin JOIN (Catalyst rompió los JOINs).
  // 1) Jobs del tenant → 2) candidate_ids de Results de esos jobs → 3) Candidates por chunks.
  let candidates: CandidateRow[] = [];
  try {
    const { bigintInClause } = await import('../lib/dbHelpers.js');
    const jobRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' LIMIT 300`,
      )) as unknown[],
      'Jobs',
    );
    const candIds = new Set<string>();
    for (let i = 0; i < jobRows.length; i += 30) {
      const chunk = bigintInClause(jobRows.slice(i, i + 30).map((j) => j.ROWID));
      if (!chunk) continue;
      const r = unwrapRows<{ candidate_id: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT candidate_id FROM Results WHERE assessment_id IN (${chunk}) LIMIT 300`,
        )) as unknown[],
        'Results',
      );
      r.forEach((x) => x.candidate_id && candIds.add(String(x.candidate_id)));
    }
    const idsArr = Array.from(candIds);
    for (let i = 0; i < idsArr.length; i += 30) {
      const chunk = bigintInClause(idsArr.slice(i, i + 30));
      if (!chunk) continue;
      const rows = unwrapRows<CandidateRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, name, email, phone, created_at FROM Candidates WHERE ROWID IN (${chunk}) LIMIT 300`,
        )) as unknown[],
        'Candidates',
      );
      candidates.push(...rows);
    }
  } catch (err) {
    log.warn('candidates query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { duplicates: [], total_candidates: 0 });
    return;
  }

  // Agrupar por phone y por nombre
  const byPhone = new Map<string, CandidateRow[]>();
  const byName = new Map<string, CandidateRow[]>();
  const byEmail = new Map<string, CandidateRow[]>();

  for (const c of candidates) {
    const phone = normalizePhone(c.phone);
    if (phone && phone.length >= 7) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(c);
    }
    const name = normalizeName(c.name);
    if (name && name.length >= 5 && name.includes(' ')) {  // skip single names (genéricos)
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(c);
    }
    const email = c.email.toLowerCase().trim();
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(c);
    }
  }

  type DuplicateGroup = {
    type: 'phone' | 'name' | 'email';
    match: string;
    candidates: Array<{
      ROWID: string;
      name: string;
      email: string;
      phone: string | null;
      created_at: string;
    }>;
    severity: 'high' | 'medium';
  };

  const duplicates: DuplicateGroup[] = [];

  // Por phone — high severity (phone único es muy distintivo)
  for (const [phone, cands] of byPhone.entries()) {
    if (cands.length > 1) {
      const distinctEmails = new Set(cands.map((c) => c.email.toLowerCase()));
      if (distinctEmails.size > 1) {
        duplicates.push({
          type: 'phone',
          match: phone,
          candidates: cands,
          severity: 'high',
        });
      }
    }
  }

  // Por email — high severity (mismo email pero dos rows; bug del sistema)
  for (const [email, cands] of byEmail.entries()) {
    if (cands.length > 1) {
      duplicates.push({
        type: 'email',
        match: email,
        candidates: cands,
        severity: 'high',
      });
    }
  }

  // Por nombre — medium severity (puede ser homonimia)
  const seenIds = new Set(duplicates.flatMap((d) => d.candidates.map((c) => c.ROWID)));
  for (const [name, cands] of byName.entries()) {
    if (cands.length > 1) {
      const distinctEmails = new Set(cands.map((c) => c.email.toLowerCase()));
      if (distinctEmails.size > 1) {
        // Skip si ya están en otro grupo (por phone)
        const newCands = cands.filter((c) => !seenIds.has(c.ROWID));
        if (newCands.length > 1) {
          duplicates.push({
            type: 'name',
            match: name,
            candidates: newCands,
            severity: 'medium',
          });
        }
      }
    }
  }

  // Ordenar por severity y luego por count
  duplicates.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return b.candidates.length - a.candidates.length;
  });

  sendJson(ctx.res, 200, {
    duplicates,
    total_candidates: candidates.length,
    duplicate_groups: duplicates.length,
    affected_candidates: new Set(duplicates.flatMap((d) => d.candidates.map((c) => c.ROWID))).size,
  });
}
