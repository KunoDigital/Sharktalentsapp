/**
 * Tests del lib/portalTracker — fire-and-forget event tracking del portal cliente.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    apiBase: 'http://localhost:3002',
    useApi: true,
    clerkPublishableKey: 'pk_test_xxx',
    appBaseUrl: 'http://localhost:3000',
  },
}));

import { trackPortalEvent, _resetForTests } from '../src/lib/portalTracker';

describe('portalTracker', () => {
  beforeEach(() => {
    _resetForTests();
    vi.restoreAllMocks();
  });

  it('no llama fetch si token vacío', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    trackPortalEvent('', { event_type: 'portal.opened' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dedupe: mismo dedupeKey solo manda 1 vez por sesión', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeaconMock,
      writable: true,
      configurable: true,
    });

    trackPortalEvent('token123', { event_type: 'portal.opened' }, 'open:token123');
    trackPortalEvent('token123', { event_type: 'portal.opened' }, 'open:token123');
    trackPortalEvent('token123', { event_type: 'portal.opened' }, 'open:token123');

    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
  });

  it('dedupe keys distintas → manda múltiples', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeaconMock,
      writable: true,
      configurable: true,
    });

    trackPortalEvent('token', { event_type: 'portal.opened' }, 'opened:token');
    trackPortalEvent('token', { event_type: 'portal.job_viewed', job_id: 'job_1' }, 'viewed:token:job_1');
    trackPortalEvent('token', { event_type: 'portal.job_viewed', job_id: 'job_2' }, 'viewed:token:job_2');

    expect(sendBeaconMock).toHaveBeenCalledTimes(3);
  });

  it('fallback a fetch si sendBeacon devuelve false', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(false),
      writable: true,
      configurable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    trackPortalEvent('token', { event_type: 'portal.opened' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/portal/token/track'),
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });

  it('sin dedupeKey → cada call manda', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeaconMock,
      writable: true,
      configurable: true,
    });

    trackPortalEvent('token', { event_type: 'portal.opened' });
    trackPortalEvent('token', { event_type: 'portal.opened' });

    expect(sendBeaconMock).toHaveBeenCalledTimes(2);
  });
});
