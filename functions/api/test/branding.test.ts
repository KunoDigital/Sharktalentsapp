import { describe, it, expect } from 'vitest';
import { parseBranding, serializeBranding } from '../src/lib/branding';

describe('branding.parseBranding', () => {
  it('returns defaults si raw es null/undefined/empty', () => {
    expect(parseBranding(null).primary_color).toBe('#2563eb');
    expect(parseBranding(undefined).primary_color).toBe('#2563eb');
    expect(parseBranding('').primary_color).toBe('#2563eb');
  });

  it('returns defaults si JSON inválido', () => {
    expect(parseBranding('not json').primary_color).toBe('#2563eb');
    expect(parseBranding('null').primary_color).toBe('#2563eb');
  });

  it('aplica overrides + defaults', () => {
    const r = parseBranding(JSON.stringify({ logo_url: 'https://x.com/logo.png' }));
    expect(r.logo_url).toBe('https://x.com/logo.png');
    expect(r.primary_color).toBe('#2563eb');  // default
  });

  it('respeta valores custom', () => {
    const r = parseBranding(JSON.stringify({ primary_color: '#ff0000' }));
    expect(r.primary_color).toBe('#ff0000');
  });
});

describe('branding.serializeBranding', () => {
  it('empty input → JSON vacío', () => {
    expect(serializeBranding({})).toBe('{}');
  });

  it('valida y serializa logo_url HTTPS', () => {
    const out = serializeBranding({ logo_url: 'https://example.com/l.png' });
    expect(JSON.parse(out).logo_url).toBe('https://example.com/l.png');
  });

  it('rechaza logo_url HTTP (no HTTPS)', () => {
    expect(() => serializeBranding({ logo_url: 'http://insecure.com/l.png' })).toThrow(/HTTPS/);
  });

  it('valida hex color', () => {
    expect(() => serializeBranding({ primary_color: '#abc' })).toThrow(/hex/);
    expect(() => serializeBranding({ primary_color: 'red' })).toThrow();
    const out = serializeBranding({ primary_color: '#2563eb' });
    expect(JSON.parse(out).primary_color).toBe('#2563eb');
  });

  it('trunca legal_name a 200 chars', () => {
    const long = 'A'.repeat(500);
    const out = JSON.parse(serializeBranding({ legal_name: long }));
    expect(out.legal_name.length).toBe(200);
  });
});
