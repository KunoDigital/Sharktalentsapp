import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReportByToken, type ReportCandidateNarrative } from '../../data/mockReports';
import { getJobById } from '../../data/mockJobs';
import { getApplicationById, type Application } from '../../data/mockApplications';
import './public-report.css';

type FeedbackChoice = 'interview' | 'pass' | 'maybe' | null;
type FeedbackState = Record<string, { choice: FeedbackChoice; comment: string }>;

export default function PublicReport() {
  const { token } = useParams<{ token: string }>();
  const report = token ? getReportByToken(token) : undefined;
  const job = report ? getJobById(report.job_id) : undefined;

  const [feedback, setFeedback] = useState<FeedbackState>({});
  const [submitted, setSubmitted] = useState(false);

  if (!report || !job) {
    return (
      <div className="pr-not-found">
        <h1>Reporte no encontrado</h1>
        <p>El link puede haber expirado o ser inválido. Contactá a Kuno Digital para más info.</p>
      </div>
    );
  }

  const candidates = report.candidate_app_ids
    .map((id) => getApplicationById(id))
    .filter((a): a is Application => a !== undefined);

  function setChoice(appId: string, choice: FeedbackChoice) {
    setFeedback((curr) => ({
      ...curr,
      [appId]: { choice, comment: curr[appId]?.comment ?? '' },
    }));
  }

  function setComment(appId: string, comment: string) {
    setFeedback((curr) => ({
      ...curr,
      [appId]: { choice: curr[appId]?.choice ?? null, comment },
    }));
  }

  function submitFeedback() {
    setSubmitted(true);
    setTimeout(() => alert('Mock: feedback enviado a Kuno Digital'), 100);
  }

  return (
    <div className="pr-root">
      <header className="pr-header">
        <div className="pr-header-brand">
          <span className="pr-brand">SharkTalents.AI</span>
          <span className="pr-brand-tag">Evaluación de talento con inteligencia artificial</span>
        </div>
        <div className="pr-header-finalists">
          {candidates.length} {candidates.length === 1 ? 'finalista' : 'finalistas'}
        </div>
      </header>

      <main className="pr-main">
        <div className="pr-title-block">
          <h1 className="pr-title">{job.title.toUpperCase()}</h1>
          <div className="pr-subtitle">{report.tenant_name}</div>
          <div className="pr-date">{formatMonth(report.published_at)}</div>
          <div className="pr-confidential">CONFIDENCIAL</div>
        </div>

        <section className="pr-section pr-overview">
          <div className="pr-overview-card">
            <div className="pr-overview-title">Quién buscamos</div>
            <ul className="pr-overview-list">
              <li>{job.context.split('.')[0]}.</li>
            </ul>
            <div className="pr-disc-mini">
              <div className="pr-disc-mini-title">Perfil A · DISC</div>
              <DiscMini d={job.disc_ideal_a.d} i={job.disc_ideal_a.i} s={job.disc_ideal_a.s} c={job.disc_ideal_a.c} />
              <div className="pr-pk">{job.disc_ideal_a.pk_profile_code} — {job.disc_ideal_a.pk_profile_name}</div>
            </div>
            {job.disc_ideal_b && (
              <div className="pr-disc-mini">
                <div className="pr-disc-mini-title">Perfil B · DISC alternativo</div>
                <DiscMini d={job.disc_ideal_b.d} i={job.disc_ideal_b.i} s={job.disc_ideal_b.s} c={job.disc_ideal_b.c} />
                <div className="pr-pk">{job.disc_ideal_b.pk_profile_code} — {job.disc_ideal_b.pk_profile_name}</div>
              </div>
            )}
          </div>

          <div className="pr-overview-card">
            <div className="pr-overview-title">Qué debe saber hacer</div>
            <ul className="pr-overview-comp">
              {job.competencias_ideales.map((c) => (
                <li key={c.name}>
                  <span>{c.name}</span>
                  <span className="pr-overview-comp-pct">{c.required_pct}</span>
                </li>
              ))}
            </ul>
            <div className="pr-overview-min">
              Mínimo técnica: <strong>{job.tecnica_minimo_pct}%</strong>
            </div>
          </div>

          <div className="pr-overview-card">
            <div className="pr-overview-title">Capacidad intelectual</div>
            <ul className="pr-overview-velna">
              {[
                ['Verbal', job.velna_ideal.verbal],
                ['Espacial', job.velna_ideal.espacial],
                ['Lógica', job.velna_ideal.logica],
                ['Numérica', job.velna_ideal.numerica],
                ['Abstracta', job.velna_ideal.abstracta],
              ].map(([label, val]) => (
                <li key={label as string}>
                  <span>{label}</span>
                  <div className="pr-velna-track">
                    <div className="pr-velna-fill" style={{ width: `${val}%` }} />
                  </div>
                  <span className="pr-velna-val">{val}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pr-section">
          <h2 className="pr-section-title">Sus finalistas están listos</h2>
          <p className="pr-section-text">
            Los {candidates.length} candidatos completaron las evaluaciones conductual, cognitiva, emocional, integridad y técnica. Los ordenamos por afinidad con el perfil ideal para ayudarte a decidir a quién entrevistar primero.
          </p>
          <p className="pr-section-text pr-section-strong">
            Siguiente paso: entrevista personal con el candidato de tu preferencia.
          </p>
        </section>

        <section className="pr-section">
          <h2 className="pr-section-title">Comparativo general</h2>
          <table className="pr-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Afinidad</th>
                <th>Conductual</th>
                <th>Cognitiva</th>
                <th>Técnica</th>
                <th>Integridad</th>
                <th>Emoción</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((app) => {
                const n = report.narratives[app.id];
                return (
                  <tr key={app.id}>
                    <td className="pr-table-name">
                      {app.candidate_name}
                      <div className="pr-table-affinity-tag">{n.affinity_label}</div>
                    </td>
                    <td className="pr-table-affinity">{n.affinity_pct}%</td>
                    <td>{n.afinidad_conductual}%</td>
                    <td>{n.afinidad_cognitiva}%</td>
                    <td>{n.afinidad_tecnica}%</td>
                    <td>{app.integridad?.observations.length ? `${app.integridad.observations.length} obs.` : 'Sin alertas'}</td>
                    <td>{app.emocional?.label ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {candidates.map((app) => (
          <CandidateCard
            key={app.id}
            app={app}
            narrative={report.narratives[app.id]}
            feedback={feedback[app.id]}
            onChoiceChange={(choice) => setChoice(app.id, choice)}
            onCommentChange={(c) => setComment(app.id, c)}
          />
        ))}

        <section className="pr-section pr-conclusion">
          <h2 className="pr-section-title">Conclusión del análisis</h2>
          <div className="pr-conclusion-grid">
            <div className="pr-conclusion-card">
              <div className="pr-conclusion-label">SI PRIORIZAS AUTONOMÍA</div>
              <div className="pr-conclusion-text">{report.conclusion.si_priorizas_autonomia}</div>
            </div>
            <div className="pr-conclusion-card">
              <div className="pr-conclusion-label">SI PRIORIZAS CRECIMIENTO</div>
              <div className="pr-conclusion-text">{report.conclusion.si_priorizas_crecimiento}</div>
            </div>
            <div className="pr-conclusion-card">
              <div className="pr-conclusion-label">MENOR RIESGO</div>
              <div className="pr-conclusion-text">{report.conclusion.menor_riesgo}</div>
            </div>
            <div className="pr-conclusion-card">
              <div className="pr-conclusion-label">MAYOR POTENCIAL</div>
              <div className="pr-conclusion-text">{report.conclusion.mayor_potencial}</div>
            </div>
          </div>
          <div className="pr-recommendation">
            {report.conclusion.recomendacion_final}
          </div>
        </section>

        <section className="pr-section pr-feedback-section">
          <h2 className="pr-section-title">Tu decisión</h2>
          <p className="pr-section-text">
            Marcá tu preferencia por candidato. Vamos a coordinar entrevistas según tu selección.
          </p>
          {submitted ? (
            <div className="pr-feedback-thanks">
              ✓ Feedback enviado. Kuno Digital te va a contactar para coordinar entrevistas.
            </div>
          ) : (
            <button
              className="pr-submit-btn"
              onClick={submitFeedback}
              disabled={Object.values(feedback).every((f) => f.choice === null)}
            >
              Enviar mi decisión a Kuno Digital
            </button>
          )}
        </section>
      </main>

      <footer className="pr-footer">
        <div className="pr-brand">SharkTalents.AI</div>
        <div className="pr-footer-tag">Evaluación de talento con inteligencia artificial</div>
      </footer>
    </div>
  );
}

function CandidateCard({
  app,
  narrative,
  feedback,
  onChoiceChange,
  onCommentChange,
}: {
  app: Application;
  narrative: ReportCandidateNarrative;
  feedback: { choice: FeedbackChoice; comment: string } | undefined;
  onChoiceChange: (c: FeedbackChoice) => void;
  onCommentChange: (c: string) => void;
}) {
  const choice = feedback?.choice ?? null;
  return (
    <section className={`pr-section pr-candidate-card pr-affinity-${classifyAffinity(narrative.affinity_pct)}`}>
      <div className="pr-candidate-header">
        <div>
          <div className="pr-candidate-affinity-tag">{narrative.affinity_label}</div>
          <h3 className="pr-candidate-name">
            <span className="pr-candidate-initials">{getInitials(app.candidate_name)}</span>
            {app.candidate_name}
          </h3>
          <div className="pr-candidate-meta">
            ${app.salary_aspiration_usd.toLocaleString()}/mes · {app.disponibilidad} · {app.candidate_age} años
          </div>
        </div>
        <div className="pr-candidate-affinity">
          <div className="pr-candidate-affinity-pct">{narrative.affinity_pct}%</div>
          <div className="pr-candidate-affinity-label">afinidad</div>
        </div>
      </div>

      <p className="pr-candidate-paragraph">{narrative.paragraph_intro}</p>

      <div className="pr-affinity-bars">
        <div className="pr-affinity-bars-title">Afinidad con el perfil ideal</div>
        {[
          ['Conductual', narrative.afinidad_conductual],
          ['Cognitiva', narrative.afinidad_cognitiva],
          ['Técnica', narrative.afinidad_tecnica],
          ['Integridad', narrative.afinidad_integridad],
          ['Emoción', narrative.afinidad_emocion],
        ].map(([label, val]) => (
          <div key={label as string} className="pr-affinity-row">
            <span className="pr-affinity-label">{label}</span>
            <div className="pr-affinity-track">
              <div className="pr-affinity-fill" style={{ width: `${val}%` }} />
            </div>
            <span className="pr-affinity-val">{val}%</span>
          </div>
        ))}
      </div>

      <div className="pr-style-grid">
        <div className="pr-style-card">
          <div className="pr-style-label">Toma de decisiones</div>
          <p>{narrative.estilo_decisiones}</p>
        </div>
        <div className="pr-style-card">
          <div className="pr-style-label">Trabajo en equipo</div>
          <p>{narrative.estilo_equipo}</p>
        </div>
        <div className="pr-style-card">
          <div className="pr-style-label">Bajo presión</div>
          <p>{narrative.estilo_presion}</p>
        </div>
        <div className="pr-style-card">
          <div className="pr-style-label">Comunicación</div>
          <p>{narrative.estilo_comunicacion}</p>
        </div>
      </div>

      <div className="pr-fortalezas-grid">
        <div className="pr-fortalezas-card pr-fortalezas-good">
          <div className="pr-fortalezas-label">Por qué es bueno para este rol</div>
          <ul>
            {narrative.fortalezas.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
        <div className="pr-fortalezas-card pr-fortalezas-warn">
          <div className="pr-fortalezas-label">A tomar en cuenta</div>
          <ul>
            {narrative.a_tomar_en_cuenta.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      </div>

      <div className="pr-emocional-block">
        <div className="pr-emocional-label">Perfil emocional · {app.emocional?.label}</div>
        <p>{narrative.perfil_emocional_text}</p>
      </div>

      {app.tecnica && (
        <div className="pr-tecnica-block">
          <div className="pr-tecnica-pill">
            Prueba técnica: <strong>{app.tecnica.pct}%</strong> {app.tecnica.estado}
          </div>
          <div className="pr-tecnica-min">Mínimo requerido: {app.tecnica.minimo_requerido_pct}%</div>
        </div>
      )}

      <div className="pr-feedback-block">
        <div className="pr-feedback-label">¿Qué hacemos con {app.candidate_name.split(' ')[0]}?</div>
        <div className="pr-feedback-buttons">
          <button
            className={`pr-fb-btn pr-fb-interview${choice === 'interview' ? ' is-selected' : ''}`}
            onClick={() => onChoiceChange(choice === 'interview' ? null : 'interview')}
          >
            👍 Quiero entrevistar
          </button>
          <button
            className={`pr-fb-btn pr-fb-maybe${choice === 'maybe' ? ' is-selected' : ''}`}
            onClick={() => onChoiceChange(choice === 'maybe' ? null : 'maybe')}
          >
            🤔 Tal vez — necesito más info
          </button>
          <button
            className={`pr-fb-btn pr-fb-pass${choice === 'pass' ? ' is-selected' : ''}`}
            onClick={() => onChoiceChange(choice === 'pass' ? null : 'pass')}
          >
            👎 Pasar
          </button>
        </div>
        <textarea
          className="pr-feedback-comment"
          placeholder="Comentario opcional (preguntas, dudas, lo que quieras decirnos)..."
          value={feedback?.comment ?? ''}
          onChange={(e) => onCommentChange(e.target.value)}
          rows={2}
        />
      </div>
    </section>
  );
}

function DiscMini({ d, i, s, c }: { d: number; i: number; s: number; c: number }) {
  return (
    <div className="pr-disc-mini-bars">
      {([
        ['D', d, '#ef4444'],
        ['I', i, '#f59e0b'],
        ['S', s, '#10b981'],
        ['C', c, '#3b82f6'],
      ] as const).map(([label, val, color]) => (
        <div key={label} className="pr-disc-mini-bar">
          <div className="pr-disc-mini-bar-graph">
            <div style={{ height: `${val}%`, background: color }} />
          </div>
          <div className="pr-disc-mini-bar-label">{label}</div>
          <div className="pr-disc-mini-bar-val">{val}</div>
        </div>
      ))}
    </div>
  );
}

function classifyAffinity(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'mid';
  return 'low';
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((p) => p[0]).join('');
}

function formatMonth(isoDate: string): string {
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const d = new Date(isoDate);
  return `${months[d.getMonth()]} de ${d.getFullYear()}`;
}
