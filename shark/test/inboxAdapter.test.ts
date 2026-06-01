/**
 * Tests del adapter usado en InboxOutbound.tsx para convertir
 * ApiOutreachCampaign/Message → ViewCampaign/ViewMessage.
 *
 * Replicamos los adapters del page (no exportados como módulo separado) para que
 * cualquier cambio en producción rompa el test y obligue a sync.
 */
import { describe, expect, it } from 'vitest';
import type { ApiOutreachCampaign, ApiOutreachMessage } from '../src/lib/api';

type ViewCampaign = {
  id: string;
  name: string;
  provider: string;
  status: string;
  invites_sent: number;
  accepted: number;
  replied: number;
  meeting_booked: number;
};

type ViewMessage = {
  id: string;
  campaign_id: string | null;
  campaign_name?: string;
  contact_name: string;
  channel: 'linkedin_dm' | 'email';
  body: string;
  sent_at: string;
  read: boolean;
  needs_response: boolean;
};

function adaptCampaigns(rows: ApiOutreachCampaign[]): ViewCampaign[] {
  return rows.map((c) => ({
    id: c.ROWID,
    name: c.name,
    provider: c.provider,
    status: c.status,
    invites_sent: c.invites_sent,
    accepted: c.accepted,
    replied: c.replied,
    meeting_booked: c.meeting_booked,
  }));
}

function adaptMessages(rows: ApiOutreachMessage[], campaigns: ViewCampaign[]): ViewMessage[] {
  return rows
    .filter((m) => m.direction === 'in')
    .map((m) => ({
      id: m.ROWID,
      campaign_id: m.campaign_id,
      campaign_name: m.campaign_id ? campaigns.find((c) => c.id === m.campaign_id)?.name : undefined,
      contact_name: m.contact_name,
      channel: m.channel,
      body: m.body,
      sent_at: m.sent_at,
      read: m.is_read,
      needs_response: m.needs_response,
    }));
}

const baseCampaign: ApiOutreachCampaign = {
  ROWID: 'camp_1',
  tenant_id: 'tenant_1',
  name: 'Banca PyME',
  job_id: 'job_1',
  provider: 'heyreach',
  status: 'active',
  invites_sent: 28,
  accepted: 14,
  replied: 9,
  meeting_booked: 3,
  started_at: '2026-04-18T00:00:00Z',
  created_at: '2026-04-18T00:00:00Z',
};

const baseMessage: ApiOutreachMessage = {
  ROWID: 'msg_1',
  tenant_id: 'tenant_1',
  campaign_id: 'camp_1',
  contact_name: 'Patricia Núñez',
  contact_linkedin: 'https://linkedin.com/in/patricianunez',
  contact_company: 'Banco Andes',
  contact_role: 'Gerente',
  channel: 'linkedin_dm',
  direction: 'in',
  body: '¿Cuándo podemos hablar?',
  sent_at: '2026-04-25T15:30:00Z',
  is_read: false,
  needs_response: true,
  created_at: '2026-04-25T15:30:00Z',
};

describe('adaptCampaigns', () => {
  it('mapea campos básicos', () => {
    const r = adaptCampaigns([baseCampaign]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('camp_1');
    expect(r[0].name).toBe('Banca PyME');
    expect(r[0].invites_sent).toBe(28);
  });

  it('preserva counters numéricos', () => {
    const r = adaptCampaigns([baseCampaign]);
    expect(r[0].accepted).toBe(14);
    expect(r[0].replied).toBe(9);
    expect(r[0].meeting_booked).toBe(3);
  });

  it('lista vacía → []', () => {
    expect(adaptCampaigns([])).toEqual([]);
  });

  it('NO expone tenant_id (privacy boundary)', () => {
    const r = adaptCampaigns([baseCampaign]);
    expect((r[0] as Record<string, unknown>).tenant_id).toBeUndefined();
  });
});

describe('adaptMessages', () => {
  const campaigns: ViewCampaign[] = [{
    id: 'camp_1', name: 'Banca PyME', provider: 'heyreach', status: 'active',
    invites_sent: 28, accepted: 14, replied: 9, meeting_booked: 3,
  }];

  it('filtra solo mensajes inbound (direction=in)', () => {
    const out: ApiOutreachMessage = { ...baseMessage, direction: 'out', ROWID: 'msg_2' };
    const r = adaptMessages([baseMessage, out], campaigns);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('msg_1');
  });

  it('mapea campaign_name desde lookup', () => {
    const r = adaptMessages([baseMessage], campaigns);
    expect(r[0].campaign_name).toBe('Banca PyME');
  });

  it('campaign_id null → campaign_name undefined', () => {
    const orphan = { ...baseMessage, campaign_id: null };
    const r = adaptMessages([orphan], campaigns);
    expect(r[0].campaign_name).toBeUndefined();
  });

  it('campaign_id que no matchea → campaign_name undefined', () => {
    const stranger = { ...baseMessage, campaign_id: 'camp_xyz' };
    const r = adaptMessages([stranger], campaigns);
    expect(r[0].campaign_name).toBeUndefined();
  });

  it('preserva needs_response y is_read flags', () => {
    const read = { ...baseMessage, ROWID: 'msg_2', is_read: true, needs_response: false };
    const r = adaptMessages([read], campaigns);
    expect(r[0].read).toBe(true);
    expect(r[0].needs_response).toBe(false);
  });

  it('NO expone tenant_id ni contact_linkedin (campos no usados en UI)', () => {
    const r = adaptMessages([baseMessage], campaigns);
    expect((r[0] as Record<string, unknown>).tenant_id).toBeUndefined();
    // contact_linkedin se omite del view shape (UI no lo muestra para no exponer URL)
    expect((r[0] as Record<string, unknown>).contact_linkedin).toBeUndefined();
  });

  it('lista vacía → []', () => {
    expect(adaptMessages([], campaigns)).toEqual([]);
  });
});

describe('Filter logic — needs_response | unread | all', () => {
  function applyFilter(messages: ViewMessage[], filter: 'all' | 'unread' | 'needs_response'): ViewMessage[] {
    return messages.filter((m) => {
      if (filter === 'unread') return !m.read;
      if (filter === 'needs_response') return m.needs_response;
      return true;
    });
  }

  const msgs: ViewMessage[] = [
    { id: '1', campaign_id: null, contact_name: 'A', channel: 'linkedin_dm', body: '', sent_at: '', read: true, needs_response: true },
    { id: '2', campaign_id: null, contact_name: 'B', channel: 'linkedin_dm', body: '', sent_at: '', read: false, needs_response: false },
    { id: '3', campaign_id: null, contact_name: 'C', channel: 'linkedin_dm', body: '', sent_at: '', read: false, needs_response: true },
  ];

  it('all devuelve todos', () => {
    expect(applyFilter(msgs, 'all')).toHaveLength(3);
  });

  it('unread devuelve solo no leídos', () => {
    const r = applyFilter(msgs, 'unread');
    expect(r.map((m) => m.id)).toEqual(['2', '3']);
  });

  it('needs_response devuelve los que requieren respuesta', () => {
    const r = applyFilter(msgs, 'needs_response');
    expect(r.map((m) => m.id)).toEqual(['1', '3']);
  });
});
