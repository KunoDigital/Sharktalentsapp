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
import { ValidationError, NotFoundError, ConflictError, UnauthorizedError, AppError } from '../lib/errors';
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

/** Columnas opcionales que pueden no existir todavía en Catalyst (deferred schema). */
const SCORES_OPTIONAL_COLS = [
  'tec_situational_validity_pct',
  'tec_style_autonomy_consult',
  'tec_style_match_with_boss_pct',
];

async function upsertScoresPatch(
  ctx: RequestContext,
  resultId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await getScoresRow(ctx, resultId);
  const doUpsert = async (p: Record<string, unknown>): Promise<void> => {
    if (existing) {
      await datastore(ctx.req).table(T_SCORES).updateRow({ ROWID: existing.ROWID, ...p });
      return;
    }
    try {
      await datastore(ctx.req).table(T_SCORES).insertRow({ result_id: resultId, ...p });
    } catch (err) {
      // Race: otra request creó el row entre nuestro SELECT y INSERT. Reintentar como update.
      log.warn('Scores upsert race detected (publicTest), retrying as update', {
        traceId: ctx.traceId, resultId, error: (err as Error).message,
      });
      const concurrent = await getScoresRow(ctx, resultId);
      if (!concurrent) throw err;
      await datastore(ctx.req).table(T_SCORES).updateRow({ ROWID: concurrent.ROWID, ...p });
    }
  };

  try {
    await doUpsert(patch);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    // Si Catalyst rechazó por columna missing (típicamente las 3 doble eje pendientes),
    // re-intentamos SIN esas columnas opcionales para no perder el score técnico básico.
    const looksLikeMissingColumn = /column|unknown|invalid/i.test(msg);
    const hasOptionalCols = SCORES_OPTIONAL_COLS.some((c) => c in patch);
    if (looksLikeMissingColumn && hasOptionalCols) {
      log.warn('Scores upsert failed, retrying without optional cols', {
        traceId: ctx.traceId, resultId, error: msg.slice(0, 200),
      });
      const cleanPatch: Record<string, unknown> = { ...patch };
      for (const c of SCORES_OPTIONAL_COLS) delete cleanPatch[c];
      await doUpsert(cleanPatch);
      return;
    }
    throw err;
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

  // Enriquecer con job + candidate para que el frontend pueda renderizar las pantallas
  // (título del puesto, nombre del candidato, etc.) sin volver a hacer otra request.
  let job: { ROWID: string; title: string; company: string; cognitive_level?: string } | null = null;
  let candidate: { name: string; email: string } | null = null;
  try {
    const jobRows = unwrapRows<{ ROWID: string; title: string; company: string; cognitive_level?: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, company, cognitive_level FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    job = jobRows[0] ?? null;
  } catch { /* tolerate missing columns */ }
  try {
    const candRows = unwrapRows<{ name: string; email: string; salary_expectation?: number | null; availability?: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT name, email, salary_expectation, availability FROM Candidates WHERE ROWID = '${escapeSql(result.candidate_id)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    );
    const c = candRows[0];
    if (c) {
      candidate = c as { name: string; email: string };
      (candidate as Record<string, unknown>).salary_expectation = c.salary_expectation;
      (candidate as Record<string, unknown>).availability = c.availability;
    }
  } catch { /* tolerate */ }

  sendJson(ctx.res, 200, {
    application_id: result.ROWID,
    pipeline_stage: result.pipeline_stage,
    started_at: result.started_at,
    completed_at: result.completed_at,
    expired: claims.exp < Math.floor(Date.now() / 1000),
    job,
    candidate,
  });
}

/**
 * POST /test/:token/register
 * Body: { full_name?, salary_expectation?, availability? }
 *
 * Permite al candidato completar/actualizar campos de su perfil ANTES de empezar las pruebas.
 * Llamado desde la pantalla de registro previa al primer test (técnica).
 *
 * Auth: token signed (mismo que el resto de endpoints públicos del test).
 */
export async function registerCandidateInfo(ctx: RequestContext): Promise<void> {
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
  if (!result) throw new NotFoundError('Application not found');

  const body = await readJsonBody<{
    full_name?: string;
    salary_expectation?: number | string;
    availability?: string;
  }>(ctx.req);

  const patch: Record<string, unknown> = { ROWID: result.candidate_id };
  if (typeof body.full_name === 'string' && body.full_name.trim()) {
    patch.name = body.full_name.trim().slice(0, 255);
  }
  if (body.salary_expectation !== undefined && body.salary_expectation !== null && body.salary_expectation !== '') {
    const n = Number(body.salary_expectation);
    if (Number.isFinite(n) && n > 0) patch.salary_expectation = n;
  }
  if (typeof body.availability === 'string' && body.availability.trim()) {
    patch.availability = body.availability.trim().slice(0, 255);
  }

  if (Object.keys(patch).length <= 1) {
    throw new ValidationError('Nada para guardar — manda al menos un campo');
  }

  // 2026-06-04 (audit fix #8): defensa contra el caso donde el candidato tiene
  // aplicaciones en >1 tenant (vector: admin malicioso del tenant B le crea una
  // Application falsa al candidato de tenant A para luego pisar sus datos personales
  // vía el link público del tenant A). Si detectamos >1 tenant tocando este candidato,
  // bloqueamos los campos compartidos (name) y solo permitimos los que aplican al
  // Result específico (salary_expectation, availability).
  const tenantsRows = unwrapRows<{ tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT DISTINCT j.tenant_id AS tenant_id
       FROM Results r JOIN Jobs j ON r.assessment_id = j.ROWID
       WHERE r.candidate_id = '${escapeSql(result.candidate_id)}'
       LIMIT 5`,
    )) as unknown[],
    'Results',
  );
  const distinctTenants = new Set(tenantsRows.map((t) => t.tenant_id).filter(Boolean));
  if (distinctTenants.size > 1) {
    log.warn('registerCandidateInfo: candidate in multiple tenants — name update blocked', {
      traceId: ctx.traceId, candidateId: result.candidate_id, tenantCount: distinctTenants.size,
    });
    delete patch.name;
    if (Object.keys(patch).length <= 1) {
      // Solo quedaba name → nada que guardar
      sendJson(ctx.res, 200, { ok: true, note: 'name not updated (candidate in multiple tenants)' });
      return;
    }
  }

  try {
    await datastore(ctx.req).table('Candidates').updateRow(patch as { ROWID: string });
  } catch (err) {
    log.warn('register candidate info failed', { traceId: ctx.traceId, error: (err as Error).message });
    throw new AppError(500, 'register_failed', `No se pudo guardar el registro: ${(err as Error).message}`);
  }

  sendJson(ctx.res, 200, { ok: true });
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

  // Si integridad incluida, insertar las dimensiones en su tabla.
  // Pattern: SECUENCIAL con retry por dimensión (3 intentos, backoff exponencial).
  // Por qué no Promise.all: Catalyst Data Store tiene rate limits / contention con
  // inserts paralelos a la misma tabla — 6% de las corridas tenían 10-12/13 filas
  // por failures silenciosas (detectado en test loop de 100 reps, 2026-06-02).
  if (integrityDimsToInsert && integrityDimsToInsert.length > 0) {
    const inserted: string[] = [];
    const failed: Array<{ dim: string; err: string }> = [];

    for (const d of integrityDimsToInsert) {
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await datastore(ctx.req).table('IntegrityDimensions').insertRow({
            result_id: resultId,
            dimension: d.dimension,
            nivel: d.nivel,
            pct: d.pct,
            created_at: now(),
          });
          inserted.push(d.dimension);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err as Error;
          if (attempt < 3) {
            // Backoff exponencial: 100ms, 300ms, 900ms.
            await new Promise((r) => setTimeout(r, 100 * Math.pow(3, attempt - 1)));
          }
        }
      }
      if (lastErr) {
        failed.push({ dim: d.dimension, err: lastErr.message });
      }
    }

    if (failed.length > 0) {
      log.error('IntegrityDimensions insert failed for some dimensions despite retries', {
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
  // 2026-06-04 (audit fix #17): Results es la fuente de verdad (ya quedó OK arriba).
  // PipelineTransitions es auditoría histórica — si falla, log.warn y seguir.
  // Sin este try/catch un throttle de Catalyst sobre la segunda escritura tiraba 500
  // y dejaba el invariante OK pero el caller veía error 500.
  try {
    await datastore(ctx.req).table(T_TRANSITIONS).insertRow({
      result_id: result.ROWID,
      from_stage: result.pipeline_stage,
      to_stage: toStage,
      actor,
      reason: `Auto-transition on submit`,
      transitioned_at: now(),
    });
  } catch (err) {
    log.warn('PipelineTransitions insert failed (Results already updated)', {
      traceId: ctx.traceId,
      resultId: result.ROWID,
      from: result.pipeline_stage,
      to: toStage,
      error: (err as Error).message,
    });
  }

  // Auto-populate del pool: cuando el candidato termina la fase intermedia
  // (integridad o videos), entra al pool histórico para futuro matching.
  if (toStage === 'integridad_completed' || toStage === 'videos_completed' || toStage === 'finalist') {
    const { upsertPoolFromApplication } = await import('../lib/poolAutoPopulate.js');
    void upsertPoolFromApplication(ctx.req, result.ROWID);
  }

  // Notificación al candidato del siguiente paso (email + WhatsApp).
  // 2026-06-04 (audit fix #16): fireAndForget wrapper para garantizar que un fallo
  // de la importación dinámica o del notify no tumbe el proceso (UnhandledRejection).
  const { fireAndForget } = await import('../lib/fireAndForget.js');
  fireAndForget('notifyCandidateOnTransition', async () => {
    const { notifyCandidateOnTransition } = await import('../lib/candidateNotifier.js');
    await notifyCandidateOnTransition(ctx.req, {
      applicationId: result.ROWID,
      toStage,
    });
  });

  // Notificación a Cris cuando candidato avanza una etapa importante o es auto-rechazado.
  void (async () => {
    try {
      const { enqueueNotification } = await import('./notifications.js');
      const { zcql: zcqlFn } = await import('../lib/db.js');
      const { escapeSql: esc, unwrapRows: unr } = await import('../lib/dbHelpers.js');
      const meta = unr<{ tenant_id: string; candidate_name: string; job_title: string }>(
        (await zcqlFn(ctx.req).executeZCQLQuery(
          `SELECT J.tenant_id AS tenant_id, C.name AS candidate_name, J.title AS job_title
           FROM Results R JOIN Jobs J ON J.ROWID = R.assessment_id
           JOIN Candidates C ON C.ROWID = R.candidate_id
           WHERE R.ROWID = '${esc(result.ROWID)}' LIMIT 1`,
        )) as unknown[],
        'Results',
      )[0];
      if (!meta) return;
      const candName = meta.candidate_name || 'Candidato';
      // Solo notificar en stages importantes — sino floodea a Cris
      const NOTIFY_ON: Record<string, { type: 'candidate_auto_rejected' | 'candidate_stage_advanced'; msg: string }> = {
        auto_rejected_low_score: { type: 'candidate_auto_rejected', msg: `${candName} fue auto-rechazado por score bajo en ${meta.job_title}` },
        integridad_completed: { type: 'candidate_stage_advanced', msg: `${candName} completó integridad para ${meta.job_title}` },
        videos_completed: { type: 'candidate_stage_advanced', msg: `${candName} completó los videos para ${meta.job_title}` },
      };
      const cfg = NOTIFY_ON[toStage];
      if (!cfg) return;
      await enqueueNotification(ctx.req, {
        tenantId: meta.tenant_id,
        type: cfg.type,
        message: cfg.msg,
        resourceType: 'application',
        resourceId: result.ROWID,
        link: `/candidates/${result.ROWID}`,
      });
    } catch (err) {
      log.warn('cris notification failed', { error: (err as Error).message });
    }
  })();

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

/**
 * GET /test/:token/my-progress
 *
 * Vista para el candidato: muestra dónde está en el proceso, qué pruebas ya hizo,
 * qué le falta. UX premium — devuelve estado humano-friendly sin exponer scores,
 * decisiones del bot ni info interna.
 */
export async function getCandidateProgress(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? '/';
  const m = url.match(/^\/test\/([^/]+)\/my-progress\/?$/);
  const token = m?.[1];
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

  // Cargar job (título solamente — el candidato no debe ver más)
  const jobRows = unwrapRows<{ title: string; company: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT title, company FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  );
  const job = jobRows[0];
  if (!job) throw new NotFoundError('Job not found');

  // Mapear stage interno → estado humano + qué prueba sigue
  const STAGE_LABELS: Record<string, { label: string; description: string; next_phase?: string; next_label?: string; show_completed: string[]; is_terminal?: boolean; is_positive?: boolean }> = {
    prefilter_pending: {
      label: 'Empezando',
      description: 'Te queda hacer unas preguntas cortas de prescreening (5 min).',
      next_phase: 'prescreening',
      next_label: 'Hacer prescreening',
      show_completed: [],
    },
    prefilter_passed: {
      label: 'Prescreening completo ✓',
      description: 'Ya pasaste el prescreening. Ahora viene la prueba técnica.',
      next_phase: 'tecnica',
      next_label: 'Empezar prueba técnica',
      show_completed: ['prescreening'],
    },
    tecnica_completed: {
      label: 'Técnica completa ✓',
      description: 'Pasaste a evaluación conductual (DISC).',
      next_phase: 'disc',
      next_label: 'Hacer DISC',
      show_completed: ['prescreening', 'tecnica'],
    },
    conductual_completed: {
      label: 'DISC completo ✓',
      description: 'Siguiente: prueba de integridad.',
      next_phase: 'integridad',
      next_label: 'Hacer integridad',
      show_completed: ['prescreening', 'tecnica', 'disc'],
    },
    integridad_completed: {
      label: 'Integridad completa ✓',
      description: 'Última prueba: video respuestas cortas.',
      next_phase: 'videos',
      next_label: 'Grabar videos',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad'],
    },
    videos_pending: {
      label: 'Video respuestas',
      description: 'Tenés preguntas en video por contestar.',
      next_phase: 'videos',
      next_label: 'Continuar videos',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad'],
    },
    videos_completed: {
      label: 'Todas las pruebas completas ✓',
      description: 'Estamos revisando tu perfil. Si avanzás, te contactamos para entrevista.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
    },
    bot_decision_advance: {
      label: 'En revisión final',
      description: 'Tu perfil está siendo evaluado. Te avisaremos en los próximos días.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
    },
    finalist: {
      label: 'Finalista 🎯',
      description: 'Quedaste como finalista. La empresa cliente está revisando tu perfil.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
      is_positive: true,
    },
    awaiting_client_review: {
      label: 'Esperando respuesta del cliente',
      description: 'Tu reporte fue enviado al cliente. Si avanzás, te contactamos para entrevista.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
      is_positive: true,
    },
    interview_scheduled: {
      label: 'Entrevista agendada 📅',
      description: 'La empresa te quiere entrevistar. Revisá el email con los detalles.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
      is_positive: true,
    },
    offered: {
      label: 'Oferta enviada 💼',
      description: 'Recibiste una oferta. Revisá el email para detalles.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
      is_positive: true,
      is_terminal: true,
    },
    hired: {
      label: 'Contratado 🎉',
      description: '¡Felicitaciones! Comenzaste tu nueva posición.',
      show_completed: ['prescreening', 'tecnica', 'disc', 'integridad', 'video'],
      is_positive: true,
      is_terminal: true,
    },
    auto_rejected_low_score: {
      label: 'Gracias por participar',
      description: 'En esta búsqueda decidimos avanzar con otros candidatos. Te dejamos en nuestra base para futuras oportunidades.',
      show_completed: [],
      is_terminal: true,
    },
    rejected_by_admin: {
      label: 'Gracias por participar',
      description: 'En esta búsqueda decidimos avanzar con otros candidatos. Te dejamos en nuestra base para futuras oportunidades.',
      show_completed: [],
      is_terminal: true,
    },
    salary_out_of_range: {
      label: 'Gracias por participar',
      description: 'Tu expectativa salarial está fuera del rango del puesto. Te dejamos en nuestra base para puestos compatibles.',
      show_completed: [],
      is_terminal: true,
    },
    withdrew: {
      label: 'Proceso cancelado',
      description: 'Te retiraste del proceso.',
      show_completed: [],
      is_terminal: true,
    },
    offer_declined: {
      label: 'Oferta declinada',
      description: 'Declinaste la oferta. Te dejamos en nuestra base para futuras oportunidades.',
      show_completed: [],
      is_terminal: true,
    },
  };

  const meta = STAGE_LABELS[result.pipeline_stage] ?? {
    label: 'En proceso',
    description: 'Estamos procesando tu perfil.',
    show_completed: [],
  };

  sendJson(ctx.res, 200, {
    job: { title: job.title, company: job.company },
    status: {
      stage: result.pipeline_stage,
      label: meta.label,
      description: meta.description,
      is_terminal: meta.is_terminal ?? false,
      is_positive: meta.is_positive ?? false,
    },
    completed_phases: meta.show_completed,
    next: meta.next_phase ? { phase: meta.next_phase, label: meta.next_label } : null,
  });
}

// =============================================================================
// Prescreening — feature post-Recruit (reemplaza el filtro inicial de Recruit)
// =============================================================================

/**
 * GET /test/:token/prescreening — devuelve las preguntas del prescreening del job
 * SIN exponer accepted_indices (eso es server-side, sino el candidato puede hackear).
 */
export async function getTestPrescreening(ctx: RequestContext): Promise<void> {
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

  const jobRow = unwrapRows<{ ROWID: string; prescreening_questions_cache?: string | null; title?: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, prescreening_questions_cache, title FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];

  if (!jobRow) {
    sendJson(ctx.res, 200, { questions: [], status: 'job_not_found' });
    return;
  }

  const cache = jobRow.prescreening_questions_cache;
  if (!cache) {
    sendJson(ctx.res, 200, { questions: [], status: 'no_cache', job_title: jobRow.title });
    return;
  }

  // Parsear cache. Si es status marker, devolver vacío con status.
  let parsedCache: unknown;
  try { parsedCache = JSON.parse(cache); } catch { parsedCache = null; }

  if (parsedCache && typeof parsedCache === 'object' && 'status' in parsedCache && !Array.isArray(parsedCache)) {
    const marker = parsedCache as { status?: string };
    sendJson(ctx.res, 200, { questions: [], status: marker.status ?? 'unknown', job_title: jobRow.title });
    return;
  }

  if (!Array.isArray(parsedCache)) {
    sendJson(ctx.res, 200, { questions: [], status: 'no_cache', job_title: jobRow.title });
    return;
  }

  // Sanitizar: NO exponer accepted_indices ni rejection_reason ni criterion
  type Internal = { id: string; text: string; type: string; options: string[] };
  const sanitized = (parsedCache as Internal[]).map((q) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    options: q.options,
  }));

  sendJson(ctx.res, 200, {
    questions: sanitized,
    status: 'ok',
    job_title: jobRow.title,
  });
}

/**
 * POST /test/:token/prescreening/submit — recibe respuestas, evalúa server-side,
 * transiciona stage.
 *
 * Body: { answers: [{ question_id, selected_index }] }
 *
 * Response:
 *   - { passed: true, next_step: 'tecnica' }      → candidato avanza
 *   - { passed: false, reason }                    → auto-rechazo
 */
export async function submitTestPrescreening(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? '/';
  const match = url.match(/^\/test\/([^/]+)\/prescreening\/submit\/?$/);
  const token = match?.[1];
  if (!token) throw new ValidationError('token missing in path');

  let claims;
  try {
    claims = verifyToken(token, 'test');
  } catch (err) {
    if (err instanceof TokenError) throw new UnauthorizedError(`Token: ${err.reason}`);
    throw err;
  }

  const body = await readJsonBody<{ answers?: Array<{ question_id: string; selected_index: number }> }>(ctx.req);
  if (!body?.answers || !Array.isArray(body.answers)) {
    throw new ValidationError('answers array required');
  }

  const result = await getResult(ctx, claims.ref);
  if (!result) throw new NotFoundError(`Application not found`);

  const jobRow = unwrapRows<{ ROWID: string; prescreening_questions_cache?: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, prescreening_questions_cache FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
    )) as unknown[],
    'Jobs',
  )[0];
  if (!jobRow?.prescreening_questions_cache) {
    throw new NotFoundError('Prescreening no configurado en este puesto');
  }

  let questions: import('../lib/prescreeningQuestions').PrescreeningQuestion[] = [];
  try {
    const parsed = JSON.parse(jobRow.prescreening_questions_cache);
    if (Array.isArray(parsed)) questions = parsed;
  } catch { /* questions stays [] */ }
  if (questions.length === 0) {
    throw new NotFoundError('Prescreening no configurado correctamente');
  }

  const { evaluatePrescreeningAnswers } = await import('../lib/prescreeningQuestions.js');
  const verdict = evaluatePrescreeningAnswers(questions, body.answers);

  const targetStage = verdict.passed ? 'prefilter_passed' : 'auto_rejected_low_score';

  // Transicionar stage
  await datastore(ctx.req).table('Results').updateRow({
    ROWID: result.ROWID,
    pipeline_stage: targetStage,
  });

  // Registrar la transición en PipelineTransitions
  try {
    await datastore(ctx.req).table('PipelineTransitions').insertRow({
      result_id: result.ROWID,
      from_stage: result.pipeline_stage,
      to_stage: targetStage,
      actor: 'system:prescreening',
      reason: verdict.passed ? 'prescreening_passed' : `prescreening_failed:${verdict.failedQuestion?.id ?? 'unknown'}`,
      transitioned_at: now(),
    });
  } catch (err) {
    log.warn('failed to record PipelineTransitions', { error: (err as Error).message });
  }

  // Notificación al candidato (siguiente paso o rechazo amable). audit fix #16.
  {
    const { fireAndForget } = await import('../lib/fireAndForget.js');
    fireAndForget('notifyCandidateOnTransition[prescreening]', async () => {
      const { notifyCandidateOnTransition } = await import('../lib/candidateNotifier.js');
      await notifyCandidateOnTransition(ctx.req, {
        applicationId: result.ROWID,
        toStage: targetStage,
        reason: verdict.failedQuestion?.criterion,
      });
    });
  }

  // Notificación a Cris si el candidato fue auto-rechazado en prescreening.
  // Útil para afinar criterios (¿estás filtrando de más?).
  if (!verdict.passed) {
    void (async () => {
      try {
        const { enqueueNotification } = await import('./notifications.js');
        const meta = unwrapRows<{ tenant_id: string; candidate_name: string; job_title: string }>(
          (await zcql(ctx.req).executeZCQLQuery(
            `SELECT J.tenant_id AS tenant_id, C.name AS candidate_name, J.title AS job_title
             FROM Results R JOIN Jobs J ON J.ROWID = R.assessment_id
             JOIN Candidates C ON C.ROWID = R.candidate_id
             WHERE R.ROWID = '${escapeSql(result.ROWID)}' LIMIT 1`,
          )) as unknown[],
          'Results',
        )[0];
        if (meta) {
          await enqueueNotification(ctx.req, {
            tenantId: meta.tenant_id,
            type: 'candidate_auto_rejected',
            message: `${meta.candidate_name || 'Candidato'} no pasó prescreening para ${meta.job_title} (criterio: ${verdict.failedQuestion?.criterion ?? 'desconocido'})`,
            resourceType: 'application',
            resourceId: result.ROWID,
            link: `/candidates/${result.ROWID}`,
          });
        }
      } catch (err) {
        log.warn('cris prescreening notification failed', { error: (err as Error).message });
      }
    })();
  }

  log.info('prescreening evaluated', {
    traceId: ctx.traceId,
    resultId: result.ROWID,
    passed: verdict.passed,
    failedQuestion: verdict.failedQuestion?.id,
  });

  if (verdict.passed) {
    sendJson(ctx.res, 200, { passed: true, next_step: 'tecnica' });
  } else {
    sendJson(ctx.res, 200, {
      passed: false,
      reason: verdict.failedQuestion?.rejection_reason ?? 'No cumplís con un criterio crítico del puesto',
      failed_criterion: verdict.failedQuestion?.criterion,
    });
  }
}
