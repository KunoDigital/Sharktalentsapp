import { useParams, Link } from 'react-router-dom';
import { getJobById } from '../data/mockJobs';
import {
  getApplicationsByJobId,
  STATE_LABELS,
  SOURCE_LABELS,
  type ApplicationState,
} from '../data/mockApplications';
import './pages.css';

const STATE_COLUMNS: { state: ApplicationState; label: string }[] = [
  { state: 'prefilter_pending', label: 'Prefiltro' },
  { state: 'prefilter_passed', label: 'Pre OK' },
  { state: 'tecnica_completed', label: 'Técnica' },
  { state: 'conductual_completed', label: 'Conductual' },
  { state: 'integridad_completed', label: 'Integridad' },
  { state: 'finalist', label: 'Finalistas' },
];

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const job = id ? getJobById(id) : undefined;

  if (!job) {
    return (
      <div>
        <p>
          Puesto no encontrado. <Link to="/jobs">Volver</Link>
        </p>
      </div>
    );
  }

  const applications = getApplicationsByJobId(job.id);

  return (
    <div>
      <Link to="/jobs" className="back-link">← Jobs</Link>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{job.title}</h1>
          <p className="page-subtitle">
            {job.client_company} · {job.location}
          </p>
        </div>
        <span className={`status-tag status-${job.status}`}>{job.status}</span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{job.applications_count}</div>
          <div className="stat-label">Aplicaciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{job.applications_in_progress}</div>
          <div className="stat-label">En pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{job.finalists_count}</div>
          <div className="stat-label">Finalistas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${job.fee_usd.toLocaleString()}</div>
          <div className="stat-label">Fee</div>
        </div>
      </div>

      <h2 className="section-title">Pipeline</h2>
      <div className="kanban">
        {STATE_COLUMNS.map((col) => {
          const items = applications.filter((a) => a.state === col.state);
          return (
            <div key={col.state} className="kanban-col">
              <div className="kanban-col-header">
                <span>{col.label}</span>
                <span className="kanban-count">{items.length}</span>
              </div>
              <div className="kanban-col-body">
                {items.map((app) => (
                  <Link key={app.id} to={`/candidates/${app.id}`} className="kanban-card kanban-card-link">
                    <div className="kanban-card-name">{app.candidate_name}</div>
                    <div className="kanban-card-meta">
                      <span className="source-tag">{SOURCE_LABELS[app.source]}</span>
                    </div>
                    {app.disc && (
                      <div className="kanban-card-detail">
                        DISC: {app.disc.dominant_label.split('—')[0].trim()} · sim {app.disc.similitud_pct}%
                      </div>
                    )}
                    {app.tecnica && (
                      <div className="kanban-card-detail">
                        Técnica: <strong>{app.tecnica.pct}%</strong> ({app.tecnica.estado})
                      </div>
                    )}
                    {app.bot_confidence != null && (
                      <div className="kanban-card-detail">
                        Bot: <strong>{(app.bot_confidence * 100).toFixed(0)}%</strong>
                      </div>
                    )}
                    {app.anti_cheat_events.length > 0 && (
                      <div className="kanban-card-detail kanban-card-warn">
                        ⚠️ Anti-trampa: {app.anti_cheat_events.length} eventos
                      </div>
                    )}
                  </Link>
                ))}
                {items.length === 0 && <div className="kanban-empty">Vacío</div>}
              </div>
            </div>
          );
        })}
      </div>

      {applications.length > 0 && (
        <>
          <h2 className="section-title">Tabla completa</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Source</th>
                <th>Estado</th>
                <th>DISC</th>
                <th>Técnica</th>
                <th>Anti-trampa</th>
                <th>Bot conf.</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id}>
                  <td>
                    <Link to={`/candidates/${app.id}`} className="link">{app.candidate_name}</Link>
                  </td>
                  <td className="muted">{SOURCE_LABELS[app.source]}</td>
                  <td>{STATE_LABELS[app.state]}</td>
                  <td className="muted">{app.disc ? `sim ${app.disc.similitud_pct}%` : '—'}</td>
                  <td>{app.tecnica ? `${app.tecnica.pct}%` : '—'}</td>
                  <td className={app.anti_cheat_events.length > 0 ? 'cd-tecnica-no-aprobado' : 'muted'}>
                    {app.anti_cheat_events.length > 0 ? `⚠️ ${app.anti_cheat_events.length}` : '—'}
                  </td>
                  <td>{app.bot_confidence != null ? `${(app.bot_confidence * 100).toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
