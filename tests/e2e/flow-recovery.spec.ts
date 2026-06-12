import { test, expect } from '@playwright/test';

/**
 * Flujo Recovery — Candidato perdió el link, lo recupera con su email.
 *
 * Asume:
 *   - El email del candidato existe en Candidates con al menos una Application activa
 *
 * Pasos:
 *   1. Candidato abre /recovery
 *   2. Ingresa su email
 *   3. Submite → backend devuelve mensaje genérico (no leak)
 *   4. Pantalla de confirmación muestra "vas a recibir un link"
 */

const APP_BASE = process.env.SHARK_APP_BASE ?? 'https://app.sharktalents.ai';
const RECOVERY_URL = `${APP_BASE}/app/#/recovery`;
const TEST_EMAIL = process.env.E2E_CANDIDATE_EMAIL ?? 'test+recovery@kunodigital.com';

test.describe('Flujo Recovery por email', () => {
  test.setTimeout(60 * 1000);

  test('Candidato ingresa email y recibe confirmación', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[RECOV] BROWSER ERROR: ${msg.text().slice(0, 200)}`);
    });

    console.log('[RECOV] Abriendo /recovery…');
    await page.goto(RECOVERY_URL);
    await page.waitForLoadState('networkidle');

    // Verificar que estamos en la página correcta
    await expect(page.getByText(/Recuperar mi link/)).toBeVisible({ timeout: 10_000 });

    // Llenar email
    await page.locator('input[type="email"]').fill(TEST_EMAIL);

    // Submit
    await page.getByRole('button', { name: /Mandame el link nuevo/ }).click();

    // Esperar confirmación
    await expect(page.getByText(/vas a recibir un link/)).toBeVisible({ timeout: 10_000 });
    console.log('[RECOV] ✓ Mensaje de confirmación visible');
  });

  test('Email inválido muestra error sin submit', async ({ page }) => {
    await page.goto(RECOVERY_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="email"]').fill('no-es-un-email');
    await page.getByRole('button', { name: /Mandame el link nuevo/ }).click();

    // La validación HTML5 nativa puede prevenir el submit; verificamos que no apareció
    // la pantalla de confirmación
    await page.waitForTimeout(1500);
    const confirmed = await page.getByText(/vas a recibir un link/).isVisible().catch(() => false);
    expect(confirmed).toBe(false);
  });
});
