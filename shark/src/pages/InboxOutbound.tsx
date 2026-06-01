import { useEffect, useState } from 'react';
import { MOCK_CAMPAIGNS, MOCK_MESSAGES, type OutreachCampaignStatus } from '../data/mockOutreach';
import { useApi, type ApiOutreachCampaign, type ApiOutreachMessage } from '../lib/api';
import { config } from '../config';
import './pages.css';

const STATUS_TAG: Record<OutreachCampaignStatus, string> = {
  active: 'status-active',
  paused: 'status-paused',
  closed: 'status-closed',
  draft: 'status-draft',
};

type ViewCampaign = {
  id: string;
  name: string;
  provider: string;
  status: OutreachCampaignStatus;
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
  contact_company: string | null;
  contact_role: string | null;
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
      contact_company: m.contact_company,
      contact_role: m.contact_role,
      channel: m.channel,
      body: m.body,
      sent_at: m.sent_at,
      read: m.is_read,
      needs_response: m.needs_response,
    }));
}

function adaptMockCampaigns(): ViewCampaign[] {
  return MOCK_CAMPAIGNS.map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    status: c.status,
    invites_sent: c.invites_sent,
    accepted: c.accepted,
    replied: c.replied,
    meeting_booked: c.meeting_booked,
  }));
}

function adaptMockMessages(campaigns: ViewCampaign[]): ViewMessage[] {
  return MOCK_MESSAGES.map((m) => ({
    id: m.id,
    campaign_id: m.campaign_id,
    campaign_name: campaigns.find((c) => c.id === m.campaign_id)?.name,
    contact_name: m.contact_name,
    contact_company: m.contact_company ?? null,
    contact_role: m.contact_role ?? null,
    channel: m.channel,
    body: m.body,
    sent_at: m.sent_at,
    read: m.read,
    needs_response: m.needs_response,
  }));
}

export default function InboxOutbound() {
  const api = useApi();
  const [filter, setFilter] = useState<'all' | 'unread' | 'needs_response'>('needs_response');
  const [campaigns, setCampaigns] = useState<ViewCampaign[]>([]);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [tableReady, setTableReady] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState<boolean>(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      if (!config.useApi) {
        const mockCamps = adaptMockCampaigns();
        if (!cancelled) {
          setCampaigns(mockCamps);
          setMessages(adaptMockMessages(mockCamps));
          setUsingMock(true);
          setLoading(false);
        }
        return;
      }
      try {
        const [campResp, inboxResp] = await Promise.all([
          api.outreach.listCampaigns(),
          api.outreach.listInbox({ filter: 'all' }),
        ]);
        if (cancelled) return;
        if (!campResp.table_ready || !inboxResp.table_ready) {
          const mockCamps = adaptMockCampaigns();
          setCampaigns(mockCamps);
          setMessages(adaptMockMessages(mockCamps));
          setUsingMock(true);
          setTableReady(false);
        } else {
          const liveCamps = adaptCampaigns(campResp.campaigns);
          setCampaigns(liveCamps);
          setMessages(adaptMessages(inboxResp.messages, liveCamps));
          setUsingMock(false);
          setTableReady(true);
        }
      } catch (e) {
        if (cancelled) return;
        const mockCamps = adaptMockCampaigns();
        setCampaigns(mockCamps);
        setMessages(adaptMockMessages(mockCamps));
        setUsingMock(true);
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, reloadTick]);

  async function handleReply(messageId: string) {
    if (usingMock) {
      alert('Mock: la respuesta se enviaría vía HeyReach API cuando la tabla esté lista.');
      return;
    }
    const text = prompt('Tu respuesta:');
    if (!text || !text.trim()) return;
    try {
      await api.outreach.reply(messageId, text.trim());
      setReloadTick((t) => t + 1);
    } catch (e) {
      alert(`Error al responder: ${(e as Error).message}`);
    }
  }

  async function markRead(messageId: string, isRead: boolean) {
    if (usingMock) return;
    try {
      await api.outreach.patchInbox(messageId, { is_read: isRead });
      setReloadTick((t) => t + 1);
    } catch {
      // silencioso, UI volverá al estado server
    }
  }

  const filtered = messages.filter((m) => {
    if (filter === 'unread') return !m.read;
    if (filter === 'needs_response') return m.needs_response;
    return true;
  });

  return (
    <div>
      <h1 className="page-title">Inbox outbound</h1>
      <p className="page-subtitle">
        Respuestas de candidatos vía LinkedIn (HeyReach) y email. Filtrá por las que necesitan tu atención.
      </p>

      {loading && <p className="muted small">Cargando…</p>}
      {error && <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>Aviso: {error}</p>}
      {usingMock && tableReady && (
        <p className="muted-note">Mostrando datos mock (backend devolvió error transitorio).</p>
      )}
      {!tableReady && (
        <p className="muted-note">
          Tablas <code>OutreachCampaigns</code>/<code>OutreachInbox</code> aún no creadas en Catalyst — mostrando mock.
        </p>
      )}

      <h2 className="section-title">Campañas activas</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Campaña</th>
            <th>Provider</th>
            <th>Estado</th>
            <th>Enviadas</th>
            <th>Aceptadas</th>
            <th>Respondieron</th>
            <th>Reuniones</th>
            <th>Tasa respuesta</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="muted">{c.provider}</td>
              <td><span className={`status-tag ${STATUS_TAG[c.status] ?? ''}`}>{c.status}</span></td>
              <td>{c.invites_sent}</td>
              <td>{c.accepted}</td>
              <td>{c.replied}</td>
              <td>{c.meeting_booked}</td>
              <td>{c.invites_sent > 0 ? `${((c.replied / c.invites_sent) * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="page-header-row" style={{ marginTop: '2rem' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Mensajes</h2>
        <div className="phase-tabs" style={{ borderBottom: 'none', padding: 0 }}>
          {(['needs_response', 'unread', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`phase-tab${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'needs_response' ? `Necesitan respuesta (${messages.filter((m) => m.needs_response).length})` :
               f === 'unread' ? `No leídos (${messages.filter((m) => !m.read).length})` :
               `Todos (${messages.length})`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="stub-card">
          <p>Sin mensajes en este filtro.</p>
        </div>
      ) : (
        <div className="inbox-list">
          {filtered.map((m) => (
            <div key={m.id} className={`inbox-msg ${m.needs_response ? 'is-needs-response' : ''} ${!m.read ? 'is-unread' : ''}`}>
              <div className="inbox-msg-header">
                <div>
                  <div className="inbox-msg-name">
                    {m.contact_name}
                    {!m.read && <span className="inbox-msg-unread-dot" />}
                  </div>
                  <div className="inbox-msg-meta">
                    {m.contact_role ?? '—'} {m.contact_company && `· ${m.contact_company}`}
                  </div>
                </div>
                <div className="inbox-msg-channel">
                  <div>{m.channel === 'linkedin_dm' ? 'LinkedIn DM' : 'Email'}</div>
                  <div className="muted small">{m.campaign_name ?? '—'}</div>
                </div>
              </div>
              <p className="inbox-msg-body">{m.body}</p>
              <div className="inbox-msg-footer">
                <span className="muted small">{new Date(m.sent_at).toLocaleString()}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {!m.read && !usingMock && (
                    <button className="btn-toolbar" onClick={() => markRead(m.id, true)}>
                      Marcar leído
                    </button>
                  )}
                  {m.needs_response && (
                    <button className="btn-toolbar" onClick={() => handleReply(m.id)}>
                      Responder →
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted-note">
        {usingMock
          ? '💡 Mock — backend conectará a HeyReach API cuando las tablas estén creadas (ver master plan §22 Outbound Sourcing).'
          : '✅ Conectado al backend. HeyReach pushea respuestas via webhook al inbox interno.'}
      </p>
    </div>
  );
}
