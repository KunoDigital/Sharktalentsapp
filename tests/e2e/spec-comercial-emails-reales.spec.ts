import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Spec comercial: validar que los emails reales llegan al inbox de Cris.
 *
 * Flujo simulado (igual al de producción cuando entra un Meta Ad):
 *   1. Meta Ad form → Zoho CRM crea Lead → workflow rule dispara webhook
 *   2. POST /api/webhooks/zoho-crm/lead-created?secret=XXX
 *   3. SharkTalents: crea MarketingLead + publica email outbox event `meta_lead_welcome`
 *   4. Outbox process → ZeptoMail envía email
 *   5. Email llega a chrismarpalma+metalead-RUNTAG-cN@gmail.com (= inbox de Cris con alias)
 *
 * Cris valida manualmente: chequear inbox + spam. Si llegan los 5 emails distintos, OK.
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-comercial-emails-reales.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET ?? 'd6a36b80c97d17c77e6f5e41e6e555c3df27e623ce16409006e8849c4dd0e5c0';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const RUN_TAG = Date.now().toString(36);
const TOTAL_LEADS = 5;

const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'e2e', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `spec-emails-${RUN_TAG}.json`);

type LeadResult = {
  idx: number;
  email: string;
  company: string;
  contact_name: string;
  webhook_status: number;
  webhook_ms: number;
  webhook_body?: unknown;
  error?: string;
};

test('Comercial emails reales: 5 leads via webhook CRM → emails reales a inbox Cris', async ({ request }) => {
  test.setTimeout(10 * 60 * 1000);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: LeadResult[] = [];

  for (let i = 1; i <= TOTAL_LEADS; i++) {
    // Alias distintos para que Gmail los muestre separados pero todos vayan a Cris
    const email = `chrismarpalma+metalead-${RUN_TAG}-c${i}@gmail.com`;
    const firstName = `Cliente`;
    const lastName = `MetaAd ${i}`;
    const company = `Empresa Test Meta ${i}`;

    console.log(`\n[${i}/${TOTAL_LEADS}] webhook CRM → ${email}`);

    const result: LeadResult = {
      idx: i, email, company, contact_name: `${firstName} ${lastName}`,
      webhook_status: 0, webhook_ms: 0,
    };

    const t0 = Date.now();
    try {
      // Simulamos el body que mandaría Zoho CRM (form-urlencoded como en producción real)
      const res = await request.post(
        `${BASE_API}/server/api/api/webhooks/zoho-crm/lead-created?secret=${CRM_WEBHOOK_SECRET}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          form: {
            email,
            first_name: firstName,
            last_name: lastName,
            company,
            phone: `+507600000${i}`,
            lead_source: 'Meta leads ad',
            lead_id: `meta_${RUN_TAG}_${i}`,
          },
        },
      );
      result.webhook_ms = Date.now() - t0;
      result.webhook_status = res.status();
      const body = await res.json().catch(() => ({}));
      result.webhook_body = body;

      if (res.status() >= 200 && res.status() < 300) {
        console.log(`  ✓ ${result.webhook_ms}ms — status ${res.status()}`);
      } else {
        console.log(`  ✗ status ${res.status()}: ${JSON.stringify(body).slice(0, 200)}`);
        result.error = JSON.stringify(body).slice(0, 400);
      }
    } catch (err) {
      result.webhook_ms = Date.now() - t0;
      result.webhook_status = -1;
      result.error = `exception: ${(err as Error).message}`;
      console.log(`  ✗ EXCEPTION: ${(err as Error).message}`);
    }

    results.push(result);
    await new Promise((r) => setTimeout(r, 800));
  }

  // Después de los 5, disparamos manualmente el outbox para procesar los emails
  // (el cron del outbox no está activo en producción, hay que disparar a mano).
  console.log('\nDisparando outbox/process para enviar los emails...');
  for (let round = 1; round <= 6; round++) {
    try {
      const res = await request.post(
        `${BASE_API}/server/api/admin/outbox/process`,
        {
          headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
          data: { batch_size: 1 },
        },
      );
      const body = await res.json().catch(() => ({}));
      const processed = body.processed ?? 0;
      console.log(`  round ${round}: processed=${processed} ${JSON.stringify(body.results ?? []).slice(0, 80)}`);
      if (processed === 0) {
        console.log(`  outbox vacío después de ${round} rounds, fin.`);
        break;
      }
    } catch (err) {
      console.log(`  outbox process error: ${(err as Error).message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Inspeccionar outbox para ver el estado final de los eventos
  let outboxRecent: unknown = null;
  try {
    const res = await request.get(
      `${BASE_API}/server/api/admin/outbox?limit=15`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    const body = await res.json();
    outboxRecent = (body.events ?? []).slice(0, 10).map((e: Record<string, unknown>) => ({
      type: e.event_type, status: e.status, created: e.CREATEDTIME, error: e.last_error,
    }));
  } catch (err) {
    outboxRecent = { error: (err as Error).message };
  }

  const success = results.filter((r) => r.webhook_status >= 200 && r.webhook_status < 300);
  const summary = {
    run_tag: RUN_TAG,
    base_api: BASE_API,
    webhook_used: '/api/webhooks/zoho-crm/lead-created',
    total_attempted: results.length,
    total_webhook_success: success.length,
    leads: results,
    outbox_recent_events: outboxRecent,
    instructions_for_cris: [
      `Chequear inbox de chrismarpalma@gmail.com`,
      `Buscar 5 emails recientes con subject relacionado a "Meta Lead" o template "meta_lead_welcome"`,
      `Si no están en inbox, chequear spam/promociones (Gmail puede filtrarlos)`,
      `Cada email debería tener un alias distinto: +metalead-${RUN_TAG}-c1@ ... +metalead-${RUN_TAG}-c5@`,
    ],
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));

  console.log(`\n=== Resumen ===`);
  console.log(`Webhook calls OK: ${summary.total_webhook_success}/${summary.total_attempted}`);
  console.log(`Output JSON: ${OUTPUT_FILE}`);
  console.log(`\n👉 Cris: chequear inbox + spam para 5 emails con prefijo "metalead-${RUN_TAG}"`);

  expect(success.length, 'Webhook CRM debería aceptar los 5 leads').toBeGreaterThanOrEqual(4);
});
