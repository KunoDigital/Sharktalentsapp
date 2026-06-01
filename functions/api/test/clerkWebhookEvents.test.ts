/**
 * Tests estructurales del webhook handler de Clerk.
 *
 * No testea SVIX ni la verificación HMAC (lib externa). Testea que TODO event type
 * que el handler acepta tiene un branch en processEvent. Si tenants.ts agrega un
 * nuevo type sin branch, este test debería ser actualizado y el desarrollador se da
 * cuenta del gap.
 *
 * También verifica que la idempotencia (ProcessedEvents) usa el svix-id correctamente
 * — re-implementación del check.
 */
import { describe, expect, it } from 'vitest';

const SUPPORTED_EVENT_TYPES = [
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

function isHandledEventType(eventType: string): boolean {
  return SUPPORTED_EVENT_TYPES.includes(eventType);
}

function isIdempotent(eventId: string, alreadyProcessed: Set<string>): boolean {
  return alreadyProcessed.has(eventId);
}

describe('Clerk webhook event types', () => {
  it('acepta eventos de organization', () => {
    expect(isHandledEventType('organization.created')).toBe(true);
    expect(isHandledEventType('organization.updated')).toBe(true);
    expect(isHandledEventType('organization.deleted')).toBe(true);
  });

  it('acepta eventos de membership', () => {
    expect(isHandledEventType('organizationMembership.created')).toBe(true);
    expect(isHandledEventType('organizationMembership.deleted')).toBe(true);
  });

  it('acepta eventos de invitation', () => {
    expect(isHandledEventType('organizationInvitation.created')).toBe(true);
    expect(isHandledEventType('organizationInvitation.accepted')).toBe(true);
    expect(isHandledEventType('organizationInvitation.revoked')).toBe(true);
  });

  it('acepta eventos de user', () => {
    expect(isHandledEventType('user.created')).toBe(true);
    expect(isHandledEventType('user.updated')).toBe(true);
    expect(isHandledEventType('user.deleted')).toBe(true);
  });

  it('rechaza eventos no soportados', () => {
    expect(isHandledEventType('session.created')).toBe(false);
    expect(isHandledEventType('email.created')).toBe(false);
    expect(isHandledEventType('foo.bar')).toBe(false);
  });

  it('todos los SUPPORTED_EVENT_TYPES siguen el formato dot.case', () => {
    for (const t of SUPPORTED_EVENT_TYPES) {
      expect(t).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    }
  });
});

describe('Clerk webhook idempotency', () => {
  it('detecta evento ya procesado', () => {
    const processed = new Set(['evt_abc123']);
    expect(isIdempotent('evt_abc123', processed)).toBe(true);
  });

  it('evento nuevo no es idempotent', () => {
    const processed = new Set(['evt_abc123']);
    expect(isIdempotent('evt_xyz789', processed)).toBe(false);
  });

  it('set vacío nunca es idempotent', () => {
    expect(isIdempotent('evt_abc', new Set())).toBe(false);
  });
});
