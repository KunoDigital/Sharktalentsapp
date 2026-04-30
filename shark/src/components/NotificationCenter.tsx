import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_DRAFTS } from '../data/mockDrafts';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { MOCK_MESSAGES } from '../data/mockOutreach';
import { MOCK_REPORTS } from '../data/mockReports';
import './notification-center.css';

type Notification = {
  id: string;
  icon: string;
  text: string;
  hint?: string;
  to: string;
  at: string;
  priority: 'warn' | 'good' | 'info';
};

function getNotifications(): Notification[] {
  const items: Notification[] = [];

  MOCK_DRAFTS.filter((d) => d.status === 'draft_generated').forEach((d) => {
    items.push({
      id: `nd-${d.id}`,
      icon: '📋',
      text: `Draft listo para revisar`,
      hint: `${d.client_company} — ${d.draft?.title ?? 'sin título'}`,
      to: `/drafts/${d.id}`,
      at: d.created_at,
      priority: 'warn',
    });
  });

  MOCK_APPLICATIONS.filter((a) => a.bot_decision?.needs_review).forEach((a) => {
    items.push({
      id: `nb-${a.id}`,
      icon: '🤖',
      text: `Bot pide tu decisión`,
      hint: `${a.candidate_name} — confidence ${(a.bot_decision!.confidence * 100).toFixed(0)}%`,
      to: `/candidates/${a.id}`,
      at: a.bot_decision!.decided_at,
      priority: 'warn',
    });
  });

  MOCK_APPLICATIONS.filter((a) => a.state === 'finalist').forEach((a) => {
    items.push({
      id: `nf-${a.id}`,
      icon: '🎯',
      text: `Finalista listo para entrevista`,
      hint: a.candidate_name,
      to: `/candidates/${a.id}`,
      at: a.applied_at,
      priority: 'good',
    });
  });

  MOCK_MESSAGES.filter((m) => m.needs_response).slice(0, 5).forEach((m) => {
    items.push({
      id: `nm-${m.id}`,
      icon: '💬',
      text: `Respuesta sin contestar`,
      hint: `${m.contact_name} — "${m.body.slice(0, 50)}..."`,
      to: '/inbox',
      at: m.sent_at.slice(0, 10),
      priority: 'info',
    });
  });

  Object.values(MOCK_REPORTS).filter((r) => r.client_feedback?.length).forEach((r) => {
    items.push({
      id: `nr-${r.token}`,
      icon: '✉️',
      text: `Cliente respondió feedback`,
      hint: `${r.client_feedback!.length} candidatos clasificados`,
      to: `/report/${r.token}`,
      at: r.client_opened_at?.slice(0, 10) ?? r.published_at,
      priority: 'good',
    });
  });

  // Más recientes primero
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const notifs = getNotifications();
  const count = notifs.length;

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

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="notif-bell"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
      >
        🔔
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-header">
            <span>Notificaciones</span>
            <span className="notif-count">{count}</span>
          </div>
          <div className="notif-list">
            {notifs.length === 0 ? (
              <div className="notif-empty">No hay nada pendiente. ✨</div>
            ) : (
              notifs.map((n) => (
                <Link
                  key={n.id}
                  to={n.to}
                  className={`notif-item notif-priority-${n.priority}`}
                  onClick={() => setOpen(false)}
                >
                  <div className="notif-icon">{n.icon}</div>
                  <div className="notif-body">
                    <div className="notif-text">{n.text}</div>
                    {n.hint && <div className="notif-hint">{n.hint}</div>}
                    <div className="notif-date">{n.at}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
