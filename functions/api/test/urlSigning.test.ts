import { describe, expect, it } from 'vitest';
import { signToken, verifyToken, expiresIn, TokenError } from '../src/lib/urlSigning';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('signToken / verifyToken', () => {
  it('roundtrip básico', () => {
    const claims = { kind: 'test' as const, ref: 'app_123', exp: expiresIn(60) };
    const token = signToken(claims, SECRET);
    const verified = verifyToken(token, 'test', SECRET);
    expect(verified.ref).toBe('app_123');
    expect(verified.kind).toBe('test');
  });

  it('falla con firma manipulada', () => {
    const claims = { kind: 'test' as const, ref: 'app_123', exp: expiresIn(60) };
    const token = signToken(claims, SECRET);
    const tampered = token.slice(0, -3) + 'XXX';
    expect(() => verifyToken(tampered, 'test', SECRET)).toThrow(TokenError);
  });

  it('falla con secret distinto', () => {
    const claims = { kind: 'test' as const, ref: 'app_123', exp: expiresIn(60) };
    const token = signToken(claims, SECRET);
    expect(() => verifyToken(token, 'test', 'OTHER_SECRET')).toThrow(TokenError);
  });

  it('falla con token expirado', () => {
    const claims = { kind: 'test' as const, ref: 'app_123', exp: Math.floor(Date.now() / 1000) - 10 };
    const token = signToken(claims, SECRET);
    try {
      verifyToken(token, 'test', SECRET);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TokenError);
      expect((err as TokenError).reason).toBe('expired');
    }
  });

  it('falla con kind incorrecto', () => {
    const claims = { kind: 'test' as const, ref: 'app_123', exp: expiresIn(60) };
    const token = signToken(claims, SECRET);
    try {
      verifyToken(token, 'report', SECRET);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TokenError).reason).toBe('wrong_kind');
    }
  });

  it('rechaza token malformado (sin punto)', () => {
    expect(() => verifyToken('invalidtoken', 'test', SECRET)).toThrow(TokenError);
  });

  it('preserva claims extra', () => {
    const claims = { kind: 'report' as const, ref: 'rep_42', exp: expiresIn(60), tenant_id: 'ten_1', custom: 'x' };
    const token = signToken(claims, SECRET);
    const verified = verifyToken(token, 'report', SECRET);
    expect(verified.tenant_id).toBe('ten_1');
    expect(verified.custom).toBe('x');
  });
});
