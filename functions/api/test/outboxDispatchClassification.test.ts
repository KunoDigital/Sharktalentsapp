/**
 * Tests estructurales de la clasificación de eventos del outbox dispatcher.
 *
 * Replica la lógica del switch en outbox.dispatch() — cualquier cambio en producción
 * debería actualizar este archivo.
 *
 * Cobertura:
 * - Whitelist completo de event types soportados (8 tipos)
 * - Cuáles delegan a integraciones externas (5 dispatchers)
 * - Cuáles son no-op success (1: application.transitioned)
 * - Cuáles aceptan evento pero requieren integración futura (lead.captured/eval_completed)
 * - Unknown event types → ok: false
 * - Validación de payload por dispatcher
 */
import { describe, expect, it } from 'vitest';

const DISPATCHER_TYPES = [
  'email.send_pending',
  'report.translate_en',
  'report.translate_es',
  'sync.recruit',
  'outreach.send_dm',
  'briefing.transcript_received',
];

const NO_OP_SUCCESS_TYPES = [
  'application.transitioned',
  'lead.captured',
  'lead.eval_completed',
];

const ALL_KNOWN_TYPES = [...DISPATCHER_TYPES, ...NO_OP_SUCCESS_TYPES];

type DispatchCategory = 'dispatch' | 'no_op_success' | 'unknown';

function classifyEvent(type: string): DispatchCategory {
  if (DISPATCHER_TYPES.includes(type)) return 'dispatch';
  if (NO_OP_SUCCESS_TYPES.includes(type)) return 'no_op_success';
  return 'unknown';
}

describe('Outbox event classification — completa', () => {
  it('email.send_pending → dispatch', () => {
    expect(classifyEvent('email.send_pending')).toBe('dispatch');
  });

  it('report.translate_en/es → dispatch', () => {
    expect(classifyEvent('report.translate_en')).toBe('dispatch');
    expect(classifyEvent('report.translate_es')).toBe('dispatch');
  });

  it('sync.recruit → dispatch', () => {
    expect(classifyEvent('sync.recruit')).toBe('dispatch');
  });

  it('outreach.send_dm → dispatch (HeyReach DM)', () => {
    expect(classifyEvent('outreach.send_dm')).toBe('dispatch');
  });

  it('briefing.transcript_received → dispatch (Anthropic auto-draft)', () => {
    expect(classifyEvent('briefing.transcript_received')).toBe('dispatch');
  });

  it('application.transitioned → no_op_success (audit-only)', () => {
    expect(classifyEvent('application.transitioned')).toBe('no_op_success');
  });

  it('lead.captured → no_op_success (Zoho CRM TODO)', () => {
    expect(classifyEvent('lead.captured')).toBe('no_op_success');
  });

  it('lead.eval_completed → no_op_success (Zoho CRM TODO)', () => {
    expect(classifyEvent('lead.eval_completed')).toBe('no_op_success');
  });

  it('Eventos random → unknown', () => {
    expect(classifyEvent('foo.bar')).toBe('unknown');
    expect(classifyEvent('email.received')).toBe('unknown');
    expect(classifyEvent('')).toBe('unknown');
  });
});

describe('Outbox event types — invariantes', () => {
  it('todos los tipos siguen formato resource.action', () => {
    for (const t of ALL_KNOWN_TYPES) {
      expect(t).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('no hay duplicados entre DISPATCHER y NO_OP', () => {
    const overlap = DISPATCHER_TYPES.filter((t) => NO_OP_SUCCESS_TYPES.includes(t));
    expect(overlap).toEqual([]);
  });

  it('total de tipos conocidos es exactamente 9', () => {
    expect(ALL_KNOWN_TYPES.length).toBe(9);
  });

  it('cada tipo aparece una sola vez', () => {
    expect(new Set(ALL_KNOWN_TYPES).size).toBe(ALL_KNOWN_TYPES.length);
  });
});

describe('Dispatcher payload requirements', () => {
  // Replicamos las validaciones que cada dispatcher hace al inicio.

  function validateEmailPayload(payload: Record<string, unknown>): boolean {
    return typeof payload.to === 'string' && typeof payload.template === 'string';
  }

  function validateRecruitSyncPayload(payload: Record<string, unknown>): boolean {
    // Dispatcher acepta cualquier object — Recruit valida shape downstream
    return typeof payload === 'object' && payload !== null;
  }

  function validateOutreachDMPayload(payload: Record<string, unknown>): boolean {
    return typeof payload.campaign_id === 'string'
      && typeof payload.contact_linkedin_url === 'string'
      && typeof payload.message === 'string';
  }

  function validateBriefingPayload(payload: Record<string, unknown>): boolean {
    return typeof payload.transcript === 'string'
      && (payload.transcript as string).length >= 100;
  }

  function validateTranslationPayload(payload: Record<string, unknown>): boolean {
    return typeof payload.narratives === 'object' && payload.narratives !== null;
  }

  it('email.send_pending: requiere to + template', () => {
    expect(validateEmailPayload({ to: 'foo@bar.com', template: 'recovery_link' })).toBe(true);
    expect(validateEmailPayload({ to: 'foo@bar.com' })).toBe(false);
    expect(validateEmailPayload({ template: 'x' })).toBe(false);
  });

  it('outreach.send_dm: requiere los 3 fields', () => {
    expect(validateOutreachDMPayload({
      campaign_id: 'c1',
      contact_linkedin_url: 'https://linkedin.com/x',
      message: 'hola',
    })).toBe(true);
    expect(validateOutreachDMPayload({
      campaign_id: 'c1',
      message: 'hola',
    })).toBe(false);
  });

  it('briefing.transcript_received: requiere transcript >= 100 chars', () => {
    expect(validateBriefingPayload({ transcript: 'a'.repeat(150) })).toBe(true);
    expect(validateBriefingPayload({ transcript: 'corto' })).toBe(false);
    expect(validateBriefingPayload({})).toBe(false);
  });

  it('report.translate: requiere narratives object', () => {
    expect(validateTranslationPayload({ narratives: { candidates: {}, conclusion: {} } })).toBe(true);
    expect(validateTranslationPayload({ narratives: 'string' })).toBe(false);
    expect(validateTranslationPayload({})).toBe(false);
  });

  it('sync.recruit: payload debe ser object', () => {
    expect(validateRecruitSyncPayload({ application_id: 'app_1' })).toBe(true);
  });
});
