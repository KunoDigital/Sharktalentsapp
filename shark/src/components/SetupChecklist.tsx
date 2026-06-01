import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '@clerk/clerk-react';
import { MOCK_JOBS } from '../data/mockJobs';
import './setup-checklist.css';

const SETUP_KEY = 'setup_checklist_dismissed';

type Step = {
  id: string;
  title: string;
  desc: string;
  cta: { label: string; to?: string; action?: () => void };
  isDone: () => boolean;
};

export default function SetupChecklist() {
  const { organization } = useOrganization();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SETUP_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(false);

  const hasOrg = !!organization;
  const hasAnyJob = MOCK_JOBS.length > 0;

  const steps: Step[] = [
    {
      id: 'org',
      title: 'Crear tu organización',
      desc: 'Tu tenant en Clerk. Cada cliente que invites a tu equipo entra acá.',
      cta: { label: hasOrg ? 'Ver organización' : 'Crear', to: '/settings' },
      isDone: () => hasOrg,
    },
    {
      id: 'first_job',
      title: 'Crear tu primer puesto',
      desc: 'Definí el cargo, perfil DISC ideal, salario y competencias clave. La IA arma preguntas técnicas custom.',
      cta: { label: hasAnyJob ? 'Ver mis puestos' : '+ Crear puesto', to: hasAnyJob ? '/jobs' : '/jobs/new' },
      isDone: () => hasAnyJob,
    },
    {
      id: 'integrations',
      title: 'Conectar integraciones críticas',
      desc: 'Anthropic Claude (drafts y bot), Zoho Recruit (recibir candidatos), Zoho Bookings (agendamiento).',
      cta: { label: 'Configurar', to: '/settings' },
      isDone: () => false, // hasta que haya backend, asumimos pendiente
    },
    {
      id: 'team',
      title: 'Invitar a tu equipo',
      desc: 'Sumá colaboradores con roles (admin / recruiter / cliente). Opcional si trabajás solo.',
      cta: { label: 'Invitar', to: '/settings' },
      isDone: () => false,
    },
    {
      id: 'first_client',
      title: 'Atender tu primer cliente',
      desc: 'Cuando un cliente agenda discovery call → la IA arma un draft → vos revisás → publicás el puesto.',
      cta: { label: 'Ver drafts', to: '/drafts' },
      isDone: () => false,
    },
  ];

  const completedCount = steps.filter((s) => s.isDone()).length;
  const allDone = completedCount === steps.length;

  function dismiss() {
    try {
      localStorage.setItem(SETUP_KEY, 'true');
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  if (dismissed || allDone) return null;

  return (
    <section className="setup-checklist">
      <header className="setup-checklist-header">
        <div>
          <h2 className="setup-checklist-title">
            👋 Bienvenida{organization ? `, ${organization.name}` : ''}. Empezá acá.
          </h2>
          <p className="setup-checklist-progress">
            {completedCount} de {steps.length} completados
          </p>
        </div>
        <div className="setup-checklist-actions">
          <button
            type="button"
            className="cd-btn-ghost setup-checklist-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            {collapsed ? 'Mostrar' : 'Ocultar'}
          </button>
          <button
            type="button"
            className="cd-btn-ghost setup-checklist-btn"
            onClick={dismiss}
            title="Ya lo sé, no mostrarme más este checklist"
          >
            ✕ No mostrar
          </button>
        </div>
      </header>

      <div className="setup-checklist-bar">
        <div
          className="setup-checklist-bar-fill"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      {!collapsed && (
        <ol className="setup-checklist-list">
          {steps.map((s, idx) => {
            const done = s.isDone();
            return (
              <li key={s.id} className={`setup-checklist-item${done ? ' is-done' : ''}`}>
                <div className="setup-checklist-item-num" aria-hidden="true">
                  {done ? '✓' : idx + 1}
                </div>
                <div className="setup-checklist-item-body">
                  <div className="setup-checklist-item-title">{s.title}</div>
                  <div className="setup-checklist-item-desc">{s.desc}</div>
                </div>
                <div className="setup-checklist-item-cta">
                  {s.cta.to ? (
                    <Link to={s.cta.to} className="btn-toolbar">
                      {s.cta.label}
                    </Link>
                  ) : (
                    <button type="button" className="btn-toolbar" onClick={s.cta.action}>
                      {s.cta.label}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function resetSetupChecklist(): void {
  try {
    localStorage.removeItem(SETUP_KEY);
  } catch {
    // ignore
  }
}
