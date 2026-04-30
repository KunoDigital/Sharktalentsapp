import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MOCK_JOBS, getJobById } from '../data/mockJobs';
import {
  getApplicationsByJobId,
  STATE_LABELS,
  SOURCE_LABELS,
  type Application,
} from '../data/mockApplications';
import { exportCandidatesToExcel } from '../lib/excelExport';
import { slugifyForFilename } from '../lib/pdfExport';
import './pages.css';

type Phase = 'tecnica' | 'conductual' | 'integridad';

type PhaseColumn = {
  key: string;
  label: string;
  match: (app: Application) => boolean;
  highlight?: 'primary' | 'warn' | 'danger';
};

const PHASE_COLUMNS: Record<Phase, PhaseColumn[]> = {
  tecnica: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.tecnica_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.tecnica_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.tecnica_state === 'completado' },
    { key: 'siguiente_etapa', label: 'Siguiente etapa', match: (a) => a.tecnica_state === 'siguiente_etapa', highlight: 'primary' },
    { key: 'salario_fuera_rango', label: 'Salario fuera de rango', match: (a) => a.tecnica_state === 'salario_fuera_rango', highlight: 'warn' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.tecnica_state === 'rechazado', highlight: 'danger' },
  ],
  conductual: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.conductual_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.conductual_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.conductual_state === 'completado' },
    { key: 'siguiente_etapa', label: 'Siguiente etapa', match: (a) => a.conductual_state === 'siguiente_etapa', highlight: 'primary' },
    { key: 'duda_cv', label: 'Duda — Revisar CV', match: (a) => a.conductual_state === 'duda_cv', highlight: 'warn' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.conductual_state === 'rechazado', highlight: 'danger' },
  ],
  integridad: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.integridad_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.integridad_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.integridad_state === 'completado' },
    { key: 'llamar_entrevista', label: 'Llamar a entrevista', match: (a) => a.integridad_state === 'llamar_entrevista', highlight: 'primary' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.integridad_state === 'rechazado', highlight: 'danger' },
  ],
};

const PHASE_LABEL: Record<Phase, string> = {
  tecnica: 'Técnica',
  conductual: 'Evaluación Conductual',
  integridad: 'Integridad',
};

function CardKpi({ app, phase }: { app: Application; phase: Phase }): React.ReactElement {
  if (phase === 'tecnica' && app.tecnica) {
    return (
      <div className="kanban-card-detail">
        Técnica: <strong>{app.tecnica.pct}%</strong> ({app.tecnica.estado})
      </div>
    );
  }
  if (phase === 'conductual' && app.disc) {
    return (
      <div className="kanban-card-detail">
        DISC sim: <strong>{app.disc.similitud_pct}%</strong> · VELNA: {app.velna?.similitud_pct ?? '—'}%
      </div>
    );
  }
  if (phase === 'integridad' && app.integridad) {
    const obs = app.integridad.observations.length;
    return (
      <div className="kanban-card-detail">
        Integridad: {obs === 0 && !app.integridad.buena_impresion_alta ? 'Sin alertas' : `${obs} obs.`}
      </div>
    );
  }
  return <div className="kanban-card-detail muted">Sin datos en esta fase</div>;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const job = id ? getJobById(id) : undefined;
  const [phase, setPhase] = useState<Phase>('tecnica');

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
  const columns = PHASE_COLUMNS[phase];

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
        <div className="job-detail-toolbar">
          <Link to={`/jobs/${job.id}/edit`} className="btn-toolbar">
            ✏️ Editar
          </Link>
          <Link to={`/jobs/${job.id}/comparar`} className="btn-toolbar">
            Comparar candidatos
          </Link>
          <button className="btn-toolbar" onClick={() => exportCandidatesToExcel(applications, MOCK_JOBS, `candidatos-${slugifyForFilename(job.title)}.xlsx`)}>
            Exportar Excel
          </button>
          <span className={`status-tag status-${job.status}`}>{job.status}</span>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{job.applications_count}</div>
          <div className="stat-label">Aplicaciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{applications.length}</div>
          <div className="stat-label">Total en pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{applications.filter((a) => a.integridad_state === 'llamar_entrevista').length}</div>
          <div className="stat-label">Listos para entrevista</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${job.fee_usd.toLocaleString()}</div>
          <div className="stat-label">Fee</div>
        </div>
      </div>

      <h2 className="section-title">Pipeline — {PHASE_LABEL[phase]}</h2>

      <div className="phase-tabs">
        {(['tecnica', 'conductual', 'integridad'] as Phase[]).map((p) => (
          <button
            key={p}
            className={`phase-tab${phase === p ? ' is-active' : ''}`}
            onClick={() => setPhase(p)}
          >
            {PHASE_LABEL[p]}
          </button>
        ))}
        <span className="phase-tabs-hint">
          Orden: prefiltro → técnica → conductual → integridad
        </span>
      </div>

      <div className="kanban">
        {columns.map((col) => {
          const items = applications.filter(col.match);
          return (
            <div key={col.key} className={`kanban-col${col.highlight ? ` kanban-col-${col.highlight}` : ''}`}>
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
                    <div className="kanban-card-detail muted">
                      {app.candidate_age} a · ${app.salary_aspiration_usd}/mes
                    </div>
                    <CardKpi app={app} phase={phase} />
                    {app.anti_cheat_events.length > 0 && (
                      <div className="kanban-card-detail kanban-card-warn">
                        ⚠️ {app.anti_cheat_events.length} eventos anti-trampa
                      </div>
                    )}
                  </Link>
                ))}
                {items.length === 0 && <div className="kanban-empty">Sin candidatos</div>}
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
