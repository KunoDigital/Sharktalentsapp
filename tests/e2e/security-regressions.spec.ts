import { test, expect } from '@playwright/test';

/**
 * Tests de regresión para los fixes de seguridad de la auditoría 2026-06-04.
 *
 * Validan que los endpoints sensibles NO sean accesibles sin auth correcta.
 * NO requieren tokens reales — chequean status codes con requests sin auth o con auth fake.
 *
 * Si en el futuro alguien revierte un fix accidentalmente, estos tests fallan.
 */

test.describe('Cross-tenant scoping (auditoría #3, #9, #10, #11)', () => {
  test('forceRecruitSync con resultId fake → 404 o 401, NUNCA 200', async ({ request }) => {
    // Sin auth: 401.
    const resNoAuth = await request.post('/server/api/admin/_force_recruit_sync/result_fake_xxx');
    expect([401, 404]).toContain(resNoAuth.status());
  });

  test('renameCandidate con candidate_id fake sin auth → 401', async ({ request }) => {
    const res = await request.post('/server/api/candidates/cand_fake_xxx/rename', {
      data: { name: 'Hacked' },
    });
    expect([401, 404]).toContain(res.status());
  });

  test('inspectIntegrityDims con resultId fake sin auth → 401', async ({ request }) => {
    const res = await request.get('/server/api/_inspect_integrity_dims/result_fake_xxx');
    expect([401, 404]).toContain(res.status());
  });

  test('forcePublishRecruitJob con id fake sin auth → 401', async ({ request }) => {
    const res = await request.post('/server/api/_force_publish_recruit_job/job_fake_xxx');
    expect([401, 404]).toContain(res.status());
  });
});

test.describe('Endpoints de diagnóstico marketing (auditoría #2, #12)', () => {
  // Todos eran `auth:public` con solo site key — vector de takeover.
  // Después del fix son `auth:admin` y requieren X-Internal-Key.

  test('_link_marketing_tenant sin X-Internal-Key → 401', async ({ request }) => {
    const res = await request.post('/server/api/marketing/_link_marketing_tenant?org_id=org_attacker');
    expect(res.status()).toBe(401);
  });

  test('_link_marketing_tenant con site key pero sin X-Internal-Key → sigue 401', async ({ request }) => {
    const siteKey = process.env.MARKETING_SITE_KEY ?? '';
    test.skip(!siteKey, 'MARKETING_SITE_KEY no seteada');
    const res = await request.post('/server/api/marketing/_link_marketing_tenant?org_id=org_attacker', {
      headers: { 'X-Marketing-Site-Key': siteKey },
    });
    // Antes esto devolvía 200 (vulnerable). Después del fix #2: 401.
    expect(res.status()).toBe(401);
  });

  test('_reset (borrado de lead) sin X-Internal-Key → 401', async ({ request }) => {
    const res = await request.post('/server/api/marketing/_reset?email=target@example.com');
    expect(res.status()).toBe(401);
  });

  test('_simulate_completion sin X-Internal-Key → 401', async ({ request }) => {
    const res = await request.post('/server/api/marketing/_simulate_completion?email=target@example.com');
    expect(res.status()).toBe(401);
  });

  test('_resend_report sin X-Internal-Key → 401', async ({ request }) => {
    const res = await request.post('/server/api/marketing/_resend_report?email=target@example.com');
    expect(res.status()).toBe(401);
  });
});

test.describe('Backdoor Playwright en producción (auditoría #1)', () => {
  // En producción, mandar X-E2E-Test-Key con un valor fake DEBE devolver 401, no 200.
  // El guard nuevo ignora la env var E2E_TEST_KEY si CATALYST_ENVIRONMENT='Production'.

  test('endpoint tenant con X-E2E-Test-Key fake → 401', async ({ request }) => {
    const res = await request.get('/server/api/jobs', {
      headers: { 'X-E2E-Test-Key': 'attacker_guessed_value_xxxxx' },
    });
    // Con backdoor activo → 200 con job list. Con fix → 401.
    expect(res.status()).toBe(401);
  });
});

test.describe('Endpoints admin con X-Internal-Key fake → 401', () => {
  test('outbox/process sin clave → 401', async ({ request }) => {
    const res = await request.post('/server/api/admin/outbox/process');
    expect(res.status()).toBe(401);
  });

  test('outbox/process con clave fake → 401', async ({ request }) => {
    const res = await request.post('/server/api/admin/outbox/process', {
      headers: { 'X-Internal-Key': 'fake_key_xxxxx' },
    });
    expect(res.status()).toBe(401);
  });

  test('outbox/reset-stuck sin clave → 401', async ({ request }) => {
    const res = await request.post('/server/api/admin/outbox/reset-stuck');
    expect(res.status()).toBe(401);
  });
});
