import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_JOBS, type Job, type JobStatus } from '../data/mockJobs';
import { exportJobsToExcel } from '../lib/excelExport';
import { useApi, type ApiJob } from '../lib/api';
import { useApiData } from '../hooks/useApiData';
import { config } from '../config';
import EmptyState from '../components/EmptyState';
import './pages.css';

const STATUS_FILTERS: ('all' | JobStatus)[] = ['all', 'active', 'paused', 'draft', 'closed'];

/**
 * Adapta un ApiJob (shape de BD) al shape rico Job (mock) que la UI espera.
 * Hasta que el schema de BD tenga todos los campos (location, fee_usd, salary_range, etc.)
 * usamos defaults razonables.
 */
function adaptApiJob(api: ApiJob): Job {
  return {
    id: api.ROWID,
    slug: api.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title: api.title,
    client_company: api.company,
    client_industry: '',
    location: '',
    status: api.is_active ? 'active' : 'paused',
    created_at: api.created_at,
    fee_usd: 0,
    salary_range_usd: { min: 0, max: 0 },
    disc_ideal_a: {
      d: 50, i: 50, s: 50, c: 50,
      pk_profile_code: 'PK-XX',
      pk_profile_name: 'TBD',
      description: [],
    },
    velna_ideal: { verbal: 70, espacial: 65, logica: 75, numerica: 70, abstracta: 70 },
    competencias_ideales: [],
    tecnica_minimo_pct: 60,
    context: api.company_context ?? '',
    applications_count: 0,
    applications_in_progress: 0,
    finalists_count: 0,
  };
}

export default function JobsList() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');

  // Fetch del backend (solo si VITE_USE_API=true)
  const { data, loading, error } = useApiData(
    () => (config.useApi ? api.jobs.list() : Promise.resolve(null)),
    [config.useApi],
  );

  const jobs: Job[] = useMemo(() => {
    if (config.useApi && data) {
      return data.jobs.map(adaptApiJob);
    }
    return MOCK_JOBS;
  }, [data]);

  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase().trim();
    return jobs.filter((job) => {
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (q && !job.title.toLowerCase().includes(q) && !job.client_company.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, search, statusFilter]);

  return (
    <div>
      <div className="page-header-row">
        <h1 className="page-title">Jobs</h1>
        <div className="filter-toolbar">
          <button className="btn-toolbar" onClick={() => exportJobsToExcel(jobs, 'jobs.xlsx')}>
            Exportar Excel
          </button>
          <Link to="/jobs/new" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            + Nuevo puesto
          </Link>
        </div>
      </div>
      <p className="page-subtitle">
        Puestos abiertos, en pausa y borradores.
        {config.useApi && <span className="muted small"> · Datos en vivo del backend</span>}
      </p>

      {config.useApi && error && (
        <div className="cd-alert cd-alert-warn" style={{ marginBottom: '1rem' }}>
          ⚠️ No se pudo cargar la lista del backend: {error.message}. Mostrando data mock.
        </div>
      )}

      {config.useApi && loading && (
        <p className="muted">Cargando...</p>
      )}

      <div className="filters-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Buscar por título o cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-pills">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              className={`filter-pill ${statusFilter === s ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'Todos' : s}
              <span className="filter-pill-count">
                {s === 'all' ? jobs.length : jobs.filter((j) => j.status === s).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No encontramos puestos"
          description={jobs.length === 0
            ? 'Empezá creando tu primer puesto. Después podés invitar candidatos.'
            : 'Ningún puesto coincide con los filtros activos. Probá otra búsqueda o cambiá el filtro de estado.'}
          cta={jobs.length === 0 ? { label: '+ Crear primer puesto' } : undefined}
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Cliente</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Tests</th>
              <th>Apps</th>
              <th>Finalistas</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link to={`/jobs/${job.id}`} className="link">{job.title}</Link>
                </td>
                <td>{job.client_company}</td>
                <td className="muted">{job.location}</td>
                <td>
                  <span className={`status-tag status-${job.status}`}>{job.status}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {job.tecnica_minimo_pct > 0 && (
                      <span title="Prueba técnica" style={badgeStyle('#7c3aed')}>🔧</span>
                    )}
                    {job.english_required && (
                      <span title={`Inglés ${job.english_min_level ?? '?'}`} style={badgeStyle('#3b82f6')}>
                        🇺🇸 {job.english_min_level}
                      </span>
                    )}
                    {job.mindset_test_enabled !== false && (
                      <span title="Test de mentalidades" style={badgeStyle('#10b981')}>🧠</span>
                    )}
                    {job.auto_rejection_rules && Object.keys(job.auto_rejection_rules).some((k) => (job.auto_rejection_rules as Record<string, unknown>)[k] != null) && (
                      <span title="Auto-rejection rules activas" style={badgeStyle('#f59e0b')}>⚡</span>
                    )}
                  </div>
                </td>
                <td>{job.applications_count}</td>
                <td>{job.finalists_count}</td>
                <td>${job.fee_usd.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: '0.7rem',
    padding: '2px 6px',
    borderRadius: '4px',
    background: `${color}22`,
    color,
    border: `1px solid ${color}55`,
    fontWeight: 600,
  };
}
