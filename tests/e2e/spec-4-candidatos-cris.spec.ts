/**
 * Spec — 4 candidatos por nombre que Cris pidió 2026-06-17.
 *
 * Perfiles:
 *  - Luis Bueno    → pasa TODO (apply → prefilter → técnica OK → DISC + VELNA + Emo + Integridad limpia → Mindset + Inglés OK)
 *  - Andrea Bueno  → idem
 *  - Marta Medio   → queda EN TÉCNICA (apply + prefilter OK, pero técnica con score muy bajo → Rechazado)
 *  - Patricia Medio → queda EN CONDUCTUAL/DISC (técnica OK, NO hace Integridad/Mindset/Inglés)
 *
 * Email: chrismarpalma+cris-{name}@gmail.com (alias Gmail → mismo inbox + lo limpia el wipe).
 *
 * Reporte de errores: cada paso (apply/prefilter/técnica/disc-velna/integridad/mindset/inglés)
 * loguea status HTTP + cuerpo. Si algo falla, queda registrado en steps[] y en el JSON output.
 *
 * Uso:
 *   PLAYWRIGHT_BASE_URL=https://app.sharktalents.ai \
 *   E2E_JOB_SLUG=test-e2e---asistente-administrativo-232717 \
 *   npx playwright test tests/e2e/spec-4-candidatos-cris.spec.ts --reporter=line
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const JOB_SLUG = process.env.E2E_JOB_SLUG ?? 'test-e2e---asistente-administrativo';

const RUN_TAG = Date.now().toString(36);
const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-cris-${RUN_TAG}.json`);

function makeMinimalPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
    'utf8',
  );
}

type StopAt = 'tecnica-rechazado' | 'disc-stuck' | 'completar-todo';

type Candidate = {
  idx: number;
  first_name: string;
  last_name: string;
  email: string;
  profile: 'bueno' | 'medio';
  stop_at: StopAt;
};

const CANDIDATES: Candidate[] = [
  { idx: 1, first_name: 'Luis',     last_name: 'Bueno',  email: `chrismarpalma+cris-${RUN_TAG}-luis@gmail.com`,     profile: 'bueno', stop_at: 'completar-todo' },
  { idx: 2, first_name: 'Andrea',   last_name: 'Bueno',  email: `chrismarpalma+cris-${RUN_TAG}-andrea@gmail.com`,   profile: 'bueno', stop_at: 'completar-todo' },
  { idx: 3, first_name: 'Marta',    last_name: 'Medio',  email: `chrismarpalma+cris-${RUN_TAG}-marta@gmail.com`,    profile: 'medio', stop_at: 'tecnica-rechazado' },
  { idx: 4, first_name: 'Patricia', last_name: 'Medio',  email: `chrismarpalma+cris-${RUN_TAG}-patricia@gmail.com`, profile: 'medio', stop_at: 'disc-stuck' },
];

test('Spec Cris: 4 candidatos con nombres reales', async ({ request }) => {
  test.setTimeout(15 * 60 * 1000);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cvPdf = makeMinimalPdf();
  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const c of CANDIDATES) {
    const full_name = `${c.first_name} ${c.last_name}`;
    console.log(`\n=== [${c.profile.toUpperCase()}] ${full_name} (${c.email}) ===`);
    const result: Record<string, unknown> = {
      idx: c.idx,
      name: full_name,
      email: c.email,
      profile: c.profile,
      stop_at: c.stop_at,
      steps: [],
      errors: [],
    };
    const steps = result.steps as string[];
    const errs = result.errors as string[];

    function logErr(step: string, msg: string) {
      const e = `[${full_name}] ${step}: ${msg}`;
      errs.push(e);
      errors.push(e);
      console.error(`❌ ${e}`);
    }

    // === Paso 1: Apply ===
    const applyRes = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${JOB_SLUG}/apply`,
      {
        multipart: {
          first_name: c.first_name,
          last_name: c.last_name,
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
    if (applyRes.status() !== 201) {
      logErr('apply', `status=${applyRes.status()} body=${JSON.stringify(applyBody).slice(0, 200)}`);
      results.push(result);
      continue;
    }
    const applicationId = applyBody.result_id as string;
    result.application_id = applicationId;
    steps.push(`✅ apply OK (app=${applicationId})`);
    console.log(`  ✅ apply OK`);

    // === Paso 2: obtener token ===
    const tokenRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-get-test-token?application_id=${applicationId}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (tokenRes.status() !== 200) {
      logErr('get-token', `status=${tokenRes.status()}`);
      results.push(result);
      continue;
    }
    const token = tokenBody.token as string;
    const jobId = tokenBody.job_id as string;
    result.job_id = jobId;
    steps.push(`✅ token obtenido`);

    // === Paso 3: cargar preguntas (prefilter + técnica) ===
    const pqRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-get-questions-for-job?job_id=${jobId}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    const pqBody = await pqRes.json().catch(() => ({}));
    const prefilterQs = (Array.isArray(pqBody.prefilter) ? pqBody.prefilter : []) as Array<{ id: string; accepted_indices: number[] }>;
    const techQs = (Array.isArray(pqBody.tech) ? pqBody.tech : []) as Array<{
      id: string; kind: 'technical' | 'situational'; options: string[];
      correct?: number; option_validity?: boolean[];
    }>;
    if (prefilterQs.length === 0) {
      logErr('preguntas', `prefilter vacío`);
      results.push(result);
      continue;
    }
    if (techQs.length === 0) {
      logErr('preguntas', `tech vacío`);
      results.push(result);
      continue;
    }
    steps.push(`✅ preguntas: prefilter=${prefilterQs.length} tech=${techQs.length}`);

    // === Paso 4: Prefilter (siempre pasa - eligen primer accepted_index) ===
    const prefAnswers = prefilterQs.map((q) => ({
      question_id: q.id,
      selected_index: q.accepted_indices[0] ?? 0,
    }));
    const prefRes = await request.post(
      `${BASE_API}/server/api/test/${token}/prescreening/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: { answers: prefAnswers } },
    );
    const prefBody = await prefRes.json().catch(() => ({}));
    if (prefRes.status() !== 200 || prefBody.passed !== true) {
      logErr('prefilter', `status=${prefRes.status()} passed=${prefBody.passed} body=${JSON.stringify(prefBody).slice(0, 200)}`);
      results.push(result);
      continue;
    }
    steps.push(`✅ prefilter PASS`);
    console.log(`  ✅ prefilter PASS`);

    // === Paso 5: Técnica ===
    // Buenos: aciertan todo. Marta: aciertan SOLO 3 (score muy bajo → Rechazado).
    const wantTecnicaPass = c.stop_at !== 'tecnica-rechazado';
    const techAnswers: Record<string, number> = {};
    let correctCount = 0;
    for (const q of techQs) {
      let chosen = 0;
      if (q.kind === 'technical' && typeof q.correct === 'number') {
        if (wantTecnicaPass) {
          chosen = q.correct;
          correctCount++;
        } else {
          // Acertar solo las primeras 3 → score ~12% < 60% mínimo
          if (correctCount < 3) {
            chosen = q.correct;
            correctCount++;
          } else {
            chosen = (q.correct + 1) % q.options.length;
          }
        }
      } else if (q.kind === 'situational' && Array.isArray(q.option_validity)) {
        const firstValid = q.option_validity.findIndex((v) => v === true);
        chosen = firstValid >= 0 ? firstValid : 0;
      }
      techAnswers[q.id] = chosen;
    }
    const tecRes = await request.post(
      `${BASE_API}/server/api/test/${token}/submit`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { tecnica: { answers: techAnswers, min_required: 60 } },
      },
    );
    const tecBody = await tecRes.json().catch(() => ({}));
    if (tecRes.status() !== 200) {
      logErr('tecnica', `status=${tecRes.status()} body=${JSON.stringify(tecBody).slice(0, 200)}`);
      results.push(result);
      continue;
    }
    result.tecnica_response = tecBody;
    // El response solo dice {"submitted": ["tecnica"]} — el score real hay que consultarlo
    // vía pipeline_stage en el endpoint público /test/<token>.
    const statusRes = await request.get(`${BASE_API}/server/api/test/${token}`);
    const statusBody = await statusRes.json().catch(() => ({}));
    const stage = statusBody.pipeline_stage as string | undefined;
    const tecnicaPassed = stage === 'tecnica_completed'
      || stage === 'conductual_completed'
      || stage === 'integridad_completed'
      || stage === 'videos_completed'
      || stage === 'finalist'
      || stage === 'offered'
      || stage === 'hired';
    const tecnicaRechazada = stage === 'auto_rejected_low_score';
    result.tecnica_passed = tecnicaPassed;
    result.pipeline_stage_after_tecnica = stage;
    steps.push(`✅ tecnica submit OK (passed=${tecnicaPassed} stage=${stage})`);
    console.log(`  ✅ tecnica passed=${tecnicaPassed} stage=${stage}`);
    if (!tecnicaPassed && c.stop_at !== 'tecnica-rechazado') {
      logErr('tecnica-no-paso', `esperábamos que pasara pero stage=${stage} (no avanzó)`);
    }
    if (tecnicaRechazada && c.stop_at !== 'tecnica-rechazado') {
      logErr('tecnica-rechazo-inesperado', `auto-rechazo inesperado: stage=${stage}`);
    }

    // Si stop_at='tecnica-rechazado', confirmamos que no pasó y paramos acá.
    if (c.stop_at === 'tecnica-rechazado') {
      if (tecnicaPassed) {
        logErr('marta', `esperábamos rechazo en técnica pero pasó`);
      } else {
        steps.push(`🎯 Esperado: ${full_name} queda en TÉCNICA · Rechazado`);
      }
      results.push(result);
      continue;
    }

    // === Paso 6: Conductual (DISC + VELNA + Emocional) + Integridad ===
    // Para los buenos: integridad limpia. Para Patricia (stop_at='disc-stuck'): NO submit conductual.
    if (c.stop_at === 'disc-stuck') {
      steps.push(`🎯 Esperado: ${full_name} queda en CONDUCTUAL · Sin avanzar (no completa DISC)`);
      results.push(result);
      continue;
    }

    // Bueno → DISC con perfil D-dominante realista (suma D+I+S+C = total_questions=24)
    // Antes mandábamos 14 en cada eje → backend normalizaba a 100/100/100/100 (cada axis dividido por max-per-axis=14).
    // Ahora 12/4/4/4 → norm aproximadamente 86/29/29/29 = perfil D claro con baja similitud al ideal (50/60/50/50).
    const disc = { raw_d: 12, raw_i: 4, raw_s: 4, raw_c: 4, total_questions: 24 };
    const velna = { verbal: 80, espacial: 78, logica: 82, numerica: 75, abstracta: 80, total: 80, max: 100 };
    const emotional = { score: 55 };
    const allDims = [
      'autenticidad', 'inteligencia_social', 'imparcialidad', 'sencillez',
      'dominio_personal', 'honestidad', 'hurto', 'soborno', 'alcohol',
      'drogas', 'confiabilidad', 'apuestas', 'buena_impresion',
    ];
    const dimsPayload = allDims.map((d) => ({ dimension: d, pct: d === 'buena_impresion' ? 30 : 75 }));

    const conIntRes = await request.post(
      `${BASE_API}/server/api/test/${token}/submit`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { disc, velna, emotional, integridad: { dimensions: dimsPayload } },
      },
    );
    const conIntBody = await conIntRes.json().catch(() => ({}));
    if (conIntRes.status() !== 200) {
      logErr('conductual+integridad', `status=${conIntRes.status()} body=${JSON.stringify(conIntBody).slice(0, 300)}`);
      results.push(result);
      continue;
    }
    result.conductual_integridad_response = conIntBody;
    const autoRej = conIntBody.auto_rejected;
    const needsRev = conIntBody.needs_review;
    if (autoRej) logErr('bueno-auto-rechazado', `inesperado: ${JSON.stringify(autoRej).slice(0, 200)}`);
    steps.push(`✅ conductual+integridad — auto_rejected=${!!autoRej} needs_review=${!!needsRev}`);
    console.log(`  ✅ conductual+integridad`);

    // === Paso 7: Mindset (adaptable para buenos) ===
    const mindsetAnswers = [];
    const adaptables = ['crecimiento', 'curiosa', 'creativa', 'agente', 'abundancia', 'exploracion', 'oportunidad'];
    for (let i = 1; i <= 14; i++) {
      mindsetAnswers.push({ question_id: `m${i}`, chosen_mentalidad: adaptables[i % adaptables.length] });
    }
    const mindsetRes = await request.post(
      `${BASE_API}/server/api/test/${token}/mindset/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: { answers: mindsetAnswers } },
    );
    const mindsetBody = await mindsetRes.json().catch(() => ({}));
    if (mindsetRes.status() === 200) {
      steps.push(`✅ mindset pattern=${mindsetBody.adaptability_pattern}`);
    } else if (mindsetRes.status() === 503) {
      steps.push(`⚠️ mindset 503 (tabla no creada)`);
    } else {
      logErr('mindset', `status=${mindsetRes.status()} body=${JSON.stringify(mindsetBody).slice(0, 200)}`);
    }

    // === Paso 8: Inglés (alto para buenos) ===
    const englishPayload = {
      level: 'B1' as const,
      mc_correct: 17, mc_total: 20,
      listening_correct: 2, listening_total: 2,
      writing_text:
        'I have been working in administrative support for over five years, handling calendars ' +
        'and coordinating meetings across teams. I am confident with Excel and customer service.',
      writing_word_count: 40,
      writing_time_seconds: 480,
      writing_paste_attempts: 0,
      writing_focus_lost_count: 0,
    };
    const englishRes = await request.post(
      `${BASE_API}/server/api/test/${token}/english/submit`,
      { headers: { 'Content-Type': 'application/json' }, data: englishPayload },
    );
    const englishBody = await englishRes.json().catch(() => ({}));
    if (englishRes.status() === 200) {
      steps.push(`✅ english passed=${englishBody.passed}`);
    } else if (englishRes.status() === 503) {
      steps.push(`⚠️ english 503 (tabla no creada)`);
    } else {
      logErr('english', `status=${englishRes.status()} body=${JSON.stringify(englishBody).slice(0, 200)}`);
    }

    steps.push(`🎯 Esperado: ${full_name} completa TODO → Integridad o Finalistas`);

    // === Paso 9: forzar finalist (Luis y Andrea solamente) ===
    // Usa endpoint diag para saltar la cadena bot/admin y dejar al candidato en
    // 'finalist'. Necesario para validar la pantalla Comparativo con datos reales.
    if (c.stop_at === 'completar-todo') {
      const setStageRes = await request.post(
        `${BASE_API}/server/api/api/admin/_diag-set-stage`,
        {
          headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
          data: { application_id: applicationId, to_stage: 'finalist' },
        },
      );
      const setStageBody = await setStageRes.json().catch(() => ({}));
      if (setStageRes.status() === 200) {
        steps.push(`✅ stage forzado a finalist (from=${setStageBody.from_stage})`);
        result.finalist = true;
      } else {
        logErr('set-stage-finalist', `status=${setStageRes.status()} body=${JSON.stringify(setStageBody).slice(0, 200)}`);
      }
    }

    results.push(result);
  }

  // ===== URL del Comparativo (si hay 2+ finalists) =====
  const finalists = results.filter((r) => r.finalist === true);
  let comparativoUrl: string | null = null;
  if (finalists.length >= 2) {
    const jobId = finalists[0].job_id as string;
    const ids = finalists.map((r) => r.application_id as string).join(',');
    comparativoUrl = `${BASE_API}/app/index.html#/jobs/${jobId}/comparar?candidates=${ids}`;
    console.log(`\n========== URL del Comparativo ==========`);
    console.log(comparativoUrl);
  }

  // ===== Reporte final =====
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    run_tag: RUN_TAG,
    job_slug: JOB_SLUG,
    candidates: results,
    errors,
    comparativo_url: comparativoUrl,
  }, null, 2));

  console.log(`\n========== REPORTE FINAL ==========`);
  console.log(`Output JSON: ${OUTPUT_FILE}`);
  console.log(`Total errores: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`\n--- Errores ---`);
    errors.forEach((e) => console.log(`  ❌ ${e}`));
  }
  console.log(`\n--- Resumen por candidato ---`);
  for (const r of results) {
    console.log(`\n${r.name as string} (${r.profile})`);
    (r.steps as string[]).forEach((s) => console.log(`  ${s}`));
    if ((r.errors as string[]).length > 0) {
      console.log(`  Errores específicos:`);
      (r.errors as string[]).forEach((e) => console.log(`    ❌ ${e}`));
    }
  }

  // Si hay errores que no son los "esperados" (Marta rechazada, Patricia atascada), fallar el test.
  // Excluimos los errores informativos relacionados con stop_at.
  const realErrors = errors.filter((e) =>
    !e.includes('Esperado:') && !e.includes('503')
  );
  if (realErrors.length > 0) {
    throw new Error(`Errores reales en spec: ${realErrors.length}\n${realErrors.join('\n')}`);
  }
});
