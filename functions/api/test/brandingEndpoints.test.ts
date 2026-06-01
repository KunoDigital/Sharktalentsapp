import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBranding, serializeBranding } from '../src/lib/branding';

describe('branding integration: parse → modify → serialize round-trip', () => {
  it('round-trip preserva campos válidos', () => {
    const original = {
      logo_url: 'https://example.com/l.png',
      primary_color: '#2563eb',
      legal_name: 'SharkTalents Inc.',
    };
    const serialized = serializeBranding(original);
    const parsed = parseBranding(serialized);
    expect(parsed.logo_url).toBe(original.logo_url);
    expect(parsed.primary_color).toBe(original.primary_color);
    expect(parsed.legal_name).toBe(original.legal_name);
  });

  it('merge: parse del valor existente + override de un campo', () => {
    const stored = serializeBranding({
      logo_url: 'https://old.com/logo.png',
      primary_color: '#aa0000',
    });
    const current = parseBranding(stored);
    const merged = { ...current, primary_color: '#00ff00' };
    const serialized = serializeBranding(merged);
    const parsed = parseBranding(serialized);
    expect(parsed.primary_color).toBe('#00ff00');
    expect(parsed.logo_url).toBe('https://old.com/logo.png');
  });

  it('validation: HTTP URL rechazado en logo_url', () => {
    expect(() => serializeBranding({ logo_url: 'http://insecure.com/x.png' })).toThrow(/HTTPS/);
  });

  it('validation: hex 3-digit rechazado', () => {
    expect(() => serializeBranding({ primary_color: '#abc' })).toThrow();
    expect(() => serializeBranding({ primary_color: '#abcdef' })).not.toThrow();
  });

  it('validation: secondary_color sigue mismas reglas que primary', () => {
    expect(() => serializeBranding({ secondary_color: 'blue' })).toThrow();
    expect(() => serializeBranding({ secondary_color: '#ff5733' })).not.toThrow();
  });

  it('legal_name acepta unicode (acentos, ñ)', () => {
    const out = serializeBranding({ legal_name: 'Compañía S.A. de C.V.' });
    expect(JSON.parse(out).legal_name).toBe('Compañía S.A. de C.V.');
  });

  it('parseBranding tolera JSON con extra fields (ignora)', () => {
    const r = parseBranding(JSON.stringify({
      primary_color: '#123456',
      future_field: 'should be ignored',
    } as Record<string, unknown>));
    expect(r.primary_color).toBe('#123456');
  });

  it('serializeBranding con input vacío produce {}', () => {
    expect(serializeBranding({})).toBe('{}');
    const parsed = parseBranding('{}');
    expect(parsed.primary_color).toBe('#2563eb'); // defaults
  });

  it('contact_email se trunca a 255 chars', () => {
    const longEmail = 'a'.repeat(300) + '@example.com';
    const out = JSON.parse(serializeBranding({ contact_email: longEmail }));
    expect(out.contact_email.length).toBe(255);
  });
});
