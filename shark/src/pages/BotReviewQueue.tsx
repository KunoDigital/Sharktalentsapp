import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { getJobById } from '../data/mockJobs';
import './pages.css';
import './bot.css';

export default function BotReviewQueue() {
  const queue = MOCK_APPLICATIONS.filter((a) => a.bot_decision && a.bot_decision.needs_review);
  const recentDecisions = MOCK_APPLICATIONS.filter((a) => a.bot_decision && a.bot_decision.auto_applied)
    .sort((a, b) => (b.bot_decision!.decided_at).localeCompare(a.bot_decision!.decided_at))
    .slice(0, 10);

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Bot decisor — Review queue</h1>
          <p className="page-subtitle">
            Casos donde el bot tiene confianza debajo del umbral y necesita tu decisión humana.
          </p>
        </div>
        <div className="bot-mode-badge bot-mode-warm">Modo: Warm</div>
      </div>

      <div className="bot-stats-grid">
        <div className="stat-card">
          <div className="stat-value">{queue.length}</div>
          <div className="stat-label">Esperando tu decisión</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{recentDecisions.length}</div>
          <div className="stat-label">Auto-aplicadas (últimas)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">12%</div>
          <div className="stat-label">Override rate (mock)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">0.83</div>
          <div className="stat-label">Confidence promedio (mock)</div>
        </div>
      </div>

      <h2 className="section-title">Necesitan tu revisión ({queue.length})</h2>
      {queue.length === 0 ? (
        <div className="bot-empty-state">
          <p>No hay casos pendientes. El bot está corriendo con confianza alta.</p>
        </div>
      ) : (
        <div className="bot-queue-list">
          {queue.map((app) => {
            const job = getJobById(app.job_id);
            const bd = app.bot_decision!;
            return (
              <Link key={app.id} to={`/candidates/${app.id}`} className="bot-queue-card">
                <div className="bot-queue-header">
                  <div>
                    <div className="bot-queue-name">{app.candidate_name}</div>
                    <div className="bot-queue-meta">
                      {job?.title} · etapa {bd.stage}
                    </div>
                  </div>
                  <div className="bot-queue-confidence">
                    <div className="bot-queue-conf-pct">{(bd.confidence * 100).toFixed(0)}%</div>
                    <div className="bot-queue-conf-label">vs umbral {(bd.threshold * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="bot-queue-recommendation">
                  <strong>Bot dice:</strong> {bd.recommendation}
                </div>
                <div className="bot-queue-rationale">{bd.rationale_text}</div>
                <div className="bot-queue-cta">Revisar y decidir →</div>
              </Link>
            );
          })}
        </div>
      )}

      <h2 className="section-title">Decisiones auto-aplicadas (últimas)</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Candidato</th>
            <th>Puesto</th>
            <th>Decisión</th>
            <th>Confidence</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {recentDecisions.map((app) => {
            const job = getJobById(app.job_id);
            const bd = app.bot_decision!;
            return (
              <tr key={app.id}>
                <td>
                  <Link to={`/candidates/${app.id}`} className="link">{app.candidate_name}</Link>
                </td>
                <td className="muted">{job?.title}</td>
                <td>{bd.recommendation}</td>
                <td>
                  <span className="bot-conf-pill bot-conf-good">{(bd.confidence * 100).toFixed(0)}%</span>
                </td>
                <td className="muted">{bd.decided_at}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="muted-note">
        💡 El bot está en modo <strong>Warm</strong>. Decide automáticamente cuando confidence ≥ {((recentDecisions[0]?.bot_decision?.threshold ?? 0.75) * 100).toFixed(0)}%.
        Cada override que hagas se guarda como training example para que el bot aprenda. Cuando over-ride rate baje de 10%, podemos pasar a Hot.
      </p>
    </div>
  );
}
