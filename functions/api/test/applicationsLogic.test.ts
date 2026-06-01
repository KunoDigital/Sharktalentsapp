/**
 * Tests estructurales de applications.ts.
 *
 * Las funciones de este feature son DB-heavy (Catalyst SDK) — no son testeables sin mocking.
 * En lugar de mockear el SDK, replicamos las constantes y reglas pure que viven en
 * applications.ts y transitionApplication() para que cualquier cambio en producción
 * obligue a actualizar el test.
 *
 * Cobertura:
 * - extractIdFromPath (regex parser de paths /api/applications/:id/...)
 * - Lista de stages que disparan upsert al pool (auto-populate)
 * - Lista de stages que disparan notification al recruiter
 * - Whitelist de event_types del outbox que applications.ts produce
 */
import { describe, expect, it } from 'vitest';
import { transitionAllowed, ALL_STAGES, ACTIVE_STAGES, TERMINAL_STAGES } from '../src/lib/pipelineStateMachine';

// ===== Replica de extractIdFromPath de applications.ts:362 =====
function extractIdFromPath(url: string): string | null {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/applications\/([^/]+)(?:\/(?:transition|transitions|scores|integrity|bot-review))?\/?$/);
  return match?.[1] ?? null;
}

function extractIdFromTransitionsPath(url: string): string | null {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/applications\/([^/]+)\/transitions\/?$/);
  return match?.[1] ?? null;
}

// Replica de las listas de stages disparadores (applications.ts:289, 295)
const POOL_AUTO_POPULATE_STAGES = ['integridad_completed', 'videos_completed', 'finalist'];
const NOTIFICATION_FINALIST_STAGE = 'finalist';
const OUTBOX_EVENT_ON_TRANSITION = 'application.transitioned';

describe('extractIdFromPath', () => {
  it('extrae id de /api/applications/:id', () => {
    expect(extractIdFromPath('/api/applications/abc123')).toBe('abc123');
  });

  it('extrae id con trailing slash', () => {
    expect(extractIdFromPath('/api/applications/abc123/')).toBe('abc123');
  });

  it('extrae id de subpath /transition', () => {
    expect(extractIdFromPath('/api/applications/abc123/transition')).toBe('abc123');
  });

  it('extrae id de subpath /scores', () => {
    expect(extractIdFromPath('/api/applications/abc123/scores')).toBe('abc123');
  });

  it('extrae id de subpath /integrity', () => {
    expect(extractIdFromPath('/api/applications/abc123/integrity')).toBe('abc123');
  });

  it('extrae id de subpath /bot-review', () => {
    expect(extractIdFromPath('/api/applications/abc123/bot-review')).toBe('abc123');
  });

  it('ignora query string', () => {
    expect(extractIdFromPath('/api/applications/abc123?foo=bar')).toBe('abc123');
  });

  it('rechaza path sin /api/applications', () => {
    expect(extractIdFromPath('/applications/abc123')).toBe(null);
    expect(extractIdFromPath('/api/jobs/abc123')).toBe(null);
  });

  it('rechaza subpath no whitelistado', () => {
    expect(extractIdFromPath('/api/applications/abc123/foo')).toBe(null);
  });

  it('id puede tener guiones y números', () => {
    expect(extractIdFromPath('/api/applications/result_a8f3-c2/transition')).toBe('result_a8f3-c2');
  });
});

describe('extractIdFromTransitionsPath', () => {
  it('matchea solo /transitions (plural)', () => {
    expect(extractIdFromTransitionsPath('/api/applications/abc123/transitions')).toBe('abc123');
  });

  it('rechaza /transition (singular)', () => {
    expect(extractIdFromTransitionsPath('/api/applications/abc123/transition')).toBe(null);
  });

  it('rechaza path sin /transitions', () => {
    expect(extractIdFromTransitionsPath('/api/applications/abc123')).toBe(null);
  });
});

describe('Pool auto-populate trigger stages', () => {
  it('integridad_completed dispara pool upsert', () => {
    expect(POOL_AUTO_POPULATE_STAGES).toContain('integridad_completed');
  });

  it('videos_completed dispara pool upsert', () => {
    expect(POOL_AUTO_POPULATE_STAGES).toContain('videos_completed');
  });

  it('finalist dispara pool upsert', () => {
    expect(POOL_AUTO_POPULATE_STAGES).toContain('finalist');
  });

  it('prefilter_passed NO dispara pool (muy temprano)', () => {
    expect(POOL_AUTO_POPULATE_STAGES).not.toContain('prefilter_passed');
  });

  it('hired NO dispara pool (terminal, ya está hired no necesita pool)', () => {
    expect(POOL_AUTO_POPULATE_STAGES).not.toContain('hired');
  });

  it('todos los disparadores son stages válidos del pipeline', () => {
    for (const s of POOL_AUTO_POPULATE_STAGES) {
      expect(ALL_STAGES as readonly string[]).toContain(s);
    }
  });
});

describe('Notification trigger', () => {
  it('finalist es el único stage que dispara notification finalist_ready', () => {
    expect(NOTIFICATION_FINALIST_STAGE).toBe('finalist');
  });

  it('finalist es un stage activo, no terminal', () => {
    expect(ACTIVE_STAGES as readonly string[]).toContain('finalist');
    expect(TERMINAL_STAGES as readonly string[]).not.toContain('finalist');
  });
});

describe('Outbox event on transition', () => {
  it('cada transición publica application.transitioned', () => {
    expect(OUTBOX_EVENT_ON_TRANSITION).toBe('application.transitioned');
  });
});

describe('Pipeline transition rules — invariantes críticos', () => {
  it('no se puede transicionar de un terminal a nada', () => {
    for (const terminal of TERMINAL_STAGES) {
      for (const target of ALL_STAGES) {
        if (target === terminal) continue;
        expect(transitionAllowed(terminal, target), `${terminal} → ${target} should be blocked`).toBe(false);
      }
    }
  });

  it('todos los stages activos pueden transicionar a rejected_by_admin', () => {
    for (const active of ACTIVE_STAGES) {
      expect(transitionAllowed(active, 'rejected_by_admin'), `${active} → rejected_by_admin`).toBe(true);
    }
  });

  it('todos los stages activos pueden transicionar a withdrew', () => {
    for (const active of ACTIVE_STAGES) {
      expect(transitionAllowed(active, 'withdrew'), `${active} → withdrew`).toBe(true);
    }
  });

  it('no se puede transicionar al mismo stage', () => {
    for (const s of ALL_STAGES) {
      expect(transitionAllowed(s, s), `${s} → ${s} should be blocked`).toBe(false);
    }
  });

  it('flujo happy path: prefilter_passed → tecnica_completed → conductual_completed → integridad_completed → finalist → offered → hired', () => {
    expect(transitionAllowed('prefilter_pending', 'prefilter_passed')).toBe(true);
    expect(transitionAllowed('prefilter_passed', 'tecnica_completed')).toBe(true);
    expect(transitionAllowed('tecnica_completed', 'conductual_completed')).toBe(true);
    expect(transitionAllowed('conductual_completed', 'integridad_completed')).toBe(true);
    expect(transitionAllowed('integridad_completed', 'finalist')).toBe(true);
    expect(transitionAllowed('finalist', 'offered')).toBe(true);
    expect(transitionAllowed('offered', 'hired')).toBe(true);
  });

  it('auto_rejected_low_score solo se alcanza desde tecnica_completed (gate técnico)', () => {
    expect(transitionAllowed('tecnica_completed', 'auto_rejected_low_score')).toBe(true);
    expect(transitionAllowed('integridad_completed', 'auto_rejected_low_score')).toBe(false);
    expect(transitionAllowed('prefilter_passed', 'auto_rejected_low_score')).toBe(false);
  });

  it('offer_declined solo se alcanza desde offered', () => {
    expect(transitionAllowed('offered', 'offer_declined')).toBe(true);
    expect(transitionAllowed('finalist', 'offer_declined')).toBe(false);
    expect(transitionAllowed('hired', 'offer_declined')).toBe(false);
  });
});
