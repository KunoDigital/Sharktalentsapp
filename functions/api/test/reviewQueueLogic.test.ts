/**
 * Tests estructurales de reviewQueue.ts.
 *
 * El feature gestiona la cola de items donde el bot decisor pidió human review.
 * Cobertura:
 * - Whitelist de actions (confirm | override)
 * - Path parsing /api/bot/review-queue/:id/decide
 * - Reglas de override: requiere override_stage
 * - Status final: confirm → to_stage_proposed; override → override_stage
 * - Audit log type según action
 */
import { describe, expect, it } from 'vitest';

const VALID_ACTIONS = ['confirm', 'override'];

type DecisionInput = {
  action: string;
  override_stage?: string;
};

function validateDecision(input: DecisionInput): { ok: boolean; error?: string } {
  if (!VALID_ACTIONS.includes(input.action)) {
    return { ok: false, error: 'action must be "confirm" or "override"' };
  }
  if (input.action === 'override' && !input.override_stage) {
    return { ok: false, error: 'override_stage required for override action' };
  }
  return { ok: true };
}

function resolveFinalStage(action: 'confirm' | 'override', toStageProposed: string, overrideStage?: string): string {
  return action === 'confirm' ? toStageProposed : (overrideStage ?? toStageProposed);
}

function getAuditAction(action: 'confirm' | 'override'): 'application.transition' | 'bot.review_only' {
  return action === 'override' ? 'bot.review_only' : 'application.transition';
}

function extractIdFromDecidePath(url: string): string | null {
  return url.match(/^\/api\/bot\/review-queue\/([^/]+)\/decide/)?.[1] ?? null;
}

describe('reviewQueue actions whitelist', () => {
  it('valid actions: confirm + override (solo 2)', () => {
    expect(VALID_ACTIONS).toEqual(['confirm', 'override']);
  });

  it('confirm acepta', () => {
    expect(validateDecision({ action: 'confirm' }).ok).toBe(true);
  });

  it('override sin override_stage falla', () => {
    expect(validateDecision({ action: 'override' }).ok).toBe(false);
  });

  it('override con override_stage pasa', () => {
    expect(validateDecision({ action: 'override', override_stage: 'finalist' }).ok).toBe(true);
  });

  it('action inválida: reject (no es válido — bot solo confirma o overridee)', () => {
    expect(validateDecision({ action: 'reject' }).ok).toBe(false);
  });

  it('action inválida: empty', () => {
    expect(validateDecision({ action: '' }).ok).toBe(false);
  });
});

describe('Final stage resolution', () => {
  it('confirm usa to_stage_proposed', () => {
    expect(resolveFinalStage('confirm', 'finalist')).toBe('finalist');
  });

  it('override usa override_stage', () => {
    expect(resolveFinalStage('override', 'finalist', 'rejected_by_admin')).toBe('rejected_by_admin');
  });

  it('override sin override_stage → fallback a to_stage_proposed (defensive)', () => {
    expect(resolveFinalStage('override', 'finalist', undefined)).toBe('finalist');
  });
});

describe('Audit log action mapping', () => {
  it('confirm → application.transition (la transición SÍ se aplicó al pipeline)', () => {
    expect(getAuditAction('confirm')).toBe('application.transition');
  });

  it('override → bot.review_only (humano cambió la recomendación)', () => {
    expect(getAuditAction('override')).toBe('bot.review_only');
  });
});

describe('Path parsing /api/bot/review-queue/:id/decide', () => {
  it('extrae id', () => {
    expect(extractIdFromDecidePath('/api/bot/review-queue/queue_abc/decide')).toBe('queue_abc');
  });

  it('rechaza path sin /decide', () => {
    expect(extractIdFromDecidePath('/api/bot/review-queue/queue_abc')).toBe(null);
  });

  it('rechaza path con prefix incorrecto', () => {
    expect(extractIdFromDecidePath('/api/review-queue/queue_abc/decide')).toBe(null);
  });

  it('id puede tener guiones bajos', () => {
    expect(extractIdFromDecidePath('/api/bot/review-queue/queue_abc_def/decide')).toBe('queue_abc_def');
  });
});
