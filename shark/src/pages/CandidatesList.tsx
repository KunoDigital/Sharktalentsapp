import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS, STATE_LABELS, SOURCE_LABELS, type ApplicationSource, type ApplicationState, type Application } from '../data/mockApplications';
import { MOCK_JOBS, getJobById } from '../data/mockJobs';
import { exportCandidatesToExcel } from '../lib/excelExport';
import { useApi, type ApiApplication, type ApiCandidate } from '../lib/api';
import { useApiData } from '../hooks/useApiData';
import { config } from '../config';
import EmptyState from '../components/EmptyState';
import './pages.css';

/**
 * Adapta una ApiApplication + Candidate al shape Application del mock.
 * No tiene todos los campos ricos (disc, velna, etc.) — para la lista alcanza con esto.
 */
function adaptApiApplication(app: ApiApplication, candidate: ApiCandidate | undefined): Application {
  const fallbackState: ApplicationState = (
    [
      'prefilter_pending', 'prefilter_passed', 'salary_out_of_range',
      'tecnica_completed', 'conductual_completed', 'integridad_completed',
      'finalist', 'auto_rejected_low_score', 'rejected_by_admin',
    ] as ApplicationState[]
  ).includes(app.pipeline_stage as ApplicationState)
    ? (app.pipeline_stage as ApplicationState)
    : 'prefilter_pending';

  return {
    id: app.ROWID,
    job_id: app.assessment_id,
    candidate_name: candidate?.name ?? '(sin nombre)',
    candidate_email: candidate?.email ?? '',
    candidate_age: candidate?.age ?? 0,
    candidate_phone: candidate?.phone ?? '',
    source: 'direct',
    state: fallbackState,
    applied_at: app.started_at,
    salary_aspiration_usd: candidate?.salary_expectation ?? 0,
    disponibilidad: candidate?.availability ?? '',
    tecnica_state: 'registrado',
    conductual_state: 'registrado',
    integridad_state: 'registrado',
    anti_cheat_events: [],
    ia_summary: '',
    timeline: [],
  };
}

export default function CandidatesList() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | ApplicationSource>('all');
  const [stateFilter, setStateFilter] = useState<'all' | ApplicationState>('all');

  const { data, loading, error } = useApiData(
    async () => {
      if (!config.useApi) return null;
      const [apps, cands] = await Promise.all([api.applications.list(), api.candidates.list()]);
      return { apps: apps.applications, cands: cands.candidates };
    },
    [config.useApi],
  );

  const applications: Application[] = useMemo(() => {
    if (config.useApi && data) {
      const candById = new Map(data.cands.map((c) => [c.ROWID, c]));
      return data.apps.map((a) => adaptApiApplication(a, candById.get(a.candidate_id)));
    }
    return MOCK_APPLICATIONS;
  }, [data]);

  const sources = Array.from(new Set(applications.map((a) => a.source)));
  const states = Array.from(new Set(applications.map((a) => a.state)));

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return applications.filter((app) => {
      if (sourceFilter !== 'all' && app.source !== sourceFilter) return false;
      if (stateFilter !== 'all' && app.state !== stateFilter) return false;
      if (q && !app.candidate_name.toLowerCase().includes(q) && !app.candidate_email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applications, search, sourceFilter, stateFilter]);

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Candidatos</h1>
          <p className="page-subtitle">
            Vista cross-job de todas las aplicaciones.
            {config.useApi && <span className="muted small"> · Datos en vivo del backend</span>}
          </p>
        </div>
        <button
          className="btn-toolbar"
          onClick={() => exportCandidatesToExcel(filtered, MOCK_JOBS, `candidatos-${filtered.length}.xlsx`)}
        >
          Exportar Excel ({filtered.length})
        </button>
      </div>

      {config.useApi && error && (
        <div className="cd-alert cd-alert-warn" style={{ marginBottom: '1rem' }}>
          ⚠️ No se pudo cargar del backend: {error.message}. Mostrando data mock.
        </div>
      )}

      {config.useApi && loading && <p className="muted">Cargando...</p>}

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
        <EmptyState
          icon="🔍"
          title="No encontramos candidatos"
          description={applications.length === 0
            ? 'Cuando un candidato aplique a alguno de tus puestos, va a aparecer acá automáticamente.'
            : 'Ningún candidato coincide con los filtros activos. Cambiá source, estado o limpiá la búsqueda.'}
          hint={applications.length === 0 ? 'El link de aplicación se comparte como /apply/<tenant>/<puesto>' : undefined}
        />
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
