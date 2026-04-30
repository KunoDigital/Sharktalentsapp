import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS, STATE_LABELS, SOURCE_LABELS, type ApplicationSource, type ApplicationState } from '../data/mockApplications';
import { MOCK_JOBS, getJobById } from '../data/mockJobs';
import { exportCandidatesToExcel } from '../lib/excelExport';
import './pages.css';

export default function CandidatesList() {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | ApplicationSource>('all');
  const [stateFilter, setStateFilter] = useState<'all' | ApplicationState>('all');

  const sources = Array.from(new Set(MOCK_APPLICATIONS.map((a) => a.source)));
  const states = Array.from(new Set(MOCK_APPLICATIONS.map((a) => a.state)));

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return MOCK_APPLICATIONS.filter((app) => {
      if (sourceFilter !== 'all' && app.source !== sourceFilter) return false;
      if (stateFilter !== 'all' && app.state !== stateFilter) return false;
      if (q && !app.candidate_name.toLowerCase().includes(q) && !app.candidate_email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, sourceFilter, stateFilter]);

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Candidatos</h1>
          <p className="page-subtitle">Vista cross-job de todas las aplicaciones.</p>
        </div>
        <button
          className="btn-toolbar"
          onClick={() => exportCandidatesToExcel(filtered, MOCK_JOBS, `candidatos-${filtered.length}.xlsx`)}
        >
          Exportar Excel ({filtered.length})
        </button>
      </div>

      <div className="filters-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'all' | ApplicationSource)}
        >
          <option value="all">Todos los sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as 'all' | ApplicationState)}
        >
          <option value="all">Todos los estados</option>
          {states.map((s) => (
            <option key={s} value={s}>{STATE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="stub-card">
          <p>No hay candidatos que coincidan con los filtros.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Candidato</th>
              <th>Email</th>
              <th>Puesto</th>
              <th>Source</th>
              <th>Estado</th>
              <th>Aplicó</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((app) => {
              const job = getJobById(app.job_id);
              return (
                <tr key={app.id}>
                  <td>
                    <Link to={`/candidates/${app.id}`} className="link">{app.candidate_name}</Link>
                  </td>
                  <td className="muted">{app.candidate_email}</td>
                  <td>
                    {job ? <Link to={`/jobs/${job.id}`} className="link">{job.title}</Link> : '—'}
                  </td>
                  <td className="muted">{SOURCE_LABELS[app.source]}</td>
                  <td>{STATE_LABELS[app.state]}</td>
                  <td className="muted">{app.applied_at}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
