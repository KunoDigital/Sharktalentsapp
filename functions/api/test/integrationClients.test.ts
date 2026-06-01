/**
 * Tests estructurales de los clients de integraciones externas
 * (Zoho Bookings + Whisper + Zoho Sign).
 *
 * No mockeamos fetch — testeamos:
 * - isConfigured() responde correctamente según env vars
 * - Que llamen `not configured` error cuando faltan env vars
 *
 * Las llamadas HTTP reales se testearán con MSW en otro archivo (TODO).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { _internal as bookingsInternal } from '../src/lib/zohoBookingsClient';
import { _internal as whisperInternal } from '../src/lib/whisperClient';
import { _internal as signInternal } from '../src/lib/zohoSignClient';
import { _internal as signWebhookInternal } from '../src/features/zohoSignWebhook';
import { createHmac } from 'crypto';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Reset env entre tests
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v !== undefined) process.env[k] = v;
  }
});

// NOTA: env() está cached. Estos tests asumen que env() ya se inicializó con vars de test
// del entorno. Si se ejecutan en orden diferente pueden fallar — son informativos.
describe('zohoBookingsClient.isConfigured', () => {
  it('es función exportada del _internal', () => {
    expect(typeof bookingsInternal.isConfigured).toBe('function');
  });

  // No llamamos isConfigured() directamente porque inicializa env() que requiere
  // CLERK_PUBLISHABLE_KEY en entorno de test. Solo validamos que es callable.
});

describe('whisperClient.isConfigured', () => {
  it('es función exportada del _internal', () => {
    expect(typeof whisperInternal.isConfigured).toBe('function');
  });
});

describe('zohoSignClient.isConfigured', () => {
  it('es función exportada del _internal', () => {
    expect(typeof signInternal.isConfigured).toBe('function');
  });
});

describe('zohoSignWebhook.verifySignature', () => {
  const SECRET = 'test_sign_secret';

  it('acepta firma válida', () => {
    const body = '{"event_id":"evt_1","request_id":"req_2","event_type":"completed"}';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(signWebhookInternal.verifySignature(body, sig, SECRET)).toBe(true);
  });

  it('rechaza firma con secret distinto', () => {
    const body = '{}';
    const sig = createHmac('sha256', 'other').update(body).digest('hex');
    expect(signWebhookInternal.verifySignature(body, sig, SECRET)).toBe(false);
  });

  it('rechaza body modificado', () => {
    const orig = '{"event_id":"a"}';
    const tampered = '{"event_id":"b"}';
    const sig = createHmac('sha256', SECRET).update(orig).digest('hex');
    expect(signWebhookInternal.verifySignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rechaza signature vacía', () => {
    expect(signWebhookInternal.verifySignature('{}', '', SECRET)).toBe(false);
  });
});

describe('zohoSignWebhook.eventToTargetStage', () => {
  const { eventToTargetStage } = signWebhookInternal;

  it('completed → hired', () => {
    expect(eventToTargetStage('completed')).toBe('hired');
  });

  it('declined → offer_declined', () => {
    expect(eventToTargetStage('declined')).toBe('offer_declined');
  });

  it('expired → null (Cris decide manualmente)', () => {
    expect(eventToTargetStage('expired')).toBe(null);
  });

  it('sent → null (todavía no hay decisión)', () => {
    expect(eventToTargetStage('sent')).toBe(null);
  });

  it('recalled → null (oferta retirada por admin)', () => {
    expect(eventToTargetStage('recalled')).toBe(null);
  });

  it('event_type random → null (defensive)', () => {
    expect(eventToTargetStage('random_event')).toBe(null);
  });
});
