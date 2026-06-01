import { describe, expect, it } from 'vitest';
import { _internal } from '../src/lib/logger';

const { redactValue, redactMeta } = _internal;

describe('frontend logger redaction', () => {
  it('redacta email parcialmente', () => {
    const r = redactValue('email', 'cris@kuno.com');
    expect(r).toContain('@kuno.com');
    expect(r).not.toContain('cris');
  });

  it('redacta phone last 4', () => {
    const r = redactValue('phone', '+507 6123-4567') as string;
    expect(r).toContain('4567');
  });

  it('redacta tokens', () => {
    const r = redactValue('token', 'eyJVERYLONGTOKEN12345');
    expect(r).toMatch(/\.\.\./);
  });

  it('preserva valores no sensibles', () => {
    expect(redactValue('count', 42)).toBe(42);
    expect(redactValue('user_id', 'u_1')).toBe('u_1');
  });

  it('redactMeta funciona recursivo', () => {
    const out = redactMeta({
      user: { email: 'x@y.com', id: 'u' },
      api_key: 'sk-secret-12345678',
    });
    expect((out as { user: { email: string } }).user.email).toContain('@y.com');
    expect((out as { api_key: string }).api_key).toMatch(/\.\.\./);
  });
});
