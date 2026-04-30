import { useParams, Link } from 'react-router-dom';
import {
  getApplicationById,
  STATE_LABELS,
  SOURCE_LABELS,
  type TimelineEvent,
} from '../data/mockApplications';
import { getJobById } from '../data/mockJobs';
import './pages.css';
import './candidate-detail.css';

const CATEGORY_DOT: Record<TimelineEvent['category'], string> = {
  application: '🟢',
  evaluation: '📊',
  decision: '🎯',
  communication: '✉️',
  alert: '⚠️',
};

const ACTOR_LABEL: Record<TimelineEvent['actor'], string> = {
  system: 'sistema',
  admin: 'admin',
  bot: 'bot decisor',
  candidate: 'candidato',
  webhook: 'integración',
};

export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>();
  const app = id ? getApplicationById(id) : undefined;

  if (!app) {
    return (
      <div>
        <p>
          Candidato no encontrado. <Link to="/candidates">Volver</Link>
        </p>
      </div>
    );
  }

  const job = getJobById(app.job_id);
  const hasAntiCheat = app.anti_cheat_events.length > 0;

  return (
    <div className="candidate-detail">
      {job && (
        <Link to={`/jobs/${job.id}`} className="back-link">
          ← {job.title}
        </Link>
      )}

      <header className="cd-header">
        <div>
          <h1 className="cd-name">{app.candidate_name}</h1>
          <div className="cd-meta">
            {app.candidate_email} · {app.candidate_age} años · ${app.salary_aspiration_usd.toLocaleString()}/mes
            {' · '}
            <span className="muted">{app.disponibilidad}</span>
          </div>
          <div className="cd-meta-secondary">
            <span className="source-tag">{SOURCE_LABELS[app.source]}</span>
            <span> · aplicó el {app.applied_at}</span>
          </div>
        </div>
        <div className="cd-stage-badge">{STATE_LABELS[app.state]}</div>
      </header>

      <section className="cd-summary-card">
        <div className="cd-summary-label">RESUMEN EJECUTIVO (IA)</div>
        <p className="cd-summary-text">{app.ia_summary}</p>
        {app.bot_recommendation && (
          <div className="cd-bot-rec">
            <span className="cd-bot-rec-label">Bot decisor:</span> {app.bot_recommendation}
            {app.bot_confidence != null && (
              <span className="cd-bot-conf"> · confidence {(app.bot_confidence * 100).toFixed(0)}%</span>
            )}
          </div>
        )}
      </section>

      {hasAntiCheat && (
        <section className="cd-anticheat-banner">
          <div className="cd-ac-title">⚠️ ANTI-TRAMPA — {app.anti_cheat_events.length} eventos detectados</div>
          <div className="cd-ac-body">
            {app.anti_cheat_events.slice(0, 6).map((e, i) => (
              <span key={i} className="cd-ac-event">
                {e.phase}: {e.type === 'cursor_out' ? 'cursor fuera' : e.type === 'window_blur' ? 'ventana perdió foco' : 'paste'} en {e.question_id}
              </span>
            ))}
          </div>
          <div className="cd-ac-rec">
            Recomendación: revisar CV con detalle y considerar entrevistar antes de avanzar.
          </div>
        </section>
      )}

      <section className="cd-stat-grid">
        <div className="cd-stat-card">
          <div className="cd-stat-label">DISC</div>
          {app.disc ? (
            <>
              <div className="cd-stat-value">{app.disc.similitud_pct}%</div>
              <div className="cd-stat-sub">{app.disc.dominant_label}</div>
              <div className="cd-stat-sub2">{app.disc.pk_profile_code} — {app.disc.pk_profile_name}</div>
              <div className="cd-disc-bars">
                {(['d', 'i', 's', 'c'] as const).map((k) => (
                  <div key={k} className="cd-disc-bar">
                    <span className="cd-disc-bar-label">{k.toUpperCase()}</span>
                    <div className="cd-disc-bar-track">
                      <div className={`cd-disc-bar-fill cd-disc-${k}`} style={{ width: `${app.disc![k]}%` }} />
                    </div>
                    <span className="cd-disc-bar-val">{app.disc![k]}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="cd-stat-pending">Pendiente</div>
          )}
        </div>

        <div className="cd-stat-card">
          <div className="cd-stat-label">VELNA Cognitiva</div>
          {app.velna ? (
            <>
              <div className="cd-stat-value">{app.velna.similitud_pct}%</div>
              <div className="cd-stat-sub">similitud con perfil ideal</div>
              <div className="cd-velna-rows">
                {[
                  ['Verbal', app.velna.verbal],
                  ['Espacial', app.velna.espacial],
                  ['Lógica', app.velna.logica],
                  ['Numérica', app.velna.numerica],
                  ['Abstracta', app.velna.abstracta],
                ].map(([label, value]) => (
                  <div key={label as string} className="cd-velna-row">
                    <span className="cd-velna-label">{label}</span>
                    <div className="cd-velna-track">
                      <div className="cd-velna-fill" style={{ width: `${value}%` }} />
                    </div>
                    <span className="cd-velna-val">{value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="cd-stat-pending">Pendiente</div>
          )}
        </div>

        <div className="cd-stat-card">
          <div className="cd-stat-label">Técnica</div>
          {app.tecnica ? (
            <>
              <div className="cd-stat-value">{app.tecnica.pct}%</div>
              <div className={`cd-stat-sub cd-tecnica-${app.tecnica.estado.toLowerCase().replace(/\s/g, '-')}`}>
                {app.tecnica.estado}
              </div>
              <div className="cd-stat-sub2">mínimo requerido: {app.tecnica.minimo_requerido_pct}%</div>
            </>
          ) : (
            <div className="cd-stat-pending">Pendiente</div>
          )}
        </div>

        <div className="cd-stat-card">
          <div className="cd-stat-label">Integridad</div>
          {app.integridad ? (
            <>
              <div className="cd-stat-value">
                {app.integridad.observations.length === 0 && !app.integridad.buena_impresion_alta
                  ? 'Sin alertas'
                  : `${app.integridad.observations.length} obs.`}
              </div>
              {app.integridad.buena_impresion_alta && (
                <div className="cd-stat-warn">⚠️ Buena impresión alta (deseabilidad social)</div>
              )}
            </>
          ) : (
            <div className="cd-stat-pending">Pendiente</div>
          )}
        </div>

        <div className="cd-stat-card">
          <div className="cd-stat-label">Emoción</div>
          {app.emocional ? (
            <>
              <div className="cd-stat-value">{app.emocional.label}</div>
              <div className="cd-stat-sub">{app.emocional.value}/100</div>
              <div className="cd-emocion-track">
                <div className="cd-emocion-marker" style={{ left: `${app.emocional.value}%` }} />
              </div>
              <div className="cd-emocion-axis">
                <span>Espontáneo</span>
                <span>Mesura</span>
                <span>Reflexivo</span>
              </div>
            </>
          ) : (
            <div className="cd-stat-pending">Pendiente</div>
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title">Timeline</h2>
        <ol className="cd-timeline">
          {app.timeline.map((e, i) => (
            <li key={i} className={`cd-timeline-item cd-tl-${e.category}`}>
              <div className="cd-tl-dot">{CATEGORY_DOT[e.category]}</div>
              <div className="cd-tl-body">
                <div className="cd-tl-meta">
                  <span className="cd-tl-date">{e.at}</span>
                  <span className="cd-tl-actor">· {ACTOR_LABEL[e.actor]}</span>
                </div>
                <div className="cd-tl-text">{e.summary_text}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="cd-sticky-actions">
        <button className="btn-primary" onClick={() => alert('Mock: avanzar etapa')}>
          → Avanzar etapa
        </button>
        <button className="cd-btn-secondary" onClick={() => alert('Mock: marcar duda')}>
          ? Duda — Revisar CV
        </button>
        <button className="cd-btn-danger" onClick={() => alert('Mock: rechazar')}>
          ✕ Rechazar
        </button>
        <button className="cd-btn-ghost" onClick={() => alert('Mock: descargar PDF')}>
          📄 Descargar PDF
        </button>
      </div>
    </div>
  );
}
