import { describe, expect, it } from 'vitest';
import type { ProcessedEvent } from '../src/lib/processedEvents';

/**
 * Test del shape — verifica que el tipo coincide con el schema en BD.
 * Las queries reales requieren mock del SDK Catalyst que es complejo;
 * acá solo aseguramos que el tipo no se desincronice del schema.
 */
describe('ProcessedEvent type matches BD schema', () => {
  it('tiene los campos esperados (provider + received_at, NO source/processed_at)', () => {
    const sample: ProcessedEvent = {
      ROWID: '123',
      event_id: 'evt_abc',
      provider: 'clerk_webhook',
      received_at: '2026-05-01 12:00:00',
    };

    // TypeScript debe rechazar el typo viejo. Esto es compile-time check via TS.
    expect(sample.provider).toBeDefined();
    expect(sample.received_at).toBeDefined();
    // @ts-expect-error — los campos viejos no deben existir
    expect(sample.source).toBeUndefined();
    // @ts-expect-error
    expect(sample.processed_at).toBeUndefined();
  });
});
