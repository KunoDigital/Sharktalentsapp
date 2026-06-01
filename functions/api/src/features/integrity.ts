/**
 * Integrity test: persiste header en `Scores` (campos int_*) + dimensiones en IntegrityDimensions (15 rows).
 *
 *   POST /api/applications/:id/integrity
 *   GET  /api/applications/:id/integrity
 */

import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { classifyIntegrityPct, type IntegrityClassification } from '../lib/scoring';

const log = logger('INTEGRITY');
const T_SCORES = 'Scores';
const T_INT_DIM = 'IntegrityDimensions';
const T_JOBS = 'Jobs';

type ScoresRow = {
  ROWID: string;
  result_id: string;
  int_overall?: IntegrityClassification;
  int_overall_pct?: number;
  int_recomendacion?: string;
  int_buena_impresion?: IntegrityClassification;
  int_buena_impresion_pct?: number;
  int_completed_at?: string;
};

type IntegrityDimensionRow = {
  ROWID: string;
  result_id: string;
  dimension: string;
  nivel: IntegrityClassification;
  pct: number;
};

/**
 * 13 dimensiones del v2 (sin etica_profesional ni personalidad — esas eran "mezcla"
 * en el v1 viejo y se redistribuyeron en otras más específicas).
 */
const VALID_DIMENSIONS = new Set([
  'autenticidad', 'inteligencia_social', 'imparcialidad', 'sencillez',
  'dominio_personal', 'honestidad', 'hurto', 'soborno', 'alcohol',
  'drogas', 'confiabilidad', 'apuestas', 'buena_impresion',
]);

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

async function getScoresRow(req: IncomingMessage, resultId: string): Promise<ScoresRow | null> {
  const query = `SELECT * FROM ${T_SCORES} WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<ScoresRow>(result, T_SCORES)[0] ?? null;
}

async function listDims(req: IncomingMessage, resultId: string): Promise<IntegrityDimensionRow[]> {
  const query = `SELECT * FROM ${T_INT_DIM} WHERE result_id = '${escapeSql(resultId)}' ORDER BY dimension ASC`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<IntegrityDimensionRow>(result, T_INT_DIM);
}

function computeOverall(dims: Array<{ dimension: string; pct: number }>): { pct: number; classification: IntegrityClassification } {
  const relevantDims = dims.filter((d) => d.dimension !== 'buena_impresion');
  const avg = relevantDims.length === 0
    ? 0
    : Math.round(relevantDims.reduce((s, d) => s + d.pct, 0) / relevantDims.length);
  return { pct: avg, classification: classifyIntegrityPct(avg) };
}

export async function writeIntegrity(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const resultId = extractResultIdFromIntegrityPath(ctx.req.url ?? '/');
  if (!resultId) throw new ValidationError('result_id missing in path');

  const ownerTenant = await getResultTenantId(ctx.req, resultId);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Result ${resultId} not found`);

  const existing = await getScoresRow(ctx.req, resultId);
  if (existing?.int_completed_at) {
    throw new ConflictError(`Integrity scores already written for result ${resultId}`);
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const rawDims = Array.isArray(body.dimensions) ? body.dimensions : [];
  if (rawDims.length === 0) throw new ValidationError('dimensions[] is required');

  type ParsedDim = { dimension: string; pct: number };
  const parsed: ParsedDim[] = [];
  for (const raw of rawDims) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const dim = typeof r.dimension === 'string' ? r.dimension : '';
    if (!VALID_DIMENSIONS.has(dim)) {
      throw new ValidationError(`Invalid dimension "${dim}". Valid: ${Array.from(VALID_DIMENSIONS).join(', ')}`);
    }
    const pct = typeof r.pct === 'number' && Number.isFinite(r.pct) ? Math.max(0, Math.min(100, Math.round(r.pct))) : 0;
    parsed.push({ dimension: dim, pct });
  }

  const overall = computeOverall(parsed);
  const buenaImpresion = parsed.find((d) => d.dimension === 'buena_impresion');
  const biPct = buenaImpresion?.pct ?? 0;
  const biClass = classifyIntegrityPct(biPct);
  const recomendacion = typeof body.recomendacion === 'string' ? body.recomendacion.slice(0, 100) : undefined;

  // Upsert header en Scores
  const headerPatch = {
    int_overall: overall.classification,
    int_overall_pct: overall.pct,
    int_recomendacion: recomendacion ?? null,
    int_buena_impresion: biClass,
    int_buena_impresion_pct: biPct,
    int_completed_at: now(),
  };

  let header: ScoresRow;
  if (existing) {
    const updated = await datastore(ctx.req).table(T_SCORES).updateRow({
      ROWID: existing.ROWID,
      ...headerPatch,
    });
    header = unwrapRow<ScoresRow>(updated, T_SCORES) as ScoresRow;
  } else {
    const inserted = await datastore(ctx.req).table(T_SCORES).insertRow({
      result_id: resultId,
      ...headerPatch,
    });
    header = unwrapRow<ScoresRow>(inserted, T_SCORES) as ScoresRow;
  }

  // Insert 15 dimensiones en paralelo
  const insertedDims = await Promise.all(
    parsed.map((d) =>
      datastore(ctx.req).table(T_INT_DIM).insertRow({
        result_id: resultId,
        dimension: d.dimension,
        nivel: classifyIntegrityPct(d.pct),
        pct: d.pct,
      }),
    ),
  );
  const dims = insertedDims
    .map((row) => unwrapRow<IntegrityDimensionRow>(row, T_INT_DIM))
    .filter((r): r is IntegrityDimensionRow => r !== null);

  log.info('integrity written', {
    traceId: ctx.traceId, resultId, overall: overall.classification, dimsCount: dims.length,
  });
  sendJson(ctx.res, 201, {
    integrity: {
      header,
      dimensions: dims,
    },
  });
}

export async function readIntegrity(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  const resultId = extractResultIdFromIntegrityPath(ctx.req.url ?? '/');
  if (!resultId) throw new ValidationError('result_id missing in path');

  const ownerTenant = await getResultTenantId(ctx.req, resultId);
  if (ownerTenant !== tenantId) throw new NotFoundError(`Result ${resultId} not found`);

  const [header, dims] = await Promise.all([
    getScoresRow(ctx.req, resultId),
    listDims(ctx.req, resultId),
  ]);

  if (!header || !header.int_completed_at) {
    throw new NotFoundError(`No integrity scores for result ${resultId}`);
  }
  sendJson(ctx.res, 200, { integrity: { header, dimensions: dims } });
}

function extractResultIdFromIntegrityPath(url: string): string | null {
  const match = url.match(/^\/api\/applications\/([^/]+)\/integrity/);
  return match?.[1] ?? null;
}
