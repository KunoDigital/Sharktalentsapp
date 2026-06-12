import { test, expect } from '@playwright/test';

/**
 * Flujo 3 — Candidato completa la prueba técnica
 *
 * Cris no quiere hacer clicks. Playwright hace TODO desde el link de Recruit
 * hasta el final del test técnica.
 *
 * Pasos:
 *   1. Abre el link de Recruit (con redirect)
 *   2. Llena el form de registro (nombre, salario, disponibilidad)
 *   3. Click "Empezar prueba técnica"
 *   4. Para cada una de las 15 preguntas, elige la primera opción y avanza
 *   5. Llega al final → backend persiste + dispara publishRecruitSync (outbox event)
 */

const RECRUIT_LINK = 'https://app.sharktalents.ai/server/api/api/recruit/test-link?recruit_job_id=756144000005212005&phase=tecnica&recruit_id=ZR_8696_CAND';

test.describe('Flujo 3 — Candidato Andrea completa técnica', () => {
  test.setTimeout(5 * 60 * 1000);

  test('1. Abre link + llena registro + completa todas las preguntas', async ({ page }) => {
    // Listeners de diagnóstico
    page.on('console', (msg) => {
      const t = msg.text();
      if (msg.type() === 'error' && !t.includes('Clerk has been loaded with development keys')) {
        console.log(`[FLOW3T] [BROWSER ERROR] ${t.slice(0, 200)}`);
      }
    });
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/register') || url.includes('/submit')) {
        const body = await resp.text().catch(() => '');
        console.log(`[FLOW3T] ${resp.status()} ${url.slice(-60)} → ${body.slice(0, 200)}`);
      }
    });

    console.log('[FLOW3T] Abriendo link de Recruit…');
    await page.goto(RECRUIT_LINK);

    // El redirect del backend nos lleva a /app/#/test/<token>/tecnica
    // Esperar a que el form de registro aparezca (puede tardar 1-2s)
    console.log('[FLOW3T] Esperando form de registro…');
    const fullNameInput = page.locator('input[type="text"]').first();
    await expect(fullNameInput).toBeVisible({ timeout: 20_000 });

    // Llenar form
    await fullNameInput.fill('Andrea Martínez Ruiz');
    await page.locator('input[type="number"]').first().fill('2000');
    await page.locator('select').first().selectOption('Inmediata');
    console.log('[FLOW3T] Form llenado');

    // Click "Empezar prueba técnica"
    const empezarBtn = page.locator('button', { hasText: /Empezar prueba|Empezar/i }).first();
    await empezarBtn.click();
    console.log('[FLOW3T] Click Empezar — esperando primera pregunta');

    // Esperar a que aparezca la primera pregunta (el form sale, las preguntas entran)
    await page.waitForTimeout(2000);

    // Bucle: responder cada pregunta hasta que termine
    let qNum = 0;
    while (qNum < 30) {
      qNum++;

      // Esperar la opción (option, radio button, etc.). El componente usa
      // .ct-mc-option o similar. También puede ser .ct-option, button con texto, etc.
      const optionCandidates = [
        '.ct-mc-option',
        '.ct-option',
        'button[class*="option"]',
        'label[class*="option"]',
      ];
      let optionClicked = false;
      for (const sel of optionCandidates) {
        const opts = page.locator(sel);
        if (await opts.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await opts.first().click();
          optionClicked = true;
          console.log(`[FLOW3T] Q${qNum}: opción clickeada (selector ${sel})`);
          break;
        }
      }
      if (!optionClicked) {
        // Probablemente terminó — verificar si hay pantalla de "✓ Respuestas guardadas" o similar
        const bodyText = await page.locator('body').innerText().catch(() => '');
        console.log(`[FLOW3T] Q${qNum}: no hay opción. Body: ${bodyText.slice(0, 200)}`);
        break;
      }
      await page.waitForTimeout(400);

      // Click "Siguiente" o "Terminar"
      const nextBtn = page.locator('button', { hasText: /Siguiente|Terminar/i }).first();
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const isDisabled = await nextBtn.isDisabled().catch(() => false);
        if (isDisabled) {
          console.log(`[FLOW3T] Q${qNum}: botón Siguiente disabled — esperando…`);
          await page.waitForTimeout(1000);
        }
        const btnText = await nextBtn.textContent();
        await nextBtn.click();
        console.log(`[FLOW3T] Q${qNum}: click "${btnText?.trim()}"`);
        await page.waitForTimeout(600);
        if (/Terminar/i.test(btnText ?? '')) {
          console.log(`[FLOW3T] Última pregunta enviada — esperando confirmación`);
          break;
        }
      }
    }

    // Esperar pantalla de confirmación/fin
    await page.waitForTimeout(3000);
    const finalText = await page.locator('body').innerText().catch(() => '');
    console.log(`[FLOW3T] FIN — body final: ${finalText.slice(0, 500)}`);
    expect(finalText).toMatch(/respuestas|gracias|completaste|siguiente prueba|guardad/i);
  });
});
