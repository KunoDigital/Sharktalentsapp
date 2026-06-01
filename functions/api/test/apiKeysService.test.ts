import { describe, expect, it } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  compareHashes,
  isKeyActive,
  parsePermissions,
  hasPermission,
  isValidPermission,
  KEY_PREFIX_LENGTH,
} from '../src/lib/apiKeysService';

describe('generateApiKey', () => {
  it('genera key con prefix st_live_', () => {
    const { plainKey } = generateApiKey();
    expect(plainKey.startsWith('st_live_')).toBe(true);
  });

  it('genera key única en cada llamada', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plainKey).not.toBe(b.plainKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('keyPrefix es los primeros 10 chars del plain key', () => {
    const { plainKey, keyPrefix } = generateApiKey();
    expect(keyPrefix.length).toBe(KEY_PREFIX_LENGTH);
    expect(plainKey.startsWith(keyPrefix)).toBe(true);
  });

  it('keyHash matchea hashApiKey(plainKey)', () => {
    const { plainKey, keyHash } = generateApiKey();
    expect(hashApiKey(plainKey)).toBe(keyHash);
  });
});

describe('compareHashes', () => {
  it('matchea hashes iguales', () => {
    const h = hashApiKey('test');
    expect(compareHashes(h, h)).toBe(true);
  });

  it('rechaza hashes distintos', () => {
    const a = hashApiKey('foo');
    const b = hashApiKey('bar');
    expect(compareHashes(a, b)).toBe(false);
  });

  it('rechaza longitudes distintas sin throw', () => {
    expect(compareHashes('aaa', 'aaaa')).toBe(false);
  });

  it('compara strings hex iguales correctamente', () => {
    // Buffer.from('zz', 'hex') es vacío (no error). compareHashes los iguala.
    // Lo importante: NO throw.
    expect(() => compareHashes('zz', 'zz')).not.toThrow();
  });
});

describe('isKeyActive', () => {
  it('active = true cuando is_active=true, sin revoked, sin expires', () => {
    expect(isKeyActive({ is_active: true, revoked_at: null, expires_at: null })).toBe(true);
  });

  it('inactive cuando is_active=false', () => {
    expect(isKeyActive({ is_active: false, revoked_at: null, expires_at: null })).toBe(false);
  });

  it('inactive cuando revoked_at no es null', () => {
    expect(isKeyActive({ is_active: true, revoked_at: '2026-01-01', expires_at: null })).toBe(false);
  });

  it('inactive cuando expires_at en el pasado', () => {
    expect(isKeyActive({
      is_active: true,
      revoked_at: null,
      expires_at: '2020-01-01',
    })).toBe(false);
  });

  it('active cuando expires_at en el futuro', () => {
    expect(isKeyActive({
      is_active: true,
      revoked_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })).toBe(true);
  });
});

describe('parsePermissions', () => {
  it('null/empty → []', () => {
    expect(parsePermissions(null)).toEqual([]);
    expect(parsePermissions('')).toEqual([]);
  });

  it('JSON inválido → []', () => {
    expect(parsePermissions('not json')).toEqual([]);
    expect(parsePermissions('{')).toEqual([]);
  });

  it('non-array → []', () => {
    expect(parsePermissions('"jobs:read"')).toEqual([]);
    expect(parsePermissions('{"key":"value"}')).toEqual([]);
  });

  it('filtra permisos inválidos', () => {
    const result = parsePermissions(JSON.stringify(['jobs:read', 'invalid_perm', 'candidates:write']));
    expect(result).toEqual(['jobs:read', 'candidates:write']);
  });

  it('preserva permisos válidos', () => {
    const result = parsePermissions(JSON.stringify(['*']));
    expect(result).toEqual(['*']);
  });
});

describe('hasPermission', () => {
  it('* matches todo', () => {
    expect(hasPermission(['*'], 'jobs:read')).toBe(true);
    expect(hasPermission(['*'], 'reports:read')).toBe(true);
  });

  it('match exacto', () => {
    expect(hasPermission(['jobs:read'], 'jobs:read')).toBe(true);
    expect(hasPermission(['jobs:read'], 'jobs:write')).toBe(false);
  });

  it('vacío rechaza todo', () => {
    expect(hasPermission([], 'jobs:read')).toBe(false);
  });
});

describe('isValidPermission', () => {
  it('acepta valores conocidos', () => {
    expect(isValidPermission('jobs:read')).toBe(true);
    expect(isValidPermission('*')).toBe(true);
  });

  it('rechaza unknown', () => {
    expect(isValidPermission('jobs:delete')).toBe(false);
    expect(isValidPermission(123)).toBe(false);
    expect(isValidPermission(null)).toBe(false);
  });
});
