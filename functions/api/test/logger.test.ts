import { describe, expect, it } from 'vitest';
import { _internal } from '../src/lib/logger';

const { redactMeta, redactValue } = _internal;

describe('logger redactValue', () => {
  it('redacta secrets totales', () => {
    expect(redactValue('apiKey', 'sk-ant-api03-VERYLONGSECRETHERE')).toMatch(/\.\.\./);
  });

  it('mantiene non-strings sin tocar', () => {
    expect(redactValue('count', 42)).toBe(42);
  });

  it('redacta email parcialmente conservando dominio', () => {
    const result = redactValue('email', 'maria.lopez@gmail.com');
    expect(result).toContain('@gmail.com');
    expect(result).not.toContain('maria');
  });

  it('redacta phone dejando últimos 4 dígitos', () => {
    const result = redactValue('phone', '+507 6123-4567') as string;
    expect(result).toContain('4567');
    expect(result).not.toContain('6123');
  });

  it('redacta cualquier campo con "secret" en el nombre', () => {
    const v = redactValue('webhook_secret', 'whsec_VERYLONGSECRET');
    expect(v).toMatch(/\.\.\./);
  });

  it('redacta authorization header', () => {
    const v = redactValue('authorization', 'Bearer eyVERYLONGTOKEN12345');
    expect(v).toMatch(/\.\.\./);
  });
});

describe('logger redactMeta (recursive)', () => {
  it('redacta nested objects', () => {
    const meta = {
      user: { id: 'u_1', email: 'cris@kuno.com' },
      api_key: 'sk-secret-12345678',
    };
    const out = redactMeta(meta) as { user: { email: string }; api_key: string };
    expect(out.user.email).toContain('@kuno.com');
    expect(out.user.email).not.toContain('cris');
    expect(out.api_key).toMatch(/\.\.\./);
  });

  it('preserva campos no sensibles', () => {
    const meta = { count: 42, status: 'ok', user_id: 'u_1' };
    const out = redactMeta(meta);
    expect(out).toEqual({ count: 42, status: 'ok', user_id: 'u_1' });
  });
});
