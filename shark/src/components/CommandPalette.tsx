import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOCK_JOBS } from '../data/mockJobs';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { MOCK_DRAFTS } from '../data/mockDrafts';
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
  { id: 'p-drafts', type: 'page', label: 'Drafts (cliente)', hint: 'Borradores post-reunión', to: '/drafts' },
  { id: 'p-jobs', type: 'page', label: 'Jobs', hint: 'Lista de puestos', to: '/jobs' },
  { id: 'p-cands', type: 'page', label: 'Candidatos', hint: 'Vista cross-job', to: '/candidates' },
  { id: 'p-bot', type: 'page', label: 'Bot — Review queue', hint: 'Decisiones que necesitan tu revisión', to: '/bot/review' },
  { id: 'p-reports', type: 'page', label: 'Reportes', hint: 'Reportes generados a clientes', to: '/reports' },
  { id: 'p-inbox', type: 'page', label: 'Inbox outbound', hint: 'Mensajes LinkedIn / email', to: '/inbox' },
  { id: 'p-settings', type: 'page', label: 'Settings', hint: 'Integraciones, API keys, equipo', to: '/settings' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

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
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const all: Command[] = [
      ...STATIC_PAGES,
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
  }, [query]);

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
