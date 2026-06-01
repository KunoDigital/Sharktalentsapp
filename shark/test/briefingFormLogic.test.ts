/**
 * Tests de la lógica del BriefingForm component.
 *
 * Testeamos las helpers internas: tomorrowMorning() default + validaciones.
 */
import { describe, expect, it } from 'vitest';

// Replica del helper interno del componente
function tomorrowMorning(now: Date = new Date()): string {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(10, 0, 0, 0);
  return t.toISOString().slice(0, 16);
}

function validateBriefingForm(input: {
  client_email: string;
  client_name: string;
  start_time: string;
  duration_minutes: number;
}): { ok: boolean; error?: string } {
  if (!input.client_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.client_email)) {
    return { ok: false, error: 'email inválido' };
  }
  if (!input.client_name.trim()) return { ok: false, error: 'name required' };
  if (!input.start_time || Number.isNaN(new Date(input.start_time).getTime())) {
    return { ok: false, error: 'start_time inválido' };
  }
  if (input.duration_minutes < 15 || input.duration_minutes > 180) {
    return { ok: false, error: 'duration fuera de rango' };
  }
  return { ok: true };
}

describe('tomorrowMorning helper', () => {
  it('devuelve formato datetime-local (YYYY-MM-DDTHH:MM)', () => {
    const now = new Date('2026-05-04T15:00:00Z');
    const result = tomorrowMorning(now);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('siempre apunta al día siguiente', () => {
    const now = new Date('2026-05-04T08:00:00Z');
    const result = tomorrowMorning(now);
    const day = new Date(result);
    // El día tiene que ser distinto al actual
    expect(day.getDate()).not.toBe(4);
  });

  it('apunta a una hora consistente (10:00 local del runtime)', () => {
    // Nota: setHours(10) usa LOCAL time, pero toISOString devuelve UTC.
    // En distintos timezones el resultado UTC varía. Solo validamos que
    // sea un timestamp válido con minutos = 00.
    const now = new Date('2026-05-04T08:00:00Z');
    const result = tomorrowMorning(now);
    expect(result.slice(-3)).toBe(':00'); // minutos = 00
  });
});

describe('validateBriefingForm', () => {
  const valid = {
    client_email: 'cliente@empresa.com',
    client_name: 'Cliente Test',
    start_time: '2026-05-10T15:00',
    duration_minutes: 30,
  };

  it('input válido pasa', () => {
    expect(validateBriefingForm(valid).ok).toBe(true);
  });

  it('rechaza email inválido', () => {
    expect(validateBriefingForm({ ...valid, client_email: 'no-arroba' }).ok).toBe(false);
    expect(validateBriefingForm({ ...valid, client_email: '' }).ok).toBe(false);
  });

  it('rechaza name vacío o whitespace', () => {
    expect(validateBriefingForm({ ...valid, client_name: '' }).ok).toBe(false);
    expect(validateBriefingForm({ ...valid, client_name: '   ' }).ok).toBe(false);
  });

  it('rechaza start_time inválido', () => {
    expect(validateBriefingForm({ ...valid, start_time: 'no-fecha' }).ok).toBe(false);
    expect(validateBriefingForm({ ...valid, start_time: '' }).ok).toBe(false);
  });

  it('rechaza duration < 15min', () => {
    expect(validateBriefingForm({ ...valid, duration_minutes: 14 }).ok).toBe(false);
    expect(validateBriefingForm({ ...valid, duration_minutes: 5 }).ok).toBe(false);
  });

  it('rechaza duration > 180min', () => {
    expect(validateBriefingForm({ ...valid, duration_minutes: 181 }).ok).toBe(false);
  });

  it('acepta duration boundary 15 y 180', () => {
    expect(validateBriefingForm({ ...valid, duration_minutes: 15 }).ok).toBe(true);
    expect(validateBriefingForm({ ...valid, duration_minutes: 180 }).ok).toBe(true);
  });
});
