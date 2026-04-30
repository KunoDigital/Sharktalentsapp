import { Link } from 'react-router-dom';
import { MOCK_JOBS } from '../data/mockJobs';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import './pages.css';

export default function Dashboard() {
  const activeJobs = MOCK_JOBS.filter((j) => j.status === 'active').length;
  const totalApps = MOCK_APPLICATIONS.length;
  const inProgress = MOCK_APPLICATIONS.filter((a) =>
    !['hired', 'rejected_by_admin', 'auto_rejected_low_score'].includes(a.state),
  ).length;
  const finalists = MOCK_APPLICATIONS.filter((a) => a.state === 'finalist').length;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">
        Vista general de los puestos activos y candidatos en pipeline.
      </p>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{activeJobs}</div>
          <div className="stat-label">Puestos activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalApps}</div>
          <div className="stat-label">Aplicaciones totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{inProgress}</div>
          <div className="stat-label">En pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{finalists}</div>
          <div className="stat-label">Finalistas</div>
        </div>
      </div>

      <h2 className="section-title">Tus puestos</h2>
      <div className="job-cards">
        {MOCK_JOBS.slice(0, 3).map((job) => (
          <Link key={job.id} to={`/jobs/${job.id}`} className="job-card">
            <div className="job-card-status">{job.status}</div>
            <div className="job-card-title">{job.title}</div>
            <div className="job-card-company">{job.client_company}</div>
            <div className="job-card-meta">
              <span>{job.applications_count} apps</span>
              <span>·</span>
              <span>{job.finalists_count} finalistas</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="muted-note">
        💡 Datos mock — el backend (Catalyst Datastore) todavía no está conectado. Ver{' '}
        <code>shark/src/data/mock*.ts</code>.
      </p>
    </div>
  );
}
