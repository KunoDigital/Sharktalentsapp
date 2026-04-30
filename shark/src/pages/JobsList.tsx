import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_JOBS, type JobStatus } from '../data/mockJobs';
import { exportJobsToExcel } from '../lib/excelExport';
import './pages.css';

const STATUS_FILTERS: ('all' | JobStatus)[] = ['all', 'active', 'paused', 'draft', 'closed'];

export default function JobsList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');

  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase().trim();
    return MOCK_JOBS.filter((job) => {
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (q && !job.title.toLowerCase().includes(q) && !job.client_company.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, statusFilter]);

  return (
    <div>
      <div className="page-header-row">
        <h1 className="page-title">Jobs</h1>
        <div className="filter-toolbar">
          <button className="btn-toolbar" onClick={() => exportJobsToExcel(MOCK_JOBS, 'jobs.xlsx')}>
            Exportar Excel
          </button>
          <button className="btn-primary">+ Nuevo puesto</button>
        </div>
      </div>
      <p className="page-subtitle">Puestos abiertos, en pausa y borradores.</p>

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
                {s === 'all' ? MOCK_JOBS.length : MOCK_JOBS.filter((j) => j.status === s).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="stub-card">
          <p>No hay puestos que coincidan con los filtros.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Cliente</th>
              <th>Ubicación</th>
              <th>Estado</th>
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
