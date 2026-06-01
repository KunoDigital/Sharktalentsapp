/**
 * Tests del lead scoring del marketing funnel.
 *
 * Reglas (heurística, ajustable):
 * - Baseline: 30
 * - urgencia=less_30d → +30, =1-3m → +20, =3m+ → +5
 * - historial_error=si_reinicio → +25, si_continuamos → +15
 * - proceso_actual=intuicion|sin_proceso → +15
 * - salario_target>=3000 → +10, >=1500 → +5
 * - Clamp a [0, 100]
 */
import { describe, expect, it } from 'vitest';
import { _internal } from '../src/features/marketing';

const { computeLeadScore } = _internal;

describe('computeLeadScore', () => {
  it('baseline 30 con quiz mínimo (urgencia=exploring)', () => {
    expect(computeLeadScore({
      urgencia: 'exploring',
      historial_error: 'no',
      proceso_actual: 'evaluaciones_propias',
      salario_target: 1000,
    })).toBe(30);
  });

  it('lead caliente: urgencia<30d + reinicio + intuicion + salary alto → clamp a 100', () => {
    const score = computeLeadScore({
      urgencia: 'less_30d',
      historial_error: 'si_reinicio',
      proceso_actual: 'intuicion',
      salario_target: 3500,
    });
    // 30 + 30 + 25 + 15 + 10 = 110 → clamped a 100
    expect(score).toBe(100);
  });

  it('lead semi-caliente sin clamp: urgencia 1-3m + si_continuamos + sin_proceso + salary mid', () => {
    const score = computeLeadScore({
      urgencia: '1-3m',
      historial_error: 'si_continuamos',
      proceso_actual: 'sin_proceso',
      salario_target: 2000,
    });
    // 30 + 20 + 15 + 15 + 5 = 85
    expect(score).toBe(85);
  });

  it('clamp a 100 si suma supera', () => {
    const score = computeLeadScore({
      urgencia: 'less_30d',
      historial_error: 'si_reinicio',
      proceso_actual: 'sin_proceso',
      salario_target: 5000,
    });
    expect(score).toBe(100); // 30+30+25+15+10 = 110 → clamp
  });

  it('urgencia less_30d > 1-3m > 3m+ > exploring', () => {
    const baseQuiz = { historial_error: 'no', proceso_actual: 'evaluaciones_propias', salario_target: 1000 };
    const a = computeLeadScore({ ...baseQuiz, urgencia: 'less_30d' });
    const b = computeLeadScore({ ...baseQuiz, urgencia: '1-3m' });
    const c = computeLeadScore({ ...baseQuiz, urgencia: '3m+' });
    const d = computeLeadScore({ ...baseQuiz, urgencia: 'exploring' });
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('si_reinicio > si_continuamos en historial_error', () => {
    const base = { urgencia: 'exploring', proceso_actual: 'evaluaciones_propias', salario_target: 1000 };
    expect(computeLeadScore({ ...base, historial_error: 'si_reinicio' }))
      .toBeGreaterThan(computeLeadScore({ ...base, historial_error: 'si_continuamos' }));
  });

  it('proceso_actual intuicion > evaluaciones_propias', () => {
    const base = { urgencia: 'exploring', historial_error: 'no', salario_target: 1000 };
    expect(computeLeadScore({ ...base, proceso_actual: 'intuicion' }))
      .toBeGreaterThan(computeLeadScore({ ...base, proceso_actual: 'evaluaciones_propias' }));
  });

  it('proceso_actual sin_proceso = intuicion (mismo bonus)', () => {
    const base = { urgencia: 'exploring', historial_error: 'no', salario_target: 1000 };
    expect(computeLeadScore({ ...base, proceso_actual: 'intuicion' }))
      .toBe(computeLeadScore({ ...base, proceso_actual: 'sin_proceso' }));
  });

  it('salario >=3000 > >=1500 > <1500', () => {
    const base = { urgencia: 'exploring', historial_error: 'no', proceso_actual: 'evaluaciones_propias' };
    const high = computeLeadScore({ ...base, salario_target: 4000 });
    const mid = computeLeadScore({ ...base, salario_target: 2000 });
    const low = computeLeadScore({ ...base, salario_target: 800 });
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
  });

  it('clamp a 0 si valor inicial es negativo (no debería pasar pero defensivo)', () => {
    expect(computeLeadScore({})).toBeGreaterThanOrEqual(0);
  });
});

describe('Marketing quiz enums (whitelist)', () => {
  it('puesto_tipo whitelist', () => {
    expect(_internal.VALID_PUESTO_TIPOS).toEqual(['gerencia_mando_medio', 'ventas', 'operaciones', 'tecnico']);
  });

  it('urgencia whitelist', () => {
    expect(_internal.VALID_URGENCIA).toEqual(['less_30d', '1-3m', '3m+', 'exploring']);
  });

  it('lead status whitelist (6 estados del funnel)', () => {
    expect(_internal.VALID_LEAD_STATUSES).toEqual(['new', 'eval_requested', 'eval_completed', 'call_booked', 'won', 'lost']);
  });
});
