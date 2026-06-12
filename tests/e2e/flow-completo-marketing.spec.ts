import { test, expect } from '@playwright/test';

/**
 * Test E2E del flow completo: setup → portal cliente → aprobación con formulario embebido → CRM.
 *
 * Cada run es UN solo test que ejecuta los 4 pasos secuencialmente:
 *   1. Llama endpoint admin `_diag-trigger-test-flow` que arma:
 *      - MarketingLead con email único (chrismarpalma+e2eN@gmail.com)
 *      - JobProfileDraft con payload mock
 *      - Portal token + URL
 *   2. Abre el portal en el browser y verifica que se ve el draft.
 *   3. Click en "Aprobar el perfil" → aparece formulario embebido.
 *   4. Llena los campos (RUC, dirección, etc) y submit.
 *   5. Verifica via `_diag-crm-lead` que CRM recibió los datos correctamente.
 *
 * Configurable:
 *   E2E_RUNS=10 (default) — cuántas veces correr el flow
 *
 * Uso:
 *   npx playwright test tests/e2e/flow-completo-marketing.spec.ts --headed
 *   E2E_RUNS=5 npx playwright test tests/e2e/flow-completo-marketing.spec.ts
 *
 * Email aliases (chrismarpalma+e2eN@gmail.com) → todos llegan al mismo inbox
 * para que Cris pueda supervisar emails reales (draft review, contract Sign).
 *
 * Nota técnica: NO usamos múltiples test() por run porque Playwright corre en
 * workers paralelos por default y las variables compartidas entre tests del
 * mismo describe no se ven entre workers. Hacer TODO en un solo test() resuelve
 * eso y mantiene el spec robusto.
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const RUNS = Number(process.env.E2E_RUNS ?? '10');
const EMAIL_BASE = 'chrismarpalma@gmail.com';

function aliasEmail(i: number): string {
  const [user, domain] = EMAIL_BASE.split('@');
  const ts = Date.now();
  return `${user}+e2e${i}-${ts}@${domain}`;
}

for (let i = 1; i <= RUNS; i++) {
  test(`Run ${i}/${RUNS}: setup → portal → aprobar con form → verificar CRM`, async ({ page, request }) => {
    test.setTimeout(120_000); // 2 min por run

    const email = aliasEmail(i);
    const contactName = `Test E2E ${i}`;
    const company = `Empresa E2E Run ${i}`;
    const rucNit = `RUC-E2E-${i}-${Date.now()}`;
    console.log(`[E2E Run ${i}] Email: ${email}`);

    // 1. Setup completo via endpoint admin.
    const setupRes = await request.post(`${BASE_API}/server/api/api/admin/_diag-trigger-test-flow`, {
      headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
      data: { email, contact_name: contactName, company },
    });
    expect(setupRes.status(), `setup status for run ${i}`).toBe(200);
    const setupJson = await setupRes.json();
    const portalUrl = setupJson.portal_url;
    const draftId = setupJson.draft_id;
    console.log(`[E2E Run ${i}] portal_url: ${portalUrl}`);
    console.log(`[E2E Run ${i}] draft_id: ${draftId}`);
    expect(portalUrl).toBeTruthy();
    expect(draftId).toBeTruthy();

    // 2. Abrir portal y verificar que se ve el botón de aprobar.
    page.on('pageerror', (err) => console.log(`[E2E Run ${i}] [BROWSER ERROR] ${err.message}`));
    await page.goto(portalUrl);
    await expect(page.getByText('Apruebas este perfil', { exact: false })).toBeVisible({ timeout: 30_000 });
    console.log(`[E2E Run ${i}] Portal cargó`);

    // 3. Click "Aprobar el perfil" → aparece formulario embebido.
    await page.getByRole('button', { name: /Aprobar el perfil/i }).click();
    await expect(page.getByText('Antes de iniciar', { exact: false })).toBeVisible({ timeout: 5_000 });
    console.log(`[E2E Run ${i}] Formulario embebido visible`);

    // 4. Llenar los 9 campos del formulario.
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

    // 5. Submit.
    await page.getByRole('button', { name: /Guardar y aprobar/i }).click();
    await expect(page.getByText('Vamos a iniciar la búsqueda', { exact: false })).toBeVisible({ timeout: 30_000 });
    console.log(`[E2E Run ${i}] Aprobación exitosa`);

    // Esperar 3s para que el push CRM (fire-and-forget) termine.
    await page.waitForTimeout(3_000);

    // 6. Verificar via diag CRM que los datos quedaron.
    const crmRes = await request.get(
      `${BASE_API}/server/api/api/admin/_diag-crm-lead?email=${encodeURIComponent(email)}`,
      { headers: { 'X-Internal-Key': INTERNAL_KEY } },
    );
    expect(crmRes.status(), `diag-crm-lead status for run ${i}`).toBe(200);
    const crmJson = await crmRes.json();
    console.log(`[E2E Run ${i}] CRM key_fields:`, JSON.stringify(crmJson.key_fields));
    console.log(`[E2E Run ${i}] CRM contract_fields:`, JSON.stringify(crmJson.contract_fields));

    expect(crmJson.found, `lead found in CRM for run ${i}`).toBe(true);
    expect(crmJson.key_fields.Company, `Company for run ${i}`).toBe(company);
    expect(crmJson.key_fields.Phone, `Phone for run ${i}`).toBe('+50760000000');
    expect(crmJson.contract_fields.RUC_NIT, `RUC_NIT for run ${i}`).toBe(rucNit);
    expect(crmJson.contract_fields.Street, `Street for run ${i}`).toBe('Calle 50, Edificio Test');
    expect(crmJson.contract_fields.City, `City for run ${i}`).toBe('Ciudad de Panamá');
    expect(crmJson.contract_fields.Country, `Country for run ${i}`).toBe('Panamá');
    expect(crmJson.layout_id, `layout_id (Sharktalents) for run ${i}`).toBe('5710516000033328002');

    console.log(`[E2E Run ${i}] ✓ OK end-to-end`);
  });
}
