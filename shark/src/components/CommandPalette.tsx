import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOCK_JOBS } from '../data/mockJobs';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { MOCK_DRAFTS } from '../data/mockDrafts';
import { useApi } from '../lib/api';
import { config } from '../config';
import './command-palette.css';

type Command = {
  id: string;
  type: 'page' | 'job' | 'candidate' | 'draft' | 'action';
  label: string;
  hint?: string;
  to?: string;
  action?: () => void;
};

const STATIC_PAGES: Command[] = [
  { id: 'p-dash', type: 'page', label: 'Dashboard', to: '/' },
  { id: 'p-leads', type: 'page', label: 'Leads marketing', hint: 'Clientes potenciales del funnel', to: '/marketing/leads' },
  { id: 'p-drafts', type: 'page', label: 'Drafts pendientes', hint: 'Borradores post-reunión', to: '/drafts' },
  { id: 'p-reports', type: 'page', label: 'Reportes enviados', hint: 'Reportes a clientes', to: '/reports' },
  { id: 'p-jobs', type: 'page', label: 'Puestos', hint: 'Lista de puestos activos', to: '/jobs' },
  { id: 'p-cands', type: 'page', label: 'Embudo (candidatos)', hint: 'Vista cross-job', to: '/candidates' },
  { id: 'p-bot', type: 'page', label: 'Bot review queue', hint: 'Decisiones pendientes', to: '/bot/review' },
  { id: 'p-inbox', type: 'page', label: 'Inbox outbound', hint: 'Mensajes LinkedIn / email', to: '/inbox' },
  { id: 'p-alerts', type: 'page', label: 'Alertas', hint: 'Notificaciones del sistema', to: '/alerts' },
  { id: 'p-settings', type: 'page', label: 'Settings', hint: 'Integraciones, API keys, equipo', to: '/settings' },
];

type LiveCandidateResult = { id: string; name: string; email: string };
type LiveJobResult = { id: string; title: string; company: string };
type LiveDraftResult = { id: string; clientCompany: string; clientName: string; status: string };

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [liveCandidates, setLiveCandidates] = useState<LiveCandidateResult[]>([]);
  const [liveJobs, setLiveJobs] = useState<LiveJobResult[]>([]);
  const [liveDrafts, setLiveDrafts] = useState<LiveDraftResult[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const api = useApi();

  // Hotkey global
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset al cerrar/abrir
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setLiveCandidates([]);
      setLiveJobs([]);
      setLiveDrafts([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Búsqueda live debounced de candidatos + jobs + drafts en paralelo
  useEffect(() => {
    if (!open || !config.useApi || query.length < 2) {
      setLiveCandidates([]);
      setLiveJobs([]);
      setLiveDrafts([]);
      return;
    }
    const timer = setTimeout(() => {
      api.candidates.search(query).then((res) => {
        setLiveCandidates(res.candidates.map((c) => ({ id: c.ROWID, name: c.name, email: c.email })));
      }).catch(() => setLiveCandidates([]));
      api.jobs.search(query).then((res) => {
        setLiveJobs(res.jobs.map((j) => ({ id: j.ROWID, title: j.title, company: j.company })));
      }).catch(() => setLiveJobs([]));
      api.drafts.search(query).then((res) => {
        setLiveDrafts(res.drafts.map((d) => ({ id: d.ROWID, clientCompany: d.client_company, clientName: d.client_name, status: d.status })));
      }).catch(() => setLiveDrafts([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, api]);

  const commands = useMemo<Command[]>(() => {
    const all: Command[] = [
      ...STATIC_PAGES,
      // Live results del backend primero (más relevantes que mocks)
      ...liveCandidates.map<Command>((c) => ({
        id: `lc-${c.id}`,
        type: 'candidate',
        label: c.name || c.email,
        hint: `${c.email} · live`,
        to: `/candidates/${c.id}`,
      })),
      ...liveJobs.map<Command>((j) => ({
        id: `lj-${j.id}`,
        type: 'job',
        label: j.title,
        hint: `${j.company} · live`,
        to: `/jobs/${j.id}`,
      })),
      ...liveDrafts.map<Command>((d) => ({
        id: `ld-${d.id}`,
        type: 'draft',
        label: `${d.clientCompany} (draft)`,
        hint: `${d.clientName} · ${d.status} · live`,
        to: `/drafts/${d.id}`,
      })),
      ...MOCK_JOBS.map<Command>((j) => ({
        id: `j-${j.id}`,
        type: 'job',
        label: j.title,
        hint: `${j.client_company} · ${j.status}`,
        to: `/jobs/${j.id}`,
      })),
      ...MOCK_APPLICATIONS.map<Command>((a) => ({
        id: `a-${a.id}`,
        type: 'candidate',
        label: a.candidate_name,
        hint: `${a.candidate_email} · ${a.state}`,
        to: `/candidates/${a.id}`,
      })),
      ...MOCK_DRAFTS.map<Command>((d) => ({
        id: `d-${d.id}`,
        type: 'draft',
        label: d.draft?.title ?? `Draft ${d.client_company}`,
        hint: `${d.client_name} · ${d.status}`,
        to: `/drafts/${d.id}`,
      })),
    ];

    if (!query) return all.slice(0, 30);

    const q = query.toLowerCase();
    return all
      .filter((c) =>
        c.label.toLowerCase().includes(q) || (c.hint?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 30);
  }, [query, liveCandidates, liveJobs, liveDrafts]);

  function exec(cmd: Command) {
    setOpen(false);
    if (cmd.to) navigate(cmd.to);
    if (cmd.action) cmd.action();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = commands[activeIdx];
      if (c) exec(c);
    }
  }

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)} role="presentation">
      <div className="cmdk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Búsqueda global">
        <div className="cmdk-input-wrap">
          <span className="cmdk-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            placeholder="Buscar puestos, candidatos, drafts, páginas..."
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="cmdk-shortcut">esc</span>
        </div>
        <div className="cmdk-list">
          {commands.length === 0 ? (
            <div className="cmdk-empty">Sin resultados para "{query}"</div>
          ) : (
            commands.map((c, idx) => (
              <button
                key={c.id}
                className={`cmdk-item ${idx === activeIdx ? 'is-active' : ''}`}
                onClick={() => exec(c)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className={`cmdk-type-tag cmdk-type-${c.type}`}>{typeLabel(c.type)}</span>
                <div className="cmdk-item-content">
                  <div className="cmdk-item-label">{c.label}</div>
                  {c.hint && <div className="cmdk-item-hint">{c.hint}</div>}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑↓</kbd> navegar</span>
          <span><kbd>↵</kbd> abrir</span>
          <span><kbd>esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}

function typeLabel(t: Command['type']): string {
  const labels: Record<Command['type'], string> = {
    page: 'Página',
    job: 'Puesto',
    candidate: 'Candidato',
    draft: 'Draft',
    action: 'Acción',
  };
  return labels[t];
}
