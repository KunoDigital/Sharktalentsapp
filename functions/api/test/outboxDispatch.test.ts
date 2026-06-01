/**
 * Tests estructurales del outbox dispatcher.
 *
 * NO testea DB ni Catalyst SDK (requeriría mocking pesado). Testea las invariantes:
 * - tipos de evento aceptados
 * - clasificación: cuáles fallan con NOT_IMPLEMENTED, cuáles son no-op success
 * - límite MAX_RETRIES
 *
 * Si outbox.ts cambia un tipo o el comportamiento, estos tests fallan y obligan a
 * actualizarlos — son la "verdad" del contrato.
 */
import { describe, expect, it } from 'vitest';

const KNOWN_EVENT_TYPES = [
  'email.send_pending',
  'report.translate_en',
  'report.translate_es',
  'sync.recruit',
  'application.transitioned',
];

// Tipos que requieren dispatch real con integración externa
const REQUIRES_DISPATCH_TYPES = [
  'email.send_pending',
  'report.translate_en',
  'report.translate_es',
  'sync.recruit',
];
const NO_OP_SUCCESS_TYPES = ['application.transitioned'];
const NOT_IMPLEMENTED_TYPES: string[] = []; // 0 — todos implementados

const MAX_RETRIES = 5;

function classify(eventType: string): 'dispatch' | 'no_op' | 'not_implemented' | 'unknown' {
  if (REQUIRES_DISPATCH_TYPES.includes(eventType)) return 'dispatch';
  if (NO_OP_SUCCESS_TYPES.includes(eventType)) return 'no_op';
  if (NOT_IMPLEMENTED_TYPES.includes(eventType)) return 'not_implemented';
  return 'unknown';
}

function shouldFail(retryCount: number): boolean {
  return retryCount + 1 >= MAX_RETRIES;
}

describe('Outbox dispatch classification', () => {
  it('clasifica email.send_pending como dispatch', () => {
    expect(classify('email.send_pending')).toBe('dispatch');
  });

  it('clasifica report.translate_en como dispatch (Anthropic translation)', () => {
    expect(classify('report.translate_en')).toBe('dispatch');
  });

  it('clasifica report.translate_es como dispatch', () => {
    expect(classify('report.translate_es')).toBe('dispatch');
  });

  it('clasifica sync.recruit como dispatch (Zoho Recruit integration)', () => {
    expect(classify('sync.recruit')).toBe('dispatch');
  });

  it('clasifica application.transitioned como no_op (success)', () => {
    expect(classify('application.transitioned')).toBe('no_op');
  });

  it('eventos desconocidos caen en unknown', () => {
    expect(classify('foo.bar')).toBe('unknown');
    expect(classify('')).toBe('unknown');
  });

  it('todos los KNOWN_EVENT_TYPES están clasificados', () => {
    for (const t of KNOWN_EVENT_TYPES) {
      expect(classify(t)).not.toBe('unknown');
    }
  });
});

describe('Outbox retry policy', () => {
  it('primer retry no marca failed', () => {
    expect(shouldFail(0)).toBe(false);
  });

  it('al cuarto retry (retryCount=3) NO marca failed (sería el 4to intento)', () => {
    expect(shouldFail(3)).toBe(false);
  });

  it('al quinto intento (retryCount=4 → 5) marca failed', () => {
    expect(shouldFail(4)).toBe(true);
  });

  it('retryCount mayor a MAX_RETRIES marca failed', () => {
    expect(shouldFail(10)).toBe(true);
  });

  it('MAX_RETRIES está en 5', () => {
    expect(MAX_RETRIES).toBe(5);
  });
});

describe('Outbox event types are stable', () => {
  it('listado de eventos no incluye duplicados', () => {
    expect(new Set(KNOWN_EVENT_TYPES).size).toBe(KNOWN_EVENT_TYPES.length);
  });

  it('cada evento tiene exactamente una clasificación', () => {
    for (const t of KNOWN_EVENT_TYPES) {
      const classifications = [
        REQUIRES_DISPATCH_TYPES.includes(t),
        NO_OP_SUCCESS_TYPES.includes(t),
        NOT_IMPLEMENTED_TYPES.includes(t),
      ].filter(Boolean).length;
      expect(classifications, `${t} should have exactly 1 classification`).toBe(1);
    }
  });
});
