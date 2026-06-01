/**
 * Tests del frontend errorTracker (Sentry envelope sin SDK).
 *
 * No mockeamos fetch real al envelope (fire-and-forget). Solo testeamos
 * que las funciones existen y son callable.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    apiBase: 'http://localhost:3002',
    useApi: false,
    clerkPublishableKey: 'pk_test',
    appBaseUrl: 'http://localhost:3000',
  },
}));

import { reportError, initErrorTracker } from '../src/lib/errorTracker';

describe('errorTracker exports', () => {
  it('reportError es función', () => {
    expect(typeof reportError).toBe('function');
  });

  it('initErrorTracker es función', () => {
    expect(typeof initErrorTracker).toBe('function');
  });

  it('reportError no-op si DSN no configurado (no throw)', () => {
    // Sin VITE_SENTRY_DSN, el cachedDsn es null y reportError es no-op silencioso.
    expect(() => reportError(new Error('test'), { route: '/test' })).not.toThrow();
  });

  it('reportError acepta non-Error y lo wrappea', () => {
    expect(() => reportError('string error', { route: '/test' })).not.toThrow();
    expect(() => reportError({ code: 'foo' }, {})).not.toThrow();
  });

  it('reportError con context vacío no rompe', () => {
    expect(() => reportError(new Error('x'))).not.toThrow();
  });

  it('initErrorTracker es idempotente (no rompe llamarlo 2x)', () => {
    expect(() => {
      initErrorTracker();
      initErrorTracker();
    }).not.toThrow();
  });
});
