/**
 * Reporte multi-candidato (bundle) para el cliente externo.
 *
 *   GET /report/bundle/:token  → JSON con job + finalists + scores + integrity dims
 *
 * Token claims: { kind: 'report_bundle', ref: <job_id>, exp }
 *
 * Diferencias con `/report/<token>` (single-result):
 * - Single-result: ref=Result.ROWID, devuelve UN candidato.
 * - Bundle: ref=Jobs.ROWID, agrega TODOS los Results en stages finalist/offered/hired.
 *
 * Lo que NO hace todavía:
 * - Generar narrativas IA (campo narratives = null). Necesita prompt + Anthropic call.
 * - Comparar contra perfil ideal del puesto (no hay disc_ideal, velna_ideal en Jobs).
 * - Persistir el reporte (no hay tabla ClientReports). Cada GET re-agrega.
 *
 * Cuando exista ClientReports + narrativas IA, este endpoint pasa a leer cache primero.
 */
import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { verifyToken, TokenError } from '../lib/urlSigning';
import type { PipelineStage } from '../lib/pipelineStateMachine';
import { parseIdealProfile } from './jobs';
import { buildNarrativesForReport, type CandidateNarrativeInput } from '../lib/reportNarratives';
import { readStoredReport, writeStoredReport, trackOpened } from '../lib/clientReportsCache';
import { createHash } from 'crypto';

const log = logger('REPORT_BUNDLE');

const FINALIST_STAGES: readonly PipelineStage[] = [
  'finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired',
];

type JobRow = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  cognitive_level: string;
  ideal_profile?: string | null;
};

type ResultRow = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: PipelineStage;
  completed_at: string | null;
};

type CandidateRow = {
  ROWID: string;
  name: string;
  email: string;
  age: number | null;
};

type ScoresRow = {
  result_id: string;
  disc_raw_d?: number; disc_raw_i?: number; disc_raw_s?: number; disc_raw_c?: number;
  disc_norm_d?: number; disc_norm_i?: number; disc_norm_s?: number; disc_norm_c?: number;
  disc_perfil_dominante?: string;
  velna_verbal?: number; velna_espacial?: number; velna_logica?: number;
  velna_numerica?: number; velna_abstracta?: number; velna_indice?: number;
  emo_score?: number; emo_perfil?: string;
  tec_score_pct?: number; tec_passed?: boolean;
  int_overall?: string; int_overall_pct?: number;
  int_recomendacion?: string; int_buena_impresion?: string;
};

type IntegrityDimRow = {
  result_id: string;
  dimension: string;
  nivel: 'bajo' | 'medio' | 'alto';
  pct: number;
};

type VideoQuestionMini = {
  ROWID: string;
  application_id: string;
  question_id: string;
  category: string;
  question_text: string;
};

type VideoResponseMini = {
  ROWID: string;
  application_id: string;
  question_id: string;
  analysis_json: string | null;
  analyzed_at: string | null;
};

function extractTokenFromPath(url: string): string | null {
  return url.match(/^\/report\/bundle\/([^/?]+)/)?.[1] ?? null;
}

export async function getPublicReportBundle(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'report_bundle');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const jobId = claims.ref;

  const job = await fetchOne<JobRow>(ctx.req, 'Jobs', `ROWID = '${escapeSql(jobId)}'`);
  if (!job) throw new NotFoundError('Job not found');

  const stagesIn = FINALIST_STAGES.map((s) => `'${s}'`).join(', ');
  const finalists = await fetchAll<ResultRow>(
    ctx.req,
    'Results',
    `assessment_id = '${escapeSql(jobId)}' AND pipeline_stage IN (${stagesIn})`,
    'ORDER BY completed_at DESC',
  );

  const idealProfile = parseIdealProfile(job.ideal_profile ?? null);
  const idealProfileSerialized = job.ideal_profile ?? null;

  if (finalists.length === 0) {
    sendJson(ctx.res, 200, {
      report: {
        generated_at: new Date().toISOString(),
        job: jobInfo(job, idealProfile),
        candidates: [],
        narratives: null,
        summary: null,
      },
    });
    return;
  }

  // Cache key incluye los result_ids ordenados, así que agregar un finalist nuevo
  // invalida automáticamente el cache (key distinto).
  const cacheKey = computeBundleCacheKey(jobId, finalists.map((f) => f.ROWID), idealProfileSerialized);

  // Read-through cache: persistencia en ClientReports si la tabla existe.
  const stored = await readStoredReport<{ report: unknown }>(ctx.req, cacheKey);
  if (stored) {
    void trackOpened(ctx.req, stored.ROWID);
    log.info('report bundle cache hit (DB)', { traceId: ctx.traceId, jobId, rowid: stored.ROWID });
    sendJson(ctx.res, 200, stored.payload);
    return;
  }

  // Carga paralela de candidates, scores e integrity dims (1 query cada uno).
  const candidateIds = finalists.map((f) => `'${escapeSql(f.candidate_id)}'`).join(', ');
  const resultIds = finalists.map((f) => `'${escapeSql(f.ROWID)}'`).join(', ');

  const [
    candidates,
    scoresRows,
    integrityRows,
    videoQuestions,
    videoResponses,
    mindsetRows,
    englishRows,
  ] = await Promise.all([
    fetchAll<CandidateRow>(ctx.req, 'Candidates', `ROWID IN (${candidateIds})`),
    fetchAll<ScoresRow>(ctx.req, 'Scores', `result_id IN (${resultIds})`),
    fetchAll<IntegrityDimRow>(ctx.req, 'IntegrityDimensions', `result_id IN (${resultIds})`, 'ORDER BY dimension'),
    fetchAllSafe<VideoQuestionMini>(ctx.req, 'VideoQuestions', `application_id IN (${resultIds})`, 'ORDER BY CREATEDTIME ASC'),
    fetchAllSafe<VideoResponseMini>(ctx.req, 'VideoResponses', `application_id IN (${resultIds})`, 'ORDER BY uploaded_at ASC'),
    fetchAllSafe<Record<string, unknown>>(ctx.req, 'MindsetScores', `result_id IN (${resultIds})`),
    fetchAllSafe<Record<string, unknown>>(ctx.req, 'EnglishTestSessions', `result_id IN (${resultIds})`, 'ORDER BY CREATEDTIME DESC'),
  ]);

  const candidatesById = new Map(candidates.map((c) => [c.ROWID, c]));
  const scoresByResult = new Map(scoresRows.map((s) => [s.result_id, s]));
  const mindsetByResult = new Map(mindsetRows.map((m) => [m.result_id as string, m]));
  // Para English: si hay múltiples sesiones por candidato, tomar la más reciente (sort desc)
  const englishByResult = new Map<string, Record<string, unknown>>();
  for (const e of englishRows) {
    const rid = e.result_id as string;
    if (!englishByResult.has(rid)) englishByResult.set(rid, e);
  }
  const dimsByResult = new Map<string, IntegrityDimRow[]>();
  for (const dim of integrityRows) {
    const list = dimsByResult.get(dim.result_id) ?? [];
    list.push(dim);
    dimsByResult.set(dim.result_id, list);
  }

  // Indexar videos por application_id para combinar pregunta + último análisis
  const videoQsByApp = new Map<string, VideoQuestionMini[]>();
  for (const vq of videoQuestions) {
    const list = videoQsByApp.get(vq.application_id) ?? [];
    list.push(vq);
    videoQsByApp.set(vq.application_id, list);
  }
  const videoRsByAppQ = new Map<string, VideoResponseMini[]>();
  for (const vr of videoResponses) {
    const key = `${vr.application_id}::${vr.question_id}`;
    const list = videoRsByAppQ.get(key) ?? [];
    list.push(vr);
    videoRsByAppQ.set(key, list);
  }

  const enriched = finalists.map((result) => {
    const candidate = candidatesById.get(result.candidate_id) ?? null;
    const scores = scoresByResult.get(result.ROWID) ?? null;
    const dims = dimsByResult.get(result.ROWID) ?? [];
    const summary = computeSummaryScore(scores);

    // Análisis IA de las respuestas en video. SOLO el resultado del análisis IA;
    // NO se expone transcript ni catalyst_file_id (privacidad del candidato).
    // El cliente ve la pregunta + el análisis sintetizado, no el contenido crudo.
    const qs = videoQsByApp.get(result.ROWID) ?? [];
    const videoAnalyses = qs.map((q) => {
      const allResponses = videoRsByAppQ.get(`${result.ROWID}::${q.question_id}`) ?? [];
      const latest = allResponses[allResponses.length - 1];
      let analysis: Record<string, unknown> | null = null;
      if (latest?.analysis_json) {
        try { analysis = JSON.parse(latest.analysis_json); } catch { analysis = null; }
      }
      return {
        question_id: q.question_id,
        category: q.category,
        question_text: q.question_text,
        has_response: !!latest,
        analysis_status: latest?.analyzed_at ? 'ok' : 'pending',
        analysis, // solo el análisis IA (overall_pct, observaciones, flags, etc.)
      };
    }).filter((v) => v.has_response); // Omitir preguntas sin respuesta del candidato

    const mindset = mindsetByResult.get(result.ROWID) ?? null;
    const english = englishByResult.get(result.ROWID) ?? null;

    return {
      application_id: result.ROWID,
      pipeline_stage: result.pipeline_stage,
      completed_at: result.completed_at,
      candidate: candidate ? {
        name: candidate.name,
        email_redacted: redactEmail(candidate.email),
        age: candidate.age,
      } : null,
      scores,
      integrity_dimensions: dims.map((d) => ({ dimension: d.dimension, nivel: d.nivel, pct: d.pct })),
      summary_score: summary,
      videos: videoAnalyses.length > 0 ? videoAnalyses : null,
      // Tests nuevos (null si el candidato no los completó o si las tablas no existen)
      mindset: mindset ? {
        adaptability_score_pct: mindset.adaptability_score_pct ?? null,
        adaptability_pattern: mindset.adaptability_pattern ?? null,
        // Solo exponer scores agregados al cliente, no las respuestas individuales (privacidad)
        polos_adaptables: {
          crecimiento: mindset.mindset_growth_pct ?? null,
          curiosa: mindset.mindset_curious_pct ?? null,
          creativa: mindset.mindset_creative_pct ?? null,
          agente: mindset.mindset_agent_pct ?? null,
          abundancia: mindset.mindset_abundance_pct ?? null,
          exploracion: mindset.mindset_exploration_pct ?? null,
          oportunidad: mindset.mindset_opportunity_pct ?? null,
        },
      } : null,
      english: english ? {
        level_required: english.level_required ?? null,
        total_score_pct: english.total_score_pct ?? null,
        passed: english.passed ?? null,
        // No exponer el writing_text crudo al cliente — solo el score
      } : null,
    };
  });

  // Ordenar por summary_score desc (mejor candidato primero)
  enriched.sort((a, b) => (b.summary_score ?? 0) - (a.summary_score ?? 0));

  // Generar narrativas IA en paralelo (con cache de 1h y fallback si falla)
  const narrativeInputs: CandidateNarrativeInput[] = enriched.map((c) => ({
    application_id: c.application_id,
    candidate_name: c.candidate?.name ?? 'Candidato',
    candidate_age: c.candidate?.age ?? null,
    scores: c.scores as Record<string, unknown> | null,
    integrity_dimensions: c.integrity_dimensions,
    summary_score: c.summary_score,
  }));

  const narratives = await buildNarrativesForReport({
    jobId,
    jobTitle: job.title,
    jobCompany: job.company,
    idealProfile,
    idealProfileSerialized,
    candidates: narrativeInputs,
    traceId: ctx.traceId,
  });

  log.info('report bundle served', {
    traceId: ctx.traceId,
    jobId,
    finalists: enriched.length,
    narratives_status: narratives.status,
  });

  // Server-side tracking de la apertura del reporte (best-effort)
  void (async () => {
    const { recordPortalSnapshot } = await import('./jobTracking.js');
    await recordPortalSnapshot(ctx, {
      tenantId: job.tenant_id,
      eventType: 'portal.report_viewed',
      jobId,
      portalToken: token,
      eventData: { finalists_count: enriched.length, source: 'report_bundle' },
    });
  })();

  // Cargar branding del tenant para personalizar el reporte
  let branding: Record<string, unknown> = {};
  try {
    const tenantRow = await fetchOne<{ branding_config: string | null }>(
      ctx.req,
      'Tenants',
      `ROWID = '${escapeSql(job.tenant_id)}'`,
    );
    if (tenantRow?.branding_config) {
      const { parseBranding } = await import('../lib/branding.js');
      branding = parseBranding(tenantRow.branding_config) as Record<string, unknown>;
    }
  } catch (err) {
    log.warn('branding load failed', { error: (err as Error).message });
  }

  const responsePayload = {
    report: {
      generated_at: new Date().toISOString(),
      job: jobInfo(job, idealProfile),
      candidates: enriched,
      narratives,
      branding,
      summary: {
        total_finalists: enriched.length,
        ordered_by_score: enriched.map((c) => c.application_id),
        best_application_id: enriched[0]?.application_id ?? null,
      },
    },
  };

  // Best-effort: persistir si la tabla existe. No bloqueamos el response.
  if (narratives.status !== 'failed') {
    void writeStoredReport(ctx.req, {
      tenantId: job.tenant_id,
      jobId,
      cacheKey,
      payload: responsePayload,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 días
    });
  }

  sendJson(ctx.res, 200, responsePayload);
}

function computeBundleCacheKey(
  jobId: string,
  resultIds: string[],
  idealProfileSerialized: string | null,
): string {
  const sortedIds = [...resultIds].sort();
  const payload = JSON.stringify({ jobId, ids: sortedIds, ip: idealProfileSerialized ?? '' });
  return createHash('sha256').update(payload).digest('hex').slice(0, 64);
}

// ===== Helpers =====

function jobInfo(job: JobRow, idealProfile: ReturnType<typeof parseIdealProfile>) {
  return {
    title: job.title,
    company: job.company,
    cognitive_level: job.cognitive_level,
    ideal_profile: idealProfile,
  };
}

/**
 * Score de resumen 0-100 basado en cognitiva + técnica + integridad (invertida) + emoción.
 * Devuelve null si no hay ningún componente medible.
 *
 * No es "afinidad con perfil ideal" — para eso hay que comparar contra Jobs.disc_ideal/velna_ideal,
 * campos que todavía no existen en la BD.
 */
export function computeSummaryScore(scores: ScoresRow | null | undefined): number | null {
  if (!scores) return null;
  const parts: number[] = [];
  if (typeof scores.velna_indice === 'number') parts.push(scores.velna_indice);
  if (typeof scores.tec_score_pct === 'number') parts.push(scores.tec_score_pct);
  if (typeof scores.int_overall_pct === 'number') {
    parts.push(Math.max(0, 100 - scores.int_overall_pct)); // riesgo invertido
  }
  if (typeof scores.emo_score === 'number') parts.push(scores.emo_score);
  if (parts.length === 0) return null;
  const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
  return Math.round(avg);
}

function redactEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '<redacted>';
  const [local, domain] = email.split('@');
  const masked = local.length > 2 ? `${local[0]}***${local.slice(-1)}` : '***';
  return `${masked}@${domain}`;
}

async function fetchOne<T>(
  req: IncomingMessage,
  table: string,
  where: string,
  orderClause = '',
): Promise<T | null> {
  const q = `SELECT * FROM ${table} WHERE ${where}${orderClause ? ' ' + orderClause : ''} LIMIT 1`;
  const rows = unwrapRows<T & Record<string, unknown>>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    table,
  );
  return rows[0] ?? null;
}

async function fetchAll<T>(
  req: IncomingMessage,
  table: string,
  where: string,
  orderClause = '',
): Promise<T[]> {
  const q = `SELECT * FROM ${table} WHERE ${where}${orderClause ? ' ' + orderClause : ''}`;
  return unwrapRows<T & Record<string, unknown>>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    table,
  );
}

/**
 * Como fetchAll pero tolera tabla inexistente (deferred Block 2). Devuelve [] silencioso.
 * Útil para tablas que pueden no estar creadas todavía (VideoQuestions, VideoResponses).
 */
async function fetchAllSafe<T>(
  req: IncomingMessage,
  table: string,
  where: string,
  orderClause = '',
): Promise<T[]> {
  try {
    return await fetchAll<T>(req, table, where, orderClause);
  } catch {
    return [];
  }
}
