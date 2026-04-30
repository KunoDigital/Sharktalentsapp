import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_DRAFTS } from '../data/mockDrafts';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { MOCK_MESSAGES } from '../data/mockOutreach';
import { MOCK_REPORTS } from '../data/mockReports';
import { getNotifPrefs, getReadIds, markAsRead, markAllAsRead, type NotifType } from '../lib/notificationPrefs';
import './notification-center.css';

type Notification = {
  id: string;
  type: NotifType;
  icon: string;
  text: string;
  hint?: string;
  to: string;
  at: string;
  priority: 'warn' | 'good' | 'info';
};

function getNotifications(prefs: ReturnType<typeof getNotifPrefs>): Notification[] {
  const items: Notification[] = [];

  if (prefs.drafts) {
    MOCK_DRAFTS.filter((d) => d.status === 'draft_generated').forEach((d) => {
      items.push({
        id: `nd-${d.id}`,
        type: 'drafts',
        icon: '📋',
        text: `Draft listo para revisar`,
        hint: `${d.client_company} — ${d.draft?.title ?? 'sin título'}`,
        to: `/drafts/${d.id}`,
        at: d.created_at,
        priority: 'warn',
      });
    });
  }

  if (prefs.bot_review) {
    MOCK_APPLICATIONS.filter((a) => a.bot_decision?.needs_review).forEach((a) => {
      items.push({
        id: `nb-${a.id}`,
        type: 'bot_review',
        icon: '🤖',
        text: `Bot pide tu decisión`,
        hint: `${a.candidate_name} — confidence ${(a.bot_decision!.confidence * 100).toFixed(0)}%`,
        to: `/candidates/${a.id}`,
        at: a.bot_decision!.decided_at,
        priority: 'warn',
      });
    });
  }

  if (prefs.finalists) {
    MOCK_APPLICATIONS.filter((a) => a.state === 'finalist').forEach((a) => {
      items.push({
        id: `nf-${a.id}`,
        type: 'finalists',
        icon: '🎯',
        text: `Finalista listo para entrevista`,
        hint: a.candidate_name,
        to: `/candidates/${a.id}`,
        at: a.applied_at,
        priority: 'good',
      });
    });
  }

  if (prefs.inbox) {
    MOCK_MESSAGES.filter((m) => m.needs_response).slice(0, 5).forEach((m) => {
      items.push({
        id: `nm-${m.id}`,
        type: 'inbox',
        icon: '💬',
        text: `Respuesta sin contestar`,
        hint: `${m.contact_name} — "${m.body.slice(0, 50)}..."`,
        to: '/inbox',
        at: m.sent_at.slice(0, 10),
        priority: 'info',
      });
    });
  }

  if (prefs.feedback) {
    Object.values(MOCK_REPORTS).filter((r) => r.client_feedback?.length).forEach((r) => {
      items.push({
        id: `nr-${r.token}`,
        type: 'feedback',
        icon: '✉️',
        text: `Cliente respondió feedback`,
        hint: `${r.client_feedback!.length} candidatos clasificados`,
        to: `/report/${r.token}`,
        at: r.client_opened_at?.slice(0, 10) ?? r.published_at,
        priority: 'good',
      });
    });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState(() => getReadIds());
  const ref = useRef<HTMLDivElement | null>(null);

  const prefs = getNotifPrefs();
  const allNotifs = getNotifications(prefs);
  const unreadCount = allNotifs.filter((n) => !readIds.has(n.id)).length;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [open]);

  function handleClick(id: string) {
    markAsRead(id);
    setReadIds(getReadIds());
    setOpen(false);
  }

  function handleMarkAll() {
    markAllAsRead(allNotifs.map((n) => n.id));
    setReadIds(getReadIds());
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="notif-bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ''}`}
      >
        🔔
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notificaciones">
          <div className="notif-header">
            <span>Notificaciones</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {unreadCount > 0 && (
                <button className="notif-mark-all" onClick={handleMarkAll}>
                  Marcar todas
                </button>
              )}
              <span className="notif-count">{allNotifs.length}</span>
            </div>
          </div>
          <div className="notif-list">
            {allNotifs.length === 0 ? (
              <div className="notif-empty">No hay nada pendiente. ✨</div>
            ) : (
              allNotifs.map((n) => {
                const isRead = readIds.has(n.id);
                return (
                  <Link
                    key={n.id}
                    to={n.to}
                    className={`notif-item notif-priority-${n.priority} ${isRead ? 'is-read' : ''}`}
                    onClick={() => handleClick(n.id)}
                  >
                    <div className="notif-icon" aria-hidden="true">{n.icon}</div>
                    <div className="notif-body">
                      <div className="notif-text">{n.text}</div>
                      {n.hint && <div className="notif-hint">{n.hint}</div>}
                      <div className="notif-date">{n.at}</div>
                    </div>
                    {!isRead && <div className="notif-unread-dot" aria-label="No leída" />}
                  </Link>
                );
              })
            )}
          </div>
          <div className="notif-footer">
            <Link to="/settings" onClick={() => setOpen(false)}>
              Configurar notificaciones →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
