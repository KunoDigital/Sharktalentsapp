import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec mini — 3 candidatos (1 bueno + 1 medio + 1 malo) aplican al puesto nuevo
 * "Coordinador de Atención al Cliente" (slug: coordinador-de-atencion-al-cliente).
 *
 * Adaptado de spec-b-candidatos-fase1.spec.ts. Cambios principales:
 *   - 3 candidatos (no 10) para iteración rápida
 *   - Slug por env var con default al puesto nuevo
 *   - Lógica "malo": elegir el primer índice NO aceptado de la PRIMERA pregunta
 *     crítica (en el puesto nuevo, prefilter Q1 es experiencia, rechaza "Ninguna")
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-mini-3-candidatos.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const JOB_SLUG = process.env.E2E_JOB_SLUG ?? 'coordinador-de-atencion-al-cliente';

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
type Candidate = { idx: number; name: string; email: string; profile: Profile };

function buildCandidates(): Candidate[] {
  return [
    { idx: 1, name: 'Andrea Sanchez', email: `chrismarpalma+minispec-${RUN_TAG}-bueno@gmail.com`, profile: 'bueno' },
    { idx: 2, name: 'Carlos Mendez', email: `chrismarpalma+minispec-${RUN_TAG}-medio@gmail.com`, profile: 'medio' },
    { idx: 3, name: 'Roberto Perez', email: `chrismarpalma+minispec-${RUN_TAG}-malo@gmail.com`, profile: 'malo' },
  ];
}

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-mini-${RUN_TAG}.json`);

test('Spec mini: 3 candidatos (bueno/medio/malo) al puesto nuevo', async ({ request }) => {
  test.setTimeout(8 * 60 * 1000);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cvPdf = makeMinimalPdf();
  const candidates = buildCandidates();
  const results: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    console.log(`\n[${c.profile.toUpperCase()}] ${c.name} (${c.email})`);
    const result: Record<string, unknown> = {
      idx: c.idx, name: c.name, email: c.email, profile: c.profile, steps: [],
    };
    const steps = result.steps as string[];

    // Paso 1: Aplicar
    let applicationId = '';
    let candidateId = '';
    try {
      const applyRes = await request.post(
        `${BASE_API}/server/api/api/public/jobs/${JOB_SLUG}/apply`,
        {
          multipart: {
            first_name: c.name.split(' ')[0],
            last_name: c.name.split(' ').slice(1).join(' ') || 'MiniSpec',
            email: c.email,
            phone: `+507${6100000 + c.idx}`,
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
        results.push(result); continue;
      }
      applicationId = applyBody.result_id;
      candidateId = applyBody.candidate_id;
      result.application_id = applicationId;
      result.candidate_id = candidateId;
      steps.push(`✓ apply OK (app=${applicationId})`);
      console.log(`  ✓ apply OK`);
    } catch (err) {
      steps.push(`✗ apply exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // Paso 2: Token signed
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
        results.push(result); continue;
      }
      token = tokenBody.token;
      jobId = tokenBody.job_id;
      steps.push(`✓ token obtained`);
    } catch (err) {
      steps.push(`✗ get-token exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // Paso 3: Leer preguntas
    type PrefilterQ = { id: string; options: string[]; accepted_indices: number[]; criterion?: string };
    type TechQ = {
      id: string; kind: 'technical' | 'situational'; options: string[];
      correct?: number; option_validity?: boolean[];
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
      if (Array.isArray(pqBody.prefilter)) prefilterQs = pqBody.prefilter;
      if (Array.isArray(pqBody.tech)) techQs = pqBody.tech;
      if (prefilterQs.length === 0) {
        steps.push(`✗ prefilter qs vacío`);
        results.push(result); continue;
      }
      steps.push(`✓ qs loaded (${prefilterQs.length} prefilter, ${techQs.length} tech)`);
    } catch (err) {
      steps.push(`✗ qs exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // Paso 4: Prefilter answers
    // Bueno/Medio: primer accepted_index (válido)
    // Malo: primer índice NO aceptado de cada pregunta (rechazo garantizado)
    const prefAnswers = prefilterQs.map((q) => {
      if (c.profile === 'malo') {
        const notAccepted = q.options
          .map((_, idx) => idx)
          .find((idx) => !q.accepted_indices.includes(idx));
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
      results.push(result); continue;
    }

    if (c.profile === 'malo') {
      steps.push(prefilterPassed
        ? `⚠️ MALO pasó prefilter inesperadamente`
        : `✓ MALO rechazado correctamente`);
      results.push(result); continue;
    }

    if (!prefilterPassed) {
      steps.push(`⚠️ ${c.profile} no pasó prefilter`);
      results.push(result); continue;
    }

    // Paso 5: Técnicas
    if (techQs.length === 0) {
      steps.push(`✗ tech qs vacío`);
      results.push(result); continue;
    }

    const techAnswers: Record<string, number> = {};
    let techIdx = 0;
    for (const q of techQs) {
      let selectedIdx = 0;
      if (q.kind === 'technical') {
        techIdx++;
        if (typeof q.correct !== 'number') continue;
        if (c.profile === 'bueno') selectedIdx = q.correct;
        else if (c.profile === 'medio') selectedIdx = (techIdx % 2 === 1) ? q.correct : ((q.correct + 1) % 4);
      } else if (q.kind === 'situational') {
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
          data: { tecnica: { answers: techAnswers, min_required: 60 } },
        },
      );
      const tSubBody = await tSubRes.json();
      if (tSubRes.status() === 200) {
        result.tech_response = tSubBody;
        steps.push(`✓ tech submit OK`);
        console.log(`  ✓ tech submit OK`);
      } else {
        steps.push(`✗ tech submit status ${tSubRes.status()}: ${JSON.stringify(tSubBody).slice(0, 200)}`);
      }
    } catch (err) {
      steps.push(`✗ tech submit exception: ${(err as Error).message}`);
    }

    results.push(result);
    await new Promise((r) => setTimeout(r, 2000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    run_tag: RUN_TAG, job_slug: JOB_SLUG, candidates: results,
  }, null, 2));

  console.log(`\n=== Resumen Spec mini ===`);
  const okApply = results.filter((r) => r.application_id).length;
  const prefPassed = results.filter((r) => r.prefilter_passed === true).length;
  const prefFailed = results.filter((r) => r.prefilter_passed === false).length;
  const techOk = results.filter((r) => r.tech_response).length;
  console.log(`Aplicaciones OK:        ${okApply}/3`);
  console.log(`Prefilter PASS:         ${prefPassed} (esperado 2: bueno + medio)`);
  console.log(`Prefilter FAIL:         ${prefFailed} (esperado 1: malo)`);
  console.log(`Técnicas submitidas OK: ${techOk}/2`);
  console.log(`Output JSON: ${OUTPUT_FILE}`);

  expect(okApply, '3 aplicaciones').toBe(3);
  expect(prefFailed, '1 malo rechazado').toBeGreaterThanOrEqual(1);
  expect(prefPassed, '2 deben pasar prefilter').toBeGreaterThanOrEqual(2);
});
