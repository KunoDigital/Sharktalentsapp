import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Spec B Fase 1 — 10 candidatos aplican a UN puesto + prefilter + técnica.
 *
 * Flujo end-to-end por candidato:
 *   1. POST /api/public/jobs/:slug/apply (form + CV PDF)
 *   2. GET _diag-get-test-token (en lugar de leer email) → token signed
 *   3. GET _diag-get-questions-for-job?type=prefilter (interno) → preguntas + accepted_indices
 *   4. POST /test/{token}/prescreening/submit → answers según perfil del candidato
 *   5. (si pasó prefilter) GET _diag-get-questions-for-job?type=tech → preguntas + correct
 *   6. POST /test/{token}/submit con tecnica.answers según perfil
 *
 * Perfiles:
 *   - 6 BUENOS:  prefilter pasa (acepta salario en rango), técnicas responden bien
 *   - 2 MEDIOS:  prefilter pasa, técnicas 50% correct
 *   - 2 MALOS:   prefilter rechaza (pretensión salarial fuera de rango)
 *
 * Email destino: chrismarpalma+specB-{n}@gmail.com (alias Gmail → mismo inbox).
 *
 * Fase 2 (futura): agregar DISC, VELNA, integridad, mindset, english.
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-b-candidatos-fase1.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const JOB_SLUG = process.env.E2E_JOB_SLUG ?? 'coordinador-de-logistica';

/** PDF mínimo válido (~192 bytes). */
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

type Profile = 'bueno' | 'medio' | 'malo';

type Candidate = {
  idx: number;
  name: string;
  email: string;
  profile: Profile;
};

function buildCandidates(): Candidate[] {
  const cs: Candidate[] = [];
  // 6 buenos
  for (let i = 1; i <= 6; i++) {
    cs.push({
      idx: i,
      name: `Bueno ${i} SpecB`,
      email: `chrismarpalma+specB-${RUN_TAG}-bueno${i}@gmail.com`,
      profile: 'bueno',
    });
  }
  // 2 medios
  for (let i = 1; i <= 2; i++) {
    cs.push({
      idx: 6 + i,
      name: `Medio ${i} SpecB`,
      email: `chrismarpalma+specB-${RUN_TAG}-medio${i}@gmail.com`,
      profile: 'medio',
    });
  }
  // 2 malos
  for (let i = 1; i <= 2; i++) {
    cs.push({
      idx: 8 + i,
      name: `Malo ${i} SpecB`,
      email: `chrismarpalma+specB-${RUN_TAG}-malo${i}@gmail.com`,
      profile: 'malo',
    });
  }
  return cs;
}

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-b-${RUN_TAG}.json`);

test('Spec B Fase 1: 10 candidatos aplican + prefilter + técnica', async ({ request }) => {
  test.setTimeout(15 * 60 * 1000); // 15 min máx

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cvPdf = makeMinimalPdf();
  const candidates = buildCandidates();
  const results: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    console.log(`\n[${c.profile.toUpperCase()} ${c.idx}] ${c.name} (${c.email})`);
    const result: Record<string, unknown> = {
      idx: c.idx, name: c.name, email: c.email, profile: c.profile,
      steps: [],
    };
    const steps = result.steps as string[];

    // ===== Paso 1: Aplicar al puesto =====
    let applicationId = '';
    let candidateId = '';
    try {
      const applyRes = await request.post(
        `${BASE_API}/server/api/api/public/jobs/${JOB_SLUG}/apply`,
        {
          multipart: {
            first_name: c.name.split(' ')[0],
            last_name: 'SpecB',
            email: c.email,
            phone: `+507${6000000 + c.idx}`,
            age: '28',
            city: 'Panama',
            country: 'Panama',
            consent_terms: 'true',
            cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: cvPdf },
          },
        },
      );
      const applyBody = await applyRes.json().catch(() => ({}));
      if (applyRes.status() !== 201) {
        steps.push(`✗ apply status ${applyRes.status()}: ${JSON.stringify(applyBody).slice(0, 200)}`);
        results.push(result);
        continue;
      }
      applicationId = applyBody.result_id;
      candidateId = applyBody.candidate_id;
      result.application_id = applicationId;
      result.candidate_id = candidateId;
      steps.push(`✓ apply OK (app=${applicationId})`);
      console.log(`  ✓ apply OK`);
    } catch (err) {
      steps.push(`✗ apply exception: ${(err as Error).message}`);
      results.push(result);
      continue;
    }

    // ===== Paso 2: Obtener token signed (sin leer email) =====
    let token = '';
    let jobId = '';
    try {
      const tokenRes = await request.get(
        `${BASE_API}/server/api/api/admin/_diag-get-test-token?application_id=${applicationId}`,
        { headers: { 'X-Internal-Key': INTERNAL_KEY } },
      );
      const tokenBody = await tokenRes.json();
      if (tokenRes.status() !== 200) {
        steps.push(`✗ get-token status ${tokenRes.status()}: ${JSON.stringify(tokenBody).slice(0, 150)}`);
        results.push(result);
        continue;
      }
      token = tokenBody.token;
      jobId = tokenBody.job_id;
      steps.push(`✓ token obtained`);
    } catch (err) {
      steps.push(`✗ get-token exception: ${(err as Error).message}`);
      results.push(result);
      continue;
    }

    // ===== Paso 3: Leer prefilter + tech preguntas de UNA sola vez (endpoint devuelve ambos) =====
    type PrefilterQ = { id: string; type: string; options: string[]; accepted_indices: number[]; criterion?: string };
    type TechQ = {
      id: string;
      kind: 'technical' | 'situational';
      options: string[];
      correct?: number;
      option_validity?: boolean[];
      option_style?: Array<{ axis: string; value: string } | null>;
    };
    let prefilterQs: PrefilterQ[] = [];
    let techQs: TechQ[] = [];
    try {
      const pqRes = await request.get(
        `${BASE_API}/server/api/api/admin/_diag-get-questions-for-job?job_id=${jobId}`,
        { headers: { 'X-Internal-Key': INTERNAL_KEY } },
      );
      const pqBody = await pqRes.json();
      if (Array.isArray(pqBody.prefilter)) {
        prefilterQs = pqBody.prefilter as PrefilterQ[];
      }
      if (Array.isArray(pqBody.tech)) {
        techQs = pqBody.tech as TechQ[];
      }
      if (prefilterQs.length === 0) {
        steps.push(`✗ prefilter qs vacío — ${JSON.stringify(pqBody).slice(0, 200)}`);
        results.push(result);
        continue;
      }
      steps.push(`✓ qs loaded (${prefilterQs.length} prefilter, ${techQs.length} tech)`);
    } catch (err) {
      steps.push(`✗ qs exception: ${(err as Error).message}`);
      results.push(result);
      continue;
    }

    // ===== Paso 4: Responder prefilter según perfil =====
    // Bueno/Medio: elegimos el primer accepted_index (=respuesta válida).
    // Malo: elegimos un índice NO aceptado para alguna pregunta crítica (típicamente salario).
    const prefAnswers: Array<{ question_id: string; selected_index: number }> = prefilterQs.map((q, i) => {
      if (c.profile === 'malo' && /salar|preten|sueld/i.test(q.criterion ?? '') && q.options.length > 0) {
        // Para malos: elegir un índice NO aceptado (cae al límite alto de salario)
        const notAccepted = [0, 1, 2, 3, 4].find((idx) => !q.accepted_indices.includes(idx) && idx < q.options.length);
        if (notAccepted != null) return { question_id: q.id, selected_index: notAccepted };
      }
      return { question_id: q.id, selected_index: q.accepted_indices[0] ?? 0 };
    });

    let prefilterPassed = false;
    try {
      const pSubRes = await request.post(
        `${BASE_API}/server/api/test/${token}/prescreening/submit`,
        { headers: { 'Content-Type': 'application/json' }, data: { answers: prefAnswers } },
      );
      const pSubBody = await pSubRes.json();
      if (pSubRes.status() === 200) {
        prefilterPassed = pSubBody.passed === true;
        steps.push(prefilterPassed ? `✓ prefilter PASS` : `✗ prefilter FAIL (${pSubBody.failedReason ?? '?'})`);
        console.log(`  ${prefilterPassed ? '✓' : '✗'} prefilter ${prefilterPassed ? 'PASS' : 'FAIL'}`);
      } else {
        steps.push(`✗ prefilter submit status ${pSubRes.status()}`);
      }
      result.prefilter_passed = prefilterPassed;
    } catch (err) {
      steps.push(`✗ prefilter submit exception: ${(err as Error).message}`);
      results.push(result);
      continue;
    }

    // Los malos esperamos que NO pasen prefilter — si pasaron, es un fail del spec.
    if (c.profile === 'malo') {
      if (prefilterPassed) {
        steps.push(`⚠️ esperaba que MALO no pase prefilter pero pasó`);
      } else {
        steps.push(`✓ MALO correctamente rechazado en prefilter`);
      }
      results.push(result);
      continue; // Los malos no siguen al técnico
    }

    if (!prefilterPassed) {
      steps.push(`⚠️ ${c.profile} esperaba pasar prefilter pero no pasó`);
      results.push(result);
      continue;
    }

    // ===== Paso 5: tech qs ya las cargamos en Paso 3 — verificar que hay =====
    if (techQs.length === 0) {
      steps.push(`✗ tech qs vacío`);
      results.push(result);
      continue;
    }

    // ===== Paso 6: Responder técnicas según perfil =====
    // Bueno: técnicas correctas + situacionales = una autonomy válida
    // Medio: técnicas 50% correctas (alterna) + situacionales = random válida
    const techAnswers: Record<string, number> = {};
    let techIdx = 0;
    for (const q of techQs) {
      let selectedIdx = 0;
      if (q.kind === 'technical') {
        techIdx++;
        if (typeof q.correct !== 'number') continue;
        if (c.profile === 'bueno') {
          selectedIdx = q.correct;
        } else if (c.profile === 'medio') {
          // 50%: alternamos pares correctos / impares no
          selectedIdx = (techIdx % 2 === 1) ? q.correct : ((q.correct + 1) % 4);
        }
      } else if (q.kind === 'situational') {
        // Elegir la primera opción válida (option_validity = true).
        if (!Array.isArray(q.option_validity)) continue;
        const firstValid = q.option_validity.findIndex((v) => v === true);
        selectedIdx = firstValid >= 0 ? firstValid : 0;
      }
      techAnswers[q.id] = selectedIdx;
    }

    try {
      const tSubRes = await request.post(
        `${BASE_API}/server/api/test/${token}/submit`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: {
            tecnica: {
              answers: techAnswers,
              min_required: 60,
            },
          },
        },
      );
      const tSubBody = await tSubRes.json();
      if (tSubRes.status() === 200) {
        result.tech_response = tSubBody;
        steps.push(`✓ tech submit OK (${tSubBody.submitted?.join(',') ?? 'ok'})`);
        console.log(`  ✓ tech submit OK`);
      } else {
        steps.push(`✗ tech submit status ${tSubRes.status()}: ${JSON.stringify(tSubBody).slice(0, 200)}`);
        console.log(`  ✗ tech submit failed status ${tSubRes.status()}`);
      }
    } catch (err) {
      steps.push(`✗ tech submit exception: ${(err as Error).message}`);
    }

    results.push(result);
    // Pausa entre candidatos para no saturar el outbox/email
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Guardar output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    run_tag: RUN_TAG, job_slug: JOB_SLUG, candidates: results,
  }, null, 2));

  // ===== Resumen =====
  console.log(`\n=== Resumen Spec B Fase 1 ===`);
  const okApply = results.filter((r) => r.application_id).length;
  const prefPassed = results.filter((r) => r.prefilter_passed === true).length;
  const prefFailed = results.filter((r) => r.prefilter_passed === false).length;
  const techOk = results.filter((r) => r.tech_response).length;
  console.log(`Aplicaciones OK:           ${okApply}/${candidates.length}`);
  console.log(`Prefilter PASS:            ${prefPassed} (esperado 8: 6 buenos + 2 medios)`);
  console.log(`Prefilter FAIL:            ${prefFailed} (esperado 2: 2 malos)`);
  console.log(`Técnicas submitidas OK:    ${techOk}/8`);
  console.log(`Output JSON: ${OUTPUT_FILE}`);

  // Validaciones de éxito
  expect(okApply, '10 aplicaciones deben suceder').toBe(candidates.length);
  expect(prefFailed, '2 malos rechazados en prefilter').toBeGreaterThanOrEqual(2);
  expect(prefPassed, 'al menos 6 deben pasar prefilter').toBeGreaterThanOrEqual(6);
});
