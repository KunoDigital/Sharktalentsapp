/**
 * Scores: persiste resultados de DISC, VELNA, Emotional y Technical en una sola tabla.
 *
 * Tabla `Scores` consolida los 4 bloques de scoring + header de integridad.
 * IntegrityDimensions queda separada (15 rows por candidato — ver features/integrity.ts).
 *
 * Diseño: 1 row por result_id (1:1). Los bloques que aún no se completaron
 * tienen NULL/0 en sus columnas + null en `<bloque>_completed_at`.
 *
 * Endpoints:
 *   POST /api/applications/:id/scores  — escribe uno o varios bloques (upsert)
 *   GET  /api/applications/:id/scores  — lee la row + IntegrityDimensions
 */

import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import {
  normalizeDiscRaw,
  discDominantAxis,
  velnaAggregate,
  calculateTechnicalScore,
  type DiscRawScores,
  type VelnaSubtestPct,
} from '../lib/scoring';

const log = logger('SCORES');
const T_SCORES = 'Scores';
const T_INT_DIM = 'IntegrityDimensions';
const T_JOBS = 'Jobs';

// ---- Types ----

export type ScoresRow = {
  ROWID: string;
  result_id: string;
  // DISC
  disc_raw_d?: number;
  disc_raw_i?: number;
  disc_raw_s?: number;
  disc_raw_c?: number;
  disc_norm_d?: number;
  disc_norm_i?: number;
  disc_norm_s?: number;
  disc_norm_c?: number;
  disc_perfil_dominante?: string;
  disc_pk_id?: string;
  disc_completed_at?: string;
  // VELNA
  velna_verbal?: number;
  velna_espacial?: number;
  velna_logica?: number;
  velna_numerica?: number;
  velna_abstracta?: number;
  velna_total?: number;
  velna_max?: number;
  velna_indice?: number;
  velna_completed_at?: string;
  // Emotional
  emo_score?: number;
  emo_perfil?: 'espontaneo' | 'mesura' | 'reflexivo';
  emo_completed_at?: string;
  // Technical
  tec_score_pct?: number;
  tec_total_correct?: number;
  tec_total_questions?: number;
  tec_passed?: boolean;
  tec_completed_at?: string;
  // Technical doble eje (doc 19)
  tec_situational_validity_pct?: number;
  tec_style_autonomy_consult?: number; // 0-100 (entero, *100 del valor 0-1)
  tec_style_match_with_boss_pct?: number;
  // Integrity header
  int_overall?: 'bajo' | 'medio' | 'alto';
  int_overall_pct?: number;
  int_recomendacion?: string;
  int_buena_impresion?: 'bajo' | 'medio' | 'alto';
  int_buena_impresion_pct?: number;
  int_completed_at?: string;
};

type IntegrityDimensionRow = {
  ROWID: string;
  result_id: string;
  dimension: string;
  nivel: 'bajo' | 'medio' | 'alto';
  pct: number;
};

// ---- Tenant guards ----

async function getResultTenantId(req: IncomingMessage, resultId: string): Promise<string | null> {
  const query = `
    SELECT J.tenant_id AS tenant_id
    FROM Results R
    JOIN Jobs J ON J.ROWID = R.assessment_id
    WHERE R.ROWID = '${escapeSql(resultId)}'
    LIMIT 1
  `.replace(/\s+/g, ' ');
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  type Pick = { tenant_id: string };
  return unwrapRows<Pick>(result, T_JOBS)[0]?.tenant_id ?? null;
}

// ---- Validation ----

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseDiscPayload(raw: unknown): { raw: DiscRawScores; total_questions: number; pk_id: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.raw_d == null && r.d == null) return null;
  return {
    raw: {
      d: num(r.raw_d ?? r.d),
      i: num(r.raw_i ?? r.i),
      s: num(r.raw_s ?? r.s),
      c: num(r.raw_c ?? r.c),
    },
    total_questions: num(r.total_questions, 24),
    pk_id: typeof r.pk_id === 'string' ? r.pk_id : null,
  };
}

function parseCognitivePayload(raw: unknown): VelnaSubtestPct | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    verbal: num(r.verbal),
    espacial: num(r.espacial),
    logica: num(r.logica),
    numerica: num(r.numerica),
    abstracta: num(r.abstracta),
  };
}

function parseEmotionalPayload(raw: unknown): { score: number; perfil: 'espontaneo' | 'mesura' | 'reflexivo' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const score = num(r.score);
  let perfil: 'espontaneo' | 'mesura' | 'reflexivo' = 'mesura';
  if (score < 35) perfil = 'espontaneo';
  else if (score >= 70) perfil = 'reflexivo';
  return { score, perfil };
}

function parseTechnicalPayload(raw: unknown): { total_correct: number; total_questions: number; min_required: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const total_questions = num(r.total_questions);
  if (total_questions <= 0) return null;
  return {
    total_correct: Math.max(0, Math.min(num(r.total_correct), total_questions)),
    total_questions,
    min_required: num(r.min_required, 60),
  };
}

// ---- DB ops ----

async function getScoresRow(req: IncomingMessage, resultId: string): Promise<ScoresRow | null> {
  const query = `SELECT * FROM ${T_SCORES} WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<ScoresRow>(result, T_SCORES)[0] ?? null;
}

async function listIntegrityDims(req: IncomingMessage, resultId: string): Promise<IntegrityDimensionRow[]> {
  const query = `SELECT * FROM ${T_INT_DIM} WHERE result_id = '${escapeSql(resultId)}' ORDER BY dimension ASC`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<IntegrityDimensionRow>(result, T_INT_DIM);
}

/**
 * Upsert atómico: lee, decide, escribe. Si dos requests concurrentes corren al mismo tiempo,
 * uno de los dos inserts choca con UNIQUE(result_id) y el catch reintenta como update.
 *
 * El UNIQUE constraint en `result_id` (ver MIGRATIONS_BLOCK1.csv) garantiza que solo
 * una row por result_id sobrevive. Con este try/catch ambos requests terminan exitosos.
 */
async function upsertScoresRow(
  req: IncomingMessage,
  resultId: string,
  patch: Partial<ScoresRow>,
): Promise<ScoresRow> {
  const existing = await getScoresRow(req, resultId);
  if (existing) {
    const updated = await datastore(req).table(T_SCORES).updateRow({
      ROWID: existing.ROWID,
      ...patch,
    });
    return unwrapRow<ScoresRow>(updated, T_SCORES) as ScoresRow;
  }
  try {
    const inserted = await datastore(req).table(T_SCORES).insertRow({
      result_id: resultId,
      ...patch,
    });
    return unwrapRow<ScoresRow>(inserted, T_SCORES) as ScoresRow;
  } catch (err) {
    // Race condition: otra request insertó al mismo tiempo. Re-leer + update.
    log.warn('Scores upsert race detected, retrying as update', {
      resultId,
      error: (err as Error).message,
    });
    const concurrent = await getScoresRow(req, resultId);
    if (!concurrent) throw err;
    const updated = await datastore(req).table(T_SCORES).updateRow({
      ROWID: concurrent.ROWID,
      ...patch,
    });
    return unwrapRow<ScoresRow>(updated, T_SCORES) as ScoresRow;
  }
}

// ---- Handlers ----

export async function writeScores(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const resultId = extractResultIdFromScoresPath(ctx.req.url ?? '/');
  if (!resultId) throw new ValidationError('result_id missing in path');

  const ownerTenant = await getResultTenantId(ctx.req, resultId);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Result ${resultId} not found`);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const patch: Partial<ScoresRow> = {};
  const blocksWritten: string[] = [];

  // ---- DISC ----
  const discPayload = parseDiscPayload(body.disc);
  if (discPayload) {
    const normalized = normalizeDiscRaw(discPayload.raw, discPayload.total_questions);
    const dominant = discDominantAxis(normalized);
    Object.assign(patch, {
      disc_raw_d: discPayload.raw.d,
      disc_raw_i: discPayload.raw.i,
      disc_raw_s: discPayload.raw.s,
      disc_raw_c: discPayload.raw.c,
      disc_norm_d: normalized.d,
      disc_norm_i: normalized.i,
      disc_norm_s: normalized.s,
      disc_norm_c: normalized.c,
      disc_perfil_dominante: dominant,
      disc_pk_id: discPayload.pk_id,
      disc_completed_at: now(),
    });
    blocksWritten.push('disc');
  }

  // ---- VELNA / Cognitive ----
  const cognitivePayload = parseCognitivePayload(body.cognitive);
  if (cognitivePayload) {
    const aggregate = velnaAggregate(cognitivePayload);
    const total = num((body.cognitive as Record<string, unknown>).total, 0);
    const max = num((body.cognitive as Record<string, unknown>).max, 0);
    Object.assign(patch, {
      velna_verbal: cognitivePayload.verbal,
      velna_espacial: cognitivePayload.espacial,
      velna_logica: cognitivePayload.logica,
      velna_numerica: cognitivePayload.numerica,
      velna_abstracta: cognitivePayload.abstracta,
      velna_total: total,
      velna_max: max,
      velna_indice: aggregate,
      velna_completed_at: now(),
    });
    blocksWritten.push('velna');
  }

  // ---- Emotional ----
  const emotionalPayload = parseEmotionalPayload(body.emotional);
  if (emotionalPayload) {
    Object.assign(patch, {
      emo_score: emotionalPayload.score,
      emo_perfil: emotionalPayload.perfil,
      emo_completed_at: now(),
    });
    blocksWritten.push('emotional');
  }

  // ---- Technical ----
  const technicalPayload = parseTechnicalPayload(body.technical);
  if (technicalPayload) {
    const calc = calculateTechnicalScore(
      technicalPayload.total_correct,
      technicalPayload.total_questions,
      technicalPayload.min_required,
    );
    Object.assign(patch, {
      tec_score_pct: calc.score_pct,
      tec_total_correct: technicalPayload.total_correct,
      tec_total_questions: technicalPayload.total_questions,
      tec_passed: calc.passed,
      tec_completed_at: now(),
    });
    blocksWritten.push('technical');
  }

  if (blocksWritten.length === 0) {
    throw new ValidationError('No score payloads provided. Expected at least one of: disc, cognitive, emotional, technical.');
  }

  const row = await upsertScoresRow(ctx.req, resultId, patch);

  log.info('scores written', { traceId: ctx.traceId, resultId, blocks: blocksWritten });
  sendJson(ctx.res, 201, { result_id: resultId, scores: row, blocks_written: blocksWritten });
}

export async function readScores(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const resultId = extractResultIdFromScoresPath(ctx.req.url ?? '/');
  if (!resultId) throw new ValidationError('result_id missing in path');

  const ownerTenant = await getResultTenantId(ctx.req, resultId);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Result ${resultId} not found`);

  const [row, dims] = await Promise.all([
    getScoresRow(ctx.req, resultId),
    listIntegrityDims(ctx.req, resultId),
  ]);

  sendJson(ctx.res, 200, {
    result_id: resultId,
    scores: row,
    integrity_dimensions: dims,
  });
}

function extractResultIdFromScoresPath(url: string): string | null {
  const match = url.match(/^\/api\/applications\/([^/]+)\/scores/);
  return match?.[1] ?? null;
}
