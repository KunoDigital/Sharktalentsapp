import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Cargar tests/.env.local manualmente (sin dotenv para evitar nueva dep).
// Formato KEY=VALUE por línea, comentarios con #.
const envFile = resolve(__dirname, 'tests/.env.local');
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * Playwright config para SharkTalents.
 *
 * E2E tests cruzan frontend (Vite/React) + backend (Catalyst Advanced I/O) + Zoho.
 * Por eso vive a nivel root, no dentro de shark/.
 *
 * Modo de uso:
 *   npm run test:e2e           — corre todos en headless
 *   npm run test:e2e:ui        — abre Playwright UI (recomendado para desarrollo)
 *   npm run test:e2e:headed    — corre con browser visible
 *   npm run test:e2e:report    — abre el último HTML report
 *
 * BASE_URL apunta por default a producción (Catalyst Development environment, que es
 * el productivo de Cris). Se puede sobreescribir con PLAYWRIGHT_BASE_URL.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  outputDir: 'test-results',
});
