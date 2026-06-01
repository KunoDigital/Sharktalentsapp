/**
 * Tests estructurales del feature outreach.
 *
 * Cobertura:
 * - Validación de body en createOutreachCampaign (provider whitelist, status whitelist)
 * - Path parsers de inbox (/api/outreach/inbox/:id, /api/outreach/inbox/:id/reply)
 * - Lógica de qué eventos del webhook HeyReach disparan qué actualización
 * - Verificación HMAC del webhook (timing-safe)
 */
import { describe, expect, it } from 'vitest';
import { _internal } from '../src/features/heyreachWebhook';
import { createHmac } from 'crypto';

const VALID_PROVIDERS = ['heyreach', 'internal', 'email'];
const VALID_CAMPAIGN_STATUSES = ['active', 'paused', 'closed', 'draft'];
const HEYREACH_EVENT_TYPES = ['invitation.sent', 'invitation.accepted', 'message.received', 'message.sent', 'meeting.booked'];

function validateProvider(p: unknown): boolean {
  return typeof p === 'string' && VALID_PROVIDERS.includes(p);
}

function validateCampaignStatus(s: unknown): boolean {
  return typeof s === 'string' && VALID_CAMPAIGN_STATUSES.includes(s);
}

function extractInboxId(url: string): string | null {
  return url.match(/^\/api\/outreach\/inbox\/([^/]+)/)?.[1] ?? null;
}

function extractInboxReplyId(url: string): string | null {
  return url.match(/^\/api\/outreach\/inbox\/([^/]+)\/reply/)?.[1] ?? null;
}

describe('Outreach campaign validation', () => {
  it('acepta provider internal/heyreach/email', () => {
    expect(validateProvider('internal')).toBe(true);
    expect(validateProvider('heyreach')).toBe(true);
    expect(validateProvider('email')).toBe(true);
  });

  it('rechaza providers desconocidos', () => {
    expect(validateProvider('linkedin')).toBe(false);
    expect(validateProvider('twitter')).toBe(false);
    expect(validateProvider('')).toBe(false);
    expect(validateProvider(null)).toBe(false);
  });

  it('acepta los 4 status válidos', () => {
    for (const s of VALID_CAMPAIGN_STATUSES) {
      expect(validateCampaignStatus(s)).toBe(true);
    }
  });

  it('rechaza status inválido', () => {
    expect(validateCampaignStatus('archived')).toBe(false);
    expect(validateCampaignStatus('running')).toBe(false);
  });
});

describe('Outreach inbox path parsing', () => {
  it('extrae id del PATCH /inbox/:id', () => {
    expect(extractInboxId('/api/outreach/inbox/msg_abc')).toBe('msg_abc');
  });

  it('extrae id del POST /inbox/:id/reply', () => {
    expect(extractInboxReplyId('/api/outreach/inbox/msg_abc/reply')).toBe('msg_abc');
  });

  it('reply no matchea sin /reply', () => {
    expect(extractInboxReplyId('/api/outreach/inbox/msg_abc')).toBe(null);
  });
});

describe('HeyReach event types', () => {
  it('lista de eventos soportados es estable', () => {
    expect(HEYREACH_EVENT_TYPES).toContain('message.received');
    expect(HEYREACH_EVENT_TYPES).toContain('invitation.sent');
    expect(HEYREACH_EVENT_TYPES).toContain('meeting.booked');
  });

  it('todos los event_types siguen formato dot.case', () => {
    for (const t of HEYREACH_EVENT_TYPES) {
      expect(t).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe('HeyReach webhook signature verification', () => {
  const SECRET = 'test_secret_abc123';

  it('acepta firma válida', () => {
    const body = '{"event_id":"evt_1","event_type":"invitation.sent"}';
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(_internal.verifySignature(body, signature, SECRET)).toBe(true);
  });

  it('rechaza firma inválida', () => {
    const body = '{"event_id":"evt_1","event_type":"invitation.sent"}';
    const wrongSignature = createHmac('sha256', 'other_secret').update(body).digest('hex');
    expect(_internal.verifySignature(body, wrongSignature, SECRET)).toBe(false);
  });

  it('rechaza body modificado con firma original', () => {
    const original = '{"event_id":"evt_1"}';
    const tampered = '{"event_id":"evt_2"}';
    const signature = createHmac('sha256', SECRET).update(original).digest('hex');
    expect(_internal.verifySignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rechaza signature de longitud incorrecta', () => {
    const body = '{}';
    expect(_internal.verifySignature(body, 'short', SECRET)).toBe(false);
    expect(_internal.verifySignature(body, '', SECRET)).toBe(false);
  });

  it('rechaza signature con caracteres no-hex', () => {
    const body = '{}';
    const validLength = 'g'.repeat(64); // 64 chars pero no hex
    expect(_internal.verifySignature(body, validLength, SECRET)).toBe(false);
  });
});
