import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { config } from '../../config';
import { publicApi, type PortalJobApi, type PortalMilestone, type PortalFunnelStats } from '../../lib/publicApi';
import { trackPortalEvent } from '../../lib/portalTracker';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { getPortalJob, type PortalDraftPayload, type PortalJob as MockPortalJob } from '../../data/mockClientPortals';
import './client-portal.css';

const log = logger('CLIENT_PORTAL_JOB');

type PortalHeader = { client_name: string; client_company: string; agency_name: string };
type ViewState = { portal: PortalHeader; job: PortalJobApi; draft?: PortalDraftPayload };

export default function ClientPortalJobView() {
  const { token, jobId } = useParams<{ token: string; jobId: string }>();
  const [view, setView] = useState<ViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !jobId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Track job_viewed una vez por (token, jobId) en sesión
    trackPortalEvent(token, { event_type: 'portal.job_viewed', job_id: jobId }, `job_viewed:${token}:${jobId}`);

    async function load() {
      try {
        if (config.useApi) {
          const res = await publicApi.getClientPortalJob(token!, jobId!);
          if (cancelled) return;
          if (res?.portal && res.job) {
            setView({ portal: res.portal, job: res.job });
            setLoading(false);
            return;
          }
        }
        // Fallback mock
        const mock = getPortalJob(token!, jobId!);
        if (cancelled) return;
        if (mock) {
          setView(mockToView(mock));
        } else {
          setNotFound(true);
        }
      } catch (err) {
        if (cancelled) return;
        log.warn('portal job load failed', { error: (err as Error).message });
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          setNotFound(true);
        } else {
          const mock = getPortalJob(token!, jobId!);
          if (mock) setView(mockToView(mock));
          else setNotFound(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token, jobId]);

  if (loading) {
    return <div className="cp-not-found"><h1>Cargando…</h1></div>;
  }

  if (notFound || !view) {
    return (
      <div className="cp-not-found">
        <h1>Puesto no encontrado</h1>
        <p>El link puede haber expirado o el puesto cerró. <Link to={`/portal/${token}`}>Volver</Link></p>
      </div>
    );
  }

  const { portal, job, draft } = view;

  return (
    <div className="cp-root">
      <header className="cp-header">
        <div className="cp-header-brand">
          <span className="cp-brand">SharkTalents.AI</span>
          <span className="cp-brand-tag">por {portal.agency_name}</span>
        </div>
        <div className="cp-header-user">
          <div className="cp-user-name">{portal.client_name}</div>
          <div className="cp-user-company">{portal.client_company}</div>
        </div>
      </header>

      <main className="cp-main">
        <Link to={`/portal/${token}`} className="cp-back">← Mis puestos</Link>

        <h1 className="cp-job-title-big">{job.display_title}</h1>
        <p className="cp-job-meta">Iniciado el {job.created_at}</p>

        <Tracking milestones={job.milestones} estimate={job.funnel?.estimated_finalists_ready} />

        {job.stage === 'profile_pending' && draft && (
          <DraftApproval draft={draft} />
        )}

        {(job.stage === 'search_started' || job.stage === 'funnel_active') && job.funnel && (
          <FunnelView funnel={job.funnel} />
        )}

        {job.stage === 'finalists_ready' && job.report_token && (
          <FinalistsReady reportToken={job.report_token} />
        )}

        <div className="cp-help-box">
          <div className="cp-help-title">¿Tenés dudas?</div>
          <p>
            Hablá con tu reclutadora directamente o escribí a{' '}
            <a className="cp-help-link" href="mailto:cris@kunodigital.com">cris@kunodigital.com</a>.
          </p>
        </div>
      </main>

      <footer className="cp-footer">
        <div className="cp-brand">SharkTalents.AI</div>
        <div className="cp-footer-tag">Plataforma de evaluación de talento con IA</div>
      </footer>
    </div>
  );
}

function mockToView(input: { portal: { client_name: string; client_company: string; agency_name: string }; job: MockPortalJob }): ViewState {
  const job: PortalJobApi = {
    id: input.job.id,
    job_id: input.job.job_id,
    display_title: input.job.display_title,
    stage: input.job.stage === 'profile_approved' ? 'search_started' : input.job.stage,
    created_at: input.job.created_at,
    funnel: input.job.funnel,
    report_token: input.job.report_token,
    milestones: input.job.milestones,
  };
  return {
    portal: {
      client_name: input.portal.client_name,
      client_company: input.portal.client_company,
      agency_name: input.portal.agency_name,
    },
    job,
    draft: input.job.draft,
  };
}

// ====== Tracking estilo Uber Eats (4 milestones) ======

function Tracking({ milestones, estimate }: { milestones: PortalMilestone[]; estimate?: string }) {
  return (
    <section className="cp-tracking">
      <div className="cp-tracking-bar">
        {milestones.map((m, i) => {
          const isLast = i === milestones.length - 1;
          const done = m.completed_at !== null;
          const current = !done && milestones.slice(0, i).every((p) => p.completed_at !== null);
          return (
            <div key={m.key} className="cp-track-step">
              <div className="cp-track-marker">
                <div className={`cp-track-dot ${done ? 'is-done' : current ? 'is-current' : ''}`}>
                  {done ? '✓' : current ? '●' : ''}
                </div>
                {!isLast && <div className={`cp-track-line ${done ? 'is-done' : ''}`} />}
              </div>
              <div className="cp-track-info">
                <div className={`cp-track-label ${done ? 'is-done' : current ? 'is-current' : ''}`}>{m.label}</div>
                <div className="cp-track-date">
                  {done ? `Listo · ${m.completed_at}` : current ? (estimate ?? 'En progreso') : 'Pendiente'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ====== Aprobar draft del job profile (stage profile_pending) ======

function DraftApproval({ draft }: { draft: PortalDraftPayload }) {
  const [decision, setDecision] = useState<'approve' | 'request_changes' | 'talk' | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <section className="cp-section cp-draft-thanks">
        <h2 className="cp-section-title">✓ Recibimos tu respuesta</h2>
        <p>Te avisamos por email cuando tengamos novedades. Mientras tanto, podés cerrar esta pestaña tranquila.</p>
      </section>
    );
  }

  return (
    <section className="cp-section">
      <h2 className="cp-section-title">Tu nuevo perfil de puesto está listo</h2>
      <p className="cp-section-text">
        Después de tu reunión con Cris, nuestra IA armó este borrador basándose en lo que conversaron.
        Revisalo y decinos qué te parece.
      </p>

      <div className="cp-draft-card">
        <div className="cp-draft-field">
          <div className="cp-draft-label">Título del puesto</div>
          <div className="cp-draft-value">{draft.title}</div>
        </div>

        <div className="cp-draft-field">
          <div className="cp-draft-label">Contexto que entendimos</div>
          <p className="cp-draft-text">{draft.context_summary}</p>
        </div>

        <div className="cp-draft-field">
          <div className="cp-draft-label">Perfil DISC ideal</div>
          <p className="cp-draft-text">{draft.disc_ideal_text}</p>
        </div>

        <div className="cp-draft-field">
          <div className="cp-draft-label">Competencias clave</div>
          <ul className="cp-draft-bullets">
            {draft.competencias_clave.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>

        <div className="cp-draft-grid">
          <div>
            <div className="cp-draft-label">Rango salarial</div>
            <div className="cp-draft-value">{draft.salary_range_text}</div>
          </div>
          <div>
            <div className="cp-draft-label">Modalidad</div>
            <div className="cp-draft-value">{draft.modalidad}</div>
          </div>
          <div>
            <div className="cp-draft-label">Ubicación</div>
            <div className="cp-draft-value">{draft.ubicacion}</div>
          </div>
        </div>
      </div>

      <div className="cp-draft-decision">
        <div className="cp-draft-decision-title">¿Cómo querés seguir?</div>
        <div className="cp-draft-decision-buttons">
          <button
            className={`cp-dec-btn cp-dec-approve ${decision === 'approve' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'approve' ? null : 'approve')}
          >
            ✓ Aprobar y empezar a buscar
          </button>
          <button
            className={`cp-dec-btn cp-dec-changes ${decision === 'request_changes' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'request_changes' ? null : 'request_changes')}
          >
            ✏️ Sugerir ajustes
          </button>
          <button
            className={`cp-dec-btn cp-dec-talk ${decision === 'talk' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'talk' ? null : 'talk')}
          >
            📞 Necesito hablarlo con Cris
          </button>
        </div>

        {decision === 'request_changes' && (
          <textarea
            className="cp-draft-comment"
            placeholder="Contanos qué cambiarías. Ej: 'el rango salarial debería ser más alto' o 'agreguen experiencia en SAP como requisito'."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
        )}

        {decision === 'approve' && (
          <textarea
            className="cp-draft-comment"
            placeholder="Comentario opcional (algo que querés que recordemos)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
        )}

        {decision === 'talk' && (
          <p className="cp-draft-hint">
            Te vamos a llamar dentro de las próximas 24h para coordinar. Si querés que sea antes, escribime a{' '}
            <a className="cp-help-link" href="mailto:cris@kunodigital.com">cris@kunodigital.com</a>.
          </p>
        )}

        {decision !== null && (
          <button className="cp-submit-btn" onClick={() => setSubmitted(true)}>
            Enviar mi respuesta
          </button>
        )}
      </div>
    </section>
  );
}

// ====== Funnel view (stage search_started o funnel_active) ======

function FunnelView({ funnel }: { funnel: PortalFunnelStats }) {
  const stages = [
    { label: 'Aplicaron', value: funnel.applied },
    { label: 'Pasaron prefiltro', value: funnel.prefilter_passed },
    { label: 'Hicieron técnica', value: funnel.tecnica_done },
    { label: 'Hicieron conductual', value: funnel.conductual_done },
    { label: 'Hicieron integridad', value: funnel.integridad_done },
    { label: 'Finalistas', value: funnel.finalists },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <section className="cp-section">
      <h2 className="cp-section-title">Funnel de candidatos</h2>
      <p className="cp-section-text">
        ETA finalistas: <strong>{funnel.estimated_finalists_ready}</strong>. Te avisamos cuando estén listos.
      </p>
      <div className="cp-funnel-rows">
        {stages.map((s) => (
          <div key={s.label} className="cp-funnel-row">
            <span className="cp-funnel-label">{s.label}</span>
            <div className="cp-funnel-track">
              <div className="cp-funnel-fill" style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
            <span className="cp-funnel-val">{s.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ====== Finalists ready (stage finalists_ready) ======

function FinalistsReady({ reportToken }: { reportToken: string }) {
  return (
    <section className="cp-section cp-finalists-ready">
      <h2 className="cp-section-title">🎯 Tus finalistas están listos</h2>
      <p className="cp-section-text">
        Los candidatos completaron todas las evaluaciones (técnica, conductual, integridad).
        Preparamos un reporte detallado con afinidad por dimensión, narrativa IA por candidato,
        comparativo y recomendación final.
      </p>
      <Link to={`/report/${reportToken}`} className="cp-submit-btn cp-finalists-cta">
        Ver reporte de finalistas →
      </Link>
    </section>
  );
}
