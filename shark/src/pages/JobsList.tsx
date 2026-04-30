import { Link } from 'react-router-dom';
import { MOCK_JOBS } from '../data/mockJobs';
import './pages.css';

export default function JobsList() {
  return (
    <div>
      <div className="page-header-row">
        <h1 className="page-title">Jobs</h1>
        <button className="btn-primary">+ Nuevo puesto</button>
      </div>
      <p className="page-subtitle">Puestos abiertos, en pausa y borradores.</p>

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
          {MOCK_JOBS.map((job) => (
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
    </div>
  );
}
