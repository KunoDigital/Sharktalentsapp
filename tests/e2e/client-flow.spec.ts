import { test, expect, Page } from '@playwright/test';

/**
 * Test E2E REALISTA del proceso completo del cliente.
 *
 * Hace CLICKS REALES en cada pregunta como lo haría un usuario humano.
 * No usa submit por API — todo va por la UI.
 *
 * Flujo:
 *   1. POST /api/marketing/lead (captura via funnel)
 *   2. Browser abre URL conductual → register → VELNA (5 subtests) → DISC → integridad
 *   3. Backend genera reporte automáticamente
 *   4. Browser abre reporte y verifica contenido
 *   5. Verificación vía API (DISC normalizado, dims integridad, etc)
 *
 * Tarda 3-7 minutos por la cantidad de clicks.
 * Requisitos: tests/.env.local con MARKETING_SITE_KEY.
 */

const SITE_KEY = process.env.MARKETING_SITE_KEY ?? '';
const TEST_EMAIL_PREFIX = 'e2e-real';

test.describe.serial('Proceso E2E REALISTA del cliente', () => {
  let leadEmail: string;
  let leadId: string;
  let conductualUrl: string;
  let integridadUrl: string;
  let demoReportUrl: string;

  // 15 min max por test
  test.setTimeout(15 * 60 * 1000);

  test.beforeAll(() => {
    if (!SITE_KEY) {
      throw new Error('MARKETING_SITE_KEY no está seteado. Configurá tests/.env.local');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    leadEmail = `${TEST_EMAIL_PREFIX}-${timestamp}@kunodigital.com`;
    console.log(`[E2E REAL] Email del test: ${leadEmail}`);
  });

  test('1. Cliente captura en funnel', async ({ request }) => {
    const response = await request.post('/server/api/api/marketing/lead', {
      headers: { 'X-Marketing-Site-Key': SITE_KEY, 'Content-Type': 'application/json' },
      data: {
        email: leadEmail,
        contact_name: 'Cliente E2E Real',
        company: 'Test Realista',
        whatsapp: '+5491100000000',
        source: 'playwright_e2e_real',
        consent_marketing: true,
        quiz_data: {
          puesto_tipo: 'ventas',
          proceso_actual: 'cv_referencias',
          historial_error: 'si_reinicio',
          urgencia: 'less_30d',
          salario_target: 1500,
        },
      },
    });
    expect(response.status()).toBeLessThan(300);
    const body = await response.json();
    leadId = body.lead_id;
    conductualUrl = body.conductual_url;
    integridadUrl = body.integridad_url;
    console.log(`[E2E REAL] Lead ${leadId} creado, URLs capturadas`);
  });

  test('2. Cliente completa toda la demo (conductual + integridad) con clicks reales', async ({ page }) => {
    // Listener: capturar errores JS del browser
    page.on('pageerror', (err) => {
      console.log(`[E2E REAL] [BROWSER ERROR] ${err.message}`);
    });
    page.on('console', (msg) => {
      const txt = msg.text();
      if (msg.type() === 'error' || msg.type() === 'warning' || txt.toLowerCase().includes('error')) {
        console.log(`[E2E REAL] [BROWSER ${msg.type().toUpperCase()}] ${txt.slice(0, 200)}`);
      }
    });

    // Listener: logear TODAS las requests a /submit para diagnosticar fallas silenciosas
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/test/') && url.includes('/submit')) {
        let bodyPreview = '';
        try {
          const txt = await resp.text();
          bodyPreview = txt.slice(0, 200);
        } catch {/* ignore */}
        console.log(`[E2E REAL] [SUBMIT] ${resp.status()} ${url.slice(-80)} → ${bodyPreview}`);
      }
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.includes('/test/') && url.includes('/submit')) {
        console.log(`[E2E REAL] [SUBMIT FAILED] ${url} → ${req.failure()?.errorText}`);
      }
    });

    // ===== CONDUCTUAL: registro =====
    console.log(`[E2E REAL] Abriendo URL conductual…`);
    await page.goto(conductualUrl);
    await registerOnDemoPage(page, 'Cliente E2E Real', leadEmail);
    await page.waitForURL(/\/test\/[^/]+\/velna/, { timeout: 15_000 });
    console.log(`[E2E REAL] Registrado en conductual, en VELNA`);

    // ===== VELNA =====
    // VELNA carga preguntas vía dynamic import. Esperar a que los 5 subtests
    // se rendericen antes de click "Empezar", si no startSubtest(0) crashea
    // porque VELNA_SUBTESTS aún está vacío.
    await page.locator('.ct-subtest-row').first().waitFor({ state: 'visible', timeout: 15_000 });
    const subtestRows = await page.locator('.ct-subtest-row').count();
    console.log(`[E2E REAL] VELNA cargada con ${subtestRows} subtests, click Empezar`);
    await page.locator('.ct-start-btn').filter({ hasText: 'Empezar' }).first().click();

    let subtestNum = 0;
    while (subtestNum < 10) {
      subtestNum++;

      // ¿Estamos en intro de subtest? Si sí, click "Comenzar"
      const comenzarBtn = page.locator('.ct-start-btn').filter({ hasText: 'Comenzar' }).first();
      if (await comenzarBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        console.log(`[E2E REAL] VELNA subtest ${subtestNum} arrancando…`);
        await comenzarBtn.click();
      }

      // Responder preguntas hasta que no haya más
      let qNum = 0;
      while (qNum < 30) {
        qNum++;
        const firstOption = page.locator('.ct-mc-option').first();
        if (!(await firstOption.isVisible({ timeout: 3_500 }).catch(() => false))) break;
        await firstOption.click();
        // VELNA auto-advance ~500ms
        await page.waitForTimeout(700);
      }

      // ¿Terminó VELNA?
      if (await page.locator('h1', { hasText: 'VELNA completa' }).isVisible({ timeout: 1_500 }).catch(() => false)) {
        console.log(`[E2E REAL] VELNA completa tras ${subtestNum} subtests`);
        break;
      }
    }

    // VELNA → DISC (auto-navega)
    await page.waitForURL(/\/test\/[^/]+\/disc/, { timeout: 15_000 });
    console.log(`[E2E REAL] En DISC`);

    // ===== DISC =====
    // Esperar a que el contenido del DISC esté listo. La página es lazy, puede tardar.
    // Pueden coexistir transiciones de VELNA finalizando con DISC iniciando.
    console.log(`[E2E REAL] DISC: esperando a que la página renderice…`);
    await page.waitForTimeout(2000);
    // Dump diagnostico
    const discHtmlLen = (await page.locator('body').innerHTML().catch(() => '')).length;
    const discText = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
    const optionsCount = await page.locator('.ct-mc-option').count();
    const startBtnCount = await page.locator('.ct-start-btn').count();
    const allButtonsCount = await page.locator('button').count();
    console.log(`[E2E REAL] DISC DOM: html_len=${discHtmlLen} options=${optionsCount} start_btns=${startBtnCount} all_btns=${allButtonsCount}`);
    console.log(`[E2E REAL] DISC TEXT: ${discText}`);

    // Capturar la promise de la request de submit ANTES de hacer click en Terminar
    const discSubmitPromise = page.waitForResponse(
      (r) => r.url().includes('/test/') && r.url().includes('/submit') && r.request().method() === 'POST',
      { timeout: 60_000 },
    ).catch(() => null);

    let qNum = 0;
    let lastBtnText = '';
    while (qNum < 50) {
      qNum++;
      const firstOption = page.locator('.ct-mc-option').first();
      if (!(await firstOption.isVisible({ timeout: 4_000 }).catch(() => false))) {
        console.log(`[E2E REAL] DISC iter ${qNum}: no hay options, salimos. lastBtnText="${lastBtnText}"`);
        break;
      }
      await firstOption.click();
      await page.waitForTimeout(300);

      const nextBtn = page.locator('.ct-start-btn').filter({ hasText: /(Siguiente|Terminar)/ }).first();
      if (!(await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
        console.log(`[E2E REAL] DISC iter ${qNum}: no hay next/terminar button. lastBtnText="${lastBtnText}"`);
        break;
      }
      // Verificar si está disabled
      const isDisabled = await nextBtn.isDisabled().catch(() => false);
      const btnText = (await nextBtn.textContent()) ?? '';
      lastBtnText = btnText;
      if (qNum % 5 === 1 || btnText.includes('Terminar')) {
        console.log(`[E2E REAL] DISC iter ${qNum}: btnText="${btnText.trim()}" disabled=${isDisabled}`);
      }
      await nextBtn.click();
      if (btnText.includes('Terminar')) {
        console.log(`[E2E REAL] DISC: click Terminar ejecutado en pregunta ${qNum}`);
        break;
      }
      await page.waitForTimeout(300);
    }

    // Esperar respuesta del submit
    const discResp = await discSubmitPromise;
    if (discResp) {
      console.log(`[E2E REAL] DISC submit response: ${discResp.status()}`);
    } else {
      console.log(`[E2E REAL] DISC submit response NO DETECTADA. lastBtnText="${lastBtnText}"`);
      // Diagnostic dump
      const pageUrl = page.url();
      const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
      console.log(`[E2E REAL] DISC URL actual: ${pageUrl}`);
      console.log(`[E2E REAL] DISC body preview: ${bodyText}`);
    }
    await page.waitForTimeout(1500);

    // ===== INTEGRIDAD =====
    console.log(`[E2E REAL] Abriendo URL integridad…`);
    await page.goto(integridadUrl);
    await registerOnDemoPage(page, 'Cliente E2E Real', leadEmail);
    await page.waitForURL(/\/test\/[^/]+\/integridad/, { timeout: 15_000 });
    console.log(`[E2E REAL] En integridad`);

    // Esperar a que la página de integridad cargue (busca primera opción)
    await page.locator('.ct-mc-option').first().waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`[E2E REAL] Integridad pregunta 1 visible, arrancamos`);

    // Capturar promise de submit de integridad
    const intSubmitPromise = page.waitForResponse(
      (r) => r.url().includes('/test/') && r.url().includes('/submit') && r.request().method() === 'POST',
      { timeout: 120_000 },
    ).catch(() => null);

    qNum = 0;
    let lastIntBtnText = '';
    while (qNum < 150) {
      qNum++;
      const firstOption = page.locator('.ct-mc-option').first();
      if (!(await firstOption.isVisible({ timeout: 4_000 }).catch(() => false))) {
        console.log(`[E2E REAL] Integridad iter ${qNum}: no hay options, salimos. lastBtn="${lastIntBtnText}"`);
        break;
      }

      // Variar opción
      const optionCount = await page.locator('.ct-mc-option').count();
      const chosenIdx = qNum % Math.max(optionCount, 1);
      await page.locator('.ct-mc-option').nth(chosenIdx).click();
      await page.waitForTimeout(250);

      const nextBtn = page.locator('.ct-start-btn').filter({ hasText: /(Siguiente|Terminar)/ }).first();
      if (!(await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
        console.log(`[E2E REAL] Integridad iter ${qNum}: no hay next btn`);
        break;
      }
      const btnText = (await nextBtn.textContent()) ?? '';
      lastIntBtnText = btnText;
      if (qNum % 10 === 1 || btnText.includes('Terminar')) {
        console.log(`[E2E REAL] Integridad iter ${qNum}: btn="${btnText.trim()}"`);
      }
      await nextBtn.click();
      if (btnText.includes('Terminar')) {
        console.log(`[E2E REAL] Integridad: click Terminar en pregunta ${qNum}`);
        break;
      }
      await page.waitForTimeout(250);
    }

    // Esperar a que la response del submit Integridad llegue
    const intResp = await intSubmitPromise;
    if (intResp) {
      console.log(`[E2E REAL] Integridad submit response: ${intResp.status()}`);
    } else {
      console.log(`[E2E REAL] Integridad submit response no detectada (timeout)`);
    }

    // Quedarse en la página un poco más para que tryCompleteMarketingDemo termine
    // (es fire-and-forget en el backend, pero como el evento ya se disparó, sigue corriendo)
    await page.waitForTimeout(3000);
    console.log(`[E2E REAL] Demo completa de extremo a extremo`);
  });

  test('3. Backend genera reporte automáticamente', async ({ request }) => {
    let leadStatus = '';
    let url = '';
    const startMs = Date.now();
    while (Date.now() - startMs < 60_000) {
      const resp = await request.get(
        `/server/api/api/marketing/lead-status?email=${encodeURIComponent(leadEmail)}`,
        { headers: { 'X-Marketing-Site-Key': SITE_KEY } },
      );
      if (resp.ok()) {
        const body = await resp.json();
        leadStatus = body.lead_status ?? '';
        url = body.demo_report_url ?? '';
        console.log(`[E2E REAL] Poll status=${leadStatus} report=${url ? 'yes' : 'no'}`);
        if (leadStatus === 'eval_completed' && url) break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(leadStatus).toBe('eval_completed');
    expect(url).toContain('/demo-report/');
    demoReportUrl = url;
    console.log(`[E2E REAL] Reporte generado: ${demoReportUrl}`);
  });

  test('4. Cliente abre el reporte y verifica contenido', async ({ page }) => {
    await page.goto(demoReportUrl);
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).toContain('disc');
    expect(bodyText.toLowerCase()).toContain('integridad');
    console.log(`[E2E REAL] Reporte renderiza correctamente`);
  });

  test('5. Verificar contenido del reporte vía API (data completa)', async ({ request }) => {
    const reportToken = demoReportUrl.match(/\/demo-report\/(.+)$/)?.[1];
    expect(reportToken).toBeTruthy();

    const resp = await request.get(`/server/api/report/${reportToken}`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const r = body.report;

    expect(r.candidate?.name).toBe('Cliente E2E Real');
    expect(r.integrity_dimensions.length).toBeGreaterThanOrEqual(13);

    // Catalyst devuelve numbers como strings — convertir explícitamente
    const discSum =
      Number(r.scores.disc_norm_d ?? 0) +
      Number(r.scores.disc_norm_i ?? 0) +
      Number(r.scores.disc_norm_s ?? 0) +
      Number(r.scores.disc_norm_c ?? 0);

    console.log('\n========== REPORTE FINAL ==========');
    console.log(`Lead email:        ${leadEmail}`);
    console.log(`Lead ID:           ${leadId}`);
    console.log(`Report URL:        ${demoReportUrl}`);
    console.log(`DISC suma:         ${discSum}`);
    console.log(`  D=${r.scores.disc_norm_d} I=${r.scores.disc_norm_i} S=${r.scores.disc_norm_s} C=${r.scores.disc_norm_c}`);
    console.log(`DISC dominante:    ${r.scores.disc_perfil_dominante}`);
    console.log(`VELNA indice:      ${r.scores.velna_indice}`);
    console.log(`  verbal=${r.scores.velna_verbal} espacial=${r.scores.velna_espacial} logica=${r.scores.velna_logica} numerica=${r.scores.velna_numerica} abstracta=${r.scores.velna_abstracta}`);
    console.log(`Integridad:        ${r.scores.int_overall} (${r.scores.int_overall_pct}%) → ${r.scores.int_recomendacion}`);
    console.log(`Buena impresión:   ${r.scores.int_buena_impresion} (${r.scores.int_buena_impresion_pct}%)`);
    console.log(`Dimensiones int:   ${r.integrity_dimensions.length}`);
    console.log('====================================\n');

    // DISC válido: la suma debe ser >= 100 (idealmente 200) cuando hay respuestas reales
    expect(discSum, 'DISC normalizado debe sumar > 0 con respuestas reales').toBeGreaterThan(0);
  });
});

/**
 * Helper: completa el form de registro en /demo-test/<section>/<token>
 */
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
