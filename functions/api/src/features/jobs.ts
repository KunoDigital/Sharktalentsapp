import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { assertTenantId } from '../lib/tenantGuard';
import { escapeSql, unwrapRow, unwrapRows, formatCatalystDateTime, bigintInClause } from '../lib/dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from '../lib/dbLimits';
import { loadLargeJson } from '../lib/largeContentStore';
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
  /**
   * Umbrales VELNA por dimensión individual (modelo confirmado por Cris 2026-06-12).
   * Cada dimensión es opcional — si no se setea, no aplica.
   * El draft del puesto define cuáles son críticas para ese rol.
   *
   * Ejemplos del modelo real:
   *   - Contable → numerica crítica con umbral 70
   *   - Vendedor → verbal crítica con umbral 65
   *   - Asistente operativo → ninguna VELNA crítica (no setear)
   *
   * Si el score del candidato en esa dimensión está por debajo del umbral, va a
   * auto-rechazo. Se evalúa además (no en lugar) de la regla legacy
   * `velna_min_indice` para mantener compatibilidad.
   */
  velna_per_dimension?: {
    verbal?: number;
    espacial?: number;
    logica?: number;
    numerica?: number;
    abstracta?: number;
  };
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
  /** Texto corto del rol — qué busca el cliente. Para mostrar al candidato. ≤500 chars. */
  que_busco?: string;
  /** Responsabilidades concretas — bullets de qué hace día a día. ≤6 items, ≤200 chars c/u. */
  que_debe_hacer?: string[];
  /** Requisitos / skills — bullets de qué debe saber. ≤6 items, ≤200 chars c/u. */
  que_debe_saber?: string[];
  /** Rango salarial del candidato. Si min==max, es monto único. Persistido al aprobar el draft. */
  salary_range_usd?: { min: number; max: number };
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
  /**
   * 2026-06-04: precio cobrado al cliente por este puesto (USD).
   * Usado por budgetWatch para calcular el presupuesto (20% del fee).
   * Cris carga manual al crear el puesto. NULL = sin presupuesto definido (no alerta).
   * Requiere columna `fee_usd` (Double) en tabla Jobs en Catalyst.
   */
  fee_usd: number | null;
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
    fee_usd: validateFeeUsd(b.fee_usd),
    created_by: '',
  };
}

/** Valida fee_usd: número >= 0, ≤ 1000000, o null. Rechaza valores inválidos. */
function validateFeeUsd(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    throw new ValidationError('fee_usd debe ser un número entre 0 y 1.000.000');
  }
  return Math.round(n * 100) / 100;
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
  if (ip.que_busco !== undefined) {
    if (typeof ip.que_busco !== 'string') throw new ValidationError('que_busco must be string');
    const trimmed = ip.que_busco.trim();
    if (trimmed) out.que_busco = trimmed.slice(0, 500);
  }
  if (ip.que_debe_hacer !== undefined) {
    if (!Array.isArray(ip.que_debe_hacer)) throw new ValidationError('que_debe_hacer must be array');
    const items = ip.que_debe_hacer
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 200))
      .slice(0, 6);
    if (items.length > 0) out.que_debe_hacer = items;
  }
  if (ip.que_debe_saber !== undefined) {
    if (!Array.isArray(ip.que_debe_saber)) throw new ValidationError('que_debe_saber must be array');
    const items = ip.que_debe_saber
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 200))
      .slice(0, 6);
    if (items.length > 0) out.que_debe_saber = items;
  }
  if (ip.salary_range_usd !== undefined) {
    if (typeof ip.salary_range_usd !== 'object' || ip.salary_range_usd === null) {
      throw new ValidationError('salary_range_usd must be object');
    }
    const sr = ip.salary_range_usd as Record<string, unknown>;
    const min = Number(sr.min);
    const max = Number(sr.max);
    if (!Number.isFinite(min) || min < 0 || min > 1_000_000) throw new ValidationError('salary_range_usd.min invalid');
    if (!Number.isFinite(max) || max < 0 || max > 1_000_000) throw new ValidationError('salary_range_usd.max invalid');
    if (max < min) throw new ValidationError('salary_range_usd.max must be >= min');
    out.salary_range_usd = { min: Math.round(min), max: Math.round(max) };
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
  if (r.velna_per_dimension !== undefined) {
    if (typeof r.velna_per_dimension !== 'object' || r.velna_per_dimension === null) {
      throw new ValidationError('velna_per_dimension must be object');
    }
    const vpd = r.velna_per_dimension as Record<string, unknown>;
    const cleaned: NonNullable<AutoRejectionRules['velna_per_dimension']> = {};
    for (const k of ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const) {
      if (vpd[k] !== undefined) {
        const n = Number(vpd[k]);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw new ValidationError(`velna_per_dimension.${k} must be 0..100`);
        }
        cleaned[k] = Math.round(n);
      }
    }
    if (Object.keys(cleaned).length > 0) out.velna_per_dimension = cleaned;
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
  // E2E / recuperación: permitir copiar tech_questions_cache (referencia File Store) entre Jobs
  // o relinkear recruit_job_id. En uso normal estos campos los gestiona el sync auto.
  if (b.tech_questions_cache !== undefined) {
    (out as Record<string, unknown>).tech_questions_cache = typeof b.tech_questions_cache === 'string' ? b.tech_questions_cache : null;
  }
  if (b.recruit_job_id !== undefined) {
    (out as Record<string, unknown>).recruit_job_id = typeof b.recruit_job_id === 'string' ? b.recruit_job_id : null;
  }
  if (b.company_context !== undefined) {
    out.company_context = typeof b.company_context === 'string' ? b.company_context : null;
  }
  if (b.ideal_profile !== undefined) {
    out.ideal_profile = serializeIdealProfile(b.ideal_profile);
  }
  if (b.fee_usd !== undefined) {
    out.fee_usd = validateFeeUsd(b.fee_usd);
  }
  return out;
}

// ---- DB ----

/**
 * Columnas explícitas para SELECT en Jobs.
 *
 * 2026-06-04: dejamos de usar `SELECT *` para tolerar tablas con columnas recién
 * agregadas que están en estado "transitioning" en Catalyst (ej. `fee_usd` agregada
 * el mismo día). Si Catalyst tiene un cache de schema stale, `SELECT *` falla con
 * 500. Listando columnas explícitas evitamos el problema.
 *
 * `fee_usd` se trae con `COALESCE(fee_usd, NULL)` para que si la columna NO existe
 * en la tabla (env. dev sin migrar), Catalyst no rompa — devuelve null.
 */
const SELECT_COLS = `ROWID, tenant_id, title, company, tech_prompt, cognitive_level, is_active, company_context, ideal_profile, tech_questions_cache, fee_usd, created_by, created_at, updated_at`;

/** Lista de columnas alternativa SIN fee_usd, usada como fallback si la query falla
 * por ese campo (ej. columna no creada todavía). */
const SELECT_COLS_NO_FEE = `ROWID, tenant_id, title, company, tech_prompt, cognitive_level, is_active, company_context, ideal_profile, tech_questions_cache, created_by, created_at, updated_at`;

async function runSelectWithFallback(
  req: IncomingMessage,
  whereAndOrder: string,
): Promise<unknown[]> {
  try {
    return (await zcql(req).executeZCQLQuery(`SELECT ${SELECT_COLS} FROM ${TABLE} ${whereAndOrder}`)) as unknown[];
  } catch (err) {
    const msg = ((err as Error).message ?? '').toLowerCase();
    // Si Catalyst rechaza fee_usd (columna desconocida o cache stale), retry sin ese campo.
    if (msg.includes('fee_usd') || msg.includes('invalid column') || msg.includes('unknown column')) {
      log.warn('Jobs SELECT failed including fee_usd — retrying without it', { error: (err as Error).message });
      const rows = (await zcql(req).executeZCQLQuery(`SELECT ${SELECT_COLS_NO_FEE} FROM ${TABLE} ${whereAndOrder}`)) as unknown[];
      return rows;
    }
    throw err;
  }
}

async function listByTenant(
  req: IncomingMessage,
  tenantId: string,
  opts: { includeInactive?: boolean; lastNDays?: number; limit?: number } = {},
): Promise<Job[]> {
  const includeInactive = opts.includeInactive ?? false;
  const lastNDays = opts.lastNDays ?? 90;
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));

  const filter = includeInactive ? '' : ` AND is_active = true`;
  // 2026-06-04: Catalyst ZCQL ahora rechaza ISO 8601 con sufijo Z y milisegundos
  // ("Invalid input value for CREATEDTIME. datetime value expected"). Formato aceptado:
  // 'YYYY-MM-DD HH:MM:SS' sin T, sin Z, sin ms.
  const dateFilter = lastNDays > 0
    ? ` AND CREATEDTIME >= '${formatCatalystDateTime(new Date(Date.now() - lastNDays * 86400_000))}'`
    : '';
  const whereAndOrder = `WHERE tenant_id = '${escapeSql(tenantId)}'${filter}${dateFilter} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  const result = await runSelectWithFallback(req, whereAndOrder);
  return unwrapRows<Job>(result, TABLE);
}

async function getByIdScoped(req: IncomingMessage, jobId: string, tenantId: string): Promise<Job | null> {
  // 2026-06-04: ROWID es BIGINT — sin quotes (Catalyst rechaza con quotes en algunas
  // builds). Validamos que jobId sea solo dígitos para evitar inyección.
  if (!/^\d+$/.test(jobId)) return null;
  const whereAndOrder = `WHERE ROWID = ${jobId} AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`;
  const result = await runSelectWithFallback(req, whereAndOrder);
  const rows = unwrapRows<Job>(result, TABLE);
  return rows[0] ?? null;
}

async function insertJob(req: IncomingMessage, payload: JobInsert): Promise<Job> {
  assertTenantId((payload as { tenant_id?: unknown }).tenant_id, 'jobs.insertJob.Jobs.insert');
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
 * la columna no existe todavía (migración manual pendiente). Aplica a:
 *   - ideal_profile
 *   - tech_questions_cache
 *   - fee_usd (agregado 2026-06-04 para presupuesto 20%)
 */
function omitIdealIfNull<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  if (out.ideal_profile == null) delete out.ideal_profile;
  if (out.tech_questions_cache == null) delete out.tech_questions_cache;
  if (out.fee_usd == null) delete out.fee_usd;
  return out;
}

// ---- Handlers ----

export async function listJobs(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const includeInactive = url.searchParams.get('include_inactive') === 'true';
  // Default 90 días — para evitar cargar todo el histórico mientras escala.
  // Pasar ?last_n_days=0 para ver todo.
  const lastNDays = Number.parseInt(url.searchParams.get('last_n_days') ?? '90', 10);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
  const jobs = await listByTenant(ctx.req, tenantId, { includeInactive, lastNDays, limit });
  log.info('list', { traceId: ctx.traceId, tenantId, count: jobs.length, lastNDays });
  sendJson(ctx.res, 200, { jobs, filter: { last_n_days: lastNDays, limit } });
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
  const callerTenantId = await requireTenant(ctx);
  try {
    const m = ctx.req.url?.match(/^\/api\/_force_publish_recruit_job\/([^/]+)\/?$/);
    const recruitId = m?.[1];
    if (!recruitId) throw new ValidationError('recruit_id missing');

    // 2026-06-04 (audit fix #11): validar que ese recruit_job_id pertenezca a un Job
    // del tenant del usuario. Sin esto, cualquier tenant podía manipular Job_Openings
    // de otros tenants en la cuenta Zoho compartida.
    const ownerRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Jobs WHERE recruit_job_id = '${escapeSql(recruitId)}' AND tenant_id = '${escapeSql(callerTenantId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    if (!ownerRows[0]) {
      log.warn('forcePublishRecruitJob: cross-tenant attempt blocked', {
        traceId: ctx.traceId, recruitId, callerTenantId,
      });
      sendJson(ctx.res, 404, { error: 'Job not found' });
      return;
    }

    const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
    const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
    const auth = await getZohoAuthHeader(ctx.traceId);
    if (!auth) {
      sendJson(ctx.res, 200, { ok: false, error: 'OAuth not configured' });
      return;
    }
    const T = 10_000; // 10s timeout cada try

    const tries: Array<{ approach: string; payload: Record<string, unknown>; result?: unknown }> = [];

    // Approach 1: PUT con Publish + Keep_on_Career_Site como booleans
    const p1 = { data: [{ Publish: true, Keep_on_Career_Site: true }] };
    tries.push({ approach: 'PUT booleans', payload: p1 });
    const r1 = await fetchWithTimeout(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p1), timeoutMs: T,
    });
    tries[0].result = { status: r1.status, body: (await r1.text()).slice(0, 500) };

    // Approach 2: PUT con string "true"
    const p2 = { data: [{ Publish: 'true', Keep_on_Career_Site: 'true' }] };
    tries.push({ approach: 'PUT strings', payload: p2 });
    const r2 = await fetchWithTimeout(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p2), timeoutMs: T,
    });
    tries[1].result = { status: r2.status, body: (await r2.text()).slice(0, 500) };

    // Approach 3: Action endpoint "publish" (módulo, no per-record)
    tries.push({ approach: 'POST /Job_Openings/actions/publish', payload: {} });
    const r3 = await fetchWithTimeout(`https://recruit.zoho.com/recruit/v2/Job_Openings/actions/publish`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [recruitId] }), timeoutMs: T,
    });
    tries[2].result = { status: r3.status, body: (await r3.text()).slice(0, 500) };

    // Approach 4: v1.1 API legacy publishJobOpenings
    tries.push({ approach: 'GET v1.1 publishJobOpenings', payload: {} });
    const r4 = await fetchWithTimeout(`https://recruit.zoho.com/recruit/private/json/JobOpenings/publishJobOpenings?jobIds=${recruitId}&scope=recruitapi`, {
      method: 'POST', headers: { Authorization: auth }, timeoutMs: T,
    });
    tries[3].result = { status: r4.status, body: (await r4.text()).slice(0, 500) };

    // Approach 5: PUT con `$publish` (algunos módulos usan campos con prefijo $)
    const p5 = { data: [{ $publish: true }] };
    tries.push({ approach: 'PUT $publish', payload: p5 });
    const r5 = await fetchWithTimeout(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(p5), timeoutMs: T,
    });
    tries[4].result = { status: r5.status, body: (await r5.text()).slice(0, 500) };

    // Re-dump después para ver cuál pegó
    const dumpRes = await fetchWithTimeout(`https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`, {
      headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: T,
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
    const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
    const auth = await getZohoAuthHeader(ctx.traceId);
    if (!auth) {
      sendJson(ctx.res, 200, { ok: false, error: 'OAuth not configured' });
      return;
    }
    const url = `https://recruit.zoho.com/recruit/v2/Job_Openings/${encodeURIComponent(recruitId)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: 10_000 });
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
    // Location fields requeridos por Recruit para publicar en career site.
    // Defaults Panamá hasta que SharkTalents capture estos campos en el form.
    const jobLocAny = job as unknown as Record<string, unknown>;
    const city = typeof jobLocAny.city === 'string' ? (jobLocAny.city as string) : 'Ciudad de Panamá';
    const state = typeof jobLocAny.state === 'string' ? (jobLocAny.state as string) : 'Panamá';
    const country = typeof jobLocAny.country === 'string' ? (jobLocAny.country as string) : 'Panama';
    const industry = typeof jobLocAny.industry === 'string' ? (jobLocAny.industry as string) : 'Tecnología';
    // Recruit Remote_Job es BOOLEAN, no string. Mapear 'Yes'/'Si'/'true' → true.
    const remoteJobRaw = jobLocAny.remote_job;
    const remoteJob = remoteJobRaw === true
      || (typeof remoteJobRaw === 'string' && /^(true|yes|si|sí|1)$/i.test(remoteJobRaw));
    const result = await createRecruitJobOpening({
      Job_Opening_Name: job.title,
      Posting_Title: job.title,
      Client_Name: job.company,
      Job_Description: job.company_context ?? undefined,
      Industry: industry,
      Job_Opening_Status: 'In-progress',
      customFields: {
        Publish: true,
        Keep_on_Career_Site: true,
        City: city,
        State: state,
        Country: country,
        Remote_Job: remoteJob,
        Date_Opened: new Date().toISOString().slice(0, 10),
        Zip_Code: '0000',
      },
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

    debug.step = 'fetch recruit_job_slug from Recruit';
    // 2026-06-05: después de crear el Job en Recruit, hacer GET para obtener
    // el slug humano (Job_Opening_Id = ZR_XX_JOB). Lo guardamos junto al bigint
    // para que cuando Recruit dispare un webhook con el slug, SharkTalents matchee.
    let recruitJobSlug: string | null = null;
    try {
      const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
      const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
      const auth = await getZohoAuthHeader(ctx.traceId);
      if (auth) {
        const slugRes = await fetchWithTimeout(
          `https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`,
          { headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: 10_000 },
        );
        const slugData = await slugRes.json().catch(() => null) as { data?: Array<{ Job_Opening_Id?: string }> } | null;
        recruitJobSlug = slugData?.data?.[0]?.Job_Opening_Id ?? null;
      }
    } catch (err) {
      debug.slug_fetch_error = (err as Error).message;
    }
    debug.recruit_job_slug = recruitJobSlug;

    debug.step = 'update SharkTalents Jobs.recruit_job_id + slug';
    try {
      const patch: Record<string, unknown> = {
        ROWID: jobId, recruit_job_id: recruitId, updated_at: now(),
      };
      if (recruitJobSlug) patch.recruit_job_slug = recruitJobSlug;
      await datastore(ctx.req).table('Jobs').updateRow(patch as { ROWID: string });
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
      // NOTA: Link_entrevista NO se sincroniza por ahora (booking en vivo todavía activo).
      // Cuando se migre a videos grabados:
      //   Link_entrevista: `${baseUrl}&phase=videos`,
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

/**
 * Endpoint async: encola la generación de tech questions.
 *
 * Anthropic toma 35-50s para generar 15 preguntas. Si lo hacemos inline, el
 * Catalyst function timeout (60s) y el HTTP gateway pueden cortar antes. La
 * solución: encolar evento y procesarlo en background via outbox cron.
 *
 *   POST /api/jobs/:id/tech-questions/generate
 *   Body opcional: { count?: 5..30 }
 *
 * Respuesta inmediata: 202 { status: 'queued' }
 * El frontend hace polling a GET /api/jobs/:id/tech-questions/status hasta
 * que devuelva status='ready'.
 */
export async function generateJobTechQuestions(ctx: RequestContext): Promise<void> {
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

  // Mark cache como pending para que el GET status devuelva info correcta.
  // Si excede 9_500 chars, queda inline (es chico).
  const pendingMarker = JSON.stringify({ status: 'pending', queued_at: now(), count });
  await datastore(ctx.req).table('Jobs').updateRow({
    ROWID: jobId,
    tech_questions_cache: pendingMarker,
    updated_at: now(),
  });

  // Intenta dispatch inline (corre con su propio request handler 60s).
  // Si falla por timeout, queda en pending y el cron retoma.
  const { publishAndProcessEvent } = await import('./outbox.js');
  void publishAndProcessEvent(ctx.req, 'job.generate_tech_questions', {
    tenant_id: tenantId,
    job_id: jobId,
    count,
    tech_prompt: job.tech_prompt,
    job_title: job.title,
    job_company: job.company,
    cognitive_level: job.cognitive_level,
  });

  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: { tech_questions_queued: true, count },
  });

  log.info('tech questions queued', { traceId: ctx.traceId, jobId, count });

  sendJson(ctx.res, 202, {
    job_id: jobId,
    status: 'queued',
    poll_url: `/api/jobs/${jobId}/tech-questions/status`,
  });
}

/**
 * POST /api/jobs/:id/prescreening-questions/generate
 *
 * Genera las preguntas de prescreening (4-6 calificatorias) vía Anthropic, async.
 * Mismo patrón que tech-questions: marca cache como pending + encola evento +
 * devuelve 202. Frontend pollea el status endpoint.
 */
export async function generateJobPrescreeningQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/prescreening-questions\/generate\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);
  if (!job.tech_prompt || !job.tech_prompt.trim()) {
    throw new ValidationError('tech_prompt vacío — necesitamos contexto del puesto para inferir criterios');
  }

  const jobAny = job as unknown as Record<string, unknown>;
  const salaryRange = (jobAny.salary_range_usd && typeof jobAny.salary_range_usd === 'object')
    ? jobAny.salary_range_usd as { min?: number; max?: number } : undefined;
  const location = typeof jobAny.location === 'string' ? jobAny.location : undefined;

  // Mark cache como pending
  const pendingMarker = JSON.stringify({ status: 'pending', queued_at: now() });
  await datastore(ctx.req).table('Jobs').updateRow({
    ROWID: jobId,
    prescreening_questions_cache: pendingMarker,
    updated_at: now(),
  });

  const { publishAndProcessEvent } = await import('./outbox.js');
  void publishAndProcessEvent(ctx.req, 'job.generate_prescreening_questions', {
    tenant_id: tenantId,
    job_id: jobId,
    tech_prompt: job.tech_prompt,
    job_title: job.title,
    job_company: job.company,
    salary_range: salaryRange,
    location,
  });

  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: { prescreening_queued: true },
  });

  log.info('prescreening questions queued', { traceId: ctx.traceId, jobId });
  sendJson(ctx.res, 202, {
    job_id: jobId,
    status: 'queued',
    poll_url: `/api/jobs/${jobId}/prescreening-questions/status`,
  });
}

/**
 * GET /api/jobs/:id/prescreening-questions/status
 * Mismo schema que tech-questions/status.
 */
export async function getJobPrescreeningQuestionsStatus(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/prescreening-questions\/status\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const jobAny = job as unknown as Record<string, unknown>;
  const cache = typeof jobAny.prescreening_questions_cache === 'string'
    ? jobAny.prescreening_questions_cache : null;
  if (!cache) {
    sendJson(ctx.res, 200, { status: 'none' });
    return;
  }

  // Si el cache es un marker JSON con status, devolvemos ese estado.
  try {
    const parsed = JSON.parse(cache) as { status?: string; queued_at?: string; count?: number; error?: string };
    if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
      // Si es array (cache real) → contar
      sendJson(ctx.res, 200, parsed);
      return;
    }
    if (Array.isArray(parsed)) {
      sendJson(ctx.res, 200, { status: 'ready', count: parsed.length });
      return;
    }
  } catch { /* not JSON */ }

  sendJson(ctx.res, 200, { status: 'none' });
}

/**
 * GET /api/jobs/:id/prescreening-questions — lista las preguntas para que admin las edite.
 * Expone TODOS los fields incluido accepted_indices + rejection_reason + criterion (a diferencia
 * del endpoint público que solo expone text + options).
 */
export async function listJobPrescreeningQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/prescreening-questions\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const jobAny = job as unknown as Record<string, unknown>;
  const cache = typeof jobAny.prescreening_questions_cache === 'string' ? jobAny.prescreening_questions_cache : null;
  if (!cache) {
    sendJson(ctx.res, 200, { questions: [], status: 'none' });
    return;
  }
  try {
    const parsed = JSON.parse(cache);
    if (Array.isArray(parsed)) {
      sendJson(ctx.res, 200, { questions: parsed, status: 'ready' });
      return;
    }
    if (parsed && typeof parsed === 'object' && 'status' in parsed) {
      sendJson(ctx.res, 200, { questions: [], status: parsed.status, error: parsed.error });
      return;
    }
  } catch { /* ignore */ }
  sendJson(ctx.res, 200, { questions: [], status: 'none' });
}

/**
 * PUT /api/jobs/:id/prescreening-questions — reemplaza el array de preguntas (admin edita).
 * Body: { questions: PrescreeningQuestion[] }
 */
export async function updateJobPrescreeningQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/prescreening-questions\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const body = await readJsonBody<{ questions?: unknown }>(ctx.req);
  if (!Array.isArray(body.questions)) throw new ValidationError('questions must be an array');
  if (body.questions.length === 0) throw new ValidationError('al menos 1 pregunta requerida');
  if (body.questions.length > 8) throw new ValidationError('máximo 8 preguntas');

  // Validación mínima de cada pregunta — el frontend ya valida pero protegemos.
  for (const q of body.questions as Array<Record<string, unknown>>) {
    if (typeof q.text !== 'string' || !q.text.trim()) throw new ValidationError('cada pregunta necesita text');
    if (!Array.isArray(q.options) || q.options.length < 2) throw new ValidationError('cada pregunta necesita ≥2 opciones');
    if (!Array.isArray(q.accepted_indices) || q.accepted_indices.length === 0) throw new ValidationError('cada pregunta necesita accepted_indices');
    if (typeof q.rejection_reason !== 'string' || !q.rejection_reason.trim()) throw new ValidationError('cada pregunta necesita rejection_reason');
  }

  await datastore(ctx.req).table('Jobs').updateRow({
    ROWID: jobId,
    prescreening_questions_cache: JSON.stringify(body.questions),
    updated_at: now(),
  });
  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: { prescreening_edited: true, count: body.questions.length },
  });
  sendJson(ctx.res, 200, { ok: true, count: body.questions.length });
}

/**
 * GET /api/jobs/:id/tech-questions — lista las preguntas con TODOS los fields (incluye correct
 * + rationale para admin). Diferente del endpoint público que oculta el correct.
 */
export async function listJobTechQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/tech-questions\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const cache = job.tech_questions_cache;
  if (!cache) {
    sendJson(ctx.res, 200, { questions: [], status: 'none' });
    return;
  }
  // Si el cache es un status marker (pending/failed), devolver el status.
  try {
    const parsed = JSON.parse(cache) as { status?: string; error?: string };
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.status === 'string') {
      sendJson(ctx.res, 200, { questions: [], status: parsed.status, error: parsed.error });
      return;
    }
  } catch { /* fallthrough */ }

  const questions = await parseTechQuestionsCache(ctx.req, cache);
  if (Array.isArray(questions) && questions.length > 0) {
    sendJson(ctx.res, 200, { questions, status: 'ready' });
    return;
  }
  sendJson(ctx.res, 200, { questions: [], status: 'none' });
}

/**
 * PUT /api/jobs/:id/tech-questions — reemplaza el array de tech questions (admin edita).
 */
export async function updateJobTechQuestions(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/tech-questions\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const body = await readJsonBody<{ questions?: unknown }>(ctx.req);
  if (!Array.isArray(body.questions)) throw new ValidationError('questions must be an array');
  if (body.questions.length < 5) throw new ValidationError('mínimo 5 preguntas');
  if (body.questions.length > 30) throw new ValidationError('máximo 30 preguntas');

  for (const q of body.questions as Array<Record<string, unknown>>) {
    if (typeof q.text !== 'string' || !q.text.trim()) throw new ValidationError('cada pregunta necesita text');
    if (!Array.isArray(q.options) || q.options.length !== 4) throw new ValidationError('cada pregunta necesita exactamente 4 opciones');
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) throw new ValidationError('cada pregunta necesita correct entre 0-3');
  }

  const { persistLargeJson } = await import('../lib/largeContentStore.js');
  const serialized = await persistLargeJson(ctx.req, body.questions, 'Jobs.tech_questions_cache');
  await datastore(ctx.req).table('Jobs').updateRow({
    ROWID: jobId,
    tech_questions_cache: serialized,
    updated_at: now(),
  });
  void auditLog(ctx, {
    action: 'job.update',
    resource_type: 'job',
    resource_id: jobId,
    changes: { tech_questions_edited: true, count: body.questions.length },
  });
  sendJson(ctx.res, 200, { ok: true, count: body.questions.length });
}

/**
 * GET /api/jobs/:id/prescreening-stats — estadísticas agregadas del prescreening.
 *
 * Útil para Cris para afinar criterios: si una pregunta está filtrando al 80% de
 * los candidatos, probablemente sea demasiado estricta o esté mal escrita.
 *
 * Devuelve:
 *   - total: cuántos candidatos respondieron prescreening en este puesto
 *   - passed: cuántos pasaron
 *   - failed: cuántos fueron auto-rechazados
 *   - by_question: agrupado por question_id, cuántos fallaron por esa pregunta
 */
export async function getJobPrescreeningStats(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/prescreening-stats\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  // Cargar preguntas para mapear question_id → texto
  const jobAny = job as unknown as Record<string, unknown>;
  const cache = typeof jobAny.prescreening_questions_cache === 'string' ? jobAny.prescreening_questions_cache : null;
  const questionsById: Record<string, { text: string; criterion: string }> = {};
  if (cache) {
    try {
      const parsed = JSON.parse(cache);
      if (Array.isArray(parsed)) {
        for (const q of parsed as Array<{ id: string; text?: string; criterion?: string }>) {
          questionsById[q.id] = {
            text: q.text ?? q.id,
            criterion: q.criterion ?? '',
          };
        }
      }
    } catch { /* ignore */ }
  }

  // Buscar transiciones de prescreening en PipelineTransitions:
  //   - actor='system:prescreening' → fueron evaluadas por prescreening
  //   - reason='prescreening_passed' → pasaron
  //   - reason='prescreening_failed:<qid>' → fallaron por qid
  try {
    const rows = unwrapRows<{ to_stage: string; reason: string | null; result_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT T.to_stage, T.reason, T.result_id
         FROM PipelineTransitions T
         JOIN Results R ON R.ROWID = T.result_id
         WHERE T.actor = 'system:prescreening'
           AND R.assessment_id = '${escapeSql(jobId)}'`,
      )) as unknown[],
      'PipelineTransitions',
    );

    let passed = 0;
    let failed = 0;
    const failsByQuestion: Record<string, number> = {};

    for (const r of rows) {
      if (r.reason === 'prescreening_passed') {
        passed += 1;
      } else if (r.reason?.startsWith('prescreening_failed:')) {
        failed += 1;
        const qid = r.reason.slice('prescreening_failed:'.length);
        failsByQuestion[qid] = (failsByQuestion[qid] ?? 0) + 1;
      }
    }

    const total = passed + failed;
    const byQuestion = Object.entries(failsByQuestion)
      .map(([qid, count]) => ({
        question_id: qid,
        question_text: questionsById[qid]?.text ?? qid,
        criterion: questionsById[qid]?.criterion ?? '',
        fails: count,
        pct_of_total: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.fails - a.fails);

    sendJson(ctx.res, 200, {
      job_id: jobId,
      total,
      passed,
      failed,
      pass_rate_pct: total > 0 ? Math.round((passed / total) * 100) : null,
      by_question: byQuestion,
    });
  } catch (err) {
    log.warn('prescreening stats query failed', { jobId, error: (err as Error).message });
    sendJson(ctx.res, 200, {
      job_id: jobId,
      total: 0,
      passed: 0,
      failed: 0,
      pass_rate_pct: null,
      by_question: [],
      error: 'PipelineTransitions query failed (la tabla puede no existir todavía)',
    });
  }
}

/**
 * GET /api/jobs/:id/funnel-timeline
 *
 * Tendencia temporal del embudo por semana — para ver cómo evoluciona el flujo
 * de aplicaciones / pruebas / finalistas en el tiempo.
 *
 * Query params: weeks_back (default 12, max 52)
 *
 * Devuelve cohortes semanales con counts por etapa.
 */
export async function getJobFunnelTimeline(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/funnel-timeline\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const urlObj = new URL(ctx.req.url ?? '/', 'http://x');
  const weeksBack = Math.max(1, Math.min(52, Number(urlObj.searchParams.get('weeks_back') ?? 12)));
  const cutoff = formatCatalystDateTime(new Date(Date.now() - weeksBack * 7 * 86400_000));

  try {
    type Row = { ROWID: string; created_time: string; pipeline_stage: string };
    // 2026-06-04: assessment_id es BIGINT, sin quotes. Validamos jobId dígitos puros.
    if (!/^\d+$/.test(jobId)) {
      sendJson(ctx.res, 200, { job_id: jobId, weeks: [] });
      return;
    }
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, CREATEDTIME AS created_time, pipeline_stage FROM Results
         WHERE assessment_id = ${jobId}
           AND CREATEDTIME >= '${cutoff}'
         ORDER BY CREATEDTIME ASC LIMIT 300`,
      )) as unknown[],
      'Results',
    );

    // Agrupar por semana ISO (lunes-domingo)
    const FINALIST_STAGES = new Set(['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired']);
    const REJECTED_STAGES = new Set(['rejected_by_admin', 'auto_rejected_low_score', 'offer_declined', 'withdrew']);
    const PASSED_PRESC_STAGES = new Set(['prefilter_passed', 'tecnica_completed', 'conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired']);

    type Bucket = { applied: number; passed_prescreening: number; rejected: number; finalists: number };
    const byWeek: Map<string, Bucket> = new Map();

    function getWeekKey(d: Date): string {
      const day = d.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;  // Lunes = inicio de semana
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - diff);
      return monday.toISOString().slice(0, 10);
    }

    for (const r of rows) {
      const week = getWeekKey(new Date(r.created_time));
      if (!byWeek.has(week)) byWeek.set(week, { applied: 0, passed_prescreening: 0, rejected: 0, finalists: 0 });
      const b = byWeek.get(week)!;
      b.applied += 1;
      if (PASSED_PRESC_STAGES.has(r.pipeline_stage)) b.passed_prescreening += 1;
      if (REJECTED_STAGES.has(r.pipeline_stage)) b.rejected += 1;
      if (FINALIST_STAGES.has(r.pipeline_stage)) b.finalists += 1;
    }

    const weeks = Array.from(byWeek.entries())
      .map(([week_start, b]) => ({ week_start, ...b }))
      .sort((a, b) => a.week_start.localeCompare(b.week_start));

    sendJson(ctx.res, 200, {
      job_id: jobId,
      weeks,
      total_applied: rows.length,
      weeks_back: weeksBack,
    });
  } catch (err) {
    log.debug('funnel timeline query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { job_id: jobId, weeks: [], total_applied: 0, error: 'query_failed' });
  }
}

/**
 * GET /api/jobs/:id/stage-timing
 *
 * Calcula tiempo promedio que los candidatos pasan en cada stage de este job.
 * Útil para detectar bottlenecks: "los candidatos pasan 8 días en prefilter_passed
 * sin hacer la técnica → ¿el link es difícil? ¿es muy larga?".
 *
 * Usa PipelineTransitions ordenadas por result_id + tiempo.
 */
export async function getJobStageTiming(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/stage-timing\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  try {
    type Row = { result_id: string; from_stage: string; to_stage: string; transitioned_at: string };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT T.result_id, T.from_stage, T.to_stage, T.transitioned_at
         FROM PipelineTransitions T
         JOIN Results R ON R.ROWID = T.result_id
         WHERE R.assessment_id = '${escapeSql(jobId)}'
         ORDER BY T.result_id, T.transitioned_at ASC`,
      )) as unknown[],
      'PipelineTransitions',
    );

    // Agrupar por result_id y calcular delta entre transiciones consecutivas
    type StageStats = { count: number; total_hours: number; min_hours: number; max_hours: number };
    const byStage: Record<string, StageStats> = {};

    let lastForResult: { result_id: string; stage: string; at: number } | null = null;
    for (const r of rows) {
      const at = new Date(r.transitioned_at).getTime();
      if (lastForResult !== null && lastForResult.result_id === r.result_id) {
        // Tiempo que pasó en lastForResult.stage antes de transicionar
        const deltaHours = (at - lastForResult.at) / 3600_000;
        if (deltaHours > 0 && deltaHours < 365 * 24) {  // sanity cap 1 año
          const s = lastForResult.stage;
          if (!byStage[s]) byStage[s] = { count: 0, total_hours: 0, min_hours: Infinity, max_hours: 0 };
          byStage[s].count += 1;
          byStage[s].total_hours += deltaHours;
          byStage[s].min_hours = Math.min(byStage[s].min_hours, deltaHours);
          byStage[s].max_hours = Math.max(byStage[s].max_hours, deltaHours);
        }
      }
      lastForResult = { result_id: r.result_id, stage: r.to_stage, at };
    }

    const stages = Object.entries(byStage)
      .map(([stage, s]) => ({
        stage,
        sample_size: s.count,
        avg_hours: Math.round(s.total_hours / s.count * 10) / 10,
        avg_days: Math.round(s.total_hours / s.count / 24 * 10) / 10,
        min_hours: Math.round(s.min_hours * 10) / 10,
        max_hours: Math.round(s.max_hours * 10) / 10,
      }))
      .sort((a, b) => b.avg_hours - a.avg_hours);

    // Identificar bottlenecks: stages con avg > 72h (3+ días) y sample ≥3
    const bottlenecks = stages.filter((s) => s.avg_hours > 72 && s.sample_size >= 3);

    sendJson(ctx.res, 200, {
      job_id: jobId,
      stages,
      bottlenecks: bottlenecks.map((b) => ({
        stage: b.stage,
        avg_days: b.avg_days,
        sample_size: b.sample_size,
      })),
      total_transitions: rows.length,
    });
  } catch (err) {
    log.debug('stage timing query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { job_id: jobId, stages: [], bottlenecks: [], error: 'query_failed' });
  }
}

/**
 * GET /api/jobs/_search?q=X
 * Búsqueda rápida por title o company. Max 20 resultados.
 */
export async function searchJobs(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    sendJson(ctx.res, 200, { jobs: [] });
    return;
  }
  try {
    const safe = escapeSql(q.toLowerCase());
    const query = `
      SELECT ROWID, title, company, is_active
      FROM Jobs
      WHERE tenant_id = '${escapeSql(tenantId)}'
        AND (LOWER(title) LIKE '%${safe}%' OR LOWER(company) LIKE '%${safe}%')
      ORDER BY CREATEDTIME DESC LIMIT 20
    `.replace(/\s+/g, ' ');
    const rows = unwrapRows<{ ROWID: string; title: string; company: string; is_active: boolean }>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      TABLE,
    );
    sendJson(ctx.res, 200, { jobs: rows });
  } catch (err) {
    log.warn('jobs search failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { jobs: [], error: 'search_failed' });
  }
}

/**
 * GET /api/jobs/:id/salary-distribution
 *
 * Agrega salary_expectation de los candidatos que aplicaron a este puesto.
 * Compara contra el rango ofrecido del job (si está seteado) para detectar si
 * la posición está mal compensada.
 *
 * Devuelve: { min, max, avg, median, count, by_range, vs_job_range }
 */
export async function getJobSalaryDistribution(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/salary-distribution\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  // Cargar todos los candidates que aplicaron a este job (vía Results)
  try {
    type Row = { salary_expectation: number | null; pipeline_stage: string };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT C.salary_expectation, R.pipeline_stage
         FROM Results R
         JOIN Candidates C ON C.ROWID = R.candidate_id
         WHERE R.assessment_id = '${escapeSql(jobId)}'`,
      )) as unknown[],
      'Results',
    );

    const expectations = rows
      .map((r) => Number(r.salary_expectation))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (expectations.length === 0) {
      sendJson(ctx.res, 200, {
        count: 0,
        message: 'Ningún candidato registró expectativa salarial todavía.',
      });
      return;
    }

    expectations.sort((a, b) => a - b);
    const min = expectations[0];
    const max = expectations[expectations.length - 1];
    const avg = Math.round(expectations.reduce((s, n) => s + n, 0) / expectations.length);
    const median = expectations[Math.floor(expectations.length / 2)];

    // Job range si está definido
    const jobAny = job as unknown as Record<string, unknown>;
    const jobRange = (jobAny.salary_range_usd && typeof jobAny.salary_range_usd === 'object')
      ? jobAny.salary_range_usd as { min?: number; max?: number } : null;

    let vsJobRange: {
      job_min?: number;
      job_max?: number;
      pct_within_range: number;
      pct_above_max: number;
      warning: string | null;
    } | null = null;
    if (jobRange?.min || jobRange?.max) {
      const jMin = jobRange.min ?? 0;
      const jMax = jobRange.max ?? Number.POSITIVE_INFINITY;
      const within = expectations.filter((e) => e >= jMin && e <= jMax).length;
      const above = expectations.filter((e) => e > jMax).length;
      const pctWithin = Math.round((within / expectations.length) * 100);
      const pctAbove = Math.round((above / expectations.length) * 100);
      let warning: string | null = null;
      if (pctAbove > 60) {
        warning = `${pctAbove}% de los candidatos pide más del max ofrecido. La posición podría estar mal compensada para el perfil que estás atrayendo.`;
      } else if (pctWithin < 30) {
        warning = `Solo ${pctWithin}% de los candidatos cae dentro del rango ofrecido. Revisá el target del puesto.`;
      }
      vsJobRange = {
        job_min: jobRange.min,
        job_max: jobRange.max,
        pct_within_range: pctWithin,
        pct_above_max: pctAbove,
        warning,
      };
    }

    sendJson(ctx.res, 200, {
      count: expectations.length,
      min, max, avg, median,
      vs_job_range: vsJobRange,
    });
  } catch (err) {
    log.debug('salary distribution query failed', { error: (err as Error).message });
    sendJson(ctx.res, 200, { count: 0, error: 'query_failed' });
  }
}

/**
 * GET /api/jobs/_stage-counts — counts agregados por stage de TODOS los jobs activos
 * del tenant. Optimización para mostrar smart filters en JobsList sin hacer N+1 queries.
 *
 * Devuelve: { counts: Record<jobId, { applied, in_tests, finalists, completed }> }
 */
export async function getAllJobsStageCounts(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  type Row = { assessment_id: string; pipeline_stage: string; cnt: number; c: number };
  let rows: Row[] = [];
  try {
    // 2026-06-04: refactor sin JOIN — Catalyst rompió los JOINs entre Jobs y Results.
    // Paso 1: traer Jobs activos del tenant.
    const jobRows = unwrapRows<{ ROWID: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Jobs WHERE tenant_id = '${escapeSql(tenantId)}' AND is_active = true LIMIT 300`,
      )) as unknown[],
      'Jobs',
    );
    if (jobRows.length > 0) {
      // Paso 2: por chunks de jobs, traer Results y agregar cliente-side.
      // 2026-06-04: GROUP BY con COUNT en Catalyst ZCQL tira "Invalid input value for BIGINT
      // column 'ROWID'" — el optimizer falla. Más robusto: traer rows y agregar en JS.
      for (let i = 0; i < jobRows.length; i += 30) {
        const chunk = jobRows.slice(i, i + 30);
        const inClause = bigintInClause(chunk.map((j) => j.ROWID));
        if (!inClause) continue;
        try {
          const chunkRows = unwrapRows<{ assessment_id: string; pipeline_stage: string }>(
            (await zcql(ctx.req).executeZCQLQuery(
              `SELECT assessment_id, pipeline_stage FROM Results WHERE assessment_id IN (${inClause}) LIMIT 300`,
            )) as unknown[],
            'Results',
          );
          // Agregar cliente-side: contar por (assessment_id, pipeline_stage).
          const counts = new Map<string, { assessment_id: string; pipeline_stage: string; n: number }>();
          for (const r of chunkRows) {
            const key = `${r.assessment_id}|${r.pipeline_stage}`;
            const cur = counts.get(key);
            if (cur) cur.n += 1;
            else counts.set(key, { assessment_id: r.assessment_id, pipeline_stage: r.pipeline_stage, n: 1 });
          }
          for (const v of counts.values()) {
            rows.push({ assessment_id: v.assessment_id, pipeline_stage: v.pipeline_stage, cnt: v.n, c: v.n });
          }
        } catch (chunkErr) {
          log.warn('stage counts chunk failed (skipping chunk)', {
            chunkStart: i, error: (chunkErr as Error)?.message ?? String(chunkErr),
          });
        }
      }
    }
  } catch (err) {
    log.warn('stage counts query failed', { error: (err as Error)?.message ?? String(err) });
  }

  const IN_TESTS_STAGES = new Set([
    'prefilter_pending', 'prefilter_passed', 'tecnica_completed', 'conductual_completed',
    'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance',
  ]);
  const FINALIST_STAGES = new Set(['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered']);
  const CLOSED_STAGES = new Set(['hired', 'rejected_by_admin', 'auto_rejected_low_score', 'offer_declined', 'withdrew']);

  const counts: Record<string, { applied: number; in_tests: number; finalists: number; closed: number }> = {};
  for (const r of rows) {
    const cnt = Number(r.cnt ?? r.c ?? 0);
    if (!counts[r.assessment_id]) counts[r.assessment_id] = { applied: 0, in_tests: 0, finalists: 0, closed: 0 };
    counts[r.assessment_id].applied += cnt;
    if (IN_TESTS_STAGES.has(r.pipeline_stage)) counts[r.assessment_id].in_tests += cnt;
    if (FINALIST_STAGES.has(r.pipeline_stage)) counts[r.assessment_id].finalists += cnt;
    if (CLOSED_STAGES.has(r.pipeline_stage)) counts[r.assessment_id].closed += cnt;
  }

  sendJson(ctx.res, 200, { counts });
}

/**
 * GET /api/jobs/:id/costs — resumen de gastos del puesto.
 */
export async function getJobCosts(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/costs\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const { getJobCostSummary } = await import('../lib/costTracking.js');
  const summary = await getJobCostSummary(ctx.req, jobId);
  sendJson(ctx.res, 200, { job_id: jobId, summary });
}

/**
 * GET /api/jobs/:id/budget — snapshot del presupuesto del puesto (20% del fee).
 *
 * Devuelve fee, presupuesto, gastado, % consumido, nivel (ok/warn/crit/no_fee).
 * Si fee_usd no está cargado en el Job, level='no_fee' (frontend muestra "cargar fee").
 */
export async function getJobBudget(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/budget\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const { getBudgetStatus } = await import('../lib/budgetWatch.js');
  const status = await getBudgetStatus(ctx.req, jobId);
  sendJson(ctx.res, 200, status);
}

/**
 * POST /api/jobs/:id/ads-spend — registrar gasto manual de pauta (LinkedIn).
 * Body: { amount_usd: number, note?: string }
 */
export async function addJobAdsSpend(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/ads-spend\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const body = (await readJsonBody(ctx.req)) as { amount_usd?: unknown; note?: unknown };
  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    throw new ValidationError('amount_usd debe ser un número positivo ≤ 10000');
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;

  const { trackJobCost } = await import('../lib/costTracking.js');
  await trackJobCost(ctx.req, {
    jobId,
    tenantId,
    type: 'ads',
    amountUsd: amount,
    count: 1,
    metadata: { source: 'manual', note, added_by: ctx.user?.clerk_user_id },
  });

  sendJson(ctx.res, 200, { ok: true, job_id: jobId, amount_usd: amount });
}

/**
 * Endpoint para chequear el status de generación de tech questions.
 *
 *   GET /api/jobs/:id/tech-questions/status
 *
 * Devuelve:
 *   { status: 'none' }                      — nunca se generó nada
 *   { status: 'pending', queued_at, count } — generación en cola
 *   { status: 'ready', count, generated_at }— preguntas listas
 *   { status: 'failed', error }             — generación falló
 */
export async function getJobTechQuestionsStatus(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/api\/jobs\/([^/]+)\/tech-questions\/status\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const cache = job.tech_questions_cache;
  if (!cache) {
    sendJson(ctx.res, 200, { status: 'none' });
    return;
  }

  // Si el cache es un marker JSON con status, devolvemos ese estado.
  try {
    const parsed = JSON.parse(cache) as { status?: string; queued_at?: string; count?: number; error?: string };
    if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
      sendJson(ctx.res, 200, parsed);
      return;
    }
  } catch { /* not JSON status — fallthrough */ }

  // Sino, asumimos que es el cache real (array de preguntas o file: ref).
  const questions = await parseTechQuestionsCache(ctx.req, cache);
  if (Array.isArray(questions) && questions.length > 0) {
    sendJson(ctx.res, 200, { status: 'ready', count: questions.length });
    return;
  }
  sendJson(ctx.res, 200, { status: 'none' });
}

/**
 * Endpoint manual: notificar al cliente que el reporte de finalistas está listo.
 *
 *   POST /api/jobs/:id/notify-client-report-ready
 *   Body opcional: { client_email?, client_name?, finalist_count?, report_url? }
 *
 * Cris (recruiter) lo dispara desde la UI cuando decide que el reporte está
 * listo para mandar. El email lo procesa el outbox via ZeptoMail.
 *
 * Si el body está vacío, intenta resolver todo desde el Job:
 *  - client_email/client_name desde Jobs
 *  - finalist_count desde COUNT de Results en stage 'finalist'
 *  - report_url auto-firma un report_bundle token apuntando al Job
 */
export async function notifyClientReportReady(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const match = (ctx.req.url ?? '').match(/^\/api\/jobs\/([^/]+)\/notify-client-report-ready\/?$/);
  const jobId = match?.[1];
  if (!jobId) throw new ValidationError('job id missing in path');

  const job = await getByIdScoped(ctx.req, jobId, tenantId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  let body: Record<string, unknown> = {};
  try { body = await readJsonBody<Record<string, unknown>>(ctx.req); } catch { /* allow empty body */ }
  const jobAny = job as unknown as Record<string, unknown>;
  let clientEmail = typeof body.client_email === 'string' ? body.client_email.trim()
    : (typeof jobAny.client_email === 'string' ? (jobAny.client_email as string).trim() : '');
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim()
    : (typeof jobAny.client_name === 'string' ? (jobAny.client_name as string).trim() : 'cliente');
  let finalistCount = typeof body.finalist_count === 'number' ? body.finalist_count : 0;
  let reportUrl = typeof body.report_url === 'string' ? body.report_url : '';

  // Auto-resolver finalist_count desde Results si no vino en body
  if (!finalistCount) {
    try {
      const counts = unwrapRows<{ cnt: number }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT COUNT(ROWID) AS cnt FROM Results WHERE assessment_id = '${escapeSql(jobId)}' AND pipeline_stage = 'finalist'`,
        )) as unknown[],
        'Results',
      );
      finalistCount = Number(counts[0]?.cnt ?? 0);
    } catch { /* ignore — defaults to 0 */ }
  }

  // Auto-firmar report_url si no vino en body
  if (!reportUrl) {
    const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
    const { env } = await import('../lib/env.js');
    const reportToken = signToken({
      kind: 'report_bundle',
      ref: jobId,
      exp: expiresIn(WEEK_SEC),
    });
    reportUrl = `${env().APP_BASE_URL.replace(/\/$/, '')}/r/${reportToken}`;
  }

  if (!clientEmail || !clientEmail.includes('@')) {
    throw new ValidationError('client_email required (no encontrado en body ni en Job)');
  }

  // Procesar inline para que el cliente reciba el email al instante. Si falla,
  // queda pending y el cron retries (no se pierde).
  const { publishAndProcessEvent } = await import('./outbox.js');
  await publishAndProcessEvent(ctx.req, 'email.send_pending', {
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

/**
 * POST /api/admin/backfill-recruit-job-slugs
 *
 * Recorre todos los Jobs con recruit_job_id pero sin recruit_job_slug,
 * llama a Recruit API por cada uno para obtener el slug (Job_Opening_Id),
 * y lo guarda en SharkTalents.
 *
 * Se corre UNA sola vez para Jobs creados antes del 2026-06-05.
 * Para Jobs nuevos, el slug se guarda automático al publicar.
 *
 * Auth: admin (X-Internal-Key) — manejar con cuidado.
 */
export async function backfillRecruitJobSlugs(ctx: RequestContext): Promise<void> {
  const { requireInternalKey } = await import('../lib/internalAuth.js');
  requireInternalKey(ctx);

  const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
  const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
  const auth = await getZohoAuthHeader(ctx.traceId);
  if (!auth) {
    sendJson(ctx.res, 200, { ok: false, error: 'Zoho OAuth not configured' });
    return;
  }

  // Traer Jobs que tienen bigint pero no slug. Catalyst ZCQL no soporta IS NULL OR = '' bien,
  // así que filtramos cliente-side.
  let candidates: Array<{ ROWID: string; title: string; recruit_job_id: string; recruit_job_slug: string | null }> = [];
  try {
    candidates = unwrapRows<{ ROWID: string; title: string; recruit_job_id: string; recruit_job_slug: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, recruit_job_id, recruit_job_slug FROM Jobs LIMIT 300`,
      )) as unknown[],
      'Jobs',
    );
  } catch (err) {
    sendJson(ctx.res, 200, { ok: false, error: `query failed: ${(err as Error).message}` });
    return;
  }
  const needsBackfill = candidates.filter((j) => j.recruit_job_id && (!j.recruit_job_slug || j.recruit_job_slug === ''));

  const results: Array<{ job_id: string; title: string; recruit_job_id: string; slug?: string; error?: string }> = [];
  for (const job of needsBackfill) {
    try {
      const res = await fetchWithTimeout(
        `https://recruit.zoho.com/recruit/v2/Job_Openings/${encodeURIComponent(job.recruit_job_id)}`,
        { headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: 10_000 },
      );
      if (!res.ok) {
        results.push({ job_id: job.ROWID, title: job.title, recruit_job_id: job.recruit_job_id, error: `Recruit GET status ${res.status}` });
        continue;
      }
      const data = await res.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null;
      const row = data?.data?.[0];
      // Recruit puede devolver el slug en varios nombres según versión API.
      const slug = (row?.Job_Opening_ID
        ?? row?.Job_Opening_Id
        ?? row?.Job_Opening_Code
        ?? row?.Job_Opening_id) as string | undefined;
      if (!slug) {
        // Devolvemos las keys disponibles para diagnosticar de una.
        const availableKeys = row ? Object.keys(row).filter((k) => /opening|job|id|code|name/i.test(k)).slice(0, 20) : [];
        const sample: Record<string, unknown> = {};
        for (const k of availableKeys) sample[k] = row?.[k];
        results.push({ job_id: job.ROWID, title: job.title, recruit_job_id: job.recruit_job_id, error: 'no slug field in response', sample } as never);
        continue;
      }
      await datastore(ctx.req).table('Jobs').updateRow({
        ROWID: job.ROWID, recruit_job_slug: slug, updated_at: now(),
      });
      results.push({ job_id: job.ROWID, title: job.title, recruit_job_id: job.recruit_job_id, slug });
    } catch (err) {
      results.push({ job_id: job.ROWID, title: job.title, recruit_job_id: job.recruit_job_id, error: (err as Error).message });
    }
  }

  const okCount = results.filter((r) => r.slug && !r.error).length;
  sendJson(ctx.res, 200, {
    ok: true,
    total_candidates: candidates.length,
    needs_backfill: needsBackfill.length,
    succeeded: okCount,
    failed: results.length - okCount,
    results,
  });
}
