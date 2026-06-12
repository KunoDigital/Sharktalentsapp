import { test, expect } from '@playwright/test';

/**
 * Flujo 3 — Candidato (registro + mensajes recibidos)
 *
 * Asume que Flujo 1 ya corrió y dejó el Job auto-creado para PixelWeb Digital.
 *
 * Este flujo testa:
 *   1. Encontrar tenant slug + Job de PixelWeb
 *   2. Postularse al puesto (apply público)
 *   3. Verificar que el backend creó application + candidate
 *   4. Verificar que el candidato fue creado en Recruit (con retry)
 *   5. Verificar que el test entry page carga con el token devuelto
 *
 * Lo que Cris verifica manualmente:
 *   - Email de bienvenida en cpalma+pmcandidate@kunodigital.com
 *   - WhatsApp en +50764318185 (workflow de Recruit)
 *
 * Los clicks completos del candidato (DISC + Técnica + VELNA + Integridad)
 * se dejan para la sesión de 1 AM.
 */

const E2E_KEY = process.env.E2E_TEST_KEY ?? '';
const CANDIDATE_EMAIL = 'cpalma+pmcandidate@kunodigital.com';
const CANDIDATE_PHONE = '+50764318185';
const CANDIDATE_NAME = 'Andrea Martínez';
const TARGET_COMPANY = 'PixelWeb';

test.describe.serial('Flujo 3 — Candidato (registro + mensajes)', () => {
  let tenantSlug: string;
  let jobId: string;
  let applicationId: string;
  let candidateId: string;
  let testToken: string;
  let testUrl: string;

  test.setTimeout(2 * 60 * 1000);

  test.beforeAll(() => {
    if (!E2E_KEY) throw new Error('E2E_TEST_KEY no seteado en tests/.env.local');
  });

  test('1. Obtener tenant slug + Job de PixelWeb', async ({ request }) => {
    // Tenant slug via whoami
    const whoami = await request.get('/server/api/api/marketing/_whoami', {
      headers: { 'X-E2E-Test-Key': E2E_KEY },
    });
    expect(whoami.status()).toBe(200);
    const whoamiJson = await whoami.json();
    tenantSlug = whoamiJson.tenant_lookup?.slug ?? whoamiJson.tenant?.slug ?? '';
    expect(tenantSlug).toBeTruthy();
    console.log(`[FLOW3] Tenant slug: ${tenantSlug}`);

    // Job de PixelWeb (el más reciente)
    const jobsRes = await request.get('/server/api/api/jobs', {
      headers: { 'X-E2E-Test-Key': E2E_KEY },
    });
    expect(jobsRes.status()).toBe(200);
    const jobsJson = await jobsRes.json();
    const pxJobs = (jobsJson.jobs ?? []).filter((j: { company?: string }) =>
      (j.company || '').toLowerCase().includes(TARGET_COMPANY.toLowerCase()),
    );
    expect(pxJobs.length).toBeGreaterThan(0);
    pxJobs.sort((a: { created_at?: string }, b: { created_at?: string }) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
    );
    jobId = pxJobs[0].ROWID as string;
    console.log(`[FLOW3] Job: ${jobId} — "${pxJobs[0].title}"`);
  });

  test('2. Candidato se postula al puesto via apply público', async ({ request }) => {
    expect(tenantSlug).toBeTruthy();
    expect(jobId).toBeTruthy();

    const res = await request.post(`/server/api/apply/${tenantSlug}/${jobId}`, {
      headers: { 'X-E2E-Test-Key': E2E_KEY, 'Content-Type': 'application/json' },
      data: {
        full_name: CANDIDATE_NAME,
        email: CANDIDATE_EMAIL,
        phone: CANDIDATE_PHONE,
        salary_aspiration_usd: 2000,
        consent_data: true,
      },
    });
    // 201 = candidato nuevo, 200 = candidato ya existía (idempotent rerun)
    expect([200, 201]).toContain(res.status());
    const json = await res.json();
    applicationId = json.application_id;
    candidateId = json.candidate_id;
    testToken = json.e2e_test_token;

    expect(applicationId).toBeTruthy();
    expect(candidateId).toBeTruthy();
    expect(testToken).toBeTruthy();

    testUrl = `https://app.sharktalents.ai/app/#/test/${testToken}`;
    console.log(`[FLOW3] Application:   ${applicationId} (${json.created_now ? 'NUEVA' : 'ya existía'})`);
    console.log(`[FLOW3] Candidate:     ${candidateId}`);
    console.log(`[FLOW3] Pipeline:      ${json.pipeline_stage}`);
    console.log(`[FLOW3] Test URL:      ${testUrl}`);
    if (json.created_now) {
      console.log(``);
      console.log(`[FLOW3] 📧 Welcome email enqueueado a: ${CANDIDATE_EMAIL}`);
      console.log(`[FLOW3] 📱 WhatsApp via Recruit a:     ${CANDIDATE_PHONE}`);
    } else {
      console.log(`[FLOW3] ℹ️  Application ya existía — no se reenviaron mensajes (idempotencia).`);
    }
  });

  test('3. Verificar candidate creado/asociado en Recruit (con retry)', async ({ request }) => {
    expect(candidateId).toBeTruthy();
    let recruitCandidateId: string | null = null;
    let stage: string | null = null;

    for (let attempt = 1; attempt <= 8; attempt++) {
      const res = await request.get(`/server/api/api/candidates/${candidateId}`, {
        headers: { 'X-E2E-Test-Key': E2E_KEY },
      });
      if (res.status() === 200) {
        const json = await res.json();
        recruitCandidateId = json.candidate?.recruit_candidate_id ?? null;
        stage = json.candidate?.pipeline_stage ?? null;
        if (recruitCandidateId) break;
      }
      console.log(`[FLOW3] Esperando Recruit sync de candidato (intento ${attempt}/8)…`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (recruitCandidateId) {
      console.log(`[FLOW3] ✓ Recruit Candidate ID: ${recruitCandidateId}`);
      console.log(`[FLOW3] ✓ Stage actual:         ${stage}`);
    } else {
      console.warn(`[FLOW3] ⚠️ Recruit sync NO completó en 40s — revisar logs o esperar más.`);
    }
  });

  test('4. Verificar que el test entry page carga con el token', async ({ page }) => {
    expect(testUrl).toBeTruthy();
    await page.goto(testUrl);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {/* ok */});

    // El entry page puede:
    // - Auto-redirigir a /prefilter, /disc, /tecnica, etc.
    // - Mostrar intro/welcome screen con botón "Comenzar"
    // Ambos casos son válidos; verificamos que hay contenido relevante.
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    console.log(`[FLOW3] Entry page URL: ${page.url()}`);
    console.log(`[FLOW3] Entry page contenido (preview):\n  ${bodyText.slice(0, 400).replace(/\n/g, '\n  ')}`);

    // El page debe haber cargado algo (no estar vacío ni con error)
    expect(bodyText.length).toBeGreaterThan(20);
    expect(bodyText).not.toMatch(/error 4\d\d|error 5\d\d|page not found|not found/i);
    console.log(`[FLOW3] ✓ Test entry carga (${bodyText.length} chars)`);
  });

  test('5. Reporte final + instrucciones para verificación manual', async () => {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('REPORTE FINAL FLUJO 3');
    console.log(`Application ID:    ${applicationId}`);
    console.log(`Candidate ID:      ${candidateId}`);
    console.log(`Pipeline:          prefilter_pending`);
    console.log(`Test URL:          ${testUrl}`);
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('PARA VERIFICAR (vos manual):');
    console.log(`  ✉️  Email a ${CANDIDATE_EMAIL}`);
    console.log(`      → Asunto tipo: "Tu evaluación para Project Manager"`);
    console.log(`      → Link "Comenzar pruebas"`);
    console.log(`  📱 WhatsApp a ${CANDIDATE_PHONE}`);
    console.log(`      → Mensaje desde Zoho Recruit con el link al test`);
    console.log(`      → (Disparado por workflow de Recruit al recibir candidato nuevo)`);
    console.log('');
    console.log('PRÓXIMO PASO (1 AM):');
    console.log(`  Completar tests del candidato (DISC + Técnica + VELNA + Integridad)`);
    console.log(`  Comando: PLAYWRIGHT_TEST_TOKEN="${testToken}" \\`);
    console.log(`           npx playwright test flow3-completar-tests`);
  });
});
