/**
 * Endpoints candidate-facing — sin Clerk auth. Auth via signed token en URL.
 *
 *   GET  /test/:token              — verifica token + devuelve estado del test
 *   POST /test/:token/submit       — candidato envía respuestas → backend calcula scores y persiste en tabla Scores
 *
 * Token claims:
 *   { kind: 'test', ref: <result_id>, exp: <unix> }
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, ConflictError, UnauthorizedError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { verifyToken, TokenError } from '../lib/urlSigning';
import {
  normalizeDiscRaw,
  discDominantAxis,
  velnaAggregate,
  calculateTechnicalScore,
  classifyIntegrityPct,
  type IntegrityClassification,
} from '../lib/scoring';
import { isStage, transitionAllowed, type PipelineStage } from '../lib/pipelineStateMachine';

const log = logger('PUBLIC_TEST');
const T_RESULTS = 'Results';
const T_SCORES = 'Scores';
const T_TRANSITIONS = 'PipelineTransitions';

type ResultRow = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: string;
  started_at: string;
  completed_at: string | null;
};

type ScoresRow = {
  ROWID: string;
  result_id: string;
  disc_completed_at?: string;
  velna_completed_at?: string;
  emo_completed_at?: string;
  tec_completed_at?: string;
  int_completed_at?: string;
};

function extractTokenFromPath(url: string): string | null {
  const match = url.match(/^\/test\/([^/?]+)/);
  return match?.[1] ?? null;
}

/**
 * Devuelve las preguntas técnicas custom del puesto sin las respuestas correctas.
 * Si el job no tiene tech_questions_cache (Cris no generó todavía), devuelve [].
 *
 *   GET /test/:token/tech-questions
 *
 * El frontend puede usarlas tal cual; al submit, el backend revalida con la versión
 * con respuestas (en Jobs.tech_questions_cache).
 */
export async function getTestTechQuestions(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const result = await getResult(ctx, claims.ref);
  if (!result) throw new NotFoundError(`Application not found`);

  // Cargar el job vía join indirecto (Result.assessment_id = Job.ROWID)
  const jobRow = unwrapRows<{ ROWID: string; tech_questions_cache?: string | null; cognitive_level?: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, tech_questions_cache, cognitive_level FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];

  if (!jobRow) {
    sendJson(ctx.res, 200, { questions: [], status: 'job_not_found' });
    return;
  }

  type OutQuestion = {
    id: string;
    text: string;
    options: string[];
    kind?: 'technical' | 'situational';
    option_validity?: boolean[];
    option_style?: Array<{ axis: 'autonomy_vs_consult'; value: 'autonomy' | 'consult' } | null>;
  };

  let questions: OutQuestion[] = [];
  if (jobRow.tech_questions_cache) {
    try {
      const { loadLargeJson } = await import('../lib/largeContentStore.js');
      const parsed = await loadLargeJson<unknown>(ctx.req, jobRow.tech_questions_cache);
      if (Array.isArray(parsed)) {
        questions = parsed.map((q: Record<string, unknown>): OutQuestion => {
          const out: OutQuestion = {
            id: String(q.id),
            text: String(q.text),
            options: Array.isArray(q.options) ? q.options.map(String) : [],
          };
          // Doble eje (doc 19) — exponer kind + option_validity + option_style si existen.
          // NUNCA exponer `correct` ni el value/axis específico de cada opción que delate
          // qué es válido. SÍ exponemos validity (true/false) porque el cliente necesita
          // saber qué opciones son aceptables al renderizar — wait, NO, eso delata cuál escoger.
          // Exposición correcta: solo exponer `kind` para que el frontend muestre instrucciones
          // distintas ("hay una correcta" vs "hay 2 válidas, marcá la que harías").
          // option_validity y option_style se mantienen privados — el backend los usa al submit.
          if (q.kind === 'situational') out.kind = 'situational';
          else if (q.kind === 'technical') out.kind = 'technical';
          return out;
        });
      }
    } catch {
      questions = [];
    }
  }

  sendJson(ctx.res, 200, {
    questions,
    cognitive_level: jobRow.cognitive_level ?? 'mid',
    status: questions.length > 0 ? 'ok' : 'no_cache',
  });
}

async function fetchJobTechCache(ctx: RequestContext, jobId: string): Promise<unknown[] | null> {
  type Row = { tech_questions_cache?: string | null };
  const q = `SELECT tech_questions_cache FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`;
  const rows = unwrapRows<Row>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], 'Jobs');
  const raw = rows[0]?.tech_questions_cache;
  if (!raw) return null;
  try {
    const { loadLargeJson } = await import('../lib/largeContentStore.js');
    const parsed = await loadLargeJson<unknown>(ctx.req, raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchJobBossStyle(ctx: RequestContext, jobId: string): Promise<number | null> {
  type Row = { ideal_profile?: string | null };
  const q = `SELECT ideal_profile FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`;
  const rows = unwrapRows<Row>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], 'Jobs');
  const raw = rows[0]?.ideal_profile;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { boss?: { style_autonomy_consult?: number } };
    const v = parsed?.boss?.style_autonomy_consult;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

async function getResult(ctx: RequestContext, resultId: string): Promise<ResultRow | null> {
  const query = `SELECT * FROM ${T_RESULTS} WHERE ROWID = '${escapeSql(resultId)}' LIMIT 1`;
  const result = (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<ResultRow>(result, T_RESULTS)[0] ?? null;
}

async function getScoresRow(ctx: RequestContext, resultId: string): Promise<ScoresRow | null> {
  const query = `SELECT * FROM ${T_SCORES} WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`;
  const result = (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[];
  return unwrapRows<ScoresRow>(result, T_SCORES)[0] ?? null;
}

async function upsertScoresPatch(
  ctx: RequestContext,
  resultId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await getScoresRow(ctx, resultId);
  if (existing) {
    await datastore(ctx.req).table(T_SCORES).updateRow({ ROWID: existing.ROWID, ...patch });
    return;
  }
  try {
    await datastore(ctx.req).table(T_SCORES).insertRow({ result_id: resultId, ...patch });
  } catch (err) {
    // Race: otra request creó el row entre nuestro SELECT y INSERT. Reintentar como update.
    log.warn('Scores upsert race detected (publicTest), retrying as update', {
      traceId: ctx.traceId, resultId, error: (err as Error).message,
    });
    const concurrent = await getScoresRow(ctx, resultId);
    if (!concurrent) throw err;
    await datastore(ctx.req).table(T_SCORES).updateRow({ ROWID: concurrent.ROWID, ...patch });
  }
}

export async function getTestStatus(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) {
      throw new UnauthorizedError(`Token: ${err.reason}`);
    }
    throw err;
  }

  const result = await getResult(ctx, claims.ref);
  if (!result) throw new NotFoundError(`Application not found`);

  sendJson(ctx.res, 200, {
    application_id: result.ROWID,
    pipeline_stage: result.pipeline_stage,
    started_at: result.started_at,
    completed_at: result.completed_at,
    expired: claims.exp < Math.floor(Date.now() / 1000),
  });
}

export async function submitTest(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromPath(ctx.req.url ?? '/');
  if (!token) throw new ValidationError('token missing');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) {
      throw new UnauthorizedError(`Token: ${err.reason}`);
    }
    throw err;
  }

  const resultId = claims.ref;
  const result = await getResult(ctx, resultId);
  if (!result) throw new NotFoundError(`Application not found`);

  const existing = await getScoresRow(ctx, resultId);
  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const blocksWritten: string[] = [];
  const patch: Record<string, unknown> = {};

  // Técnica
  if (body.tecnica && typeof body.tecnica === 'object') {
    if (existing?.tec_completed_at) throw new ConflictError('Technical score already submitted');
    const t = body.tecnica as Record<string, unknown>;
    const min_required = Number(t.min_required ?? 60);

    let calc: { score_pct: number; passed: boolean };
    let total_correct: number;
    let total_questions: number;

    // Path 1: doble eje server-side. Frontend manda `answers: { qid: idx }`,
    // backend computa todo (técnica + situacional + estilo + match con jefe).
    if (t.answers && typeof t.answers === 'object') {
      const answers = t.answers as Record<string, number>;
      const techCacheRaw = await fetchJobTechCache(ctx, result.assessment_id);
      if (!techCacheRaw) {
        throw new ValidationError('Job no tiene tech_questions_cache — generar primero con POST /api/jobs/:id/tech-questions/generate');
      }

      const { scoreTechnicalDoubleAxis, matchStyleWithBoss } = await import('../lib/scoring.js');
      const r = scoreTechnicalDoubleAxis(techCacheRaw as Parameters<typeof scoreTechnicalDoubleAxis>[0], answers, min_required);
      calc = { score_pct: r.technical.score_pct, passed: r.technical.passed };
      total_correct = r.technical.correct;
      total_questions = r.technical.total;

      Object.assign(patch, {
        tec_situational_validity_pct: r.situational_validity.score_pct,
      });

      if (r.style.autonomy_vs_consult != null) {
        const styleInt = Math.round(r.style.autonomy_vs_consult * 100);
        (patch as Record<string, unknown>).tec_style_autonomy_consult = styleInt;

        // Match con jefe: leer ideal_profile.boss del Job
        const bossStyle = await fetchJobBossStyle(ctx, result.assessment_id);
        if (bossStyle != null) {
          const m = matchStyleWithBoss(r.style.autonomy_vs_consult, bossStyle);
          if (m) (patch as Record<string, unknown>).tec_style_match_with_boss_pct = m.match_pct;
        }
      }
    } else {
      // Path 2 legacy: frontend manda total_correct ya computado.
      total_questions = Number(t.total_questions ?? 0);
      total_correct = Number(t.total_correct ?? 0);
      if (total_questions <= 0) throw new ValidationError('tecnica.total_questions invalid (o mandar `answers` para scoring server-side)');
      calc = calculateTechnicalScore(total_correct, total_questions, min_required);
    }

    Object.assign(patch, {
      tec_score_pct: calc.score_pct,
      tec_total_correct: total_correct,
      tec_total_questions: total_questions,
      tec_passed: calc.passed,
      tec_completed_at: now(),
    });

    blocksWritten.push('tecnica');

    // Auto-transition de pipeline_stage
    await transitResult(ctx, result, calc.passed ? 'tecnica_completed' : 'auto_rejected_low_score', 'webhook');
  }

  // DISC
  if (body.disc && typeof body.disc === 'object') {
    if (existing?.disc_completed_at) throw new ConflictError('DISC score already submitted');
    const d = body.disc as Record<string, unknown>;
    const totalQ = Number(d.total_questions ?? 24);
    const raw = {
      d: Number(d.raw_d ?? 0),
      i: Number(d.raw_i ?? 0),
      s: Number(d.raw_s ?? 0),
      c: Number(d.raw_c ?? 0),
    };

    const normalized = normalizeDiscRaw(raw, totalQ);
    const dominant = discDominantAxis(normalized);
    Object.assign(patch, {
      disc_raw_d: raw.d, disc_raw_i: raw.i, disc_raw_s: raw.s, disc_raw_c: raw.c,
      disc_norm_d: normalized.d, disc_norm_i: normalized.i,
      disc_norm_s: normalized.s, disc_norm_c: normalized.c,
      disc_perfil_dominante: dominant,
      disc_pk_id: typeof d.pk_id === 'string' ? d.pk_id : null,
      disc_completed_at: now(),
    });
    blocksWritten.push('disc');
  }

  // VELNA / Cognitive
  if (body.velna && typeof body.velna === 'object') {
    if (existing?.velna_completed_at) throw new ConflictError('VELNA score already submitted');
    const v = body.velna as Record<string, unknown>;
    const subtests = {
      verbal: Number(v.verbal ?? 0),
      espacial: Number(v.espacial ?? 0),
      logica: Number(v.logica ?? 0),
      numerica: Number(v.numerica ?? 0),
      abstracta: Number(v.abstracta ?? 0),
    };

    const aggregate = velnaAggregate(subtests);
    Object.assign(patch, {
      velna_verbal: subtests.verbal,
      velna_espacial: subtests.espacial,
      velna_logica: subtests.logica,
      velna_numerica: subtests.numerica,
      velna_abstracta: subtests.abstracta,
      velna_total: Number(v.total ?? 0),
      velna_max: Number(v.max ?? 0),
      velna_indice: aggregate,
      velna_completed_at: now(),
    });
    blocksWritten.push('velna');
  }

  // Emotional
  if (body.emotional && typeof body.emotional === 'object') {
    if (existing?.emo_completed_at) throw new ConflictError('Emotional score already submitted');
    const e = body.emotional as Record<string, unknown>;
    const score = Number(e.score ?? 0);
    const perfil: 'espontaneo' | 'mesura' | 'reflexivo' =
      score < 35 ? 'espontaneo' : score >= 70 ? 'reflexivo' : 'mesura';
    Object.assign(patch, {
      emo_score: score,
      emo_perfil: perfil,
      emo_completed_at: now(),
    });
    blocksWritten.push('emotional');
  }

  // Integrity (header en Scores + dimensiones en IntegrityDimensions)
  let integrityDimsToInsert: Array<{ dimension: string; pct: number; nivel: IntegrityClassification }> | null = null;
  if (body.integridad && typeof body.integridad === 'object') {
    if (existing?.int_completed_at) throw new ConflictError('Integrity already submitted');
    const intg = body.integridad as Record<string, unknown>;
    const dimsArr = Array.isArray(intg.dimensions) ? intg.dimensions : [];
    if (dimsArr.length === 0) throw new ValidationError('integridad.dimensions[] required');

    const parsed: Array<{ dimension: string; pct: number; nivel: IntegrityClassification }> = [];
    let totalRisk = 0;
    let totalMax = 0;
    let anyAlto = false;
    let biPct = 0;
    for (const raw of dimsArr) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as { dimension?: unknown; pct?: unknown };
      const dim = typeof d.dimension === 'string' ? d.dimension : '';
      if (!dim) continue;
      const pct = typeof d.pct === 'number' ? Math.max(0, Math.min(100, Math.round(d.pct))) : 0;
      const nivel = classifyIntegrityPct(pct, dim);
      parsed.push({ dimension: dim, pct, nivel });
      if (dim === 'buena_impresion') {
        biPct = pct;
        continue;
      }
      // overall_pct se calcula como avg de pcts (no usamos risk_score raw aquí porque
      // el frontend ya envía pcts pre-calculados).
      totalRisk += pct;
      totalMax += 100;
      if (nivel === 'alto') anyAlto = true;
    }
    const overallPct = totalMax > 0 ? Math.round((totalRisk / parsed.filter((d) => d.dimension !== 'buena_impresion').length) || 0) : 0;
    let overall: IntegrityClassification;
    if (overallPct <= 30 && !anyAlto) overall = 'bajo';
    else if (overallPct > 60) overall = 'alto';
    else overall = 'medio';
    const recomendacion = overall === 'bajo' ? 'Se puede recomendar'
      : overall === 'medio' ? 'Revisar con cautela'
      : 'No se recomienda';
    const biClass: IntegrityClassification = biPct > 60 ? 'alto' : biPct > 30 ? 'medio' : 'bajo';

    Object.assign(patch, {
      int_overall: overall,
      int_overall_pct: overallPct,
      int_recomendacion: recomendacion,
      int_buena_impresion: biClass,
      int_buena_impresion_pct: biPct,
      int_completed_at: now(),
    });
    integrityDimsToInsert = parsed;
    blocksWritten.push('integridad');
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('No score payloads provided.');
  }

  // Anti-cheat events: persistir en AntiCheatEvents (Block 2 §7) + logs estructurados.
  // Si la tabla no existe, no-op silencioso (mantiene logs como fallback).
  if (body.anti_cheat && typeof body.anti_cheat === 'object') {
    const ac = body.anti_cheat as Record<string, unknown>;
    const count = typeof ac.count === 'number' ? ac.count : 0;
    const events = Array.isArray(ac.events) ? ac.events : [];
    const phase = typeof ac.phase === 'string' ? ac.phase : 'unknown';
    if (count > 0 || events.length > 0) {
      log.warn('anti-cheat events on submit', {
        traceId: ctx.traceId,
        resultId,
        phase,
        count,
        types: events.slice(0, 20).map((e: unknown) => (e as { type?: string }).type ?? 'unknown'),
      });
      // Persist
      try {
        await Promise.all(events.slice(0, 50).map((e) => {
          const ev = e as { type?: string; question_id?: string; duration_ms?: number };
          return datastore(ctx.req).table('AntiCheatEvents').insertRow({
            result_id: resultId,
            phase,
            event_type: typeof ev.type === 'string' ? ev.type : 'unknown',
            question_id: typeof ev.question_id === 'string' ? ev.question_id : null,
            duration_ms: typeof ev.duration_ms === 'number' ? ev.duration_ms : null,
            created_at: now(),
          });
        }));
      } catch (err) {
        log.debug('AntiCheatEvents table not ready or insert failed', {
          error: (err as Error).message,
        });
      }
    }
  }

  await upsertScoresPatch(ctx, resultId, patch);

  // Si integridad incluida, insertar las dimensiones en su tabla
  if (integrityDimsToInsert && integrityDimsToInsert.length > 0) {
    const inserted: string[] = [];
    const failed: Array<{ dim: string; err: string }> = [];
    await Promise.all(
      integrityDimsToInsert.map(async (d) => {
        try {
          await datastore(ctx.req).table('IntegrityDimensions').insertRow({
            result_id: resultId,
            dimension: d.dimension,
            nivel: d.nivel,
            pct: d.pct,
            created_at: now(),
          });
          inserted.push(d.dimension);
        } catch (err) {
          failed.push({ dim: d.dimension, err: (err as Error).message });
        }
      }),
    );
    if (failed.length > 0) {
      log.error('IntegrityDimensions insert failed for some dimensions', {
        traceId: ctx.traceId,
        resultId,
        insertedCount: inserted.length,
        failedCount: failed.length,
        failures: failed,
      });
    } else {
      log.info('IntegrityDimensions persisted', { traceId: ctx.traceId, resultId, count: inserted.length });
    }
    // Siempre intentar transicionar a integridad_completed después del submit.
    // transitResult valida internamente que la transición sea legal según el state
    // machine; si no lo es, hace skip silently. Esto evita race conditions cuando
    // `result.pipeline_stage` está stale (eventual consistency).
    await transitResult(ctx, result, 'integridad_completed', 'webhook');
  }

  // Después del upsert, releer el Scores row actualizado para chequear si los bloques
  // conductuales (DISC + VELNA) ya están completos. El bloque emocional es opcional
  // mientras no exista la UI de emocional en el frontend.
  const refreshed = await getScoresRow(ctx, resultId);
  const conductualComplete = refreshed
    && refreshed.disc_completed_at
    && refreshed.velna_completed_at;
  if (conductualComplete && result.pipeline_stage !== 'conductual_completed') {
    await transitResult(ctx, result, 'conductual_completed', 'webhook');
  }

  // Auto-rejection multidim (doc 18). Si el candidato no cumple las reglas configuradas
  // del job (DISC similitud, VELNA mínimo, integridad máxima de riesgo, emocional mínimo),
  // transicionar a auto_rejected_low_score y devolver un flag al frontend.
  let autoRejected: { reasons: string[] } | null = null;
  if (refreshed && !['auto_rejected_low_score', 'rejected_by_admin'].includes(result.pipeline_stage)) {
    try {
      const { evaluateAutoRejection } = await import('../lib/autoRejection.js');
      const { parseIdealProfile } = await import('./jobs.js');
      const jobIdeal = await fetchJobIdealProfile(ctx, result.assessment_id);
      const ideal = parseIdealProfile(jobIdeal);
      const decision = evaluateAutoRejection(refreshed as Parameters<typeof evaluateAutoRejection>[0], ideal);
      if (decision.reject) {
        const fresh = await getResult(ctx, resultId);
        if (fresh && !['auto_rejected_low_score', 'rejected_by_admin'].includes(fresh.pipeline_stage)) {
          await transitResult(ctx, fresh, 'auto_rejected_low_score', 'webhook');
          autoRejected = { reasons: decision.reasons };
          log.info('candidate auto-rejected by rules', {
            traceId: ctx.traceId,
            resultId,
            reasons: decision.reasons,
          });
        }
      }
    } catch (err) {
      log.warn('auto-rejection evaluation failed', {
        traceId: ctx.traceId,
        resultId,
        error: (err as Error).message,
      });
    }
  }

  log.info('public test submitted', { traceId: ctx.traceId, resultId, blocks: blocksWritten });
  sendJson(ctx.res, 200, { submitted: blocksWritten, ...(autoRejected ? { auto_rejected: autoRejected } : {}) });
}

async function fetchJobIdealProfile(ctx: RequestContext, jobId: string): Promise<string | null> {
  type Row = { ideal_profile?: string | null };
  const rows = unwrapRows<Row>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ideal_profile FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  );
  return rows[0]?.ideal_profile ?? null;
}

async function transitResult(ctx: RequestContext, result: ResultRow, toStage: string, actor: string): Promise<void> {
  // Validación del state machine — si la transición no es legal, NO se aplica.
  // En lugar de tirar error (lo que rompería el submit del candidato), logueamos
  // y dejamos al admin/bot resolverlo manualmente.
  if (!isStage(toStage) || !isStage(result.pipeline_stage)
      || !transitionAllowed(result.pipeline_stage as PipelineStage, toStage as PipelineStage)) {
    log.warn('skipping invalid transition', {
      traceId: ctx.traceId,
      resultId: result.ROWID,
      from: result.pipeline_stage,
      to: toStage,
    });
    return;
  }

  await datastore(ctx.req).table(T_RESULTS).updateRow({
    ROWID: result.ROWID,
    pipeline_stage: toStage,
    ...(toStage.includes('completed') || toStage.includes('rejected') || toStage === 'finalist'
      ? { completed_at: now() }
      : {}),
  });
  await datastore(ctx.req).table(T_TRANSITIONS).insertRow({
    result_id: result.ROWID,
    from_stage: result.pipeline_stage,
    to_stage: toStage,
    actor,
    reason: `Auto-transition on submit`,
    transitioned_at: now(),
  });

  // Auto-populate del pool: cuando el candidato termina la fase intermedia
  // (integridad o videos), entra al pool histórico para futuro matching.
  if (toStage === 'integridad_completed' || toStage === 'videos_completed' || toStage === 'finalist') {
    const { upsertPoolFromApplication } = await import('../lib/poolAutoPopulate.js');
    void upsertPoolFromApplication(ctx.req, result.ROWID);
  }

  // Marketing demo flow: si el Result es de un MarketingLead, chequear si ambas
  // secciones (conductual + integridad) están completas para disparar el reporte.
  // Se chequea en cada transición a *_completed porque las 2 pruebas pueden hacerse
  // en cualquier orden (links independientes).
  if (toStage === 'integridad_completed' || toStage === 'conductual_completed') {
    const { tryCompleteMarketingDemo } = await import('./marketing.js');
    void tryCompleteMarketingDemo(ctx, result.ROWID);
  }

  // Sync con Recruit: cada cambio de etapa avisa a Recruit para que dispare sus
  // reglas automáticas (email + WhatsApp). Usa el recruit_candidate_id guardado en
  // Candidates desde el primer apply.
  void (async () => {
    try {
      const { publishRecruitSync } = await import('../lib/recruitSyncPublisher.js');
      await publishRecruitSync(ctx.req, {
        application_id: result.ROWID,
        job_id: String(result.assessment_id ?? ''),
        tenant_id: '',
        from_stage: result.pipeline_stage,
        to_stage: toStage,
        actor,
        transitioned_at: now(),
        candidate_id: String(result.candidate_id ?? ''),
      });
    } catch (err) {
      log.warn('publishRecruitSync failed on transition', {
        traceId: ctx.traceId, resultId: result.ROWID, error: (err as Error).message,
      });
    }
  })();
}
