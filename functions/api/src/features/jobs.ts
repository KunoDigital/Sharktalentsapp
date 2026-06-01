import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { persistLargeJson, loadLargeJson, deleteLargeContent } from '../lib/largeContentStore';
import { NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { auditLog } from '../lib/auditLog';

const log = logger('JOBS');
const TABLE = 'Jobs';

export type CognitiveLevel = 'basic' | 'mid' | 'senior';

export type DiscIdeal = {
  d: number; i: number; s: number; c: number;
  pk_code?: string;
  pk_name?: string;
};

export type VelnaIdeal = {
  verbal: number; espacial: number; logica: number; numerica: number; abstracta: number;
};

export type Competencia = { name: string; required_pct: number };

export type BossProfile = {
  name: string;
  role: string;
  style_autonomy_consult: number; // 0-1: 0=consult, 1=autonomy
  evidence_quote?: string;
};

/**
 * Reglas de auto-rechazo (doc 18). Si el candidato no cumple algún umbral después
 * de completar pruebas, el sistema lo manda a `auto_rejected_low_score` automáticamente.
 *
 * Todos los umbrales son OPCIONALES — si no se setea, no se aplica esa dimensión.
 */
export type AutoRejectionRules = {
  /** Mínimo de similitud DISC vs ideal (0-100). Default: no chequear. */
  disc_min_similarity?: number;
  /** Mínimo VELNA índice (0-100). */
  velna_min_indice?: number;
  /** Máximo % de riesgo integridad (0-100). 0 = solo bajo permitido; 100 = todos pasan. */
  integridad_max_riesgo?: number;
  /** Mínimo score emocional (0-100). */
  emo_min_score?: number;
  /** Si true, rechaza si el candidato no pasó el test de inglés (cuando el job lo requiere). */
  require_english_passed?: boolean;
  /** Mínimo % de adaptabilidad (mindset) — 0-100. */
  mindset_min_adaptability?: number;
};

export type ReportLang = 'es' | 'en';

export type IdealProfile = {
  disc?: DiscIdeal;
  disc_b?: DiscIdeal;
  velna?: VelnaIdeal;
  competencias?: Competencia[];
  tecnica_minimo_pct?: number;
  context_summary?: string;
  boss?: BossProfile;
  auto_rejection_rules?: AutoRejectionRules;
  report_lang?: ReportLang;
};

export type Job = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  tech_prompt: string | null;
  cognitive_level: CognitiveLevel;
  is_active: boolean;
  company_context: string | null;
  ideal_profile: string | null; // JSON serializado de IdealProfile
  tech_questions_cache: string | null; // JSON array de GeneratedQuestion
  created_by: string;
  created_at: string;
  updated_at: string;
};

type JobInsert = Omit<Job, 'ROWID' | 'created_at' | 'updated_at'>;
type JobPatch = Partial<Omit<JobInsert, 'tenant_id' | 'created_by'>>;

const COGNITIVE_LEVELS: CognitiveLevel[] = ['basic', 'mid', 'senior'];

const VALID_CEFR_LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

/** Valida que english_required ⇒ english_min_level válido. Throws si inconsistente. */
export function validateEnglishConfig(b: Record<string, unknown>): void {
  if (b.english_required === true) {
    const lvl = b.english_min_level;
    if (typeof lvl !== 'string' || !(VALID_CEFR_LEVELS as readonly string[]).includes(lvl)) {
      throw new ValidationError(
        `english_required=true requires english_min_level to be one of ${VALID_CEFR_LEVELS.join(', ')}`,
      );
    }
  }
}

function validateInsert(body: unknown): JobInsert {
  const b = body as Record<string, unknown>;
  if (typeof b.title !== 'string' || !b.title.trim()) {
    throw new ValidationError('title is required');
  }
  if (typeof b.company !== 'string' || !b.company.trim()) {
    throw new ValidationError('company is required');
  }
  const cognitiveLevel = (typeof b.cognitive_level === 'string' ? b.cognitive_level : 'mid') as CognitiveLevel;
  if (!COGNITIVE_LEVELS.includes(cognitiveLevel)) {
    throw new ValidationError(`cognitive_level must be one of ${COGNITIVE_LEVELS.join(', ')}`);
  }
  validateEnglishConfig(b);
  return {
    tenant_id: '',
    title: b.title.trim().slice(0, 255),
    company: b.company.trim().slice(0, 255),
    tech_prompt: typeof b.tech_prompt === 'string' ? b.tech_prompt : null,
    cognitive_level: cognitiveLevel,
    is_active: typeof b.is_active === 'boolean' ? b.is_active : true,
    company_context: typeof b.company_context === 'string' ? b.company_context : null,
    ideal_profile: serializeIdealProfile(b.ideal_profile),
    tech_questions_cache: null,
    created_by: '',
  };
}

export function validateIdealProfile(input: unknown): IdealProfile | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('ideal_profile must be an object');
  }
  const ip = input as Record<string, unknown>;
  const out: IdealProfile = {};

  if (ip.disc !== undefined) out.disc = validateDisc(ip.disc, 'disc');
  if (ip.disc_b !== undefined) out.disc_b = validateDisc(ip.disc_b, 'disc_b');
  if (ip.velna !== undefined) out.velna = validateVelna(ip.velna);
  if (ip.competencias !== undefined) out.competencias = validateCompetencias(ip.competencias);
  if (ip.tecnica_minimo_pct !== undefined) {
    const n = Number(ip.tecnica_minimo_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ValidationError('tecnica_minimo_pct must be 0..100');
    }
    out.tecnica_minimo_pct = Math.round(n);
  }
  if (ip.context_summary !== undefined) {
    if (typeof ip.context_summary !== 'string') throw new ValidationError('context_summary must be string');
    out.context_summary = ip.context_summary.slice(0, 4000);
  }
  if (ip.boss !== undefined) out.boss = validateBoss(ip.boss);
  if (ip.auto_rejection_rules !== undefined) out.auto_rejection_rules = validateAutoRejection(ip.auto_rejection_rules);
  if (ip.report_lang !== undefined) {
    if (ip.report_lang !== 'es' && ip.report_lang !== 'en') {
      throw new ValidationError('report_lang must be "es" or "en"');
    }
    out.report_lang = ip.report_lang;
  }

  return out;
}

function validateAutoRejection(raw: unknown): AutoRejectionRules {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('auto_rejection_rules must be object');
  const r = raw as Record<string, unknown>;
  const out: AutoRejectionRules = {};
  for (const k of ['disc_min_similarity', 'velna_min_indice', 'integridad_max_riesgo', 'emo_min_score', 'mindset_min_adaptability'] as const) {
    if (r[k] !== undefined) {
      const n = Number(r[k]);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new ValidationError(`${k} must be 0..100`);
      }
      out[k] = Math.round(n);
    }
  }
  if (r.require_english_passed !== undefined) {
    if (typeof r.require_english_passed !== 'boolean') {
      throw new ValidationError('require_english_passed must be boolean');
    }
    out.require_english_passed = r.require_english_passed;
  }
  return out;
}

function validateBoss(raw: unknown): BossProfile {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('boss must be object');
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) throw new ValidationError('boss.name required');
  if (typeof r.role !== 'string') throw new ValidationError('boss.role required');
  const style = Number(r.style_autonomy_consult);
  if (!Number.isFinite(style) || style < 0 || style > 1) {
    throw new ValidationError('boss.style_autonomy_consult must be 0..1');
  }
  return {
    name: r.name.trim().slice(0, 255),
    role: r.role.trim().slice(0, 255),
    style_autonomy_consult: Number(style.toFixed(2)),
    ...(typeof r.evidence_quote === 'string' ? { evidence_quote: r.evidence_quote.slice(0, 1000) } : {}),
  };
}

function validateDisc(raw: unknown, label: string): DiscIdeal {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError(`${label} must be object`);
  const r = raw as Record<string, unknown>;
  for (const k of ['d', 'i', 's', 'c']) {
    const n = Number(r[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ValidationError(`${label}.${k} must be 0..100`);
    }
  }
  return {
    d: Math.round(Number(r.d)),
    i: Math.round(Number(r.i)),
    s: Math.round(Number(r.s)),
    c: Math.round(Number(r.c)),
    ...(typeof r.pk_code === 'string' ? { pk_code: r.pk_code.slice(0, 20) } : {}),
    ...(typeof r.pk_name === 'string' ? { pk_name: r.pk_name.slice(0, 100) } : {}),
  };
}

function validateVelna(raw: unknown): VelnaIdeal {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('velna must be object');
  const r = raw as Record<string, unknown>;
  const keys = ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const;
  const out = {} as VelnaIdeal;
  for (const k of keys) {
    const n = Number(r[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ValidationError(`velna.${k} must be 0..100`);
    }
    out[k] = Math.round(n);
  }
  return out;
}

function validateCompetencias(raw: unknown): Competencia[] {
  if (!Array.isArray(raw)) throw new ValidationError('competencias must be array');
  if (raw.length > 30) throw new ValidationError('competencias max 30');
  return raw.map((c, idx) => {
    if (typeof c !== 'object' || c === null) throw new ValidationError(`competencias[${idx}] invalid`);
    const r = c as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) throw new ValidationError(`competencias[${idx}].name required`);
    const pct = Number(r.required_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new ValidationError(`competencias[${idx}].required_pct must be 0..100`);
    }
    return { name: r.name.trim().slice(0, 200), required_pct: Math.round(pct) };
  });
}

function serializeIdealProfile(input: unknown): string | null {
  const validated = validateIdealProfile(input);
  if (!validated || Object.keys(validated).length === 0) return null;
  return stringifyAndTruncate(validated, FIELD_LIMITS.IDEAL_PROFILE, 'Jobs.ideal_profile');
}

export function parseIdealProfile(serialized: string | null | undefined): IdealProfile | null {
  if (!serialized || typeof serialized !== 'string') return null;
  try {
    return validateIdealProfile(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function validatePatch(body: unknown): JobPatch {
  const b = body as Record<string, unknown>;
  const out: JobPatch = {};
  validateEnglishConfig(b);
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim()) throw new ValidationError('title invalid');
    out.title = b.title.trim().slice(0, 255);
  }
  if (b.company !== undefined) {
    if (typeof b.company !== 'string' || !b.company.trim()) throw new ValidationError('company invalid');
    out.company = b.company.trim().slice(0, 255);
  }
  if (b.tech_prompt !== undefined) {
    out.tech_prompt = typeof b.tech_prompt === 'string' ? b.tech_prompt : null;
  }
  if (b.cognitive_level !== undefined) {
    if (typeof b.cognitive_level !== 'string' || !COGNITIVE_LEVELS.includes(b.cognitive_level as CognitiveLevel)) {
      throw new ValidationError('cognitive_level invalid');
    }
    out.cognitive_level = b.cognitive_level as CognitiveLevel;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') throw new ValidationError('is_active must be boolean');
    out.is_active = b.is_active;
  }
  if (b.company_context !== undefined) {
    out.company_context = typeof b.company_context === 'string' ? b.company_context : null;
  }
  if (b.ideal_profile !== undefined) {
    out.ideal_profile = serializeIdealProfile(b.ideal_profile);
  }
  return out;
}

// ---- DB ----

async function listByTenant(req: IncomingMessage, tenantId: string, includeInactive = false): Promise<Job[]> {
  const filter = includeInactive ? '' : ` AND is_active = true`;
  const query = `SELECT * FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}'${filter} ORDER BY CREATEDTIME DESC`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<Job>(result, TABLE);
}

async function getByIdScoped(req: IncomingMessage, jobId: string, tenantId: string): Promise<Job | null> {
  const query = `SELECT * FROM ${TABLE} WHERE ROWID = '${escapeSql(jobId)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  const rows = unwrapRows<Job>(result, TABLE);
  return rows[0] ?? null;
}

async function insertJob(req: IncomingMessage, payload: JobInsert): Promise<Job> {
  const row = await datastore(req).table(TABLE).insertRow(omitIdealIfNull({
    ...payload,
    created_at: now(),
    updated_at: now(),
  }));
  return unwrapRow<Job>(row, TABLE) as Job;
}

async function updateJob(req: IncomingMessage, rowId: string, patch: JobPatch): Promise<Job | null> {
  const row = await datastore(req).table(TABLE).updateRow(omitIdealIfNull({
    ROWID: rowId,
    ...patch,
    updated_at: now(),
  }));
  return unwrapRow<Job>(row, TABLE);
}

/**
 * Saca claves opcionales con valor null del payload, para que Catalyst no falle si
 * la columna no existe todavía (migración manual pendiente). Por ahora aplica a
 * `ideal_profile` y `tech_questions_cache`.
 */
function omitIdealIfNull<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  if (out.ideal_profile == null) delete out.ideal_profile;
  if (out.tech_questions_cache == null) delete out.tech_questions_cache;
  return out;
}

// ---- Handlers ----

export async function listJobs(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const includeInactive = url.searchParams.get('include_inactive') === 'true';
  const jobs = await listByTenant(ctx.req, tenantId, includeInactive);
  log.info('list', { traceId: ctx.traceId, tenantId, count: jobs.length });
  sendJson(ctx.res, 200, { jobs });
}

export async function getJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const jobId = extractIdFromPath(ctx.req.url ?? '/');
  if (!jobId) throw new ValidationError('job id missing in path');
  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);
  sendJson(ctx.res, 200, { job });
}

export async function createJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const body = await readJsonBody(ctx.req);
  const draft = validateInsert(body);
  draft.tenant_id = tenantId;
  draft.created_by = ctx.user!.clerk_user_id;
  const created = await insertJob(ctx.req, draft);
  log.info('created', { traceId: ctx.traceId, tenantId, jobId: created.ROWID });
  void auditLog(ctx, {
    action: 'job.create',
    resource_type: 'job',
    resource_id: created.ROWID,
    changes: { title: draft.title, company: draft.company, cognitive_level: draft.cognitive_level },
  });
  sendJson(ctx.res, 201, { job: created });
}

export async function patchJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const jobId = extractIdFromPath(ctx.req.url ?? '/');
  if (!jobId) throw new ValidationError('job id missing in path');
  const existing = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!existing) throw new NotFoundError(`Job ${jobId} not found`);
  const body = await readJsonBody(ctx.req);
  const patch = validatePatch(body);
  const updated = await updateJob(ctx.req, jobId, patch);
  log.info('patched', { traceId: ctx.traceId, tenantId, jobId, fields: Object.keys(patch) });
  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: patch,
  });
  sendJson(ctx.res, 200, { job: updated });
}

export async function archiveJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const jobId = extractIdFromPath(ctx.req.url ?? '/');
  if (!jobId) throw new ValidationError('job id missing in path');
  const existing = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!existing) throw new NotFoundError(`Job ${jobId} not found`);
  const updated = await updateJob(ctx.req, jobId, { is_active: false });
  log.info('archived', { traceId: ctx.traceId, tenantId, jobId });
  void auditLog(ctx, {
    action: 'job.archive',
    resource_type: 'job',
    resource_id: jobId,
  });
  sendJson(ctx.res, 200, { job: updated });
}

function extractIdFromPath(url: string): string | null {
  const match = url.match(/^\/api\/jobs\/([^/?]+)/);
  return match?.[1] ?? null;
}

// ===== Diagnóstico: force-publish un Job Opening en Recruit con varios approaches =====

export async function forcePublishRecruitJob(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  try {
    const m = ctx.req.url?.match(/^\/api\/_force_publish_recruit_job\/([^/]+)\/?$/);
    const recruitId = m?.[1];
    if (!recruitId) throw new ValidationError('recruit_id missing');

    const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
    const auth = await getZohoAuthHeader(ctx.traceId);
    if (!auth) {
      sendJson(ctx.res, 200, { ok: false, error: 'OAuth not configured' });
      return;
    }

    const tries: Array<{ approach: string; payload: Record<string, unknown>; result?: unknown }> = [];

    // Approach 1: PUT con Publish + Keep_on_Career_Site como booleans
    const p1 = { data: [{ Publish: true, Keep_on_Career_Site: true }] };
    tries.push({ approach: 'PUT booleans', payload: p1 });
    const r1 = await fetch(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p1),
    });
    tries[0].result = { status: r1.status, body: (await r1.text()).slice(0, 500) };

    // Approach 2: PUT con string "true"
    const p2 = { data: [{ Publish: 'true', Keep_on_Career_Site: 'true' }] };
    tries.push({ approach: 'PUT strings', payload: p2 });
    const r2 = await fetch(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p2),
    });
    tries[1].result = { status: r2.status, body: (await r2.text()).slice(0, 500) };

    // Approach 3: Action endpoint "publish" (módulo, no per-record)
    tries.push({ approach: 'POST /Job_Openings/actions/publish', payload: {} });
    const r3 = await fetch(`https://recruit.zoho.com/recruit/v2/Job_Openings/actions/publish`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [recruitId] }),
    });
    tries[2].result = { status: r3.status, body: (await r3.text()).slice(0, 500) };

    // Approach 4: v1.1 API legacy publishJobOpenings
    tries.push({ approach: 'GET v1.1 publishJobOpenings', payload: {} });
    const r4 = await fetch(`https://recruit.zoho.com/recruit/private/json/JobOpenings/publishJobOpenings?jobIds=${recruitId}&scope=recruitapi`, {
      method: 'POST', headers: { Authorization: auth },
    });
    tries[3].result = { status: r4.status, body: (await r4.text()).slice(0, 500) };

    // Approach 5: PUT con `$publish` (algunos módulos usan campos con prefijo $)
    const p5 = { data: [{ $publish: true }] };
    tries.push({ approach: 'PUT $publish', payload: p5 });
    const r5 = await fetch(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p5),
    });
    tries[4].result = { status: r5.status, body: (await r5.text()).slice(0, 500) };

    // Re-dump después para ver cuál pegó
    const dumpRes = await fetch(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    const dumpData = await dumpRes.json().catch(() => null);
    const row = (dumpData as { data?: Array<Record<string, unknown>> })?.data?.[0];

    sendJson(ctx.res, 200, {
      ok: true,
      tries,
      after: {
        Publish: row?.Publish,
        Keep_on_Career_Site: row?.Keep_on_Career_Site,
        Job_Opening_Status: row?.Job_Opening_Status,
      },
    });
  } catch (err) {
    sendJson(ctx.res, 200, { ok: false, error: (err as Error).message });
  }
}

// ===== Diagnóstico: dump RAW del Job Opening en Recruit (ve todos los API names con sus values) =====

export async function dumpRecruitJobOpening(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  try {
    const m = ctx.req.url?.match(/^\/api\/_dump_recruit_job\/([^/]+)\/?$/);
    const recruitId = m?.[1];
    if (!recruitId) throw new ValidationError('recruit_job_id missing in path');

    const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
    const auth = await getZohoAuthHeader(ctx.traceId);
    if (!auth) {
      sendJson(ctx.res, 200, { ok: false, error: 'OAuth not configured' });
      return;
    }
    const url = `https://recruit.zoho.com/recruit/v2/Job_Openings/${encodeURIComponent(recruitId)}`;
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    sendJson(ctx.res, 200, { ok: res.ok, status: res.status, data });
  } catch (err) {
    sendJson(ctx.res, 200, { ok: false, error: (err as Error).message });
  }
}

// ===== Diagnóstico: introspección de fields del módulo Job_Openings en Recruit =====

export async function inspectRecruitJobOpeningFields(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);
  try {
    const { listJobOpeningFields } = await import('../lib/zohoRecruitClient.js');
    const result = await listJobOpeningFields(ctx.traceId);
    if (!result.ok) {
      sendJson(ctx.res, 200, { ok: false, error: result.error });
      return;
    }
    const custom = result.data.fields.filter((f) => f.custom_field);
    sendJson(ctx.res, 200, {
      ok: true,
      custom_fields: custom.map((f) => ({ label: f.field_label, api_name: f.api_name, type: f.data_type })),
      all_fields_count: result.data.fields.length,
    });
  } catch (err) {
    sendJson(ctx.res, 200, { ok: false, error: (err as Error).message });
  }
}

// ===== Diagnóstico: re-disparar sync con Recruit y devolver error inline =====

export async function retryRecruitSync(ctx: RequestContext): Promise<void> {
  const debug: Record<string, unknown> = { step: 'start' };
  try {
    debug.step = 'requireAuth';
    await requireAuth(ctx);
    debug.step = 'requireTenant';
    const tenantId = await requireTenant(ctx);

    debug.step = 'extract id';
    const m = ctx.req.url?.match(/^\/api\/jobs\/([^/]+)\/retry-recruit-sync\/?$/);
    const jobId = m?.[1];
    if (!jobId) throw new ValidationError('job id missing in path');

    debug.step = 'fetch job';
    const job = await getByIdScoped(ctx.req, jobId, tenantId);
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);
    const jobAny = job as Record<string, unknown>;
    debug.job = { id: job.ROWID, title: job.title, company: job.company, recruit_job_id: jobAny.recruit_job_id };

    debug.step = 'check config';
    const { isZohoRecruitConfigured, createRecruitJobOpening, updateRecruitJobOpening } = await import('../lib/zohoRecruitClient.js');
    if (!isZohoRecruitConfigured()) {
      sendJson(ctx.res, 200, { ok: false, debug, reason: 'Zoho Recruit not configured (faltan env vars ZOHO_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN)' });
      return;
    }

    debug.step = 'call create job opening';
    const result = await createRecruitJobOpening({
      Job_Opening_Name: job.title,
      Posting_Title: job.title,
      Client_Name: job.company,
      Job_Description: job.company_context ?? undefined,
      Job_Opening_Status: 'In-progress',
      customFields: { Publish: true, Keep_on_Career_Site: true },
    }, ctx.traceId);
    debug.create_result = { ok: result.ok, error: result.ok ? undefined : result.error, status: result.ok ? undefined : result.status };

    if (!result.ok) {
      sendJson(ctx.res, 200, { ok: false, debug, error: result.error });
      return;
    }

    const recruitId = result.data?.data?.[0]?.details?.id ?? '';
    debug.recruit_id = recruitId;
    if (!recruitId) {
      sendJson(ctx.res, 200, { ok: false, debug, raw_response: result.data, reason: 'created but no id returned' });
      return;
    }

    debug.step = 'update SharkTalents Jobs.recruit_job_id';
    try {
      await datastore(ctx.req).table('Jobs').updateRow({
        ROWID: jobId, recruit_job_id: recruitId, updated_at: now(),
      });
    } catch (err) {
      debug.link_error = (err as Error).message;
    }

    debug.step = 'update Recruit custom fields';
    const { env } = await import('../lib/env.js');
    const e = env();
    const baseUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/server/api/api/recruit/test-link?recruit_job_id=${recruitId}`;
    const customFields: Record<string, unknown> = {
      Perfil_Disc: `${baseUrl}&phase=disc`,
      Perfil_Tecnica: `${baseUrl}&phase=tecnica`,
      Prueba_Integridad: `${baseUrl}&phase=integridad`,
      Publish: true,
      Keep_on_Career_Site: true,
    };
    const updateResult = await updateRecruitJobOpening(recruitId, customFields, ctx.traceId);
    debug.custom_fields_update = { ok: updateResult.ok, error: updateResult.ok ? undefined : updateResult.error };

    sendJson(ctx.res, 200, {
      ok: true,
      recruit_job_id: recruitId,
      custom_fields_ok: updateResult.ok,
      custom_fields_error: updateResult.ok ? null : updateResult.error,
      debug,
    });
  } catch (err) {
    const e = err as Error;
    sendJson(ctx.res, 200, {
      ok: false,
      debug,
      error_name: e?.name,
      error_message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 6).join(' | '),
    });
  }
}

// ===== Tech questions: generación IA on-demand y persistencia en Jobs.tech_questions_cache =====

export async function generateJobTechQuestions(ctx: RequestContext): Promise<void> {
  const { generateTechnicalQuestions } = await import('../lib/techQuestions.js');
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/tech-questions\/generate\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);
  if (!job.tech_prompt || !job.tech_prompt.trim()) {
    throw new ValidationError('tech_prompt vacío en este job — agregar descripción de qué evaluar antes de generar');
  }

  const body = await readJsonBody<{ count?: number }>(ctx.req).catch(() => ({} as { count?: number }));
  const count = typeof body.count === 'number' && body.count >= 5 && body.count <= 30 ? body.count : 15;

  const questions = await generateTechnicalQuestions({
    jobTitle: job.title,
    jobCompany: job.company,
    techPrompt: job.tech_prompt,
    level: job.cognitive_level,
    count,
    traceId: ctx.traceId,
  });

  // Si excede 9_500 chars, va al File Store; si entra inline, queda en la columna.
  // Antes de persistir el nuevo, recordamos el actual para limpiarlo si era File Store ref.
  const previousCache = job.tech_questions_cache;
  const serialized = await persistLargeJson(ctx.req, questions, 'Jobs.tech_questions_cache');
  await datastore(ctx.req).table('Jobs').updateRow({
    ROWID: jobId,
    tech_questions_cache: serialized,
    updated_at: now(),
  });
  // Limpiar el File Store ref anterior si lo había (no-op si era inline o null)
  deleteLargeContent(ctx.req, previousCache).catch(() => {});

  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: { tech_questions_count: questions.length },
  });

  log.info('tech questions persisted', { traceId: ctx.traceId, jobId, count: questions.length });

  sendJson(ctx.res, 200, {
    job_id: jobId,
    count: questions.length,
    questions, // devolvemos para que la UI muestre preview
  });
}

/**
 * Endpoint manual: notificar al cliente que el reporte de finalistas está listo.
 *
 *   POST /api/jobs/:id/notify-client-report-ready
 *   Body: { client_email, client_name, finalist_count?, report_url? }
 *
 * Cris (recruiter) lo dispara desde la UI cuando decide que el reporte está
 * listo para mandar. El email lo procesa el outbox via ZeptoMail.
 */
export async function notifyClientReportReady(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const match = (ctx.req.url ?? '').match(/^\/api\/jobs\/([^/]+)\/notify-client-report-ready\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const body = await readJsonBody<Record<string, unknown>>(ctx.req);
  const clientEmail = typeof body.client_email === 'string' ? body.client_email.trim() : '';
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const finalistCount = typeof body.finalist_count === 'number' ? body.finalist_count : 0;
  const reportUrl = typeof body.report_url === 'string' ? body.report_url : '';

  if (!clientEmail || !clientEmail.includes('@')) {
    throw new ValidationError('client_email required (string con @)');
  }
  if (!clientName) {
    throw new ValidationError('client_name required');
  }

  const { publishOutboxEvent } = await import('./outbox.js');
  await publishOutboxEvent(ctx.req, 'email.send_pending', {
    to: clientEmail,
    template: 'client_report_ready',
    locale: 'es',
    vars: {
      client_name: clientName,
      job_title: job.title,
      finalist_count: String(finalistCount || 'tus'),
      report_url: reportUrl,
    },
  });

  void auditLog(ctx, {
    action: 'client.notify_report_ready',
    resource_type: 'job',
    resource_id: jobId,
    changes: { client_email: clientEmail, finalist_count: finalistCount },
  });

  log.info('client report-ready email enqueued', {
    traceId: ctx.traceId, jobId, clientEmail: clientEmail.slice(0, 3) + '***',
  });

  sendJson(ctx.res, 202, { ok: true, enqueued: true });
}

/**
 * Deserializa el cache de tech_questions de un Job. Soporta tanto contenido inline
 * como referencia a File Store (`file:<id>`). Devuelve null si vacío o no parseable.
 */
export async function parseTechQuestionsCache(
  req: IncomingMessage,
  raw: string | null | undefined,
): Promise<unknown[] | null> {
  if (!raw) return null;
  try {
    const parsed = await loadLargeJson<unknown>(req, raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
