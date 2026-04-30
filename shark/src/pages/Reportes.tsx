import { Link } from 'react-router-dom';
import { MOCK_REPORTS } from '../data/mockReports';
import { getJobById } from '../data/mockJobs';
import './pages.css';

export default function Reportes() {
  const reports = Object.values(MOCK_REPORTS);

  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p className="page-subtitle">
        Reportes generados a clientes con finalistas + feedback recibido.
      </p>

      {reports.length === 0 ? (
        <div className="stub-card">
          <p>Aún no generaste reportes. Cuando un puesto tenga finalistas, podés crear el reporte desde la vista comparativo.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Cliente</th>
              <th>Finalistas</th>
              <th>Publicado</th>
              <th>Cliente abrió</th>
              <th>Feedback</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((rpt) => {
              const job = getJobById(rpt.job_id);
              const fb = rpt.client_feedback ?? [];
              const interview = fb.filter((f) => f.decision === 'interview').length;
              const maybe = fb.filter((f) => f.decision === 'maybe').length;
              const pass = fb.filter((f) => f.decision === 'pass').length;
              return (
                <tr key={rpt.token}>
                  <td>{job?.title ?? '—'}</td>
                  <td className="muted">{job?.client_company ?? '—'}</td>
                  <td>{rpt.candidate_app_ids.length}</td>
                  <td className="muted">{rpt.published_at}</td>
                  <td>
                    {rpt.client_opened_at ? (
                      <span className="status-tag status-active">{new Date(rpt.client_opened_at).toLocaleDateString()}</span>
                    ) : (
                      <span className="muted">No abierto</span>
                    )}
                  </td>
                  <td>
                    {fb.length === 0 ? (
                      <span className="muted">Sin feedback</span>
                    ) : (
                      <span>
                        {interview > 0 && <span className="report-fb-tag is-interview">{interview} entrevistar</span>}
                        {maybe > 0 && <span className="report-fb-tag is-maybe">{maybe} tal vez</span>}
                        {pass > 0 && <span className="report-fb-tag is-pass">{pass} pasar</span>}
                      </span>
                    )}
                  </td>
                  <td>
                    <Link to={`/report/${rpt.token}`} className="link" target="_blank">Ver reporte ↗</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="muted-note">
        💡 Datos mock — backend persistirá feedback real cuando esté conectado.
      </p>
    </div>
  );
}
