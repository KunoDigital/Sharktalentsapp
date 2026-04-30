import { useState } from 'react';
import { MOCK_CAMPAIGNS, MOCK_MESSAGES, type OutreachCampaignStatus } from '../data/mockOutreach';
import './pages.css';

const STATUS_TAG: Record<OutreachCampaignStatus, string> = {
  active: 'status-active',
  paused: 'status-paused',
  closed: 'status-closed',
  draft: 'status-draft',
};

export default function InboxOutbound() {
  const [filter, setFilter] = useState<'all' | 'unread' | 'needs_response'>('needs_response');

  const filtered = MOCK_MESSAGES.filter((m) => {
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
          {MOCK_CAMPAIGNS.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="muted">{c.provider}</td>
              <td><span className={`status-tag ${STATUS_TAG[c.status]}`}>{c.status}</span></td>
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
              {f === 'needs_response' ? `Necesitan respuesta (${MOCK_MESSAGES.filter((m) => m.needs_response).length})` :
               f === 'unread' ? `No leídos (${MOCK_MESSAGES.filter((m) => !m.read).length})` :
               `Todos (${MOCK_MESSAGES.length})`}
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
          {filtered.map((m) => {
            const camp = MOCK_CAMPAIGNS.find((c) => c.id === m.campaign_id);
            return (
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
                    <div className="muted small">{camp?.name}</div>
                  </div>
                </div>
                <p className="inbox-msg-body">{m.body}</p>
                <div className="inbox-msg-footer">
                  <span className="muted small">{new Date(m.sent_at).toLocaleString()}</span>
                  {m.needs_response && (
                    <button className="btn-toolbar" onClick={() => alert('Mock: abrir thread y responder')}>
                      Responder →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted-note">
        💡 Mock — backend conectará a HeyReach API para tirar respuestas reales (ver master plan §22 Outbound Sourcing).
      </p>
    </div>
  );
}
