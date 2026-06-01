import { describe, expect, it } from 'vitest';
import { _internal } from '../src/lib/logger';

const { redactValue, redactMeta } = _internal;

describe('redactValue — keys conocidos', () => {
  it('email parcial', () => {
    expect(redactValue('email', 'cris@kunodigital.com')).toBe('c***s@kunodigital.com');
  });

  it('phone parcial', () => {
    expect(redactValue('phone', '+50761234567')).toBe('***4567');
  });

  it('apiKey full redact', () => {
    const result = redactValue('apiKey', 'st_live_abcdef1234567890') as string;
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(20);
  });

  it('token full redact', () => {
    const result = redactValue('token', 'abc123def456') as string;
    expect(result).toContain('...');
  });

  it('cv: redact completo con length', () => {
    expect(redactValue('cv', 'Long resume text...')).toContain('redacted');
  });

  it('first_name parcial', () => {
    expect(redactValue('first_name', 'Carolina')).toBe('C***');
  });

  it('full_name parcial', () => {
    expect(redactValue('full_name', 'Carolina Aguilar Pérez')).toBe('C***');
  });

  it('address: redact completo', () => {
    expect(redactValue('address', 'Calle 50, Panamá')).toContain('redacted');
  });
});

describe('redactValue — inline en strings sin key conocido', () => {
  it('detecta email inline en error message', () => {
    const result = redactValue('error_msg', 'Failed to send email to maria@example.com') as string;
    expect(result).not.toContain('maria@example.com');
    expect(result).toContain('@example.com');
  });

  it('detecta API key inline (st_live_)', () => {
    const fullKey = 'st_live_abcdef1234567890ABCDEFGHIJ';
    const result = redactValue('msg', `Auth failed with key ${fullKey}`) as string;
    expect(result).toContain('REDACTED');
    expect(result).not.toContain('abcdef1234567890ABCDEFGHIJ');
  });

  it('detecta JWT inline', () => {
    const result = redactValue('msg', 'Got token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdef1234567890') as string;
    expect(result).toContain('REDACTED');
  });

  it('detecta Bearer header inline', () => {
    const result = redactValue('msg', 'Authorization: Bearer abc123def456ghi789jkl012') as string;
    expect(result).toContain('REDACTED');
  });

  it('NO redacta strings cortos sin patrones', () => {
    expect(redactValue('msg', 'something failed')).toBe('something failed');
  });
});

describe('redactMeta — recursivo', () => {
  it('redacta valores anidados', () => {
    const result = redactMeta({
      user: { email: 'cris@kunodigital.com', age: 35 },
      apiKey: 'st_live_secret',
    });
    expect((result?.user as Record<string, unknown>).email).toContain('***');
    expect((result?.user as Record<string, unknown>).age).toBe(35);
    expect(result?.apiKey).toContain('...');
  });

  it('preserva non-string values', () => {
    const result = redactMeta({ count: 42, active: true });
    expect(result?.count).toBe(42);
    expect(result?.active).toBe(true);
  });

  it('undefined → undefined', () => {
    expect(redactMeta(undefined)).toBe(undefined);
  });
});
