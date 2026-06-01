/**
 * Reportes públicos (cliente externo). Sin Clerk auth — token firmado en URL.
 *
 *   GET  /report/:token  → JSON con resumen del reporte
 *
 * Token claims: { kind: 'report', ref: <result_id>, exp }
 *
 * El reporte agrega: Result + Job + Candidate + scores (DISC, VELNA, integrity, técnica).
 * Sin información sensible que el candidato no haya consentido (email se redacta).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { verifyToken, TokenError } from '../lib/urlSigning';

const log = logger('PUBLIC_REPORT');

function extractTokenFromPath(url: string): string | null {
  const match = url.match(/^\/report\/([^/?]+)/);
  return match?.[1] ?? null;
}

export async function getPublicReport(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'report');
  } catch (err) {
    if (err instanceof TokenError) {
      throw new UnauthorizedError(`Token: ${err.reason}`);
    }
    throw err;
  }

  const resultId = claims.ref;

  // Result + Scores (consolidada)
  const [result, scores] = await Promise.all([
    fetchOne(ctx, 'Results', `ROWID = '${escapeSql(resultId)}'`),
    fetchOne(ctx, 'Scores', `result_id = '${escapeSql(resultId)}'`),
  ]);

  if (!result) throw new NotFoundError('Report not found');

  const [jobRow, candidateRow, dims] = await Promise.all([
    fetchOne(ctx, 'Jobs', `ROWID = '${escapeSql(String(result.assessment_id))}'`),
    fetchOne(ctx, 'Candidates', `ROWID = '${escapeSql(String(result.candidate_id))}'`),
    fetchAll(ctx, 'IntegrityDimensions', `result_id = '${escapeSql(resultId)}' ORDER BY dimension`),
  ]);

  log.info('public report served', { traceId: ctx.traceId, resultId });

  sendJson(ctx.res, 200, {
    report: {
      generated_at: new Date().toISOString(),
      job: jobRow ? {
        title: jobRow.title,
        company: jobRow.company,
        cognitive_level: jobRow.cognitive_level,
      } : null,
      candidate: candidateRow ? {
        name: candidateRow.name,
        email: redactEmail(String(candidateRow.email ?? '')),
        age: candidateRow.age,
      } : null,
      pipeline_stage: result.pipeline_stage,
      scores,
      integrity_dimensions: dims,
    },
  });
}

function redactEmail(email: string): string {
  if (!email.includes('@')) return '<redacted>';
  const [local, domain] = email.split('@');
  const masked = local.length > 2 ? `${local[0]}***${local.slice(-1)}` : '***';
  return `${masked}@${domain}`;
}

async function fetchOne(
  ctx: RequestContext,
  table: string,
  whereOrWhereOrder: string,
): Promise<Record<string, unknown> | null> {
  const q = `SELECT * FROM ${table} WHERE ${whereOrWhereOrder} LIMIT 1`;
  const rows = unwrapRows<Record<string, unknown>>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], table);
  return rows[0] ?? null;
}

async function fetchAll(
  ctx: RequestContext,
  table: string,
  whereOrWhereOrder: string,
): Promise<Record<string, unknown>[]> {
  const q = `SELECT * FROM ${table} WHERE ${whereOrWhereOrder}`;
  return unwrapRows<Record<string, unknown>>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], table);
}
