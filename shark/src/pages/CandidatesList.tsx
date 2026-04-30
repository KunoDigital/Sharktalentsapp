import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS, STATE_LABELS, SOURCE_LABELS } from '../data/mockApplications';
import { getJobById } from '../data/mockJobs';
import './pages.css';

export default function CandidatesList() {
  return (
    <div>
      <h1 className="page-title">Candidatos</h1>
      <p className="page-subtitle">Vista cross-job de todas las aplicaciones.</p>

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
          {MOCK_APPLICATIONS.map((app) => {
            const job = getJobById(app.job_id);
            return (
              <tr key={app.id}>
                <td>{app.candidate_name}</td>
                <td className="muted">{app.candidate_email}</td>
                <td>
                  {job ? (
                    <Link to={`/jobs/${job.id}`} className="link">{job.title}</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="muted">{SOURCE_LABELS[app.source]}</td>
                <td>{STATE_LABELS[app.state]}</td>
                <td className="muted">{app.applied_at}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
