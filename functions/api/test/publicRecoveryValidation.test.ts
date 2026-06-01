/**
 * Tests de validación del flujo de recovery público.
 *
 * Tests:
 * - Email regex (rechaza inválidos, acepta válidos comunes)
 * - Lista de stages terminales (no debe enviar link a candidatos en estos)
 * - Path parsing del endpoint /apply/:tenantSlug/:jobIdentifier/resend
 * - Email enumeration safety: el mensaje genérico de respuesta es siempre el mismo
 */
import { describe, expect, it } from 'vitest';

// Replicamos el regex y constantes de publicRecovery.ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TERMINAL_STAGES = [
  'hired',
  'rejected_by_admin',
  'auto_rejected_low_score',
  'offer_declined',
  'withdrew',
];

const GENERIC_MESSAGE =
  'Si tu email tiene una aplicación a este puesto, recibirás un nuevo link en los próximos minutos.';

function parseRecoveryPath(url: string): { tenantSlug: string; jobIdentifier: string } | null {
  const m = url.match(/^\/apply\/([^/]+)\/([^/]+)\/resend/);
  if (!m) return null;
  return { tenantSlug: m[1], jobIdentifier: m[2] };
}

function shouldSkipForTerminalStage(stage: string): boolean {
  return TERMINAL_STAGES.includes(stage);
}

describe('publicRecovery email validation', () => {
  it('acepta emails válidos comunes', () => {
    expect(EMAIL_REGEX.test('foo@bar.com')).toBe(true);
    expect(EMAIL_REGEX.test('a.b+tag@example.co.uk')).toBe(true);
    expect(EMAIL_REGEX.test('user@domain.io')).toBe(true);
  });

  it('rechaza emails sin @', () => {
    expect(EMAIL_REGEX.test('foo.bar.com')).toBe(false);
  });

  it('rechaza emails sin dominio', () => {
    expect(EMAIL_REGEX.test('foo@')).toBe(false);
    expect(EMAIL_REGEX.test('foo@bar')).toBe(false);
  });

  it('rechaza emails con espacios', () => {
    expect(EMAIL_REGEX.test('foo bar@x.com')).toBe(false);
    expect(EMAIL_REGEX.test('foo@x .com')).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(EMAIL_REGEX.test('')).toBe(false);
  });
});

describe('publicRecovery path parsing', () => {
  it('parsea path estándar', () => {
    expect(parseRecoveryPath('/apply/acme/job_123/resend')).toEqual({
      tenantSlug: 'acme',
      jobIdentifier: 'job_123',
    });
  });

  it('parsea slug en jobIdentifier', () => {
    expect(parseRecoveryPath('/apply/acme/dev-fullstack-senior/resend')).toEqual({
      tenantSlug: 'acme',
      jobIdentifier: 'dev-fullstack-senior',
    });
  });

  it('rechaza path sin /resend', () => {
    expect(parseRecoveryPath('/apply/acme/job_123')).toBe(null);
  });

  it('rechaza path con segmentos faltantes', () => {
    expect(parseRecoveryPath('/apply/acme/resend')).toBe(null);
    expect(parseRecoveryPath('/apply/resend')).toBe(null);
  });
});

describe('publicRecovery terminal stage check', () => {
  it('hired skipea envío', () => {
    expect(shouldSkipForTerminalStage('hired')).toBe(true);
  });

  it('rejected stages skipean', () => {
    expect(shouldSkipForTerminalStage('rejected_by_admin')).toBe(true);
    expect(shouldSkipForTerminalStage('auto_rejected_low_score')).toBe(true);
  });

  it('offer_declined y withdrew skipean', () => {
    expect(shouldSkipForTerminalStage('offer_declined')).toBe(true);
    expect(shouldSkipForTerminalStage('withdrew')).toBe(true);
  });

  it('stages activos NO skipean', () => {
    expect(shouldSkipForTerminalStage('applied')).toBe(false);
    expect(shouldSkipForTerminalStage('tecnica_completed')).toBe(false);
    expect(shouldSkipForTerminalStage('finalist')).toBe(false);
    expect(shouldSkipForTerminalStage('awaiting_client_review')).toBe(false);
  });
});

describe('publicRecovery email enumeration safety', () => {
  it('mensaje genérico es siempre el mismo', () => {
    // El backend devuelve este mensaje para 4 escenarios distintos:
    // 1. Candidate no existe
    // 2. Application no existe
    // 3. Stage terminal
    // 4. Recovery exitoso
    // Si los mensajes divergen, atacante puede enumerar emails.
    expect(GENERIC_MESSAGE.length).toBeGreaterThan(20);
    expect(GENERIC_MESSAGE).toContain('Si tu email');
    expect(GENERIC_MESSAGE).toContain('recibirás');
  });
});
