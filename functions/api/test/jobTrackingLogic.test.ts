/**
 * Tests estructurales de jobTracking.ts.
 *
 * Cobertura:
 * - Whitelist de event types del portal
 * - hashPortalToken: SHA-256 + truncate 32 chars (debe ser determinístico)
 * - maskIp: IPv4 → primer octeto, IPv6 → primer hextet
 * - Path parsers
 */
import { describe, expect, it } from 'vitest';
import { _internal } from '../src/features/jobTracking';
import { createHash } from 'crypto';

const { hashPortalToken, maskIp, VALID_EVENT_TYPES } = _internal;

describe('jobTracking valid event types', () => {
  it('los 6 tipos de eventos del portal', () => {
    expect(VALID_EVENT_TYPES).toEqual([
      'portal.opened',
      'portal.job_viewed',
      'portal.report_viewed',
      'portal.draft_approved',
      'portal.draft_rejected',
      'portal.feedback',
    ]);
  });

  it('todos siguen formato portal.<action>', () => {
    for (const t of VALID_EVENT_TYPES) {
      expect(t).toMatch(/^portal\.[a-z_]+$/);
    }
  });

  it('rechaza event_types fuera del whitelist', () => {
    const invalid = ['portal.deleted', 'admin.opened', 'portal', 'opened'];
    for (const i of invalid) {
      expect(VALID_EVENT_TYPES).not.toContain(i);
    }
  });
});

describe('hashPortalToken', () => {
  it('determinístico: mismo input → mismo hash', () => {
    const t = 'abc123';
    expect(hashPortalToken(t)).toBe(hashPortalToken(t));
  });

  it('SHA-256 truncado a 32 chars', () => {
    const t = 'sample_token';
    const hash = hashPortalToken(t);
    expect(hash.length).toBe(32);
  });

  it('matches sha256 reference', () => {
    const t = 'foo';
    const expected = createHash('sha256').update(t).digest('hex').slice(0, 32);
    expect(hashPortalToken(t)).toBe(expected);
  });

  it('inputs distintos → hashes distintos', () => {
    expect(hashPortalToken('a')).not.toBe(hashPortalToken('b'));
  });

  it('hash es solo hex chars', () => {
    expect(hashPortalToken('test')).toMatch(/^[0-9a-f]+$/);
  });
});

describe('maskIp', () => {
  it('IPv4: solo primer octeto visible', () => {
    expect(maskIp('192.168.1.5')).toBe('192.xx.xx.xx');
    expect(maskIp('10.0.0.1')).toBe('10.xx.xx.xx');
  });

  it('IPv6: primer hextet + xxxx::xxxx', () => {
    expect(maskIp('2001:0db8::1')).toBe('2001:xxxx::xxxx');
    expect(maskIp('fe80::1')).toBe('fe80:xxxx::xxxx');
  });

  it('vacío → unknown', () => {
    expect(maskIp('')).toBe('unknown');
  });

  it('IPv4 raros se enmascaran sin romper', () => {
    expect(maskIp('127.0.0.1')).toBe('127.xx.xx.xx');
    expect(maskIp('255.255.255.255')).toBe('255.xx.xx.xx');
  });

  it('IPv4 nunca expone los últimos 3 octetos', () => {
    const masked = maskIp('192.168.50.99');
    expect(masked).not.toContain('168');
    expect(masked).not.toContain('50');
    expect(masked).not.toContain('99');
  });
});

describe('jobTracking path parsing', () => {
  function extractTrackPath(url: string): string | null {
    return url.match(/^\/portal\/([^/]+)\/track/)?.[1] ?? null;
  }

  function extractTrackingAdminPath(url: string): string | null {
    return url.match(/^\/api\/jobs\/([^/]+)\/tracking/)?.[1] ?? null;
  }

  it('public track path /portal/<token>/track', () => {
    expect(extractTrackPath('/portal/abc/track')).toBe('abc');
  });

  it('public track path con trailing slash', () => {
    expect(extractTrackPath('/portal/abc/track/')).toBe('abc');
  });

  it('admin tracking path /api/jobs/<id>/tracking', () => {
    expect(extractTrackingAdminPath('/api/jobs/job_1/tracking')).toBe('job_1');
  });

  it('rechaza paths sin /track o /tracking', () => {
    expect(extractTrackPath('/portal/abc')).toBe(null);
    expect(extractTrackingAdminPath('/api/jobs/job_1')).toBe(null);
  });
});
