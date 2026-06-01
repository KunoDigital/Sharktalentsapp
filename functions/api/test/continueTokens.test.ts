import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../src/lib/continueTokens';

describe('continueTokens utility functions', () => {
  it('generateToken devuelve 32 hex chars', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generateToken devuelve tokens únicos', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken());
    }
    expect(tokens.size).toBe(100);
  });

  it('hashToken devuelve 32 hex chars', () => {
    const h = hashToken('cualquier-token');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashToken es determinístico', () => {
    expect(hashToken('abc123')).toBe(hashToken('abc123'));
  });

  it('hashToken produce hashes distintos para inputs distintos', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('hashToken NO es invertible (no contiene el token raw)', () => {
    const token = 'mi-secret-token-largo';
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash.length).toBe(32);
  });
});
