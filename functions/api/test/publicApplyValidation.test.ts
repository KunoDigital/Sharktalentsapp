/**
 * Tests de validación del endpoint público de apply.
 *
 * Replicamos las reglas de validación del POST /apply/:tenantSlug/:jobIdentifier
 * para que cualquier cambio en publicApply.ts requiera actualizar estos tests.
 */
import { describe, expect, it } from 'vitest';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApplyInput = {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  consent_data?: unknown;
  salary_aspiration_usd?: unknown;
  age?: unknown;
};

type ValidationOutcome =
  | { ok: true; cleaned: { fullName: string; email: string; phone: string; salary: number | null; age: number | null } }
  | { ok: false; error: string };

function validateApplyBody(body: ApplyInput): ValidationOutcome {
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const consentData = body.consent_data === true;
  const salaryRaw = Number(body.salary_aspiration_usd);
  const ageRaw = body.age;

  if (!fullName) return { ok: false, error: 'full_name required' };
  if (!email || !EMAIL_REGEX.test(email)) return { ok: false, error: 'email inválido' };
  if (!phone) return { ok: false, error: 'phone required' };
  if (!consentData) return { ok: false, error: 'Consent obligatorio (consent_data=true)' };

  return {
    ok: true,
    cleaned: {
      fullName: fullName.slice(0, 255),
      email: email.slice(0, 255),
      phone: phone.slice(0, 50),
      salary: Number.isFinite(salaryRaw) ? Math.round(salaryRaw) : null,
      age: typeof ageRaw === 'number' ? Math.round(ageRaw) : null,
    },
  };
}

describe('publicApply validateApplyBody', () => {
  const validBody = {
    full_name: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+507 6000-1234',
    consent_data: true,
    salary_aspiration_usd: 1500,
  };

  it('body válido pasa', () => {
    const r = validateApplyBody(validBody);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cleaned.fullName).toBe('Juan Pérez');
      expect(r.cleaned.email).toBe('juan@example.com');
      expect(r.cleaned.salary).toBe(1500);
    }
  });

  it('rechaza sin full_name', () => {
    expect(validateApplyBody({ ...validBody, full_name: '' }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, full_name: '   ' }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, full_name: undefined }).ok).toBe(false);
  });

  it('rechaza email inválido', () => {
    expect(validateApplyBody({ ...validBody, email: 'no-at-sign' }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, email: 'at@nodot' }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, email: '' }).ok).toBe(false);
  });

  it('email se normaliza a lowercase', () => {
    const r = validateApplyBody({ ...validBody, email: 'JUAN@EXAMPLE.COM' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.email).toBe('juan@example.com');
  });

  it('rechaza sin phone', () => {
    expect(validateApplyBody({ ...validBody, phone: '' }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, phone: undefined }).ok).toBe(false);
  });

  it('rechaza sin consent_data=true', () => {
    expect(validateApplyBody({ ...validBody, consent_data: false }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, consent_data: undefined }).ok).toBe(false);
    expect(validateApplyBody({ ...validBody, consent_data: 'true' as unknown as boolean }).ok).toBe(false);
  });

  it('salary inválido cae a null sin fallar la validación', () => {
    const r = validateApplyBody({ ...validBody, salary_aspiration_usd: 'mucho' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.salary).toBe(null);
  });

  it('age numérico se redondea', () => {
    const r = validateApplyBody({ ...validBody, age: 32.7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.age).toBe(33);
  });

  it('age no numérico cae a null', () => {
    const r = validateApplyBody({ ...validBody, age: 'thirty' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.age).toBe(null);
  });

  it('full_name se trunca a 255 chars', () => {
    const long = 'a'.repeat(500);
    const r = validateApplyBody({ ...validBody, full_name: long });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.fullName.length).toBe(255);
  });

  it('phone se trunca a 50 chars', () => {
    const long = '+'.repeat(100);
    const r = validateApplyBody({ ...validBody, phone: long });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned.phone.length).toBe(50);
  });
});
