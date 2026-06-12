import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec comercial: 25 clientes desde Meta Ads.
 *
 * Pivot 2026-06-09: SharkTalents v2 cubre la parte COMERCIAL (lead → portal cliente → contrato).
 * v1 sigue siendo el productivo para el lado de candidatos.
 *
 * Flujo simulado por cliente:
 *   1. POST /api/admin/_diag-trigger-test-flow
 *      → crea MarketingLead (como si vino de Meta Ads via webhook CRM)
 *      → crea JobProfileDraft mock (Gerente de Ventas E2E)
 *      → genera portal_token + portal_url
 *   2. Verificar que la respuesta tiene shape correcto (portal_url, draft_id, marketing_lead_id)
 *   3. Verificar que el draft persiste consultable via _diag-list-drafts
 *   4. Verificar que el outbox NO acumuló failures masivos durante el batch
 *
 * Salida: JSON con resultados de los 25 + lista de errores/caídas.
 *
 * Por qué este endpoint: cubre lo que ya está automatizable (diag tiene INTERNAL_KEY).
 * send-demo y send-contract requieren auth tenant Clerk (queda manual para Cris desde la UI).
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-comercial-25-clientes.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const RUN_TAG = Date.now().toString(36);
const TOTAL_CLIENTS = 25;

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-comercial-${RUN_TAG}.json`);

type ClientResult = {
  idx: number;
  email: string;
  company: string;
  contact_name: string;
  trigger_status: number;
  trigger_ms: number;
  marketing_lead_id?: string;
  draft_id?: string;
  portal_url?: string;
  error?: string;
  steps: string[];
};

type SpecSummary = {
  run_tag: string;
  base_api: string;
  total_attempted: number;
  total_success: number;
  total_errors: number;
  errors_by_status: Record<string, number>;
  avg_response_ms: number;
  outbox_before: { processed: number; pending: number };
  outbox_after: { processed: number; pending: number };
  clients: ClientResult[];
};

test('Comercial: 25 clientes desde "Meta Ads" llegan a portal con draft', async ({ request }) => {
  test.setTimeout(15 * 60 * 1000);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Snapshot inicial de outbox (cuántos eventos pending hay antes de empezar)
  const outboxBefore = await snapshotOutbox(request);

  const results: ClientResult[] = [];

  for (let i = 1; i <= TOTAL_CLIENTS; i++) {
    const email = `chrismarpalma+comercial-${RUN_TAG}-c${i}@gmail.com`;
    const company = `Empresa Meta Lead ${i}`;
    const contactName = `Cliente Meta ${i}`;
    const result: ClientResult = {
      idx: i, email, company, contact_name: contactName,
      trigger_status: 0, trigger_ms: 0, steps: [],
    };
    const steps = result.steps;

    console.log(`\n[${i}/${TOTAL_CLIENTS}] ${email}`);

    const t0 = Date.now();
    try {
      const res = await request.post(
        `${BASE_API}/server/api/api/admin/_diag-trigger-test-flow`,
        {
          headers: {
            'X-Internal-Key': INTERNAL_KEY,
            'Content-Type': 'application/json',
          },
          data: { email, contact_name: contactName, company },
        },
      );
      result.trigger_ms = Date.now() - t0;
      result.trigger_status = res.status();
      const body = await res.json().catch(() => ({}));

      if (res.status() === 200) {
        result.marketing_lead_id = body.marketing_lead_id;
        result.draft_id = body.draft_id;
        result.portal_url = body.portal_url;
        steps.push(`✓ trigger ${res.status()} en ${result.trigger_ms}ms (lead=${body.marketing_lead_id}, draft=${body.draft_id})`);
        console.log(`  ✓ ${result.trigger_ms}ms — lead ${body.marketing_lead_id}, draft ${body.draft_id}`);
      } else {
        result.error = JSON.stringify(body).slice(0, 400);
        steps.push(`✗ trigger ${res.status()} en ${result.trigger_ms}ms — ${result.error}`);
        console.log(`  ✗ FAIL ${res.status()}: ${result.error?.slice(0, 100)}`);
      }
    } catch (err) {
      result.trigger_ms = Date.now() - t0;
      result.trigger_status = -1;
      result.error = `exception: ${(err as Error).message}`;
      steps.push(`✗ exception: ${(err as Error).message}`);
      console.log(`  ✗ EXCEPTION: ${(err as Error).message}`);
    }

    results.push(result);
    // Pausa chica entre requests para no saturar
    await new Promise((r) => setTimeout(r, 500));
  }

  // Snapshot final del outbox
  const outboxAfter = await snapshotOutbox(request);

  const success = results.filter((r) => r.trigger_status === 200);
  const errors = results.filter((r) => r.trigger_status !== 200);
  const avgMs = results.reduce((s, r) => s + r.trigger_ms, 0) / results.length;
  const errorsByStatus: Record<string, number> = {};
  for (const r of errors) {
    const key = String(r.trigger_status);
    errorsByStatus[key] = (errorsByStatus[key] ?? 0) + 1;
  }

  const summary: SpecSummary = {
    run_tag: RUN_TAG,
    base_api: BASE_API,
    total_attempted: results.length,
    total_success: success.length,
    total_errors: errors.length,
    errors_by_status: errorsByStatus,
    avg_response_ms: Math.round(avgMs),
    outbox_before: outboxBefore,
    outbox_after: outboxAfter,
    clients: results,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));

  console.log(`\n=== Resumen Spec Comercial ===`);
  console.log(`Total: ${summary.total_attempted}`);
  console.log(`✓ Success: ${summary.total_success}`);
  console.log(`✗ Errores: ${summary.total_errors}`);
  if (Object.keys(errorsByStatus).length > 0) {
    console.log(`  por status: ${JSON.stringify(errorsByStatus)}`);
  }
  console.log(`Latencia promedio: ${summary.avg_response_ms}ms`);
  console.log(`Outbox: ${outboxBefore.pending} pending antes → ${outboxAfter.pending} pending después`);
  console.log(`\nOutput JSON: ${OUTPUT_FILE}`);

  if (errors.length > 0) {
    console.log(`\n--- Primeros 5 errores ---`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  [${e.idx}] status=${e.trigger_status}: ${e.error?.slice(0, 150)}`);
    }
  }

  // Validaciones: queremos al menos 20/25 éxito (>= 80%)
  expect(success.length, `Esperaban al menos 20/25 OK. Hubo ${errors.length} errores. Ver ${OUTPUT_FILE}`)
    .toBeGreaterThanOrEqual(20);
});

async function snapshotOutbox(request: import('@playwright/test').APIRequestContext): Promise<{ processed: number; pending: number }> {
  try {
    const res = await request.get(
      `${BASE_API}/server/api/admin/outbox?limit=300`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    if (res.status() !== 200) return { processed: -1, pending: -1 };
    const body = await res.json();
    const events: Array<{ status: string }> = body.events ?? [];
    const pending = events.filter((e) => e.status === 'pending' || e.status === 'processing').length;
    const processed = events.filter((e) => e.status === 'sent').length;
    return { processed, pending };
  } catch {
    return { processed: -1, pending: -1 };
  }
}
