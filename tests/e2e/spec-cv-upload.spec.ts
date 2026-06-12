import { test, expect, request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Spec CV Upload — valida end-to-end el endpoint público de apply con CV:
 *   POST /api/public/jobs/:slug/apply (multipart/form-data)
 *
 * Casos cubiertos:
 *   1. Aplicación válida con PDF mínimo → 201 OK, devuelve candidate_id + result_id
 *   2. Email duplicado al mismo puesto → update (no error)
 *   3. PDF inválido (otro mimetype) → 400 ValidationError
 *   4. CV faltante → 400 ValidationError
 *   5. Slug inexistente → 404 NotFound
 *   6. Email mal formado → 400 ValidationError
 *   7. Edad fuera de rango → 400 ValidationError
 *
 * Uso:
 *   npx playwright test tests/e2e/spec-cv-upload.spec.ts
 */

const BASE_API = (process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.sharktalents.ai').replace(/\/$/, '');
const SLUG_VALIDO = process.env.E2E_JOB_SLUG ?? 'lider-de-desarrollo-backend';

/** Genera un PDF mínimo válido (header + trailer). 192 bytes aprox. */
function makeMinimalPdf(): Buffer {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;
  return Buffer.from(pdf, 'utf8');
}

function tmpFile(name: string, data: Buffer): string {
  const file = path.join(os.tmpdir(), `${Date.now()}-${name}`);
  fs.writeFileSync(file, data);
  return file;
}

function uniqueEmail(prefix: string): string {
  return `cuentas+${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@kunodigital.com`;
}

const VALID_FORM = () => ({
  first_name: 'Juan',
  last_name: 'Pérez',
  email: uniqueEmail('cv-upload'),
  phone: '+50761234567',
  age: '28',
  city: 'Panamá',
  country: 'Panama',
  consent_terms: 'true',
});

test.describe('CV Upload — POST /api/public/jobs/:slug/apply', () => {
  test('1. Aplicación válida con PDF mínimo → 201 OK', async ({ request }) => {
    const cvPath = tmpFile('valid.pdf', makeMinimalPdf());
    const form = VALID_FORM();
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: { ...form, cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(cvPath) } },
      },
    );
    const body = await res.json().catch(() => ({}));
    if (res.status() !== 201) {
      console.log('[CV Upload 1] FAIL response:', body);
    }
    expect(res.status(), `expected 201, got ${res.status()} — body: ${JSON.stringify(body).slice(0, 300)}`).toBe(201);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('candidate_id');
    expect(body).toHaveProperty('result_id');
    expect(body).toHaveProperty('next_step', 'check_email');
    fs.unlinkSync(cvPath);
  });

  test('2. Email duplicado al mismo puesto → update (no error)', async ({ request }) => {
    const cvPath = tmpFile('dup.pdf', makeMinimalPdf());
    const cvBuf = fs.readFileSync(cvPath);
    const email = uniqueEmail('cv-dup');

    // Primer envío
    const res1 = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: {
          ...VALID_FORM(), email,
          cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: cvBuf },
        },
      },
    );
    expect(res1.status()).toBe(201);
    const body1 = await res1.json();
    const candidateId1 = body1.candidate_id;

    // Segundo envío (mismo email + mismo job) — debe pasar y reutilizar candidate
    const res2 = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: {
          ...VALID_FORM(), email,
          cv: { name: 'cv2.pdf', mimeType: 'application/pdf', buffer: cvBuf },
        },
      },
    );
    expect(res2.status()).toBe(201);
    const body2 = await res2.json();
    expect(body2.candidate_id).toBe(candidateId1); // Mismo candidato
    fs.unlinkSync(cvPath);
  });

  test('3. PDF inválido (mimetype text/plain) → 400 ValidationError', async ({ request }) => {
    const fakePath = tmpFile('fake.txt', Buffer.from('no soy un PDF de verdad', 'utf8'));
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: {
          ...VALID_FORM(),
          cv: { name: 'cv.txt', mimeType: 'text/plain', buffer: fs.readFileSync(fakePath) },
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cv must be a PDF|PDF/i);
    fs.unlinkSync(fakePath);
  });

  test('4. CV faltante → 400 ValidationError', async ({ request }) => {
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      { multipart: VALID_FORM() },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cv.*required/i);
  });

  test('5. Slug inexistente → 404 NotFound', async ({ request }) => {
    const cvPath = tmpFile('notfound.pdf', makeMinimalPdf());
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/slug-que-no-existe-en-ningun-tenant/apply`,
      {
        multipart: {
          ...VALID_FORM(),
          cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(cvPath) },
        },
      },
    );
    expect(res.status()).toBe(404);
    fs.unlinkSync(cvPath);
  });

  test('6. Email mal formado → 400 ValidationError', async ({ request }) => {
    const cvPath = tmpFile('badmail.pdf', makeMinimalPdf());
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: {
          ...VALID_FORM(),
          email: 'no-es-email',
          cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(cvPath) },
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email|email/i);
    fs.unlinkSync(cvPath);
  });

  test('7. Edad fuera de rango (<16) → 400 ValidationError', async ({ request }) => {
    const cvPath = tmpFile('badage.pdf', makeMinimalPdf());
    const res = await request.post(
      `${BASE_API}/server/api/api/public/jobs/${SLUG_VALIDO}/apply`,
      {
        multipart: {
          ...VALID_FORM(),
          age: '12',
          cv: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(cvPath) },
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age.*16-99|edad/i);
    fs.unlinkSync(cvPath);
  });
});
