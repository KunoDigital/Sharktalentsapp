import { describe, expect, it } from 'vitest';
import { signPortalToken, verifyPortalToken } from '../src/lib/clientPortalTokens';
import { signToken, expiresIn, TokenError } from '../src/lib/urlSigning';

const SECRET = 'test-secret-portal';

const baseClaims = {
  ref: 'tenant_123',
  company: 'Banco Pacífico',
  client_name: 'Carolina Aguilar',
  client_email: 'caguilar@bancopacifico.com',
  agency_name: 'Kuno Digital',
};

describe('portal tokens', () => {
  it('roundtrip preserva todos los claims', () => {
    const token = signPortalToken({ ...baseClaims, ttl_days: 7 }, SECRET);
    const verified = verifyPortalToken(token, SECRET);
    expect(verified.ref).toBe('tenant_123');
    expect(verified.company).toBe('Banco Pacífico');
    expect(verified.client_name).toBe('Carolina Aguilar');
    expect(verified.client_email).toBe('caguilar@bancopacifico.com');
    expect(verified.agency_name).toBe('Kuno Digital');
    expect(verified.kind).toBe('portal');
  });

  it('falla con secret distinto', () => {
    const token = signPortalToken(baseClaims, SECRET);
    expect(() => verifyPortalToken(token, 'OTHER')).toThrow(TokenError);
  });

  it('falla con kind=test (no acepta cross-kind)', () => {
    const tokenWithWrongKind = signToken(
      { kind: 'test', ref: 'app_1', exp: expiresIn(60) },
      SECRET,
    );
    expect(() => verifyPortalToken(tokenWithWrongKind, SECRET)).toThrow(TokenError);
  });

  it('falla si claims extra faltan', () => {
    const t = signToken(
      { kind: 'portal', ref: 'tenant_1', exp: expiresIn(60) },
      SECRET,
    );
    expect(() => verifyPortalToken(t, SECRET)).toThrow();
  });
});
