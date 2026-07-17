/**
 * Marketing V2 — endpoints del nuevo mini-CRM (Clientes + Finalistas).
 *
 * Coexiste con el módulo viejo (`marketing.ts` → `listMarketingLeads`) sin
 * modificar nada de allí. Cuando Cris confirme que el V2 le sirve, se borra el
 * viejo. Mientras tanto ambos endpoints devuelven data desde las mismas tablas.
 *
 * Endpoints:
 *   GET /api/marketing/clientes    — leads enriquecidos con source normalizado + vendor + finalistas_count
 *   GET /api/marketing/finalistas  — Results con marketing_lead_id joineados con Candidates y MarketingLeads
 *
 * Ambos requieren auth 'tenant' (Clerk). No se exponen públicamente.
 */

import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { AppError } from '../lib/errors';
import { signToken, expiresIn, DAY_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';

const log = logger('MARKETING_V2');
const TABLE_LEADS = 'MarketingLeads';
const TABLE_FREELANCE = 'FreelanceUsers';

// ============================================================================
// Source normalization — el campo `source` en la tabla es texto libre con
// valores inconsistentes históricos ("meta_ads", "Meta leads ad",
// "crm_import:LinkedIn Frío", "manual_whatsapp", null, ""). Este normalizador
// lo mapea a 6 buckets fijos para badges/filtros en la UI.
// ============================================================================
export type SourceBucket = 'demo' | 'finalista' | 'meta_ads' | 'linkedin' | 'manual' | 'otros';

export function normalizeSource(raw: string | null | undefined): SourceBucket {
  if (!raw) return 'otros';
  const s = raw.toLowerCase().trim();
  if (s.includes('finalista') || s === 'evalua-finalista') return 'finalista';
  if (s.includes('meta') || s.includes('facebook') || s.includes('instagram')) return 'meta_ads';
  if (s.includes('linkedin')) return 'linkedin';
  if (s.includes('manual') || s.includes('whatsapp')) return 'manual';
  if (s.includes('demo') || s === 'unknown' || s.includes('quiz') || s === 'eval-request') return 'demo';
  return 'otros';
}

// ============================================================================
// GET /api/marketing/clientes
// ============================================================================
type ClienteRow = {
  ROWID: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  score_quality: number | null;
  urgency: string | null;
  salary_target: string | null;
  source: string | null;
  status: string | null;
  pipeline_stage: string | null;
  puesto: string | null;
  assigned_to: string | null;
  eval_result_id: string | null;
  demo_report_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  CREATEDTIME: string;
};

type FreelanceRow = { ROWID: string; nombre: string };

export async function listMarketingClientes(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const sourceFilter = url.searchParams.get('source');
  const vendorFilter = url.searchParams.get('vendor');
  const minScore = Number(url.searchParams.get('min_score') ?? 0);
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit') ?? 200)));

  const filters: string[] = [];
  if (minScore > 0) filters.push(`score_quality >= ${Math.round(minScore)}`);
  if (vendorFilter === 'unassigned') filters.push(`assigned_to IS NULL`);
  else if (vendorFilter) filters.push(`assigned_to = '${escapeSql(vendorFilter)}'`);

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const q = `SELECT ROWID, email, contact_name, company, whatsapp, score_quality, urgency,
              salary_target, source, status, pipeline_stage, puesto, assigned_to, eval_result_id,
              demo_report_url, created_at, updated_at
              FROM ${TABLE_LEADS} ${whereClause}
              ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  let rows: ClienteRow[] = [];
  try {
    rows = unwrapRows<ClienteRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE_LEADS);
  } catch (err) {
    log.error('listClientes query failed', { traceId: ctx.traceId, error: (err as Error).message });
    throw new AppError(500, 'list_clientes_failed', `Query failed: ${(err as Error).message}`);
  }

  // Filter local por source normalizado (ZCQL no puede hacerlo — source es texto libre)
  let filtered = rows;
  if (sourceFilter && sourceFilter !== 'all') {
    filtered = rows.filter((r) => normalizeSource(r.source) === sourceFilter);
  }

  // Cargar vendors en 1 query
  const vendorIds = Array.from(new Set(filtered.map((r) => r.assigned_to).filter(Boolean))) as string[];
  const vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    try {
      const inClause = vendorIds.map((id) => `'${escapeSql(id)}'`).join(',');
      const freelanceRows = unwrapRows<FreelanceRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, nombre FROM ${TABLE_FREELANCE} WHERE ROWID IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        TABLE_FREELANCE,
      );
      for (const f of freelanceRows) vendorMap.set(f.ROWID, f.nombre);
    } catch (err) {
      log.warn('vendor lookup failed — continuing without names', { traceId: ctx.traceId, error: (err as Error).message });
    }
  }

  // Contar finalistas por cliente (Results con marketing_lead_id in leadIds)
  const finalistasCountMap = new Map<string, number>();
  const leadIds = filtered.map((r) => r.ROWID);
  if (leadIds.length > 0) {
    try {
      const inClause = leadIds.map((id) => `'${escapeSql(id)}'`).join(',');
      const resultRows = unwrapRows<{ marketing_lead_id: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT marketing_lead_id FROM Results WHERE marketing_lead_id IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        'Results',
      );
      for (const r of resultRows) {
        const c = finalistasCountMap.get(r.marketing_lead_id) ?? 0;
        finalistasCountMap.set(r.marketing_lead_id, c + 1);
      }
    } catch (err) {
      log.warn('finalistas count lookup failed — continuing without count', { traceId: ctx.traceId, error: (err as Error).message });
    }
  }

  // Normalizar pipeline_stage default (nuevo_lead → nuevo, null → nuevo)
  function normalizeStage(raw: string | null | undefined): string {
    if (!raw || raw === 'nuevo_lead' || raw === 'new') return 'nuevo';
    return raw;
  }

  const appBase = env().APP_BASE_URL.replace(/\/$/, '');
  const clientes = filtered.map((r) => {
    let demoReportUrl: string | null = null;
    if (r.eval_result_id) {
      const token = signToken({ kind: 'report', ref: r.eval_result_id, exp: expiresIn(30 * DAY_SEC) });
      demoReportUrl = `${appBase}/app/index.html#/demo-report/${token}`;
    } else if (r.demo_report_url) {
      demoReportUrl = r.demo_report_url;
    }
    return {
      id: r.ROWID,
      email: r.email,
      contact_name: r.contact_name,
      company: r.company,
      whatsapp: r.whatsapp,
      score_quality: r.score_quality,
      urgency: r.urgency,
      salary_target: r.salary_target,
      puesto: r.puesto,
      source_raw: r.source,
      source_bucket: normalizeSource(r.source),
      status: r.status,
      pipeline_stage: normalizeStage(r.pipeline_stage),
      vendor_id: r.assigned_to,
      vendor_name: r.assigned_to ? vendorMap.get(r.assigned_to) ?? null : null,
      finalistas_count: finalistasCountMap.get(r.ROWID) ?? 0,
      demo_report_url: demoReportUrl,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  const stats = {
    total: clientes.length,
    demo: clientes.filter((c) => c.source_bucket === 'demo').length,
    finalista: clientes.filter((c) => c.source_bucket === 'finalista').length,
    meta_ads: clientes.filter((c) => c.source_bucket === 'meta_ads').length,
    linkedin: clientes.filter((c) => c.source_bucket === 'linkedin').length,
    unassigned: clientes.filter((c) => !c.vendor_id).length,
  };

  sendJson(ctx.res, 200, { clientes, count: clientes.length, stats });
}

// ============================================================================
// GET /api/marketing/finalistas
// ============================================================================
type ResultRow = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: string;
  started_at: string | null;
  completed_at: string | null;
  marketing_lead_id: string | null;
  CREATEDTIME: string;
};

type CandidateRow = { ROWID: string; name: string; email: string };
type LeadInfoRow = { ROWID: string; company: string | null; email: string; source: string | null };

export async function listMarketingFinalistas(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const statusFilter = url.searchParams.get('status'); // pending | in_progress | complete | report_sent
  const clientIdFilter = url.searchParams.get('client_id');
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit') ?? 200)));

  const filters: string[] = ['marketing_lead_id IS NOT NULL'];
  if (clientIdFilter) filters.push(`marketing_lead_id = '${escapeSql(clientIdFilter)}'`);
  const whereClause = `WHERE ${filters.join(' AND ')}`;

  let resultRows: ResultRow[] = [];
  try {
    resultRows = unwrapRows<ResultRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, assessment_id, candidate_id, pipeline_stage, started_at, completed_at, marketing_lead_id
         FROM Results ${whereClause}
         ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
      )) as unknown[],
      'Results',
    );
  } catch (err) {
    log.error('listFinalistas query failed', { traceId: ctx.traceId, error: (err as Error).message });
    throw new AppError(500, 'list_finalistas_failed', `Query failed: ${(err as Error).message}`);
  }

  // Cargar candidates + leads en 2 queries batch
  const candidateIds = Array.from(new Set(resultRows.map((r) => r.candidate_id).filter(Boolean))) as string[];
  const leadIds = Array.from(new Set(resultRows.map((r) => r.marketing_lead_id).filter(Boolean))) as string[];

  const candidateMap = new Map<string, CandidateRow>();
  if (candidateIds.length > 0) {
    try {
      const inClause = candidateIds.map((id) => `'${escapeSql(id)}'`).join(',');
      const rows = unwrapRows<CandidateRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, name, email FROM Candidates WHERE ROWID IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        'Candidates',
      );
      for (const c of rows) candidateMap.set(c.ROWID, c);
    } catch (err) {
      log.warn('candidate lookup failed', { traceId: ctx.traceId, error: (err as Error).message });
    }
  }

  const leadMap = new Map<string, LeadInfoRow>();
  if (leadIds.length > 0) {
    try {
      const inClause = leadIds.map((id) => `'${escapeSql(id)}'`).join(',');
      const rows = unwrapRows<LeadInfoRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, company, email, source FROM ${TABLE_LEADS} WHERE ROWID IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        TABLE_LEADS,
      );
      for (const l of rows) leadMap.set(l.ROWID, l);
    } catch (err) {
      log.warn('lead lookup failed', { traceId: ctx.traceId, error: (err as Error).message });
    }
  }

  // Mapear estado del finalista según pipeline_stage del Result.
  // OJO: en flow finalist el Result arranca en 'tecnica_completed' (salta la
  // técnica del ATS porque no aplica al demo). Eso NO significa que la conductual
  // esté completa — significa que arranca sin haber hecho nada aún.
  //
  //   applied           → nada hecho
  //   tecnica_completed → nada hecho (el finalist arranca acá)
  //   conductual_completed → conductual OK, falta integridad
  //   integridad_completed → integridad OK, falta conductual (raro, pero posible)
  //   finalist / report_sent → ambas hechas
  function mapStatus(pipelineStage: string): { test1: 'pending' | 'complete'; test2: 'pending' | 'complete'; reporte: boolean } {
    switch (pipelineStage) {
      case 'report_sent': return { test1: 'complete', test2: 'complete', reporte: true };
      case 'finalist': return { test1: 'complete', test2: 'complete', reporte: false };
      case 'conductual_completed': return { test1: 'complete', test2: 'pending', reporte: false };
      case 'integridad_completed': return { test1: 'pending', test2: 'complete', reporte: false };
      case 'applied':
      case 'tecnica_completed':
      default: return { test1: 'pending', test2: 'pending', reporte: false };
    }
  }

  const finalistas = resultRows
    .map((r) => {
      const candidate = candidateMap.get(r.candidate_id);
      const lead = r.marketing_lead_id ? leadMap.get(r.marketing_lead_id) : null;
      const status = mapStatus(r.pipeline_stage);
      const daysAgo = r.started_at ? Math.floor((Date.now() - new Date(r.started_at).getTime()) / 86400_000) : 0;
      return {
        id: r.ROWID,
        candidate_id: r.candidate_id,
        candidate_name: candidate?.name ?? '(sin nombre)',
        candidate_email: candidate?.email ?? '(sin email)',
        client_id: r.marketing_lead_id,
        client_company: lead?.company ?? '(sin empresa)',
        client_email: lead?.email ?? '',
        source_bucket: normalizeSource(lead?.source),
        pipeline_stage: r.pipeline_stage,
        test1_status: status.test1,
        test2_status: status.test2,
        reporte: status.reporte,
        started_at: r.started_at,
        completed_at: r.completed_at,
        dias_espera: daysAgo,
      };
    })
    .filter((f) => {
      if (!statusFilter || statusFilter === 'all') return true;
      if (statusFilter === 'pending') return f.test1_status === 'pending' && f.test2_status === 'pending';
      if (statusFilter === 'in_progress') return (f.test1_status === 'complete' || f.test2_status === 'complete') && !f.reporte;
      if (statusFilter === 'complete') return f.test1_status === 'complete' && f.test2_status === 'complete' && !f.reporte;
      if (statusFilter === 'report_sent') return f.reporte;
      return true;
    });

  const stats = {
    total: finalistas.length,
    sin_arrancar: finalistas.filter((f) => f.test1_status === 'pending' && f.test2_status === 'pending').length,
    en_proceso: finalistas.filter((f) => (f.test1_status === 'complete' || f.test2_status === 'complete') && !f.reporte).length,
    reporte_listo: finalistas.filter((f) => f.reporte).length,
  };

  sendJson(ctx.res, 200, { finalistas, count: finalistas.length, stats });
}
