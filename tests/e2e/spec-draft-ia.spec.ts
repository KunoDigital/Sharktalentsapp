import { test, expect } from '@playwright/test';

/**
 * Spec del Draft IA — valida el flujo crítico:
 *   transcript de reunión cliente → draft IA → campos descriptivos correctos.
 *
 * Sin esto, la primera reunión real con un cliente puede caer en bugs no detectados.
 * El draft IA es el insumo que arma el puesto público (qué busco, qué hace, qué sabe).
 *
 * Estrategia:
 *   1. Llama POST /api/admin/_diag-generate-draft con un transcript realista
 *   2. Espera ~30-90s (Anthropic genera el draft completo)
 *   3. Recibe `payload_summary` con los campos clave del draft
 *   4. Audita con dureza: ¿está title? ¿objetivo_cargo no vacío? ¿bullets con N items?
 *   5. Si todo pasa, el draft IA está apto para mandar a cliente
 *
 * NO ejecuta deploy ni cambios en producción.
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-draft-ia.spec.ts
 */

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? '733639dfcbb93d15e31072ccb76370ad2da67f3e8dbbd16edee937cf13c1d04d';
const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');

/**
 * Transcript realista de reunión cliente-recruiter, ~600 palabras, simulando un caso
 * típico de SharkTalents: empresa describe puesto, contexto, equipo, salario, urgencia.
 */
const TRANSCRIPT_REALISTA = `
Cris: Bueno María, gracias por hacer este espacio. Contame qué están buscando.

María (Cliente, Distribuidora XYZ): Mira, necesitamos un gerente comercial para liderar
nuestra fuerza de ventas en LATAM. La empresa tiene 15 años distribuyendo productos de
consumo masivo, facturamos unos 8 millones USD al año. Hoy tenemos 12 vendedores en
campo distribuidos en Panamá, Costa Rica y Colombia. El gerente actual se va a fin de
mes — necesitamos cubrir antes que se vaya, máximo 6 semanas.

Cris: ¿Quién reporta y qué tamaño tiene el equipo?

María: Reporta directo al CEO. A su cargo va a tener los 12 vendedores más un asistente
comercial. La persona tiene que ser fuerte en gestión de equipos remotos porque los
vendedores están en distintos países. También necesitamos alguien con criterio para
abrir mercados nuevos — estamos viendo entrar a México el año que viene.

Cris: ¿Qué perfil de personalidad tienen en mente?

María: Necesitamos alguien dominante, que sepa exigir resultados sin dañar la relación
con el equipo. Hay vendedores difíciles que llevan años con nosotros y ya tienen su
forma de trabajar. Pero también tiene que ser ordenado con los procesos y reportes —
hoy no tenemos visibilidad clara del pipeline de ventas y eso necesitamos cambiarlo.

Cris: ¿Qué herramientas usan?

María: Salesforce como CRM, Excel y Power BI para reportes. Importante que sepa armar
forecasts y leer KPIs. También va a manejar el equipo en Slack y Google Meet.

Cris: ¿Y experiencia previa?

María: 7+ años en posiciones gerenciales comerciales, idealmente en consumo masivo o
distribución. Necesita haber liderado equipos de mínimo 8 personas. Inglés conversacional
para reportar al CEO que es de origen americano. Carrera universitaria completa.

Cris: ¿Salario?

María: Estamos pensando 4500 USD mensuales más comisiones por cumplimiento. El total
puede llegar a 6500 USD en meses buenos. Modalidad híbrida — 3 días oficina en Panamá
y 2 remotos.

Cris: ¿Algún red flag que querés que filtre desde el principio?

María: Alguien que solo haya trabajado en multinacionales grandes — necesitamos perfil
de empresa mediana, que sepa hacer de todo. Y alguien sin experiencia en mercados LATAM.

Cris: ¿El CEO da bastante autonomía o prefiere consultar todo?

María: El CEO da autonomía total siempre que haya resultados. Es alguien muy directo,
de pocas palabras, pero exige reportes claros. Si la persona necesita que le digan qué
hacer todo el tiempo no funciona.

Cris: Perfecto. Te armo el perfil esta semana y te mando para que revises.
`.trim();

const TEST_EMAIL = `cuentas+draft-spec-${Date.now()}@kunodigital.com`;

test('Spec Draft IA: transcript de reunión → draft con campos descriptivos completos', async ({ request }) => {
  test.setTimeout(3 * 60 * 1000); // 3 min — Anthropic puede tardar

  console.log('[Spec Draft] Disparando generación con transcript de', TRANSCRIPT_REALISTA.length, 'chars');

  const res = await request.post(`${BASE_API}/server/api/api/admin/_diag-generate-draft`, {
    headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
    data: {
      email: TEST_EMAIL,
      client_name: 'María Distribuidora',
      client_company: 'Distribuidora XYZ',
      transcript: TRANSCRIPT_REALISTA,
    },
    timeout: 150_000,
  });

  expect(res.status(), `expected 200 got ${res.status()}`).toBe(200);
  const body = await res.json() as {
    draft_id: string;
    draft_status: string;
    portal_url: string;
    payload_summary: {
      title?: string;
      company?: string;
      objetivo_cargo?: string;
      responsabilidades?: string[];
      responsabilidades_count?: number;
      tareas_especificas?: string[];
      tareas_especificas_count?: number;
      herramientas_conocimientos?: string[];
      herramientas_conocimientos_count?: number;
      formacion_requerida?: string;
      experiencia_requerida?: string;
      sector?: string;
      modalidad?: string;
      salary_range_usd?: { min: number; max: number };
      competencias?: Array<{ name: string; required_pct: number }>;
      competencias_count?: number;
      disc_ideal_a?: { d: number; i: number; s: number; c: number };
      has_disc_ideal_a?: boolean;
      full_payload_keys?: string[];
    };
  };

  console.log('[Spec Draft] Draft creado ID:', body.draft_id);
  console.log('[Spec Draft] Portal URL:', body.portal_url);
  console.log('[Spec Draft] Status:', body.draft_status);

  const p = body.payload_summary;
  expect(p, 'payload_summary debe existir').toBeTruthy();

  // === Validaciones críticas: campos OBLIGATORIOS ===
  console.log('\n[Spec Draft] Auditando contenido del payload:');
  console.log('  title:                       ', p.title);
  console.log('  company:                     ', p.company);
  console.log('  sector:                      ', p.sector);
  console.log('  modalidad:                   ', p.modalidad);
  console.log('  objetivo_cargo (chars):      ', p.objetivo_cargo?.length ?? 0);
  console.log('  responsabilidades count:     ', p.responsabilidades_count);
  console.log('  tareas_especificas count:    ', p.tareas_especificas_count);
  console.log('  herramientas_conocimientos:  ', p.herramientas_conocimientos_count);
  console.log('  competencias count:          ', p.competencias_count);
  console.log('  salary_range_usd:            ', JSON.stringify(p.salary_range_usd));
  console.log('  DISC ideal A:                ', JSON.stringify(p.disc_ideal_a));

  // Campos básicos
  expect(p.title?.trim().length, 'title no puede estar vacío').toBeGreaterThan(3);
  expect(p.company?.trim().length, 'company no puede estar vacío').toBeGreaterThan(3);
  expect(p.sector?.trim().length, 'sector no puede estar vacío').toBeGreaterThan(0);

  // Campos descriptivos que mapean al ideal_profile (que_busco, que_debe_hacer, que_debe_saber)
  expect(p.objetivo_cargo?.trim().length, 'objetivo_cargo no puede estar vacío').toBeGreaterThan(20);
  expect(p.responsabilidades_count ?? 0, 'responsabilidades debe tener >=5 bullets').toBeGreaterThanOrEqual(5);
  expect(p.responsabilidades_count ?? 0, 'responsabilidades no debe exceder 10').toBeLessThanOrEqual(10);
  expect(p.tareas_especificas_count ?? 0, 'tareas_especificas >= 3 bullets').toBeGreaterThanOrEqual(3);
  expect(p.herramientas_conocimientos_count ?? 0, 'herramientas_conocimientos >= 3').toBeGreaterThanOrEqual(3);

  // Competencias (catálogo cerrado, 3-5 esperadas)
  expect(p.competencias_count ?? 0, 'competencias >= 3').toBeGreaterThanOrEqual(3);
  expect(p.competencias_count ?? 0, 'competencias <= 5').toBeLessThanOrEqual(5);

  // Salario: el transcript menciona 4500 USD base — la IA debería detectarlo
  expect(p.salary_range_usd, 'salary_range_usd debe estar definido').toBeTruthy();
  expect(p.salary_range_usd?.max ?? 0, 'salary_range_usd.max > 0').toBeGreaterThan(0);

  // DISC invariante: D+I+S+C === 200 exacto
  if (p.disc_ideal_a) {
    const sum = p.disc_ideal_a.d + p.disc_ideal_a.i + p.disc_ideal_a.s + p.disc_ideal_a.c;
    expect(sum, `DISC D+I+S+C debe sumar 200 exacto (sumó ${sum})`).toBe(200);
  }

  // === Detección de voseo argentino ===
  const voseo = /\b(tenés|tené|podés|querés|sabés|fijate|mirá|vení|andá|hacés)\b/i;
  if (p.objetivo_cargo) {
    expect(voseo.test(p.objetivo_cargo), `objetivo_cargo tiene voseo: "${p.objetivo_cargo.slice(0, 100)}"`).toBe(false);
  }
  for (const bullet of [...(p.responsabilidades ?? []), ...(p.tareas_especificas ?? []), ...(p.herramientas_conocimientos ?? [])]) {
    expect(voseo.test(bullet), `bullet con voseo: "${bullet.slice(0, 100)}"`).toBe(false);
  }

  // === No revelar salario en texto descriptivo ===
  // El salario va en salary_range_usd, NO en objetivo_cargo o responsabilidades.
  const salaryPattern = /\$?\s*\d{3,5}\s*(USD|usd|d[oó]lares|al mes|mensual)/i;
  if (p.objetivo_cargo) {
    expect(salaryPattern.test(p.objetivo_cargo), `objetivo_cargo revela salario: "${p.objetivo_cargo.slice(0, 100)}"`).toBe(false);
  }

  console.log('\n[Spec Draft] ✓ Todos los chequeos pasaron. Draft listo para mandar al cliente.');
  console.log('[Spec Draft] Para ver el draft en el portal:', body.portal_url);
});
