import { test, expect, Page } from '@playwright/test';
import { TRANSCRIPTS } from './transcripts';

/**
 * Test E2E REALISTA del flow completo del cliente:
 *
 *   1. Cliente entra a la web → completa quiz de marketing (captura lead via API)
 *   2. Cliente abre URL conductual → registro → VELNA (5 subtests) → DISC con clicks reales
 *   3. Cliente abre URL integridad → registro → integridad con clicks reales
 *   4. Backend genera demo report automático → cliente recibe email
 *   5. Cris sube transcript → Anthropic genera draft con IA REAL
 *   6. Cliente abre portal cliente con el draft AI-generated
 *   7. Cliente aprueba con formulario embebido (9 campos)
 *   8. Backend pushea Lead a CRM (layout Sharktalents)
 *   9. Backend dispara contrato Zoho Sign con todos los datos llenos
 *
 * Tiempo estimado: ~8-10 min por run (VELNA+DISC 3 min, integridad 3 min, IA draft ~30-90s, resto rápido)
 *
 * Configurable:
 *   E2E_RUNS=10 (default) — cuántas veces correr el flow
 *
 * Email aliases: chrismarpalma+e2eN-{ts}@gmail.com → todos al inbox de Cris para supervisión.
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const SITE_KEY = process.env.MARKETING_SITE_KEY ?? '';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const RUNS = Number(process.env.E2E_RUNS ?? '10');
const EMAIL_BASE = 'chrismarpalma@gmail.com';

function aliasEmail(i: number): string {
  const [user, domain] = EMAIL_BASE.split('@');
  const ts = Date.now();
  return `${user}+e2eReal${i}-${ts}@${domain}`;
}

/** Catálogo cerrado de competencias (debe matchear el del prompt en outbox.ts). */
const COMPETENCIAS_CATALOG = new Set([
  'comunicacion_digital', 'colaboracion', 'adaptabilidad', 'iniciativa', 'planificacion',
  'manejo_ambiguedad', 'trabajo_equipo', 'retroalimentacion', 'orientacion_cliente',
  'aprendizaje_vuelo', 'resolucion_problemas', 'inteligencia_emocional', 'creatividad_innovacion',
  'liderazgo', 'orientacion_logro', 'persuasion_negociacion', 'mentalidad_digital', 'foco_data',
  'impacto_influencia', 'autoconfianza', 'comprension_interpersonal', 'desarrollo_interrelaciones',
  'orden_calidad', 'asertividad', 'dinamismo_energia', 'habilidad_analitica', 'perseverancia',
  'orientacion_accion', 'compromiso_organizacional', 'actitud_servicio', 'manejo_conflictos',
  'toma_decisiones_oportuna', 'calidad_decisiones', 'capacidad_intelectual', 'capacidad_escuchar',
  'paciencia', 'comunicacion_escrita', 'gestion_riesgo', 'pensamiento_critico', 'resiliencia',
]);

/** Helper: completa el form de registro en /demo-test/<section>/<token> */
async function registerOnDemoPage(page: Page, name: string, email: string): Promise<void> {
  await page.locator('input[type="text"], input[name="name"]').first().fill(name);
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  const consentCheckbox = page.locator('input[type="checkbox"]').first();
  if (await consentCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
    await consentCheckbox.check();
  }
  await page
    .locator('button[type="submit"], button:has-text("Empezar"), button:has-text("Comenzar"), button:has-text("Continuar")')
    .first()
    .click();
}

test.beforeAll(() => {
  if (!SITE_KEY) {
    throw new Error('MARKETING_SITE_KEY no está seteado. Configurá tests/.env.local');
  }
});

for (let i = 1; i <= RUNS; i++) {
  // Rotamos entre los 10 transcripts (puestos distintos: ventas, contabilidad, RRHH, tech, etc).
  const transcriptCase = TRANSCRIPTS[(i - 1) % TRANSCRIPTS.length];

  test(`Run ${i}/${RUNS} (${transcriptCase.expected_title}): web → demo → IA → portal → form → CRM + Sign`, async ({ page, request }) => {
    test.setTimeout(15 * 60 * 1000); // 15 min por run

    const email = aliasEmail(i);
    const contactName = `Cliente Real ${i}`;
    const company = `Empresa Real Run ${i}`;
    const rucNit = `RUC-REAL-${i}-${Date.now()}`;
    console.log(`[Run ${i}] Email: ${email}`);
    console.log(`[Run ${i}] Transcript ID: ${transcriptCase.id} — ${transcriptCase.expected_title}`);

    // Listeners de browser para diagnosticar
    page.on('pageerror', (err) => console.log(`[Run ${i}] [BROWSER ERROR] ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[Run ${i}] [BROWSER ERROR] ${msg.text().slice(0, 200)}`);
    });

    // ========== STEP 1: Capture lead via API ==========
    console.log(`[Run ${i}] Step 1: capture lead via /marketing/lead`);
    const captureRes = await request.post(`${BASE_API}/server/api/api/marketing/lead`, {
      headers: { 'X-Marketing-Site-Key': SITE_KEY, 'Content-Type': 'application/json' },
      data: {
        email,
        contact_name: contactName,
        company,
        whatsapp: '+50760000000',
        source: 'playwright_e2e_realista',
        consent_marketing: true,
        quiz_data: {
          puesto_tipo: 'ventas',
          proceso_actual: 'cv_referencias',
          historial_error: 'si_reinicio',
          urgencia: 'less_30d',
          salario_target: 2500,
        },
      },
    });
    expect(captureRes.status(), `capture lead status run ${i}`).toBeLessThan(300);
    const captureBody = await captureRes.json();
    const conductualUrl = captureBody.conductual_url;
    const integridadUrl = captureBody.integridad_url;
    expect(conductualUrl).toBeTruthy();
    expect(integridadUrl).toBeTruthy();
    console.log(`[Run ${i}] Lead capturado, URLs OK`);

    // ========== STEP 2: Demo conductual (VELNA + DISC) ==========
    console.log(`[Run ${i}] Step 2: demo conductual (VELNA + DISC)`);
    await page.goto(conductualUrl);
    await registerOnDemoPage(page, contactName, email);
    await page.waitForURL(/\/test\/[^/]+\/velna/, { timeout: 15_000 });
    console.log(`[Run ${i}] Registrado conductual, en VELNA`);

    // VELNA: esperar subtests + click Empezar
    await page.locator('.ct-subtest-row').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.ct-start-btn').filter({ hasText: 'Empezar' }).first().click();

    // VELNA loop: hasta que aparezca "VELNA completa"
    let subtestNum = 0;
    while (subtestNum < 10) {
      subtestNum++;
      const comenzarBtn = page.locator('.ct-start-btn').filter({ hasText: 'Comenzar' }).first();
      if (await comenzarBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await comenzarBtn.click();
      }
      let qNum = 0;
      while (qNum < 30) {
        qNum++;
        const firstOption = page.locator('.ct-mc-option').first();
        if (!(await firstOption.isVisible({ timeout: 3_500 }).catch(() => false))) break;
        await firstOption.click();
        await page.waitForTimeout(700);
      }
      if (await page.locator('h1', { hasText: 'VELNA completa' }).isVisible({ timeout: 1_500 }).catch(() => false)) {
        console.log(`[Run ${i}] VELNA completa tras ${subtestNum} subtests`);
        break;
      }
    }

    // VELNA → DISC
    await page.waitForURL(/\/test\/[^/]+\/disc/, { timeout: 15_000 });
    console.log(`[Run ${i}] En DISC`);
    await page.waitForTimeout(2000);

    const discSubmitPromise = page.waitForResponse(
      (r) => r.url().includes('/test/') && r.url().includes('/submit') && r.request().method() === 'POST',
      { timeout: 60_000 },
    ).catch(() => null);

    let discQ = 0;
    while (discQ < 50) {
      discQ++;
      const firstOption = page.locator('.ct-mc-option').first();
      if (!(await firstOption.isVisible({ timeout: 4_000 }).catch(() => false))) break;
      await firstOption.click();
      await page.waitForTimeout(300);
      const nextBtn = page.locator('.ct-start-btn').filter({ hasText: /(Siguiente|Terminar)/ }).first();
      if (!(await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false))) break;
      const btnText = (await nextBtn.textContent()) ?? '';
      await nextBtn.click();
      if (btnText.includes('Terminar')) {
        console.log(`[Run ${i}] DISC: Terminar en preg ${discQ}`);
        break;
      }
      await page.waitForTimeout(300);
    }
    await discSubmitPromise;
    await page.waitForTimeout(1500);

    // ========== STEP 3: Demo integridad ==========
    console.log(`[Run ${i}] Step 3: demo integridad`);
    await page.goto(integridadUrl);
    await registerOnDemoPage(page, contactName, email);
    await page.waitForURL(/\/test\/[^/]+\/integridad/, { timeout: 15_000 });
    await page.locator('.ct-mc-option').first().waitFor({ state: 'visible', timeout: 15_000 });

    const intSubmitPromise = page.waitForResponse(
      (r) => r.url().includes('/test/') && r.url().includes('/submit') && r.request().method() === 'POST',
      { timeout: 120_000 },
    ).catch(() => null);

    let intQ = 0;
    while (intQ < 150) {
      intQ++;
      const firstOption = page.locator('.ct-mc-option').first();
      if (!(await firstOption.isVisible({ timeout: 4_000 }).catch(() => false))) break;
      const optionCount = await page.locator('.ct-mc-option').count();
      const chosenIdx = intQ % Math.max(optionCount, 1);
      await page.locator('.ct-mc-option').nth(chosenIdx).click();
      await page.waitForTimeout(250);
      const nextBtn = page.locator('.ct-start-btn').filter({ hasText: /(Siguiente|Terminar)/ }).first();
      if (!(await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false))) break;
      const btnText = (await nextBtn.textContent()) ?? '';
      await nextBtn.click();
      if (btnText.includes('Terminar')) {
        console.log(`[Run ${i}] Integridad: Terminar en preg ${intQ}`);
        break;
      }
      await page.waitForTimeout(250);
    }
    await intSubmitPromise;
    await page.waitForTimeout(3000);
    console.log(`[Run ${i}] Demo completa`);

    // ========== STEP 4: Esperar generación de demo report ==========
    console.log(`[Run ${i}] Step 4: esperar demo report`);
    let demoReportUrl = '';
    const startWait = Date.now();
    while (Date.now() - startWait < 60_000) {
      const statusRes = await request.get(
        `${BASE_API}/server/api/api/marketing/lead-status?email=${encodeURIComponent(email)}`,
        { headers: { 'X-Marketing-Site-Key': SITE_KEY } },
      );
      if (statusRes.ok()) {
        const sb = await statusRes.json();
        if (sb.demo_report_url) {
          demoReportUrl = sb.demo_report_url;
          break;
        }
      }
      await page.waitForTimeout(3_000);
    }
    expect(demoReportUrl, `demo report URL run ${i}`).toBeTruthy();
    console.log(`[Run ${i}] Demo report URL: ${demoReportUrl}`);

    // ========== STEP 5: Generar draft con Anthropic (IA real) ==========
    console.log(`[Run ${i}] Step 5: generar draft con Anthropic`);
    const draftRes = await request.post(`${BASE_API}/server/api/api/admin/_diag-generate-draft`, {
      headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
      data: {
        email,
        client_name: contactName,
        client_company: company,
        transcript: transcriptCase.transcript,
      },
      timeout: 120_000,
    });
    expect(draftRes.status(), `draft generation status run ${i}`).toBe(200);
    const draftJson = await draftRes.json();
    const portalUrl = draftJson.portal_url;
    console.log(`[Run ${i}] Draft generado por IA. ID: ${draftJson.draft_id}`);
    console.log(`[Run ${i}] Payload summary:`, JSON.stringify(draftJson.payload_summary));

    // ============ VALIDACIONES CALIDAD IA ============
    const summary = draftJson.payload_summary;
    expect(summary, `IA payload summary for run ${i}`).toBeTruthy();

    // 1. Empresa pisada del lead (NO del transcript)
    expect(summary.company, `Company del LEAD (no transcript) for run ${i}`).toBe(company);

    // 2. DISC suma 200 en perfil A y B
    const sumDisc = (p?: { d?: number; i?: number; s?: number; c?: number }) =>
      (Number(p?.d ?? 0)) + (Number(p?.i ?? 0)) + (Number(p?.s ?? 0)) + (Number(p?.c ?? 0));
    const sumA = sumDisc(summary.disc_ideal_a);
    const sumB = sumDisc(summary.disc_ideal_b);
    expect(sumA, `DISC A suma 200 run ${i} (actual ${sumA})`).toBe(200);
    expect(sumB, `DISC B suma 200 run ${i} (actual ${sumB})`).toBe(200);

    // 3. Polaridades respetadas
    const checkPolaridades = (p?: { d?: number; i?: number; s?: number; c?: number }, label = '') => {
      if (!p) return;
      if (Number(p.d ?? 0) >= 65) expect(Number(p.s ?? 0), `${label} D≥65 → S≤35 run ${i}`).toBeLessThanOrEqual(35);
      if (Number(p.i ?? 0) >= 65) expect(Number(p.c ?? 0), `${label} I≥65 → C≤35 run ${i}`).toBeLessThanOrEqual(35);
      if (Number(p.s ?? 0) >= 65) expect(Number(p.d ?? 0), `${label} S≥65 → D≤35 run ${i}`).toBeLessThanOrEqual(35);
      if (Number(p.c ?? 0) >= 65) expect(Number(p.i ?? 0), `${label} C≥65 → I≤35 run ${i}`).toBeLessThanOrEqual(35);
    };
    checkPolaridades(summary.disc_ideal_a, 'A');
    checkPolaridades(summary.disc_ideal_b, 'B');

    // 4. A y B son distintos (no copias)
    expect(JSON.stringify(summary.disc_ideal_a), `A ≠ B run ${i}`).not.toBe(JSON.stringify(summary.disc_ideal_b));

    // 5. Competencias del catálogo cerrado (3-5)
    const competencias = Array.isArray(summary.competencias) ? summary.competencias : [];
    expect(competencias.length, `competencias 3-5 run ${i}`).toBeGreaterThanOrEqual(3);
    expect(competencias.length, `competencias 3-5 run ${i}`).toBeLessThanOrEqual(8);
    for (const c of competencias) {
      expect(COMPETENCIAS_CATALOG.has(c.name), `competencia "${c.name}" del catálogo cerrado run ${i}`).toBe(true);
    }

    // 6. Salario plausible (max > 0 y dentro de rango razonable: 500-20000 USD mensuales)
    const salaryMax = Number(summary.salary_range_usd?.max ?? 0);
    expect(salaryMax, `salary_max > 0 run ${i}`).toBeGreaterThan(0);
    expect(salaryMax, `salary_max < 20000 USD mensual run ${i}`).toBeLessThan(20_000);

    // 7. Jefe descrito (campo nuevo del prompt nuevo)
    expect(summary.jefe, `IA generated jefe run ${i}`).toBeTruthy();

    console.log(`[Run ${i}] ✓ Validaciones calidad IA pasaron`);

    // ========== STEP 6: Cliente abre portal ==========
    console.log(`[Run ${i}] Step 6: abrir portal`);
    await page.goto(portalUrl);
    await expect(page.getByText('Apruebas este perfil', { exact: false })).toBeVisible({ timeout: 30_000 });
    console.log(`[Run ${i}] Portal cargó`);

    // ========== STEP 7: Aprobar con formulario embebido ==========
    console.log(`[Run ${i}] Step 7: aprobar con form embebido`);
    await page.getByRole('button', { name: /Aprobar el perfil/i }).click();
    await expect(page.getByText('Antes de iniciar', { exact: false })).toBeVisible({ timeout: 5_000 });

    const fillByLabel = async (labelText: string, value: string) => {
      const label = page.locator('label', { hasText: labelText });
      await label.locator('input').fill(value);
    };

    await fillByLabel('Nombre completo', contactName);
    await fillByLabel('Email', email);
    await fillByLabel('Teléfono', '+50760000000');
    await fillByLabel('Empresa', company);
    await fillByLabel('RUC / NIT', rucNit);
    await fillByLabel('Calle y número', 'Calle 50, Edificio Test');
    await fillByLabel('Ciudad', 'Ciudad de Panamá');
    await fillByLabel('Estado/Provincia', 'Panamá');
    await fillByLabel('País', 'Panamá');
    await page.getByRole('button', { name: /Guardar y aprobar/i }).click();
    await expect(page.getByText('Vamos a iniciar la búsqueda', { exact: false })).toBeVisible({ timeout: 30_000 });
    console.log(`[Run ${i}] Aprobación exitosa`);
    await page.waitForTimeout(3_000); // wait push CRM

    // ========== STEP 8: Verificar CRM ==========
    console.log(`[Run ${i}] Step 8: verificar CRM`);
    const crmRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-crm-lead?email=${encodeURIComponent(email)}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    expect(crmRes.status(), `diag-crm-lead status run ${i}`).toBe(200);
    const crmJson = await crmRes.json();
    console.log(`[Run ${i}] CRM key_fields:`, JSON.stringify(crmJson.key_fields));
    console.log(`[Run ${i}] CRM contract_fields:`, JSON.stringify(crmJson.contract_fields));

    expect(crmJson.found, `lead found CRM run ${i}`).toBe(true);
    expect(crmJson.key_fields.Company, `Company CRM run ${i}`).toBe(company);
    expect(crmJson.contract_fields.RUC_NIT, `RUC_NIT CRM run ${i}`).toBe(rucNit);
    expect(crmJson.contract_fields.Street, `Street CRM run ${i}`).toBe('Calle 50, Edificio Test');
    expect(crmJson.contract_fields.Country, `Country CRM run ${i}`).toBe('Panamá');
    expect(crmJson.layout_id, `Sharktalents layout run ${i}`).toBe('5710516000033328002');

    console.log(`[Run ${i}] ✓ FULL FLOW REAL OK end-to-end`);
  });
}
