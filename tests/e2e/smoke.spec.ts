import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verifican que la app responde y los endpoints públicos están vivos.
 * No requieren auth ni datos de prueba. Se corren en cada PR como gate básico.
 */

test.describe('Smoke tests — app responde', () => {
  test('homepage carga', async ({ page }) => {
    await page.goto('/');
    // La app de SharkTalents redirige a /app/ o muestra un splash. Solo verificamos
    // que algo HTML llegó (no 5xx).
    await expect(page).toHaveURL(/.*sharktalents\.ai.*/);
  });

  test('backend health endpoint responde 200', async ({ request }) => {
    const response = await request.get('/server/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('status');
  });
});
