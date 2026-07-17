import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec B Fase 2 — Validación end-to-end de DISC + VELNA + Emoción + Integridad + Mindset + Inglés.
 *
 * Hereda la estructura de Fase 1 PERO esta vez los candidatos NO se detienen en técnica:
 * completan los 5 tests adicionales y validamos que el motor de auto-rechazo + Duda CV
 * + reglas de pipeline (Cris 2026-06-12) se respetan.
 *
 * Reglas que se verifican (memoria project_reglas_pipeline_candidato.md):
 *   🔴 AUTO-RECHAZO:
 *     - Integridad con dim hard-reject en 'bajo': hurto/soborno/drogas/alcohol/confiabilidad
 *     - DISC similitud < umbral (regla legacy, sigue funcionando si auto_rejection_rules la setea)
 *   🟡 DUDA CV (needs_review):
 *     - Inglés bajo el mínimo
 *     - Integridad con dim review en 'bajo': honestidad/imparcialidad/autenticidad/etc.
 *   🟢 NUNCA RECHAZA:
 *     - Mindset (siempre informativo)
 *     - Conductual puro (DISC/VELNA/Emoción) sin reglas legacy
 *
 * Distribución de 10 candidatos:
 *   - 3 BUENOS: DISC alineado (>75%) + VELNA alto + integridad limpia + mindset adaptable + inglés pasa
 *   - 4 MEDIOS: DISC ~50% + VELNA mixto + 1-2 dims review en bajo + mindset mixto + inglés falla por 1-2 pts
 *   - 3 MALOS: DISC <30% + VELNA bajo + 1-2 dims HARD REJECT en bajo (hurto/soborno/etc.) + mindset rígido + inglés fallo total
 *
 * Endpoint principal: POST /test/<token>/submit (acepta todos los bloques en una sola call).
 * Para mindset + inglés se usan endpoints dedicados.
 *
 * Email destino: chrismarpalma+specb-f2-{n}@gmail.com (alias Gmail → mismo inbox + pattern
 * que wipe-all-test-data detecta).
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-b-candidatos-fase2.spec.ts
 *
 * NOTA: depende de un puesto real publicado vía Recruit con:
 *   - prefilter generado
 *   - tech_questions generadas
 *   - ideal_profile con disc + (opcional) auto_rejection_rules
 *   - english_required + mindset_required (idealmente configurados, pero el spec funciona
 *     aunque no estén — solo no validará el flag de Duda CV por inglés)
 *
 * Reusa el puesto de Fase 1 por default. Override con E2E_JOB_SLUG.
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const JOB_SLUG = process.env.E2E_JOB_SLUG_F2 ?? process.env.E2E_JOB_SLUG ?? 'coordinador-de-logistica';

/** PDF mínimo válido (~192 bytes) — mismo helper que Fase 1. */
function makeMinimalPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
    'utf8',
  );
}

const RUN_TAG = Date.now().toString(36);
const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-b-f2-${RUN_TAG}.json`);

type Profile = 'bueno' | 'medio' | 'malo';

type Candidate = {
  idx: number;
  name: string;
  email: string;
  profile: Profile;
};

function buildCandidates(): Candidate[] {
  const cs: Candidate[] = [];
  // 3 buenos
  for (let i = 1; i <= 3; i++) {
    cs.push({
      idx: i,
      name: `Bueno F2 ${i}`,
      email: `chrismarpalma+specb-f2-${RUN_TAG}-bueno${i}@gmail.com`,
      profile: 'bueno',
    });
  }
  // 4 medios
  for (let i = 1; i <= 4; i++) {
    cs.push({
      idx: 3 + i,
      name: `Medio F2 ${i}`,
      email: `chrismarpalma+specb-f2-${RUN_TAG}-medio${i}@gmail.com`,
      profile: 'medio',
    });
  }
  // 3 malos
  for (let i = 1; i <= 3; i++) {
    cs.push({
      idx: 7 + i,
      name: `Malo F2 ${i}`,
      email: `chrismarpalma+specb-f2-${RUN_TAG}-malo${i}@gmail.com`,
      profile: 'malo',
    });
  }
  return cs;
}

// ===== Builders de payloads por perfil =====

type DiscPayload = { raw_d: number; raw_i: number; raw_s: number; raw_c: number; total_questions: number };
type VelnaPayload = {
  verbal: number; espacial: number; logica: number; numerica: number; abstracta: number;
  total: number; max: number;
};
type EmotionalPayload = { score: number };
type IntegrityDimPayload = { dimension: string; pct: number };

/**
 * DISC normalizado per-axis 0-100 (modelo V1 confirmado memoria project_disc_per_axis_0_100).
 * Para el cálculo de similitud usamos min/max ratio.
 * Como NO sabemos el ideal_profile del puesto al tiempo del test, generamos perfiles
 * extremos para que la similitud caiga bien por encima/abajo del 50% típico.
 */
function buildDisc(profile: Profile): DiscPayload {
  // total_questions=24 → raw es 0-24. normalizado * 100 / 24 → 0-100.
  // Buenos: tendencia balanceada D=I=S=C (60 ~ 60% en cada eje), funciona razonable contra cualquier ideal.
  // Medios: extremo D dominante.
  // Malos: extremo C alto + S muy bajo (anti-perfil típico).
  if (profile === 'bueno') return { raw_d: 14, raw_i: 14, raw_s: 14, raw_c: 14, total_questions: 24 };
  if (profile === 'medio') return { raw_d: 20, raw_i: 12, raw_s: 8, raw_c: 6, total_questions: 24 };
  return { raw_d: 2, raw_i: 2, raw_s: 2, raw_c: 22, total_questions: 24 };
}

/**
 * VELNA en porcentajes 0-100 por subtest. Total y max son agregados.
 * Buenos: >75 en todas — escala 80/100 = 80%.
 * Medios: ~50 mixto.
 * Malos: <30 todas.
 */
function buildVelna(profile: Profile): VelnaPayload {
  if (profile === 'bueno') {
    return { verbal: 80, espacial: 78, logica: 82, numerica: 75, abstracta: 80, total: 80, max: 100 };
  }
  if (profile === 'medio') {
    return { verbal: 60, espacial: 45, logica: 55, numerica: 40, abstracta: 50, total: 50, max: 100 };
  }
  return { verbal: 20, espacial: 25, logica: 22, numerica: 18, abstracta: 24, total: 22, max: 100 };
}

function buildEmotional(profile: Profile): EmotionalPayload {
  if (profile === 'bueno') return { score: 55 }; // mesura
  if (profile === 'medio') return { score: 45 }; // mesura tirando a espontáneo
  return { score: 20 }; // espontáneo (NO rechaza per Cris)
}

/**
 * 13 dimensiones de integridad. pct 0-100.
 * classifyIntegrityPct usa umbrales por dimensión (ver scoring.ts):
 *   hurto: medioMin=21, altoMin=41 → bajo: 0-20, medio: 21-40, alto: 41-100
 *   buena_impresion: invertida — alto = malo. Pero al spec lo importante es que ≥60 = alto en bi.
 *
 * Lo CLAVE: para que dispare auto-rechazo / Duda CV vía evaluateAutoRejection() se mira la
 * clasificación de cada dimensión devuelta por classifyIntegrityPct(pct, dim). bajo = problema.
 *
 * Buenos: todas pct ≥ 70 → todas 'alto' (sano).
 * Medios: 1-2 dims review en bajo (honestidad / imparcialidad) → Duda CV.
 * Malos: 1-2 dims hard-reject en bajo (hurto / confiabilidad) → AUTO-RECHAZO.
 */
function buildIntegrity(profile: Profile, idx: number): IntegrityDimPayload[] {
  const allDims = [
    'autenticidad', 'inteligencia_social', 'imparcialidad', 'sencillez',
    'dominio_personal', 'honestidad', 'hurto', 'soborno', 'alcohol',
    'drogas', 'confiabilidad', 'apuestas', 'buena_impresion',
  ];

  if (profile === 'bueno') {
    return allDims.map((d) => ({ dimension: d, pct: d === 'buena_impresion' ? 30 : 75 }));
  }

  if (profile === 'medio') {
    // 1-2 dims review en 'bajo' (honestidad e imparcialidad). El resto sano.
    // pct=15 → bajo en honestidad (medioMin típico ~30 para review dims).
    return allDims.map((d) => {
      if (d === 'honestidad') return { dimension: d, pct: 15 };
      if (idx % 2 === 0 && d === 'imparcialidad') return { dimension: d, pct: 15 };
      if (d === 'buena_impresion') return { dimension: d, pct: 30 };
      return { dimension: d, pct: 75 };
    });
  }

  // Malo: 1-2 dims HARD REJECT en bajo. pct=15 < medioMin(21) → 'bajo'.
  return allDims.map((d) => {
    if (d === 'hurto') return { dimension: d, pct: 15 };
    if (idx % 2 === 0 && d === 'confiabilidad') return { dimension: d, pct: 15 };
    if (d === 'buena_impresion') return { dimension: d, pct: 70 };
    return { dimension: d, pct: 50 };
  });
}

// ===== Mindset =====

type MindsetAnswer = { question_id: string; chosen_mentalidad: string };

/**
 * Buenos: todas adaptables (crecimiento, curiosa, creativa, etc.).
 * Medios: mezcla 50/50.
 * Malos: todas limitantes (fija, experto, reactiva, etc.).
 *
 * Sin saber el banco completo, generamos N preguntas sintéticas. El backend acepta
 * cualquier question_id arbitrario y solo usa la mentalidad elegida para scoring.
 */
function buildMindsetAnswers(profile: Profile): MindsetAnswer[] {
  const adaptables = ['crecimiento', 'curiosa', 'creativa', 'agente', 'abundancia', 'exploracion', 'oportunidad'];
  const limitantes = ['fija', 'experto', 'reactiva', 'victima', 'escasez', 'certeza', 'proteccion'];
  const out: MindsetAnswer[] = [];
  for (let i = 1; i <= 14; i++) {
    let chosen: string;
    if (profile === 'bueno') {
      chosen = adaptables[i % adaptables.length];
    } else if (profile === 'medio') {
      chosen = (i % 2 === 0) ? adaptables[i % adaptables.length] : limitantes[i % limitantes.length];
    } else {
      chosen = limitantes[i % limitantes.length];
    }
    out.push({ question_id: `m${i}`, chosen_mentalidad: chosen });
  }
  return out;
}

// ===== Inglés =====

type EnglishPayload = {
  level: 'A2' | 'B1' | 'B2' | 'C1';
  mc_correct: number; mc_total: number;
  listening_correct: number; listening_total: number;
  writing_text: string;
  writing_word_count: number;
  writing_time_seconds: number;
  writing_paste_attempts: number;
  writing_focus_lost_count: number;
};

/**
 * Nivel requerido B1.
 * Buenos: ~17/20 mc + 2/2 listening + writing largo en inglés decente → pasa.
 * Medios: ~12/20 mc + 1/2 listening + writing corto → falla por 1-2 pts (Duda CV).
 * Malos: 4/20 mc + 0/2 listening + writing en español → falla total.
 */
function buildEnglish(profile: Profile): EnglishPayload {
  const baseLevel: EnglishPayload['level'] = 'B1';
  if (profile === 'bueno') {
    return {
      level: baseLevel,
      mc_correct: 17, mc_total: 20,
      listening_correct: 2, listening_total: 2,
      writing_text:
        'I have been working in logistics for over five years, managing supply chains and ' +
        'coordinating with international vendors. My role required strong communication skills ' +
        'in English to negotiate contracts and resolve operational issues across multiple regions.',
      writing_word_count: 50,
      writing_time_seconds: 480,
      writing_paste_attempts: 0,
      writing_focus_lost_count: 0,
    };
  }
  if (profile === 'medio') {
    return {
      level: baseLevel,
      mc_correct: 11, mc_total: 20,
      listening_correct: 1, listening_total: 2,
      writing_text:
        'I work logistics. I help company with shipment. I speak english sometimes with client ' +
        'but not perfect. I learn more english every day for my job.',
      writing_word_count: 30,
      writing_time_seconds: 300,
      writing_paste_attempts: 1,
      writing_focus_lost_count: 2,
    };
  }
  return {
    level: baseLevel,
    mc_correct: 4, mc_total: 20,
    listening_correct: 0, listening_total: 2,
    writing_text: 'Yo trabajar logistica mucho. No hablar mucho ingles. Aprender despues.',
    writing_word_count: 12,
    writing_time_seconds: 60,
    writing_paste_attempts: 3,
    writing_focus_lost_count: 5,
  };
}

// ===== Spec =====

test('Spec B Fase 2: 10 candidatos completan DISC + VELNA + Integridad + Mindset + Inglés', async ({ request }) => {
  test.setTimeout(20 * 60 * 1000); // 20 min máx

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cvPdf = makeMinimalPdf();
  const candidates = buildCandidates();
  const results: Array<Record<string, unknown>> = [];

  // Helper: aplicar + token + cargar prefilter/tech para un candidato.
  // Reusa el patrón de Fase 1 pero compacto.
  async function setupCandidate(c: Candidate): Promise<{
    applicationId: string; candidateId: string; jobId: string; token: string;
    prefilterQs: Array<{ id: string; type: string; options: string[]; accepted_indices: number[]; criterion?: string }>;
    techQs: Array<{
      id: string; kind: 'technical' | 'situational'; options: string[];
      correct?: number; option_validity?: boolean[];
      option_style?: Array<{ axis: string; value: string } | null>;
    }>;
  } | null> {
    const applyRes = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${JOB_SLUG}/apply`,
      {
        multipart: {
          first_name: c.name.split(' ')[0],
          last_name: 'FaseDos',
          email: c.email,
          phone: `+507${6100000 + c.idx}`,
          age: '29',
          city: 'Panama',
          country: 'Panama',
          consent_terms: 'true',
          cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: cvPdf },
        },
      },
    );
    const applyBody = await applyRes.json().catch(() => ({}));
    if (applyRes.status() !== 201) return null;

    const applicationId = applyBody.result_id as string;
    const candidateId = applyBody.candidate_id as string;

    const tokenRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-get-test-token?application_id=${applicationId}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (tokenRes.status() !== 200) return null;
    const token = tokenBody.token as string;
    const jobId = tokenBody.job_id as string;

    const pqRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-get-questions-for-job?job_id=${jobId}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    const pqBody = await pqRes.json().catch(() => ({}));
    const prefilterQs = Array.isArray(pqBody.prefilter) ? pqBody.prefilter : [];
    const techQs = Array.isArray(pqBody.tech) ? pqBody.tech : [];

    return { applicationId, candidateId, jobId, token, prefilterQs, techQs };
  }

  // Helper: responder prefilter eligiendo el primer accepted_index (siempre pasa).
  async function passPrefilter(token: string, prefilterQs: Array<{ id: string; accepted_indices: number[] }>) {
    const answers = prefilterQs.map((q) => ({
      question_id: q.id,
      selected_index: q.accepted_indices[0] ?? 0,
    }));
    const res = await request.post(
      `${BASE_API}/server/api/test/${token}/prescreening/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: { answers } },
    );
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), passed: body.passed === true };
  }

  // Helper: completar técnica con buenas respuestas (no es el foco de F2).
  async function submitTecnica(token: string, techQs: Array<{
    id: string; kind: string; correct?: number; option_validity?: boolean[];
  }>) {
    const techAnswers: Record<string, number> = {};
    for (const q of techQs) {
      if (q.kind === 'technical' && typeof q.correct === 'number') {
        techAnswers[q.id] = q.correct;
      } else if (q.kind === 'situational' && Array.isArray(q.option_validity)) {
        const firstValid = q.option_validity.findIndex((v) => v === true);
        techAnswers[q.id] = firstValid >= 0 ? firstValid : 0;
      }
    }
    const res = await request.post(
      `${BASE_API}/server/api/test/${token}/submit`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { tecnica: { answers: techAnswers, min_required: 60 } },
      },
    );
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // Helper: submit del bloque conductual + integridad en una sola call.
  async function submitConductualPlusIntegrity(
    token: string,
    c: Candidate,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const disc = buildDisc(c.profile);
    const velna = buildVelna(c.profile);
    const emotional = buildEmotional(c.profile);
    const dims = buildIntegrity(c.profile, c.idx);
    const res = await request.post(
      `${BASE_API}/server/api/test/${token}/submit`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          disc, velna, emotional,
          integridad: { dimensions: dims },
        },
      },
    );
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async function submitMindset(token: string, c: Candidate): Promise<{ status: number; body: Record<string, unknown> }> {
    const answers = buildMindsetAnswers(c.profile);
    const res = await request.post(
      `${BASE_API}/server/api/test/${token}/mindset/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: { answers } },
    );
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async function submitEnglish(token: string, c: Candidate): Promise<{ status: number; body: Record<string, unknown> }> {
    const payload = buildEnglish(c.profile);
    const res = await request.post(
      `${BASE_API}/server/api/test/${token}/english/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: payload },
    );
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // Procesamos candidatos en paralelo de a 3 para no saturar el backend.
  const BATCH_SIZE = 3;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (c) => {
      console.log(`\n[${c.profile.toUpperCase()} ${c.idx}] ${c.name} (${c.email})`);
      const result: Record<string, unknown> = {
        idx: c.idx, name: c.name, email: c.email, profile: c.profile, steps: [],
      };
      const steps = result.steps as string[];

      const setup = await setupCandidate(c);
      if (!setup) {
        steps.push(`x setup failed`);
        return result;
      }
      result.application_id = setup.applicationId;
      result.candidate_id = setup.candidateId;
      result.job_id = setup.jobId;
      steps.push(`OK setup (app=${setup.applicationId})`);

      // Prefilter
      const pre = await passPrefilter(setup.token, setup.prefilterQs);
      if (pre.status !== 200 || !pre.passed) {
        steps.push(`x prefilter status=${pre.status} passed=${pre.passed}`);
        return result;
      }
      steps.push(`OK prefilter PASS`);

      // Técnica (siempre pasamos — F2 valida los OTROS tests)
      const tec = await submitTecnica(setup.token, setup.techQs);
      if (tec.status !== 200) {
        steps.push(`x tecnica status=${tec.status}`);
        return result;
      }
      result.tecnica_response = tec.body;
      steps.push(`OK tecnica submit`);

      // DISC + VELNA + Emocional + Integridad → en un solo POST /submit
      const conInt = await submitConductualPlusIntegrity(setup.token, c);
      if (conInt.status !== 200) {
        steps.push(`x conductual+integridad status=${conInt.status} body=${JSON.stringify(conInt.body).slice(0, 200)}`);
        return result;
      }
      result.conductual_integridad_response = conInt.body;
      const autoRejected = conInt.body.auto_rejected as { reasons: string[] } | undefined;
      const needsReview = conInt.body.needs_review as { reasons: string[] } | undefined;
      result.auto_rejected = autoRejected ?? null;
      result.needs_review_from_conductual = needsReview ?? null;
      steps.push(`OK conductual+integridad — auto_rejected=${!!autoRejected} needs_review=${!!needsReview}`);

      // Mindset (opcional — si la tabla no está creada, 503 y seguimos)
      const mindset = await submitMindset(setup.token, c);
      result.mindset_status = mindset.status;
      result.mindset_response = mindset.body;
      if (mindset.status === 200) {
        steps.push(`OK mindset pattern=${(mindset.body as Record<string, unknown>).adaptability_pattern}`);
      } else if (mindset.status === 503) {
        steps.push(`- mindset tabla no creada (503) - skip`);
      } else {
        steps.push(`x mindset status=${mindset.status}`);
      }

      // Inglés (opcional — si la tabla no está creada, 503 y seguimos)
      const english = await submitEnglish(setup.token, c);
      result.english_status = english.status;
      result.english_response = english.body;
      if (english.status === 200) {
        steps.push(`OK english passed=${(english.body as Record<string, unknown>).passed}`);
      } else if (english.status === 503) {
        steps.push(`- english tabla no creada (503) - skip`);
      } else {
        steps.push(`x english status=${english.status}`);
      }

      return result;
    }));
    results.push(...batchResults);
    // Pausa breve entre batches
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Guardar output completo
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    run_tag: RUN_TAG,
    job_slug: JOB_SLUG,
    candidates: results,
  }, null, 2));

  // ===== Validaciones agregadas =====

  console.log(`\n=== Resumen Spec B Fase 2 ===`);
  const okApply = results.filter((r) => r.application_id).length;
  const okConInt = results.filter((r) => r.conductual_integridad_response).length;
  const buenos = results.filter((r) => r.profile === 'bueno');
  const medios = results.filter((r) => r.profile === 'medio');
  const malos = results.filter((r) => r.profile === 'malo');

  console.log(`Aplicaciones OK:                ${okApply}/${candidates.length}`);
  console.log(`Conductual+Integridad OK:       ${okConInt}/${candidates.length}`);

  // --- BUENOS: NO deben tener auto_rejected ---
  const buenosAutoRejected = buenos.filter((r) => r.auto_rejected);
  console.log(`Buenos auto-rechazados:         ${buenosAutoRejected.length}/${buenos.length} (esperado 0)`);

  // --- MEDIOS: deben tener needs_review pero NO auto-rejected (por integridad review dims o inglés) ---
  const mediosAutoRejected = medios.filter((r) => r.auto_rejected);
  const mediosNeedsReview = medios.filter((r) => {
    // Puede venir o del bloque conductual (integridad review dims) o del inglés (passed=false).
    if (r.needs_review_from_conductual) return true;
    const eng = r.english_response as Record<string, unknown> | undefined;
    return eng?.passed === false;
  });
  console.log(`Medios auto-rechazados:         ${mediosAutoRejected.length}/${medios.length} (esperado 0)`);
  console.log(`Medios con needs_review:        ${mediosNeedsReview.length}/${medios.length} (esperado >=2)`);

  // --- MALOS: deben tener auto_rejected con razon hard-reject de integridad ---
  const malosAutoRejected = malos.filter((r) => {
    const ar = r.auto_rejected as { reasons: string[] } | null | undefined;
    if (!ar) return false;
    return ar.reasons.some((s) =>
      /hurto|soborno|drogas|alcohol|confiabilidad/i.test(s),
    );
  });
  console.log(`Malos auto-rechazados (hard):   ${malosAutoRejected.length}/${malos.length} (esperado >=2)`);

  // --- Mindset NUNCA dispara auto-rechazo (regla Cris) ---
  const mindsetCausedReject = results.filter((r) => {
    const ar = r.auto_rejected as { reasons: string[] } | null | undefined;
    if (!ar) return false;
    return ar.reasons.some((s) => /mindset|adaptabilidad/i.test(s));
  });
  console.log(`Auto-rechazos por mindset:      ${mindsetCausedReject.length} (esperado 0)`);

  console.log(`Output JSON: ${OUTPUT_FILE}`);

  // ===== Aserciones duras =====

  expect(okApply, 'Todas las aplicaciones deben crearse').toBe(candidates.length);
  expect(okConInt, 'Todos los candidatos deben completar conductual+integridad').toBeGreaterThanOrEqual(
    Math.floor(candidates.length * 0.8),
  );

  // Buenos: 0 auto-rechazos
  expect(buenosAutoRejected.length, 'Ningun BUENO debe ser auto-rechazado').toBe(0);

  // Medios: 0 auto-rechazos
  expect(mediosAutoRejected.length, 'Ningun MEDIO debe ser auto-rechazado').toBe(0);

  // Medios: al menos algunos deben tener needs_review (sea por integridad o inglés)
  // Si las tablas Mindset/English no están, esto sigue validando integridad.
  expect(mediosNeedsReview.length, 'Al menos 2 MEDIOS deben tener needs_review').toBeGreaterThanOrEqual(2);

  // Malos: al menos 2 de 3 deben tener auto_rejected con dim hard-reject
  expect(malosAutoRejected.length, 'Al menos 2 MALOS deben ser auto-rechazados por dim hard-reject').toBeGreaterThanOrEqual(2);

  // Mindset nunca rechaza
  expect(mindsetCausedReject.length, 'Mindset NUNCA puede causar auto-rechazo (regla Cris)').toBe(0);

  // Sanity: el flag conductual NUNCA agrega "DISC bajo" como reason de auto-rechazo
  // a menos que el ideal_profile del Job tenga auto_rejection_rules.disc_min_similarity.
  // Si lo tiene, esa es la regla LEGACY explicitamente queriendo validarse.
  // Aca solo confirmamos que NO hay auto-rechazos por "Emocional" o "VELNA" en buenos.
  const buenosConProblemaConductual = buenos.filter((r) => {
    const ar = r.auto_rejected as { reasons: string[] } | null | undefined;
    if (!ar) return false;
    return ar.reasons.some((s) => /VELNA|Emocional/i.test(s));
  });
  expect(buenosConProblemaConductual.length, 'Ningun BUENO debe ser rechazado por VELNA/Emocional').toBe(0);
});
