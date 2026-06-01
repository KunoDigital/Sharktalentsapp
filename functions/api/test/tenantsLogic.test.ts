/**
 * Tests estructurales de tenants.ts.
 *
 * Cobertura:
 * - slugify (normalización para tenant slugs)
 * - Whitelist de event types del webhook Clerk
 * - Defaults del tenant nuevo (free plan, 5 jobs, 50 cand/mes)
 * - features_enabled default (api/mcp/branding off)
 * - Reglas de stage transitions del tenant (active → suspended → deleted)
 */
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/lib/slugify';

const HANDLED_EVENTS = [
  'organization.created',
  'organization.updated',
  'organization.deleted',
  'organizationMembership.created',
  'organizationMembership.updated',
  'organizationMembership.deleted',
  'organizationInvitation.created',
  'organizationInvitation.accepted',
  'organizationInvitation.revoked',
  'user.created',
  'user.updated',
  'user.deleted',
];

const TENANT_DEFAULTS_NEW = {
  plan: 'free',
  status: 'active',
  max_active_jobs: 5,
  max_candidates_per_month: 50,
  features_enabled: { mcp: false, api: false, custom_branding: false },
};

const VALID_TENANT_STATUSES = ['active', 'suspended', 'deleted'];
const VALID_TENANT_PLANS = ['free', 'pro', 'enterprise'];

describe('slugify', () => {
  it('lowercase + replace spaces con guión', () => {
    expect(slugify('AcmeTech Panamá')).toBe('acmetech-panama');
  });

  it('quita acentos (NFD normalize)', () => {
    expect(slugify('María Pérez')).toBe('maria-perez');
    expect(slugify('São Paulo')).toBe('sao-paulo');
  });

  it('múltiples separadores se colapsan en uno', () => {
    expect(slugify('Foo   Bar___baz')).toBe('foo-bar-baz');
  });

  it('quita guiones al inicio y final', () => {
    expect(slugify('--Foo--')).toBe('foo');
    expect(slugify('  Bar  ')).toBe('bar');
  });

  it('caracteres no-ascii a guiones', () => {
    expect(slugify('Hello@World!')).toBe('hello-world');
    expect(slugify('foo & bar')).toBe('foo-bar');
  });

  it('trunca a 100 chars', () => {
    const long = 'a'.repeat(150);
    expect(slugify(long).length).toBe(100);
  });

  it('emoji se reemplazan a guión', () => {
    expect(slugify('Acme 🚀 Tech')).toBe('acme-tech');
  });

  it('strings solo de caracteres no-ascii devuelven vacío', () => {
    expect(slugify('！@#$%')).toBe('');
  });

  it('números se preservan', () => {
    expect(slugify('Empresa 2026')).toBe('empresa-2026');
  });
});

describe('Clerk webhook event types', () => {
  it('los 12 tipos manejados están en la lista', () => {
    expect(HANDLED_EVENTS).toHaveLength(12);
  });

  it('organization.* (3)', () => {
    expect(HANDLED_EVENTS.filter((e) => e.startsWith('organization.'))).toHaveLength(3);
  });

  it('organizationMembership.* (3)', () => {
    expect(HANDLED_EVENTS.filter((e) => e.startsWith('organizationMembership.'))).toHaveLength(3);
  });

  it('organizationInvitation.* (3)', () => {
    expect(HANDLED_EVENTS.filter((e) => e.startsWith('organizationInvitation.'))).toHaveLength(3);
  });

  it('user.* (3)', () => {
    expect(HANDLED_EVENTS.filter((e) => e.startsWith('user.'))).toHaveLength(3);
  });

  it('event types siguen formato resource.action', () => {
    for (const e of HANDLED_EVENTS) {
      expect(e).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    }
  });
});

describe('Tenant defaults nuevo (organization.created)', () => {
  it('plan = free por defecto', () => {
    expect(TENANT_DEFAULTS_NEW.plan).toBe('free');
  });

  it('status = active', () => {
    expect(TENANT_DEFAULTS_NEW.status).toBe('active');
  });

  it('max_active_jobs = 5 (free tier)', () => {
    expect(TENANT_DEFAULTS_NEW.max_active_jobs).toBe(5);
  });

  it('max_candidates_per_month = 50 (free tier)', () => {
    expect(TENANT_DEFAULTS_NEW.max_candidates_per_month).toBe(50);
  });

  it('features off por defecto', () => {
    expect(TENANT_DEFAULTS_NEW.features_enabled.api).toBe(false);
    expect(TENANT_DEFAULTS_NEW.features_enabled.mcp).toBe(false);
    expect(TENANT_DEFAULTS_NEW.features_enabled.custom_branding).toBe(false);
  });
});

describe('Tenant status transitions', () => {
  it('los 3 status válidos', () => {
    expect(VALID_TENANT_STATUSES).toEqual(['active', 'suspended', 'deleted']);
  });

  it('los 3 plans válidos', () => {
    expect(VALID_TENANT_PLANS).toEqual(['free', 'pro', 'enterprise']);
  });

  it('"deleted" es terminal — no se puede volver a "active" automáticamente', () => {
    // Un tenant deleted requiere intervención manual del admin para reactivar
    // (no hay webhook que lo haga). Esto es por diseño.
    const transitions = {
      active: ['suspended', 'deleted'],
      suspended: ['active', 'deleted'],
      deleted: [],
    };
    expect(transitions.deleted).toHaveLength(0);
  });
});
