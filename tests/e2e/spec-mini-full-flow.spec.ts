import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec mini FULL FLOW — 2 candidatos (bueno + medio) recorren TODO el flow:
 *   apply → prefilter → técnica + DISC + VELNA + emocional + integridad → mindset → english
 *
 * Objetivo: ver dónde más rompe el embudo cuando los candidatos avanzan por todas
 * las fases. El bug del embudo que descubrimos antes (los candidatos aparecen en
 * todos los tabs sin haber hecho los tests) probablemente esconde más bugs.
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
type Profile = 'bueno' | 'medio';

type Candidate = { idx: number; name: string; email: string; profile: Profile };

const CANDIDATES: Candidate[] = [
  { idx: 1, name: 'Lucia Fernandez', email: `chrismarpalma+full-${RUN_TAG}-bueno@gmail.com`, profile: 'bueno' },
  { idx: 2, name: 'Miguel Ruiz', email: `chrismarpalma+full-${RUN_TAG}-medio@gmail.com`, profile: 'medio' },
];

/**
 * Perfiles de respuesta por bloque.
 * Bueno: scores altos, DISC cercano al ideal (D40, I50, S60, C50 — del prompt original).
 * Medio: scores medios, DISC desviado del ideal.
 */
const PROFILES = {
  bueno: {
    disc: { raw_d: 5, raw_i: 6, raw_s: 8, raw_c: 5, total_questions: 24 }, // suma 24
    velna: { verbal: 16, espacial: 12, logica: 16, numerica: 14, abstracta: 14, total: 72, max: 100 },
    emotional: { score: 65 },
    integridad: {
      dimensions: [
        { dimension: 'buena_impresion', pct: 35 },
        { dimension: 'mentiras', pct: 10 },
        { dimension: 'sustancias', pct: 5 },
        { dimension: 'robo', pct: 5 },
        { dimension: 'conflictos', pct: 15 },
      ],
    },
  },
  medio: {
    disc: { raw_d: 8, raw_i: 4, raw_s: 4, raw_c: 8, total_questions: 24 }, // desviado
    velna: { verbal: 11, espacial: 9, logica: 10, numerica: 9, abstracta: 11, total: 50, max: 100 },
    emotional: { score: 45 },
    integridad: {
      dimensions: [
        { dimension: 'buena_impresion', pct: 55 },
        { dimension: 'mentiras', pct: 25 },
        { dimension: 'sustancias', pct: 15 },
        { dimension: 'robo', pct: 20 },
        { dimension: 'conflictos', pct: 30 },
      ],
    },
  },
};

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-full-${RUN_TAG}.json`);

test('Spec mini full flow: 2 candidatos recorren TODAS las fases', async ({ request }) => {
  test.setTimeout(15 * 60 * 1000);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cvPdf = makeMinimalPdf();
  const results: Array<Record<string, unknown>> = [];

  for (const c of CANDIDATES) {
    console.log(`\n[${c.profile.toUpperCase()}] ${c.name} (${c.email})`);
    const result: Record<string, unknown> = {
      idx: c.idx, name: c.name, email: c.email, profile: c.profile, steps: [],
    };
    const steps = result.steps as string[];

    // === Apply ===
    let applicationId = '';
    try {
      const applyRes = await request.post(
        `${BASE_API}/server/api/api/public/jobs/${JOB_SLUG}/apply`,
        {
          multipart: {
            first_name: c.name.split(' ')[0],
            last_name: c.name.split(' ')[1] ?? 'FullSpec',
            email: c.email,
            phone: `+507${6200000 + c.idx}`,
            age: '30',
            city: 'Panama',
            country: 'Panama',
            consent_terms: 'true',
            cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: cvPdf },
          },
        },
      );
      const applyBody = await applyRes.json().catch(() => ({}));
      if (applyRes.status() !== 201) {
        steps.push(`✗ apply ${applyRes.status()}: ${JSON.stringify(applyBody).slice(0, 200)}`);
        results.push(result); continue;
      }
      applicationId = applyBody.result_id;
      result.application_id = applicationId;
      steps.push(`✓ apply OK (app=${applicationId})`);
      console.log(`  ✓ apply OK`);
    } catch (err) {
      steps.push(`✗ apply exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // === Token ===
    let token = '';
    let jobId = '';
    try {
      const tokenRes = await request.get(
        `${BASE_API}/server/api/api/admin/_diag-get-test-token?application_id=${applicationId}`,
        { headers: { 'X-Internal-Key': INTERNAL_KEY } },
      );
      const tokenBody = await tokenRes.json();
      token = tokenBody.token;
      jobId = tokenBody.job_id;
      steps.push(`✓ token`);
    } catch (err) {
      steps.push(`✗ token exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // === Cargar preguntas ===
    type PrefilterQ = { id: string; options: string[]; accepted_indices: number[] };
    type TechQ = {
      id: string; kind: 'technical' | 'situational'; options: string[];
      correct?: number; option_validity?: boolean[];
    };
    let prefilterQs: PrefilterQ[] = [];
    let techQs: TechQ[] = [];
    try {
      const pqRes = await request.get(
        `${BASE_API}/server/api/api/admin/_diag-get-questions-for-job?job_id=${jobId}`,
        { headers: { 'X-Internal-Key': INTERNAL_KEY } },
      );
      const pqBody = await pqRes.json();
      prefilterQs = pqBody.prefilter ?? [];
      techQs = pqBody.tech ?? [];
      steps.push(`✓ qs (${prefilterQs.length} pref, ${techQs.length} tech)`);
    } catch (err) {
      steps.push(`✗ qs exception: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // === Prefilter (responde válido para ambos) ===
    const prefAnswers = prefilterQs.map((q) => ({
      question_id: q.id, selected_index: q.accepted_indices[0] ?? 0,
    }));
    try {
      const pSubRes = await request.post(
        `${BASE_API}/server/api/test/${token}/prescreening/submit`,
        { headers: { 'Content-Type': 'application/json' }, data: { answers: prefAnswers } },
      );
      const pSubBody = await pSubRes.json();
      if (pSubRes.status() !== 200 || !pSubBody.passed) {
        steps.push(`✗ prefilter FAIL`);
        results.push(result); continue;
      }
      steps.push(`✓ prefilter PASS`);
      console.log(`  ✓ prefilter PASS`);
    } catch (err) {
      steps.push(`✗ prefilter ex: ${(err as Error).message}`);
      results.push(result); continue;
    }

    // === Submit: técnica + DISC + VELNA + emocional + integridad (1 sola request) ===
    const techAnswers: Record<string, number> = {};
    let techIdx = 0;
    for (const q of techQs) {
      let selectedIdx = 0;
      if (q.kind === 'technical') {
        techIdx++;
        if (typeof q.correct !== 'number') continue;
        selectedIdx = c.profile === 'bueno'
          ? q.correct
          : ((techIdx % 2 === 1) ? q.correct : ((q.correct + 1) % 4));
      } else if (q.kind === 'situational') {
        if (!Array.isArray(q.option_validity)) continue;
        const firstValid = q.option_validity.findIndex((v) => v === true);
        selectedIdx = firstValid >= 0 ? firstValid : 0;
      }
      techAnswers[q.id] = selectedIdx;
    }

    const profile = PROFILES[c.profile];
    const submitBody = {
      tecnica: { answers: techAnswers, min_required: 60 },
      disc: profile.disc,
      velna: profile.velna,
      emotional: profile.emotional,
      integridad: profile.integridad,
    };

    try {
      const tSubRes = await request.post(
        `${BASE_API}/server/api/test/${token}/submit`,
        { headers: { 'Content-Type': 'application/json' }, data: submitBody },
      );
      const tSubBody = await tSubRes.json();
      result.submit_status = tSubRes.status();
      result.submit_body = tSubBody;
      if (tSubRes.status() === 200) {
        const blocks = (tSubBody.submitted ?? []).join(',');
        steps.push(`✓ submit OK [${blocks}]`);
        console.log(`  ✓ submit OK [${blocks}]`);
      } else {
        steps.push(`✗ submit ${tSubRes.status()}: ${JSON.stringify(tSubBody).slice(0, 300)}`);
        console.log(`  ✗ submit ${tSubRes.status()}`);
      }
    } catch (err) {
      steps.push(`✗ submit ex: ${(err as Error).message}`);
    }

    // === Mindset (endpoint separado) ===
    try {
      const mAnswers = c.profile === 'bueno'
        ? Array.from({ length: 20 }, (_, i) => ({ question_id: `m${i + 1}`, selected_index: 0 }))
        : Array.from({ length: 20 }, (_, i) => ({ question_id: `m${i + 1}`, selected_index: i % 4 }));
      const mRes = await request.post(
        `${BASE_API}/server/api/test/${token}/mindset/submit`,
        { headers: { 'Content-Type': 'application/json' }, data: { answers: mAnswers } },
      );
      const mBody = await mRes.json().catch(() => ({}));
      result.mindset_status = mRes.status();
      if (mRes.status() === 200) {
        steps.push(`✓ mindset OK`);
        console.log(`  ✓ mindset OK`);
      } else {
        steps.push(`✗ mindset ${mRes.status()}: ${JSON.stringify(mBody).slice(0, 200)}`);
      }
    } catch (err) {
      steps.push(`✗ mindset ex: ${(err as Error).message}`);
    }

    // === English (endpoint separado) ===
    try {
      const eAnswers = c.profile === 'bueno'
        ? Array.from({ length: 15 }, (_, i) => ({ question_id: `e${i + 1}`, selected_index: 0 }))
        : Array.from({ length: 15 }, (_, i) => ({ question_id: `e${i + 1}`, selected_index: i % 4 }));
      const eRes = await request.post(
        `${BASE_API}/server/api/test/${token}/english/submit`,
        { headers: { 'Content-Type': 'application/json' }, data: { answers: eAnswers } },
      );
      const eBody = await eRes.json().catch(() => ({}));
      result.english_status = eRes.status();
      if (eRes.status() === 200) {
        steps.push(`✓ english OK`);
        console.log(`  ✓ english OK`);
      } else {
        steps.push(`✗ english ${eRes.status()}: ${JSON.stringify(eBody).slice(0, 200)}`);
      }
    } catch (err) {
      steps.push(`✗ english ex: ${(err as Error).message}`);
    }

    results.push(result);
    await new Promise((r) => setTimeout(r, 2000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    run_tag: RUN_TAG, job_slug: JOB_SLUG, candidates: results,
  }, null, 2));

  console.log(`\n=== Resumen Full Flow ===`);
  for (const r of results) {
    console.log(`${r.name} (${r.profile}):`);
    (r.steps as string[]).forEach((s) => console.log(`  ${s}`));
  }
  console.log(`Output: ${OUTPUT_FILE}`);

  expect(results.length).toBe(2);
});
