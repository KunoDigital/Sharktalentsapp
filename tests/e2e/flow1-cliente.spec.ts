import { test, expect } from '@playwright/test';

/**
 * Flujo 1 — Cliente PixelWeb Digital (agencia de mkt que busca PM web)
 *
 * Test 100% AUTOMÁTICO end-to-end. Cris no toca nada.
 *
 * Pasos:
 *   1. Encontrar o crear el lead PixelWeb Digital
 *   2. Generar draft con IA desde transcript
 *   3. Guardar draft vinculado al lead
 *   4. Mandar al cliente — backend manda email + devuelve portal_url
 *   5. Playwright abre el portal y verifica
 *   6. Playwright aprueba el perfil
 *
 * Setup:
 *   - tests/.env.local debe tener MARKETING_SITE_KEY + E2E_TEST_KEY
 *   - Catalyst env vars: E2E_TEST_KEY + E2E_TEST_CLERK_ORG_ID
 */

const SITE_KEY = process.env.MARKETING_SITE_KEY ?? '';
const E2E_KEY = process.env.E2E_TEST_KEY ?? '';
const CLIENT_EMAIL = 'cpalma+pmclient@kunodigital.com';

export const TRANSCRIPT_PM_WEB = `
Cris: Hola Diego, gracias por agendar. Contame un poco de PixelWeb y qué los trajo a buscarnos.

Diego: Hola Cris. Mirá, nosotros somos una agencia de marketing digital, pero la rama fuerte es el desarrollo de páginas web. Atendemos clientes medianos y grandes — desde restaurantes con cadena de 20 locales hasta retailers, pero también algo de fintech ecuatoriano y un par de startups en LATAM. Hoy somos 18 personas: 6 devs entre frontend y backend, 4 diseñadores UX/UI, 3 content strategists, 2 vendedores comerciales, project managers somos 2 y el resto somos administración. El problema es que mi PM actual se me satura. Cuando un proyecto entra él tiene que coordinar entre el equipo de diseño, el de desarrollo, el cliente, mantener el cronograma, gestionar los cambios de scope. Y cuando entran 4 o 5 proyectos en simultáneo el caos es enorme.

Cris: Entonces necesitás un PM nuevo que entre a coordinar.

Diego: Sí. Pero no cualquiera. Necesito alguien que entienda de tecnología web — no necesita programar pero sí entender que cuando el dev dice "esto me toma 2 semanas" entender por qué. Que pueda hablar con el cliente sin que el dev tenga que estar metido en cada reunión. Y que sea muy organizado, muy estructurado.

Cris: Tipos de proyectos que va a manejar.

Diego: Páginas web corporativas, e-commerce con Shopify o WooCommerce, landing pages para campañas, a veces apps web SaaS sencillas en Next.js. No hablamos de apps móviles ni cosas con blockchain. El stack es básicamente Next.js, React, WordPress headless, Tailwind, algunas integraciones con Zoho CRM o HubSpot. Y manejamos sprints de 2 semanas con Linear.

Cris: ¿Qué le exigirías a esta persona, cuáles son las responsabilidades principales?

Diego: Coordinar el equipo asignado a cada proyecto — devs, diseñadores, content. Hacer el cronograma y mantenerlo. Reuniones de status semanales con el cliente. Detectar riesgos antes de que exploten. Documentar todo en Linear y Notion. Manejar el scope creep — los clientes siempre piden más, ella tiene que saber negociar y a veces decirles que sí pero con un add-on cobrado. También revisar entregas antes de mandarlas, no quiero que el cliente reciba algo con bugs porque el PM no lo testeó. Y hacer el debrief después de cada lanzamiento.

Cris: ¿Y a quién reporta?

Diego: A mí, soy el Director de Operaciones. Pero va a tener bastante autonomía, no le voy a estar revisando cada decisión.

Cris: ¿Va a tener gente a cargo?

Diego: No directamente, pero indirectamente sí — los equipos del proyecto le rinden a ella mientras dura el proyecto. Tiene que ser una persona con capacidad de liderazgo aunque no sea jefa formal.

Cris: ¿Qué tipo de persona buscás? Más bien analítica, más bien sociable, más bien orientada a resultados.

Diego: Yo creo que tiene que ser sobre todo organizada, ordenada. C alto. Pero también tiene que poder hablar con el cliente, ser persuasiva. No tanta D — no quiero alguien dominante que vaya a chocar con los devs senior, los devs no responden bien a eso. Algo de I para llevarse bien con el cliente pero no tanto que se pase de comprometida. S medio porque tiene que aguantar la presión de varios proyectos.

Cris: ¿Cuánto tiempo de experiencia necesitás?

Diego: Mínimo 3 años de PM en agencias de marketing digital o consultoras tech. Que haya manejado proyectos web reales, no infraestructura ni móvil. Que conozca el stack moderno — Next.js, Tailwind, herramientas tipo Linear o Jira. Que haya trabajado con metodologías ágiles. Inglés intermedio para leer documentación y ocasionalmente cliente extranjero.

Cris: ¿Formación?

Diego: Universitaria sí, pero no me importa tanto si es ingeniería en sistemas, marketing, diseño industrial, lo que sea. Que tenga al menos una certificación en gestión de proyectos — Scrum Master, PMP, alguna así.

Cris: ¿Salario?

Diego: Pago 2,000 dólares al mes brutos, full time, oficina híbrida — 3 días en oficina, 2 remoto. Es buen salario para Ecuador.

Cris: ¿Cuándo necesitás que arranque?

Diego: Lo antes posible. Idealmente mes y medio máximo. Antes mejor.

Cris: ¿Algo que NO querés en este perfil?

Diego: Alguien que no sepa decir no al cliente. Alguien que se asuste con conflictos. Y alguien sin disciplina de documentación — necesito que TODO quede escrito.

Cris: Perfecto Diego, te voy a mandar el perfil propuesto en un par de días, lo revisamos juntos.

Diego: Bárbaro, gracias Cris.
`.trim();

test.describe.serial('Flujo 1 — Cliente PixelWeb Digital (end-to-end)', () => {
  let leadId: string;
  let draftId: string;
  let portalUrl: string;

  // El generate de IA puede tardar 30-40s. Subimos el timeout por test a 90s.
  test.setTimeout(2 * 60 * 1000);

  test.beforeAll(() => {
    if (!SITE_KEY) throw new Error('MARKETING_SITE_KEY no seteado en tests/.env.local');
    if (!E2E_KEY) throw new Error('E2E_TEST_KEY no seteado en tests/.env.local');
  });

  test('1. Encontrar lead PixelWeb Digital', async ({ request }) => {
    const listRes = await request.get('/server/api/api/marketing/leads?limit=300', {
      headers: { 'X-E2E-Test-Key': E2E_KEY },
    });
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();
    const existing = (listJson.leads ?? []).find(
      (l: { email?: string }) => (l.email || '').toLowerCase() === CLIENT_EMAIL.toLowerCase(),
    );

    if (existing) {
      leadId = existing.ROWID;
      console.log(`[FLOW1] Lead PixelWeb encontrado: ${leadId}`);
    } else {
      // Crear via la API pública (con SITE_KEY)
      const createRes = await request.post('/server/api/api/marketing/lead', {
        headers: { 'X-Marketing-Site-Key': SITE_KEY, 'Content-Type': 'application/json' },
        data: {
          email: CLIENT_EMAIL,
          contact_name: 'Diego Méndez',
          company: 'PixelWeb Digital',
          whatsapp: '+50764318185',
          quiz_data: '{}',
          utm_source: 'e2e-test-flow1',
        },
      });
      expect(createRes.status()).toBe(200);
      const createJson = await createRes.json();
      leadId = createJson.lead_id;
      console.log(`[FLOW1] Lead PixelWeb creado: ${leadId}`);
    }
    expect(leadId).toBeTruthy();
  });

  test('2. Generar draft con IA desde transcript', async ({ request }) => {
    expect(leadId).toBeTruthy();
    console.log(`[FLOW1] Llamando a Claude para generar el draft (puede tardar 30-40s)...`);
    const t0 = Date.now();
    const res = await request.post('/server/api/api/drafts/generate', {
      headers: { 'X-E2E-Test-Key': E2E_KEY, 'Content-Type': 'application/json' },
      data: { transcript: TRANSCRIPT_PM_WEB },
      timeout: 90_000,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.draft).toBeTruthy();
    expect(json.draft.title).toBeTruthy();
    console.log(`[FLOW1] Draft generado en ${((Date.now() - t0) / 1000).toFixed(1)}s. Título: "${json.draft.title}"`);

    // Guardar el draft vinculado al lead
    const saveRes = await request.post('/server/api/api/drafts/jobs/save', {
      headers: { 'X-E2E-Test-Key': E2E_KEY, 'Content-Type': 'application/json' },
      data: {
        draft_payload: json.draft,
        transcript: TRANSCRIPT_PM_WEB,
        transcript_source: 'e2e-test',
        marketing_lead_id: leadId,
        status: 'draft_generated',
      },
    });
    expect(saveRes.status()).toBe(201);
    const saveJson = await saveRes.json();
    draftId = saveJson.draft.ROWID;
    expect(draftId).toBeTruthy();
    console.log(`[FLOW1] Draft persistido: ${draftId}`);
  });

  test('3. Mandar draft al cliente (email + portal URL)', async ({ request }) => {
    expect(draftId).toBeTruthy();
    const res = await request.post(`/server/api/api/drafts/jobs/${draftId}/send-to-client`, {
      headers: { 'X-E2E-Test-Key': E2E_KEY, 'Content-Type': 'application/json' },
      data: {}, // Email viene del lead vinculado
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    portalUrl = json.portal_url;
    expect(portalUrl).toContain('/portal/');
    console.log(`[FLOW1] Email enviado a ${CLIENT_EMAIL}`);
    console.log(`[FLOW1] Portal URL: ${portalUrl}`);
  });

  test('4. Cliente abre portal y verifica contenido', async ({ page }) => {
    expect(portalUrl).toBeTruthy();
    await page.goto(portalUrl);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const title = await page.locator('h1').first().textContent();
    console.log(`[FLOW1] Cliente ve título: "${title}"`);
    expect(title?.toLowerCase()).toMatch(/project manager|pm|gerente/i);

    // PixelWeb debe estar visible
    await expect(page.locator('text=PixelWeb').first()).toBeVisible();

    // Velna debe tener al menos 3 dimensiones visibles (mobile-responsive)
    let velnaCount = 0;
    for (const dim of ['Verbal', 'Espacial', 'Lógica', 'Numérica', 'Abstracta']) {
      const visible = await page.locator(`text=${dim}`).first().isVisible().catch(() => false);
      if (visible) velnaCount++;
    }
    expect(velnaCount).toBeGreaterThanOrEqual(3);
    console.log(`[FLOW1] Velna: ${velnaCount}/5 dimensiones visibles`);
  });

  test('5. Cliente aprueba el perfil', async ({ page }) => {
    expect(portalUrl).toBeTruthy();
    await page.goto(portalUrl);

    // Scroll hasta el fondo para ver botones de acción
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Buscar botón de aprobar
    const approveBtn = page.locator('button', { hasText: /aprob/i }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await approveBtn.click();

    // Esperar confirmación
    await expect(page.locator('body')).toContainText(/aprobado|confirmamos|recibido|gracias|enviado/i, {
      timeout: 20000,
    });
    console.log(`[FLOW1] ✓ Cliente aprobó el perfil`);
  });

  test('6. Verificar que el draft quedó en client_approved', async ({ request }) => {
    expect(draftId).toBeTruthy();
    // Esperar 2s para que el event de aprobación procese
    await new Promise((r) => setTimeout(r, 2000));
    const res = await request.get(`/server/api/api/drafts/jobs/${draftId}`, {
      headers: { 'X-E2E-Test-Key': E2E_KEY },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Cuando el cliente aprueba, el draft puede quedar en:
    // - 'client_approved': aprobado pero no convertido aún
    // - 'converted_to_job': aprobado + auto-convertido en Job (feature de auto-conversion)
    expect(['client_approved', 'converted_to_job']).toContain(json.draft.status);
    console.log(`[FLOW1] ✓ Draft status: ${json.draft.status}`);
    if (json.draft.status === 'converted_to_job') {
      console.log(`[FLOW1] 🎉 Auto-converted to Job: ${json.draft.job_id ?? '(check job_id field)'}`);
    }
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('REPORTE FINAL FLUJO 1');
    console.log(`Lead ID:    ${leadId}`);
    console.log(`Draft ID:   ${draftId}`);
    console.log(`Portal URL: ${portalUrl}`);
    console.log('═══════════════════════════════════════');
  });
});
