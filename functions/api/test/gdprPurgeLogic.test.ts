/**
 * Tests estructurales de gdpr.ts.
 *
 * Cobertura:
 * - Email regex (mismo patrón que publicRecovery, debe estar en sync)
 * - Lista de stages terminales que califican para purga (debe matchear pipelineStateMachine)
 * - Cutoff de 30 días post-cierre (Doc 20 / Ley Panamá)
 * - Validación de payload de exportCandidateData/deleteCandidateData
 */
import { describe, expect, it } from 'vitest';
import { TERMINAL_STAGES } from '../src/lib/pipelineStateMachine';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PURGE_ELIGIBLE_STAGES = [
  'hired',
  'rejected_by_admin',
  'auto_rejected_low_score',
  'offer_declined',
  'withdrew',
];

const RETENTION_DAYS = 30;

function isOlderThanRetention(completedAtIso: string, nowMs: number = Date.now()): boolean {
  const completedMs = new Date(completedAtIso).getTime();
  if (Number.isNaN(completedMs)) return false;
  return (nowMs - completedMs) > RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function eligibleForPurge(opts: { pipelineStage: string; completedAt: string | null; catalystFileId: string | null; nowMs?: number }): boolean {
  if (!opts.catalystFileId) return false;  // ya purgado
  if (!opts.completedAt) return false;     // todavía activo
  if (!PURGE_ELIGIBLE_STAGES.includes(opts.pipelineStage)) return false;
  return isOlderThanRetention(opts.completedAt, opts.nowMs);
}

describe('gdpr email validation', () => {
  it('acepta emails válidos', () => {
    expect(EMAIL_RE.test('user@example.com')).toBe(true);
    expect(EMAIL_RE.test('a.b+c@example.co.uk')).toBe(true);
  });

  it('rechaza emails sin @', () => {
    expect(EMAIL_RE.test('userexample.com')).toBe(false);
  });

  it('rechaza emails sin punto en dominio', () => {
    expect(EMAIL_RE.test('user@example')).toBe(false);
  });

  it('rechaza espacios', () => {
    expect(EMAIL_RE.test('user @example.com')).toBe(false);
    expect(EMAIL_RE.test('user@example .com')).toBe(false);
  });
});

describe('gdpr purge eligible stages', () => {
  it('los 5 stages terminales son eligibles para purga', () => {
    expect(PURGE_ELIGIBLE_STAGES).toHaveLength(5);
    expect(PURGE_ELIGIBLE_STAGES).toContain('hired');
    expect(PURGE_ELIGIBLE_STAGES).toContain('rejected_by_admin');
    expect(PURGE_ELIGIBLE_STAGES).toContain('auto_rejected_low_score');
    expect(PURGE_ELIGIBLE_STAGES).toContain('offer_declined');
    expect(PURGE_ELIGIBLE_STAGES).toContain('withdrew');
  });

  it('matchea exactamente con TERMINAL_STAGES del state machine', () => {
    expect(new Set(PURGE_ELIGIBLE_STAGES)).toEqual(new Set(TERMINAL_STAGES as readonly string[]));
  });

  it('stages activos NO son eligibles', () => {
    expect(PURGE_ELIGIBLE_STAGES).not.toContain('finalist');
    expect(PURGE_ELIGIBLE_STAGES).not.toContain('interview_scheduled');
    expect(PURGE_ELIGIBLE_STAGES).not.toContain('offered');
  });
});

describe('gdpr retention period (30 días)', () => {
  it('RETENTION_DAYS está fijado en 30 (Doc 20 / Ley Panamá)', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it('completedAt hace 31 días → eligible', () => {
    const now = Date.now();
    const old = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isOlderThanRetention(old, now)).toBe(true);
  });

  it('completedAt hace 29 días → NO eligible', () => {
    const now = Date.now();
    const recent = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
    expect(isOlderThanRetention(recent, now)).toBe(false);
  });

  it('completedAt hace exactamente 30 días → NO eligible (boundary)', () => {
    const now = Date.now();
    const exactly = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isOlderThanRetention(exactly, now)).toBe(false);
  });

  it('completedAt inválido → false (no purgar)', () => {
    expect(isOlderThanRetention('not-a-date')).toBe(false);
  });
});

describe('gdpr eligibleForPurge composición', () => {
  const now = Date.now();
  const old = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

  it('hired + 35 días + file_id → ELIGIBLE', () => {
    expect(eligibleForPurge({
      pipelineStage: 'hired',
      completedAt: old,
      catalystFileId: 'file_abc',
      nowMs: now,
    })).toBe(true);
  });

  it('finalist + 35 días + file_id → NO eligible (stage activo)', () => {
    expect(eligibleForPurge({
      pipelineStage: 'finalist',
      completedAt: old,
      catalystFileId: 'file_abc',
      nowMs: now,
    })).toBe(false);
  });

  it('hired + 5 días + file_id → NO eligible (muy reciente)', () => {
    expect(eligibleForPurge({
      pipelineStage: 'hired',
      completedAt: recent,
      catalystFileId: 'file_abc',
      nowMs: now,
    })).toBe(false);
  });

  it('hired + 35 días + file_id null → NO eligible (ya purgado)', () => {
    expect(eligibleForPurge({
      pipelineStage: 'hired',
      completedAt: old,
      catalystFileId: null,
      nowMs: now,
    })).toBe(false);
  });

  it('hired + completedAt null → NO eligible (todavía activo)', () => {
    expect(eligibleForPurge({
      pipelineStage: 'hired',
      completedAt: null,
      catalystFileId: 'file_abc',
      nowMs: now,
    })).toBe(false);
  });
});

describe('gdpr export/delete payload validation', () => {
  function validateGdprPayload(body: unknown): { ok: boolean; reason?: string } {
    if (typeof body !== 'object' || body === null) return { ok: false, reason: 'not object' };
    const b = body as Record<string, unknown>;
    if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) return { ok: false, reason: 'email required' };
    return { ok: true };
  }

  it('payload con email válido pasa', () => {
    expect(validateGdprPayload({ email: 'user@example.com' }).ok).toBe(true);
  });

  it('payload sin email falla', () => {
    expect(validateGdprPayload({}).ok).toBe(false);
    expect(validateGdprPayload({ email: '' }).ok).toBe(false);
    expect(validateGdprPayload(null).ok).toBe(false);
  });
});
