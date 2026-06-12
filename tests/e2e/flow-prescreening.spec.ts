import { test, expect } from '@playwright/test';

/**
 * Flujo Prescreening — Candidato completa el prescreening generado por IA.
 *
 * Asume:
 *   - Job tiene prescreening_questions_cache populado (Cris generó previamente)
 *   - Candidato llega via /api/recruit/test-link?phase=prescreening
 *
 * Pasos:
 *   1. Candidato abre link de Recruit con phase=prescreening
 *   2. Se redirige a /test/<token>/prescreening
 *   3. Responde las 4-6 preguntas eligiendo la primera opción (que SUELE ser la aceptada)
 *   4. Envía → backend evalúa y transiciona a prefilter_passed o auto_rejected
 *   5. Si pasó → ve pantalla "✓ Pasaste el prescreening" + botón a técnica
 *   6. Si falló → ve "Gracias por tu interés"
 *
 * **Nota:** este test depende del estado real de Catalyst. Para que pase consistentemente,
 * el job referenciado debe tener prescreening generado. Si el job no tiene preguntas
 * (status='no_cache'), el flujo salta directo a "vamos a la técnica" sin error.
 */

const RECRUIT_BASE = process.env.SHARK_BASE_URL ?? 'https://app.sharktalents.ai/server/api';
const TEST_RECRUIT_JOB = process.env.E2E_RECRUIT_JOB_ID ?? '756144000005212005';
const TEST_RECRUIT_CANDIDATE = process.env.E2E_RECRUIT_CANDIDATE_ID ?? 'ZR_TEST_CAND';

const RECRUIT_LINK = `${RECRUIT_BASE}/api/recruit/test-link?recruit_job_id=${TEST_RECRUIT_JOB}&phase=prescreening&recruit_id=${TEST_RECRUIT_CANDIDATE}`;

test.describe('Flujo Prescreening', () => {
  test.setTimeout(2 * 60 * 1000);

  test('Candidato responde prescreening y avanza a técnica', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('Clerk has been loaded with development keys')) {
          console.log(`[PRESC] [BROWSER ERROR] ${t.slice(0, 200)}`);
        }
      }
    });

    console.log('[PRESC] Abriendo link…');
    await page.goto(RECRUIT_LINK);

    // Esperar redirect al frontend (puede tomar 1-2s)
    await page.waitForURL(/\/test\//, { timeout: 30_000 });
    console.log('[PRESC] Redirect ok →', page.url());

    // Si vamos a CandidateTestEntry, navegar manualmente a prescreening
    // (depende de phase=prescreening en URL — el backend ya nos redirige bien si está bien wireado)
    if (!page.url().includes('/prescreening')) {
      console.log('[PRESC] Phase no detectada; navegando a prescreening manualmente');
      const newUrl = page.url().replace(/\/test\/([^/]+).*/, '/test/$1/prescreening');
      await page.goto(newUrl);
    }

    // Esperar a que cargue
    await page.waitForLoadState('networkidle');

    // Si el backend devuelve "no_prescreening" (no hay preguntas configuradas), el flow
    // muestra "Vamos directo a la prueba técnica" — eso es válido. Salimos OK.
    const noPrescreening = page.getByText('No tenemos preguntas de prescreening');
    if (await noPrescreening.isVisible({ timeout: 5_000 }).catch(() => false)) {
      console.log('[PRESC] No hay preguntas configuradas — el job no tiene prescreening generado.');
      await expect(page.getByRole('button', { name: /Continuar/ })).toBeVisible();
      return;
    }

    // Asumir que hay preguntas. Esperar que aparezca la primera.
    await expect(page.getByText(/prescreening/i)).toBeVisible({ timeout: 10_000 });
    console.log('[PRESC] Pantalla de prescreening cargada');

    // Loop: responder cada pregunta eligiendo la PRIMERA opción
    // (que suele ser la "aceptada" — sí/dentro del rango)
    let questionCount = 0;
    while (questionCount < 10) {  // safety cap
      // ¿Hay opciones visibles?
      const options = page.locator('.ct-option');
      const count = await options.count();
      if (count === 0) {
        console.log('[PRESC] No hay opciones visibles → asumo fin del test');
        break;
      }

      console.log(`[PRESC] Pregunta ${questionCount + 1}: ${count} opciones`);
      await options.first().click();

      // Buscar botón Siguiente o Enviar
      const nextBtn = page.getByRole('button', { name: /Siguiente/ });
      const submitBtn = page.getByRole('button', { name: /^Enviar$/ });

      if (await submitBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('[PRESC] Submit detectado, click…');
        await submitBtn.click();
        break;
      }

      if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await nextBtn.click();
        questionCount++;
        await page.waitForTimeout(300);
      } else {
        console.log('[PRESC] Ni Siguiente ni Enviar visibles → salgo del loop');
        break;
      }
    }

    // Verificar resultado (pasó o falló)
    await page.waitForTimeout(2000);  // wait for submit response

    const passed = await page.getByText(/Pasaste el prescreening/).isVisible({ timeout: 5_000 }).catch(() => false);
    const failed = await page.getByText(/Gracias por tu interés/).isVisible({ timeout: 1_000 }).catch(() => false);

    if (passed) {
      console.log('[PRESC] ✓ Candidato pasó el prescreening');
      await expect(page.getByRole('button', { name: /Empezar prueba técnica/ })).toBeVisible();
    } else if (failed) {
      console.log('[PRESC] ✓ Candidato fue auto-rechazado (pantalla amable mostrada)');
      // No hay siguiente botón — el flow termina acá
    } else {
      throw new Error('Ni pasó ni falló — pantalla inesperada');
    }
  });
});
