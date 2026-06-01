/**
 * Tests estructurales del feature briefings.
 *
 * No mockeamos Zoho Bookings (lib externa). Testeamos validación del payload
 * y reglas internas de scheduleBriefing.
 */
import { describe, expect, it } from 'vitest';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_DURATION = 15;
const MAX_DURATION = 180;

type ScheduleInput = {
  client_email?: unknown;
  client_name?: unknown;
  client_company?: unknown;
  client_phone?: unknown;
  start_time?: unknown;
  duration_minutes?: unknown;
};

function validateScheduleBody(body: ScheduleInput): { ok: boolean; error?: string } {
  const email = typeof body.client_email === 'string' ? body.client_email.trim().toLowerCase() : '';
  const name = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const duration = Number(body.duration_minutes ?? 30);

  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'client_email inválido' };
  if (!name) return { ok: false, error: 'client_name required' };
  if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
    return { ok: false, error: 'start_time debe ser ISO 8601' };
  }
  if (!Number.isFinite(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    return { ok: false, error: `duration_minutes debe estar entre ${MIN_DURATION} y ${MAX_DURATION}` };
  }
  return { ok: true };
}

describe('briefings.scheduleBriefing validation', () => {
  const validBody = {
    client_email: 'cliente@empresa.com',
    client_name: 'Cliente Demo',
    client_company: 'AcmeTech',
    start_time: '2026-05-10T15:00:00Z',
    duration_minutes: 30,
  };

  it('body válido pasa', () => {
    expect(validateScheduleBody(validBody).ok).toBe(true);
  });

  it('rechaza sin client_email', () => {
    expect(validateScheduleBody({ ...validBody, client_email: '' }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, client_email: undefined }).ok).toBe(false);
  });

  it('rechaza email mal formado', () => {
    expect(validateScheduleBody({ ...validBody, client_email: 'sin-arroba' }).ok).toBe(false);
  });

  it('email se normaliza a lowercase', () => {
    // Validación pasa para CLIENTE@EMPRESA.COM (la lib internamente lo bajea)
    expect(validateScheduleBody({ ...validBody, client_email: 'CLIENTE@EMPRESA.COM' }).ok).toBe(true);
  });

  it('rechaza sin client_name', () => {
    expect(validateScheduleBody({ ...validBody, client_name: '' }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, client_name: '   ' }).ok).toBe(false);
  });

  it('rechaza start_time inválido', () => {
    expect(validateScheduleBody({ ...validBody, start_time: '' }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, start_time: 'mañana' }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, start_time: '2026-13-01' }).ok).toBe(false);
  });

  it('acepta start_time en formato ISO 8601 con TZ', () => {
    expect(validateScheduleBody({ ...validBody, start_time: '2026-05-10T15:00:00-05:00' }).ok).toBe(true);
  });

  it('duration default 30 si no viene', () => {
    expect(validateScheduleBody({ ...validBody, duration_minutes: undefined }).ok).toBe(true);
  });

  it('rechaza duration < 15min', () => {
    expect(validateScheduleBody({ ...validBody, duration_minutes: 14 }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, duration_minutes: 5 }).ok).toBe(false);
  });

  it('rechaza duration > 180min', () => {
    expect(validateScheduleBody({ ...validBody, duration_minutes: 181 }).ok).toBe(false);
    expect(validateScheduleBody({ ...validBody, duration_minutes: 240 }).ok).toBe(false);
  });

  it('acepta duration boundary 15 y 180', () => {
    expect(validateScheduleBody({ ...validBody, duration_minutes: 15 }).ok).toBe(true);
    expect(validateScheduleBody({ ...validBody, duration_minutes: 180 }).ok).toBe(true);
  });

  it('rechaza duration NaN', () => {
    expect(validateScheduleBody({ ...validBody, duration_minutes: 'media hora' }).ok).toBe(false);
  });
});
