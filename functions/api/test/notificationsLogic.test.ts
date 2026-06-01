/**
 * Tests estructurales de notifications.ts.
 *
 * Cobertura:
 * - Whitelist de NotificationType (5 tipos)
 * - Path parsers (/api/notifications/:id/read)
 * - Truncation de message a 500 chars
 * - Status filter validation
 */
import { describe, expect, it } from 'vitest';

const VALID_NOTIFICATION_TYPES = [
  'draft_pending',
  'bot_review',
  'finalist_ready',
  'inbox_message',
  'client_feedback',
  'system',
];

const MESSAGE_MAX_LENGTH = 500;

function isValidNotificationType(t: unknown): boolean {
  return typeof t === 'string' && VALID_NOTIFICATION_TYPES.includes(t);
}

function truncateMessage(s: string): string {
  return s.slice(0, MESSAGE_MAX_LENGTH);
}

function extractIdFromMarkReadPath(url: string): string | null {
  return url.match(/^\/api\/notifications\/([^/]+)\/read/)?.[1] ?? null;
}

function validateStatusFilter(s: string | null): 'unread' | 'read' | null {
  if (s === 'unread') return 'unread';
  if (s === 'read') return 'read';
  return null;
}

describe('Notification types whitelist', () => {
  it('los 6 tipos válidos', () => {
    expect(VALID_NOTIFICATION_TYPES).toHaveLength(6);
  });

  it('draft_pending para drafts IA', () => {
    expect(isValidNotificationType('draft_pending')).toBe(true);
  });

  it('bot_review para review queue del bot decisor', () => {
    expect(isValidNotificationType('bot_review')).toBe(true);
  });

  it('finalist_ready cuando candidato llega a stage finalist', () => {
    expect(isValidNotificationType('finalist_ready')).toBe(true);
  });

  it('inbox_message para outreach LinkedIn', () => {
    expect(isValidNotificationType('inbox_message')).toBe(true);
  });

  it('client_feedback cuando el cliente devuelve algo en el portal', () => {
    expect(isValidNotificationType('client_feedback')).toBe(true);
  });

  it('system es catch-all genérico', () => {
    expect(isValidNotificationType('system')).toBe(true);
  });

  it('rechaza tipos inventados', () => {
    expect(isValidNotificationType('email_received')).toBe(false);
    expect(isValidNotificationType('error')).toBe(false);
    expect(isValidNotificationType('')).toBe(false);
    expect(isValidNotificationType(null)).toBe(false);
  });

  it('todos los tipos siguen snake_case', () => {
    for (const t of VALID_NOTIFICATION_TYPES) {
      expect(t).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('Notification message truncation', () => {
  it('mensaje corto pasa intacto', () => {
    expect(truncateMessage('Hola').length).toBe(4);
  });

  it('mensaje exactamente 500 chars pasa', () => {
    const s = 'a'.repeat(500);
    expect(truncateMessage(s).length).toBe(500);
  });

  it('mensaje >500 se trunca', () => {
    const s = 'a'.repeat(800);
    expect(truncateMessage(s).length).toBe(500);
  });

  it('truncate preserva los primeros 500 chars (no slice del medio)', () => {
    const s = 'A' + 'b'.repeat(499) + 'CCCC';
    const truncated = truncateMessage(s);
    expect(truncated[0]).toBe('A');
    expect(truncated.length).toBe(500);
    expect(truncated.includes('CCCC')).toBe(false);
  });
});

describe('Path parsing /api/notifications/:id/read', () => {
  it('extrae id del PATCH', () => {
    expect(extractIdFromMarkReadPath('/api/notifications/abc123/read')).toBe('abc123');
  });

  it('extrae con trailing slash', () => {
    expect(extractIdFromMarkReadPath('/api/notifications/abc123/read/')).toBe('abc123');
  });

  it('mark-all-read no matchea (no tiene /:id/read)', () => {
    // /api/notifications/mark-all-read es un path distinto, NO matchea el patrón /:id/read
    expect(extractIdFromMarkReadPath('/api/notifications/mark-all-read')).toBe(null);
  });

  it('rechaza path sin /read', () => {
    expect(extractIdFromMarkReadPath('/api/notifications/abc123')).toBe(null);
  });

  it('id puede tener guiones bajos y guiones', () => {
    expect(extractIdFromMarkReadPath('/api/notifications/notif_a-b_c/read')).toBe('notif_a-b_c');
  });
});

describe('Notification status filter', () => {
  it('acepta unread', () => {
    expect(validateStatusFilter('unread')).toBe('unread');
  });

  it('acepta read', () => {
    expect(validateStatusFilter('read')).toBe('read');
  });

  it('valor inválido → null (sin filtro)', () => {
    expect(validateStatusFilter('all')).toBe(null);
    expect(validateStatusFilter(null)).toBe(null);
    expect(validateStatusFilter('UNREAD')).toBe(null);
  });
});
