import { test, expect } from '@playwright/test';

/**
 * Tests E2E de las mejoras del portal/reporte (2026-06-03).
 *
 * Cubre:
 *   - Footer PublicPortalFooter (Powered by + links legales) en portal y reporte
 *   - Toggle de sonido en portal-job (persiste en localStorage)
 *   - Botones Compartir + Imprimir en reporte público
 *   - CSS print mode (oculta acciones y muestra URL)
 *   - Mobile responsive (375px) sin layout roto
 *   - HelpBox con email/whatsapp dinámicos del recruiter
 *
 * Requiere:
 *   - E2E_PORTAL_TOKEN — token HMAC válido de un cliente real con ≥1 puesto (no expirado).
 *   - E2E_PORTAL_JOB_ID — ID de un puesto del cliente para abrir el detail view.
 *   - (opcional) E2E_REPORT_TOKEN — token de un reporte público con candidatos.
 *
 * Si no tenés los tokens en tests/.env.local, los tests del bloque correspondiente se
 * skipean (no fallan) y queda el smoke como gate base.
 */

const PORTAL_TOKEN = process.env.E2E_PORTAL_TOKEN ?? '';
const PORTAL_JOB_ID = process.env.E2E_PORTAL_JOB_ID ?? '';
const REPORT_TOKEN = process.env.E2E_REPORT_TOKEN ?? '';

test.describe('Rutas legales del footer (sin token)', () => {
  test('/#/legal/privacidad renderiza la página', async ({ page }) => {
    // HashRouter: la URL real es /#/legal/privacidad
    await page.goto('/app/#/legal/privacidad');
    await expect(page.locator('h1')).toContainText(/privacidad/i, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/datos|kuno|gdpr|habeas|derechos/i);
  });

  test('/#/legal/terminos renderiza la página', async ({ page }) => {
    await page.goto('/app/#/legal/terminos');
    await expect(page.locator('h1')).toContainText(/t.rminos/i, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/uso|condiciones|kuno/i);
  });
});

test.describe('Portal landing — footer + helpbox', () => {
  test.skip(!PORTAL_TOKEN, 'E2E_PORTAL_TOKEN no seteado en tests/.env.local');

  test('footer Powered by con links legales', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // Footer Powered by visible
    const footer = page.locator('footer.cp-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/Powered by SharkTalents/i);
    await expect(footer).toContainText(`© ${new Date().getFullYear()}`);

    // Links legales presentes (HashRouter → href contiene #/legal/...)
    const privacy = footer.locator('a', { hasText: /privacidad/i });
    const terms = footer.locator('a', { hasText: /t.rminos/i });
    await expect(privacy).toBeVisible();
    await expect(terms).toBeVisible();
    expect(await privacy.getAttribute('href')).toMatch(/legal\/privacidad/);
    expect(await terms.getAttribute('href')).toMatch(/legal\/terminos/);
  });

  test('helpbox con email del recruiter', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // ClientHelpBox renderiza al menos un mailto:
    const mailtos = page.locator('a[href^="mailto:"]');
    expect(await mailtos.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Portal job — sound toggle + tracking', () => {
  test.skip(!(PORTAL_TOKEN && PORTAL_JOB_ID), 'Faltan E2E_PORTAL_TOKEN o E2E_PORTAL_JOB_ID');

  test('toggle de sonido persiste en localStorage', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}/jobs/${PORTAL_JOB_ID}`);
    await expect(page.locator('h1.cp-job-title-big')).toBeVisible({ timeout: 15_000 });

    const toggle = page.locator('button.cp-sound-toggle');
    await expect(toggle).toBeVisible();

    // Estado inicial: aria-pressed false (o no presente)
    const initialPressed = await toggle.getAttribute('aria-pressed');
    expect(['false', null]).toContain(initialPressed);

    // Click → activa sonido (UI cambia)
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText(/Avisos sonoros/i);

    // localStorage persiste la preferencia
    const stored = await page.evaluate(() => localStorage.getItem('portal_sound_enabled'));
    expect(stored).toBe('1');

    // Reload y verificar que el toggle queda prendido
    await page.reload();
    await expect(page.locator('button.cp-sound-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    // Limpieza: desactivar para no afectar runs siguientes
    await page.locator('button.cp-sound-toggle').click();
    await page.evaluate(() => localStorage.removeItem('portal_sound_enabled'));
  });

  test('tracking section visible con milestones', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}/jobs/${PORTAL_JOB_ID}`);
    await expect(page.locator('section.cp-tracking')).toBeVisible({ timeout: 15_000 });

    // Al menos 1 dot en el tracking
    const dots = page.locator('.cp-track-dot');
    expect(await dots.count()).toBeGreaterThanOrEqual(1);
  });

  test('footer Powered by también en portal-job', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}/jobs/${PORTAL_JOB_ID}`);
    await expect(page.locator('h1.cp-job-title-big')).toBeVisible({ timeout: 15_000 });

    const footer = page.locator('footer.cp-footer');
    await expect(footer).toContainText(/Powered by SharkTalents/i);
  });
});

test.describe('Reporte público — share + print + footer', () => {
  test.skip(!REPORT_TOKEN, 'E2E_REPORT_TOKEN no seteado');

  test('botones Compartir e Imprimir presentes', async ({ page }) => {
    await page.goto(`/app/report/${REPORT_TOKEN}`);
    await expect(page.locator('header.pr-header')).toBeVisible({ timeout: 15_000 });

    const shareBtns = page.locator('button.pr-share-btn');
    expect(await shareBtns.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('button', { hasText: /Compartir/i }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: /Imprimir/i }).first()).toBeVisible();
  });

  test('share button copia URL al portapapeles', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/app/report/${REPORT_TOKEN}`);
    await expect(page.locator('header.pr-header')).toBeVisible({ timeout: 15_000 });

    // navigator.share existe en Playwright Chromium → mock para forzar el path clipboard
    await page.evaluate(() => { (navigator as unknown as { share: undefined }).share = undefined; });

    await page.locator('button', { hasText: /Compartir/i }).first().click();

    // Tooltip de confirmación aparece
    await expect(page.locator('.pr-share-tooltip')).toContainText(/Link copiado/i, { timeout: 5_000 });

    // El clipboard tiene la URL actual
    const clipboardUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardUrl).toContain(REPORT_TOKEN);
  });

  test('data-print-url está seteado en main', async ({ page }) => {
    await page.goto(`/app/report/${REPORT_TOKEN}`);
    const mainPrintUrl = await page.locator('main.pr-main').getAttribute('data-print-url');
    expect(mainPrintUrl).toBeTruthy();
    expect(mainPrintUrl).toContain(REPORT_TOKEN);
  });

  test('footer Powered by también en reporte', async ({ page }) => {
    await page.goto(`/app/report/${REPORT_TOKEN}`);
    const footer = page.locator('footer.pr-footer');
    await expect(footer).toContainText(/Powered by SharkTalents/i);
  });
});

test.describe('Mobile responsive — viewport 375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test.skip(!PORTAL_TOKEN, 'E2E_PORTAL_TOKEN no seteado');

  test('portal landing no overflowea horizontalmente', async ({ page }) => {
    await page.goto(`/app/portal/${PORTAL_TOKEN}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // No scroll horizontal: scrollWidth <= viewport width + 1px de margen
    const widths = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(widths.doc).toBeLessThanOrEqual(widths.inner + 1);
  });

  test('portal-job tracking colapsa a columna en mobile', async ({ page }) => {
    test.skip(!PORTAL_JOB_ID, 'E2E_PORTAL_JOB_ID no seteado');
    await page.goto(`/app/portal/${PORTAL_TOKEN}/jobs/${PORTAL_JOB_ID}`);
    await expect(page.locator('section.cp-tracking')).toBeVisible({ timeout: 15_000 });

    const widths = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(widths.doc).toBeLessThanOrEqual(widths.inner + 1);
  });
});
