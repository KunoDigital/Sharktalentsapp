/**
 * GDPR / compliance endpoints.
 *
 * Acceso: solo admin (X-Internal-Key).
 *
 * - GET  /admin/gdpr/candidate-export?email=...  — exporta TODOS los datos del candidato
 * - POST /admin/gdpr/candidate-delete            — borra TODOS los datos del candidato
 *
 * El "derecho al olvido" GDPR exige eliminar:
 * - Datos personales del candidato
 * - Sus respuestas (Results)
 * - Sus scores (Scores, IntegrityDimensions)
 * - Sus transitions (PipelineTransitions)
 *
 * NO se borran: AuditLog (queda como rastro de la operación de borrado),
 * Tenants/Jobs (no contienen PII del candidato).
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireInternalKey } from '../lib/internalAuth';
import { auditLog } from '../lib/auditLog';

const log = logger('GDPR');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /admin/gdpr/candidate-export?email=foo@bar.com
 * Devuelve un JSON con TODOS los datos del candidato.
 */
export async function exportCandidateData(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email || !EMAIL_RE.test(email)) {
    throw new ValidationError('email query param required (valid format)');
  }

  // 1) Candidato base
  const candidates = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  );
  const candidate = candidates[0];
  if (!candidate) throw new NotFoundError(`No candidate with email ${email}`);
  const candidateId = String(candidate.ROWID);

  // 2) Sus Results (aplicaciones).
  // 2026-06-04 (audit fix #27): LIMIT 100 — un candidato puede tener N aplicaciones,
  // pero >100 es un caso de uso degenerado. Si pasa, devolvemos 100 y un warning para
  // que Cris haga el resto manual. Reportable a través del campo `truncated`.
  const RESULTS_LIMIT = 100;
  const results = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT * FROM Results WHERE candidate_id = '${escapeSql(candidateId)}' LIMIT ${RESULTS_LIMIT}`,
    )) as unknown[],
    'Results',
  );

  // 3) Para cada Result, traer scores + transitions + integrity dims.
  // audit fix #27: chunks de 5 con concurrencia controlada (en lugar de Promise.all
  // sobre todos). Catalyst tiene contention en queries paralelas a misma tabla.
  const CHUNK_SIZE = 5;
  const enriched: Array<Record<string, unknown>> = [];
  for (let i = 0; i < results.length; i += CHUNK_SIZE) {
    const chunk = results.slice(i, i + CHUNK_SIZE);
    const chunkEnriched = await Promise.all(chunk.map(async (r) => {
      const resultId = String(r.ROWID);
      const [scores, transitions, dims] = await Promise.all([
        zcql(ctx.req).executeZCQLQuery(`SELECT * FROM Scores WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`),
        zcql(ctx.req).executeZCQLQuery(`SELECT * FROM PipelineTransitions WHERE result_id = '${escapeSql(resultId)}' LIMIT 50`),
        zcql(ctx.req).executeZCQLQuery(`SELECT * FROM IntegrityDimensions WHERE result_id = '${escapeSql(resultId)}' LIMIT 50`),
      ]);
      return {
        result: r,
        scores: unwrapRows<Record<string, unknown>>(scores as unknown[], 'Scores')[0] ?? null,
        transitions: unwrapRows<Record<string, unknown>>(transitions as unknown[], 'PipelineTransitions'),
        integrity_dimensions: unwrapRows<Record<string, unknown>>(dims as unknown[], 'IntegrityDimensions'),
      };
    }));
    enriched.push(...chunkEnriched);
  }

  log.info('GDPR export', { traceId: ctx.traceId, candidate_id: candidateId, results_count: results.length });
  void auditLog(ctx, {
    action: 'candidate.update', // el master plan no tiene action específico para export, usamos update
    resource_type: 'candidate',
    resource_id: candidateId,
    changes: { gdpr_action: 'export', email_fragment: email.slice(0, 4) + '...' },
  });

  sendJson(ctx.res, 200, {
    exported_at: new Date().toISOString(),
    candidate,
    applications: enriched,
    truncated: results.length === RESULTS_LIMIT,
  });
}

/**
 * POST /admin/gdpr/candidate-delete
 * Body: { email: string, confirm: 'YES_DELETE_ALL' }
 *
 * Borra todos los datos del candidato. AuditLog persiste como rastro.
 */
export async function deleteCandidateData(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RE.test(email)) {
    throw new ValidationError('email required (valid format)');
  }
  if (body.confirm !== 'YES_DELETE_ALL') {
    throw new ValidationError('confirm field must be "YES_DELETE_ALL" — safety check');
  }

  // 1) Encontrar al candidato
  const candidates = unwrapRows<Record<string, unknown>>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  );
  const candidate = candidates[0];
  if (!candidate) throw new NotFoundError(`No candidate with email ${email}`);
  const candidateId = String(candidate.ROWID);

  // 2) Encontrar sus Results
  const results = unwrapRows<{ ROWID: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID FROM Results WHERE candidate_id = '${escapeSql(candidateId)}'`,
    )) as unknown[],
    'Results',
  );
  const resultIds = results.map((r) => String(r.ROWID));

  // 3) Borrar (orden importante: hijos primero, padre último)
  let deletedScores = 0;
  let deletedDims = 0;
  let deletedTransitions = 0;
  let deletedResults = 0;

  for (const rid of resultIds) {
    // Scores
    try {
      const scores = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM Scores WHERE result_id = '${escapeSql(rid)}'`,
        )) as unknown[],
        'Scores',
      );
      for (const s of scores) {
        await datastore(ctx.req).table('Scores').deleteRow(s.ROWID);
        deletedScores++;
      }
    } catch (err) {
      log.warn('failed deleting Scores', { resultId: rid, error: (err as Error).message });
    }

    // IntegrityDimensions
    try {
      const dims = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM IntegrityDimensions WHERE result_id = '${escapeSql(rid)}'`,
        )) as unknown[],
        'IntegrityDimensions',
      );
      for (const d of dims) {
        await datastore(ctx.req).table('IntegrityDimensions').deleteRow(d.ROWID);
        deletedDims++;
      }
    } catch (err) {
      log.warn('failed deleting dims', { resultId: rid, error: (err as Error).message });
    }

    // PipelineTransitions
    try {
      const transitions = unwrapRows<{ ROWID: string }>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID FROM PipelineTransitions WHERE result_id = '${escapeSql(rid)}'`,
        )) as unknown[],
        'PipelineTransitions',
      );
      for (const t of transitions) {
        await datastore(ctx.req).table('PipelineTransitions').deleteRow(t.ROWID);
        deletedTransitions++;
      }
    } catch (err) {
      log.warn('failed deleting transitions', { resultId: rid, error: (err as Error).message });
    }

    // Result
    try {
      await datastore(ctx.req).table('Results').deleteRow(rid);
      deletedResults++;
    } catch (err) {
      log.warn('failed deleting Result', { resultId: rid, error: (err as Error).message });
    }
  }

  // 4) Borrar al candidato (último, después de hijos)
  let deletedCandidate = false;
  try {
    await datastore(ctx.req).table('Candidates').deleteRow(candidateId);
    deletedCandidate = true;
  } catch (err) {
    log.error('failed deleting Candidate', { candidateId, error: (err as Error).message });
  }

  // 5) Audit log persiste — es el único rastro de que esto pasó.
  void auditLog(ctx, {
    action: 'tenant.delete', // el master plan no tiene action gdpr.delete específico
    resource_type: 'candidate',
    resource_id: candidateId,
    changes: {
      gdpr_action: 'right_to_erasure',
      email_fragment: email.slice(0, 4) + '...',
      deleted: { candidate: deletedCandidate, results: deletedResults, scores: deletedScores, dims: deletedDims, transitions: deletedTransitions },
      executed_at: now(),
    },
  });

  log.warn('GDPR right-to-erasure executed', {
    traceId: ctx.traceId,
    candidate_id: candidateId,
    deleted: { candidate: deletedCandidate, results: deletedResults, scores: deletedScores, dims: deletedDims, transitions: deletedTransitions },
  });

  sendJson(ctx.res, 200, {
    deleted: deletedCandidate,
    candidate_id: candidateId,
    counts: {
      results: deletedResults,
      scores: deletedScores,
      integrity_dimensions: deletedDims,
      transitions: deletedTransitions,
    },
  });
}

/**
 * Purga videos físicos (catalyst_file_id) de respuestas viejas (>30d post-cierre del job).
 *
 *   POST /admin/gdpr/purge-old-videos
 *
 * Doc 20: "auto-delete de videos físicos a 30 días post-cierre del puesto".
 *
 * El transcript + analysis quedan en `VideoResponses` para auditoría histórica;
 * solo se borra el `catalyst_file_id` (archivo físico) y se marca con flag.
 *
 * Está pensado para llamarse desde un cron diario externo. También expuesto como
 * endpoint admin para correr a demanda.
 */
export async function purgeOldVideos(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  // Cutoff: cualquier respuesta cuyo Result lleve >30d con stage hired/rejected/withdrew/declined
  // Y que tenga catalyst_file_id no-null.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  type Candidate = {
    ROWID: string;
    catalyst_file_id: string;
    application_id: string;
  };

  let purgedCount = 0;
  let errors = 0;

  try {
    const q = `
      SELECT VR.ROWID, VR.catalyst_file_id, VR.application_id
      FROM VideoResponses VR
      JOIN Results R ON R.ROWID = VR.application_id
      WHERE VR.catalyst_file_id IS NOT NULL
        AND R.completed_at IS NOT NULL
        AND R.completed_at < '${escapeSql(cutoff)}'
        AND R.pipeline_stage IN ('hired', 'rejected_by_admin', 'auto_rejected_low_score', 'offer_declined', 'withdrew')
    `.replace(/\s+/g, ' ');

    const rows = unwrapRows<Candidate>(
      (await zcql(ctx.req).executeZCQLQuery(q)) as unknown[],
      'VideoResponses',
    );

    for (const row of rows) {
      try {
        // TODO: cuando exista integración con Catalyst File Store, hacer DELETE físico
        // del archivo con catalyst_file_id. Por ahora, solo marcamos en BD.
        await datastore(ctx.req).table('VideoResponses').updateRow({
          ROWID: row.ROWID,
          catalyst_file_id: null, // marcador: el archivo físico fue purgado
        });
        purgedCount++;
      } catch (err) {
        errors++;
        log.warn('purge video file failed', { rowid: row.ROWID, error: (err as Error).message });
      }
    }

    log.info('purge old videos completed', {
      traceId: ctx.traceId,
      eligible: rows.length,
      purged: purgedCount,
      errors,
      cutoff,
    });

    sendJson(ctx.res, 200, {
      ok: true,
      cutoff,
      eligible: rows.length,
      purged: purgedCount,
      errors,
      note: 'Catalyst File Store DELETE físico pendiente — por ahora se marca catalyst_file_id=null en BD. Cuando exista integración, agregar la llamada al SDK de File Store.',
    });
  } catch (err) {
    log.warn('purge old videos failed at query', { error: (err as Error).message });
    sendJson(ctx.res, 500, {
      error: { code: 'purge_failed', message: (err as Error).message },
    });
  }
}
