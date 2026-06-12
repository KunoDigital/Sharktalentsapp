import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec A — Genera preguntas (prefiltro + técnica) para TODOS los jobs activos
 * y guarda los outputs en disco para que Claude analice la calidad después.
 *
 * Estrategia:
 *   1. Lista jobs activos via /api/admin/_diag-list-jobs
 *   2. Para cada job que tenga tech_prompt:
 *      a. Dispara generación de prefiltro (POST con type:prefilter, espera ~25s)
 *      b. Dispara generación de técnica (POST con type:tech, espera ~25s)
 *   3. Guarda el resultado a `tests/e2e/output/preguntas-jobs.json`
 *
 * Tiempo: ~50s por job. Con 4 workers paralelos: ~3-4 min para 10 jobs.
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-a-generar-preguntas.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');

type JobSummary = {
  id: string;
  title: string;
  company: string;
  cognitive_level: string;
  has_tech_prompt: boolean;
  has_prefilter_cache: boolean;
  has_tech_cache: boolean;
};

type JobOutput = {
  job: { id: string; title: string; company: string; cognitive_level: string };
  prefilter: unknown;
  tech: unknown;
  errors: string[];
};

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'preguntas-jobs.json');

/**
 * Detecta si el endpoint devolvió un cache marcado como failure (HTTP 200 pero el
 * generador falló y persistió `{status:'failed', error:'...'}`). Sin este check,
 * el spec antiguo reportaba "20/20 OK" aunque ninguna pregunta se hubiera generado.
 */
function isFailureCache(questions: unknown): boolean {
  return !!questions
    && typeof questions === 'object'
    && !Array.isArray(questions)
    && (questions as Record<string, unknown>).status === 'failed';
}

test.describe.configure({ mode: 'serial' });

test('Spec A: generar preguntas (prefiltro + técnica) para todos los jobs activos', async ({ request }) => {
  test.setTimeout(30 * 60 * 1000); // 30 min máx

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Listar jobs
  console.log('[Spec A] Listando jobs activos…');
  const listRes = await request.get(`${BASE_API}/server/api/api/admin/_diag-list-jobs?title_prefix=`, {
    headers: { 'X-Internal-Key': INTERNAL_KEY },
  });
  expect(listRes.status(), 'list jobs').toBe(200);
  const { jobs } = (await listRes.json()) as { count: number; jobs: JobSummary[] };
  console.log(`[Spec A] Encontrados ${jobs.length} jobs activos`);
  expect(jobs.length).toBeGreaterThan(0);

  const eligibles = jobs.filter((j) => j.has_tech_prompt);
  console.log(`[Spec A] Con tech_prompt válido: ${eligibles.length}`);

  const results: JobOutput[] = [];

  for (const job of eligibles) {
    console.log(`\n[Job ${job.id}] ${job.title} — ${job.company}`);
    const out: JobOutput = {
      job: { id: job.id, title: job.title, company: job.company, cognitive_level: job.cognitive_level },
      prefilter: null,
      tech: null,
      errors: [],
    };

    // 2a. Prefiltro
    console.log(`[Job ${job.id}] generando prefiltro…`);
    try {
      const preRes = await request.post(`${BASE_API}/server/api/api/admin/_diag-generate-questions-for-job`, {
        headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
        data: { job_id: job.id, type: 'prefilter' },
        timeout: 90_000,
      });
      if (preRes.status() === 200) {
        const body = (await preRes.json()) as { questions: unknown };
        out.prefilter = body.questions;
        // Validación de contenido: el endpoint puede devolver HTTP 200 con un cache
        // {status:'failed', error:'...'} cuando la generación cascó (timeout, JSON inválido,
        // créditos, etc.). Sin este check, el spec reporta 20/20 OK aunque todo haya fallado.
        if (isFailureCache(body.questions)) {
          const failDetail = JSON.stringify(body.questions).slice(0, 200);
          out.errors.push(`prefilter cache marcado failed: ${failDetail}`);
          console.log(`[Job ${job.id}] ✗ prefiltro CACHE FAILED: ${failDetail}`);
        } else if (!Array.isArray(body.questions) || body.questions.length === 0) {
          out.errors.push(`prefilter cache no es array no-vacío`);
          console.log(`[Job ${job.id}] ✗ prefiltro cache inválido (no es array)`);
        } else {
          console.log(`[Job ${job.id}] ✓ prefiltro OK (${body.questions.length} preguntas)`);
        }
      } else {
        const txt = await preRes.text();
        out.errors.push(`prefilter status ${preRes.status()}: ${txt.slice(0, 200)}`);
        console.log(`[Job ${job.id}] ✗ prefiltro status ${preRes.status()}`);
      }
    } catch (err) {
      out.errors.push(`prefilter exception: ${(err as Error).message}`);
      console.log(`[Job ${job.id}] ✗ prefiltro exception: ${(err as Error).message}`);
    }

    // 2b. Técnica
    console.log(`[Job ${job.id}] generando técnica…`);
    try {
      const techRes = await request.post(`${BASE_API}/server/api/api/admin/_diag-generate-questions-for-job`, {
        headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
        data: { job_id: job.id, type: 'tech' },
        timeout: 90_000,
      });
      if (techRes.status() === 200) {
        const body = (await techRes.json()) as { questions: unknown };
        out.tech = body.questions;
        if (isFailureCache(body.questions)) {
          const failDetail = JSON.stringify(body.questions).slice(0, 200);
          out.errors.push(`tech cache marcado failed: ${failDetail}`);
          console.log(`[Job ${job.id}] ✗ técnica CACHE FAILED: ${failDetail}`);
        } else if (!Array.isArray(body.questions) || body.questions.length === 0) {
          out.errors.push(`tech cache no es array no-vacío`);
          console.log(`[Job ${job.id}] ✗ técnica cache inválido (no es array)`);
        } else {
          // Validar proporción doble eje (doc 19): 12 técnicas + 13 situacionales = 25.
          const tCount = (body.questions as Array<{ kind?: string }>).filter((q) => q.kind === 'technical').length;
          const sCount = (body.questions as Array<{ kind?: string }>).filter((q) => q.kind === 'situational').length;
          const total = body.questions.length;
          if (tCount !== 12 || sCount !== 13) {
            out.errors.push(`tech proporción incorrecta: ${tCount} técnicas + ${sCount} situacionales (esperado 12+13)`);
            console.log(`[Job ${job.id}] ⚠ técnica proporción incorrecta: tech=${tCount} sit=${sCount} total=${total}`);
          } else {
            console.log(`[Job ${job.id}] ✓ técnica OK (${tCount} técnicas + ${sCount} situacionales)`);
          }
        }
      } else {
        const txt = await techRes.text();
        out.errors.push(`tech status ${techRes.status()}: ${txt.slice(0, 200)}`);
        console.log(`[Job ${job.id}] ✗ técnica status ${techRes.status()}`);
      }
    } catch (err) {
      out.errors.push(`tech exception: ${(err as Error).message}`);
      console.log(`[Job ${job.id}] ✗ técnica exception: ${(err as Error).message}`);
    }

    results.push(out);

    // Guardar cada vuelta para no perder progreso si algo casca.
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ generated_at: new Date().toISOString(), count: results.length, results }, null, 2));

    // Anti-rate-limit: esperar 15s entre jobs para no abrir el circuit breaker de Anthropic.
    // 1 job = 4 calls (1 prefilter + 3 tech batches). Con 15s entre jobs, mantenemos
    // throughput ≈ 16 calls/min, bien por debajo del límite de 50 RPM de Anthropic Tier 1.
    if (eligibles.indexOf(job) < eligibles.length - 1) {
      console.log(`[Job ${job.id}] esperando 15s antes del próximo job…`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  console.log(`\n[Spec A] Total procesados: ${results.length}. Output: ${OUTPUT_FILE}`);
  const sinErrores = results.filter((r) => r.errors.length === 0).length;
  const okPrefilter = results.filter((r) => Array.isArray(r.prefilter)).length;
  const okTech = results.filter((r) => Array.isArray(r.tech)).length;
  console.log(`[Spec A] Sin errores:        ${sinErrores}/${results.length}`);
  console.log(`[Spec A] Prefiltro válido:   ${okPrefilter}/${results.length}`);
  console.log(`[Spec A] Técnica válida:     ${okTech}/${results.length}`);

  // Listar los primeros 5 errores únicos para diagnóstico rápido en consola.
  const allErrors = results.flatMap((r) => r.errors);
  if (allErrors.length > 0) {
    const unique = Array.from(new Set(allErrors)).slice(0, 5);
    console.log(`\n[Spec A] Primeros errores únicos (5):`);
    unique.forEach((e, i) => console.log(`  ${i + 1}. ${e.slice(0, 200)}`));
  }

  // Fail explícito si algún job tuvo error de contenido (no solo HTTP status).
  // Antes el spec passaba con "20/20 OK" aunque todos los caches estuvieran failed.
  expect(sinErrores, `${results.length - sinErrores} job(s) con errores de contenido — ver detalle arriba o en ${OUTPUT_FILE}`).toBe(results.length);
});
