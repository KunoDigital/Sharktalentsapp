import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { config } from '../../config';
import { publicApi, type PortalJobApi, type PortalMilestone, type PortalFunnelStats } from '../../lib/publicApi';
import { trackPortalEvent } from '../../lib/portalTracker';
import { logger } from '../../lib/logger';
import { getPortalJob, type PortalDraftPayload, type PortalJob as MockPortalJob } from '../../data/mockClientPortals';
import { ClientHelpBox } from './ClientHelpBox';
import { PublicPortalFooter } from './PublicPortalFooter';
import './client-portal.css';

const log = logger('CLIENT_PORTAL_JOB');

type PortalHeader = {
  client_name: string;
  client_company: string;
  agency_name: string;
  recruiter_email?: string;
  recruiter_whatsapp?: string | null;
};
type FinalistPreview = { display_name: string; one_liner: string; match_pct: number | null };
type ViewState = { portal: PortalHeader; job: PortalJobApi; draft?: PortalDraftPayload; finalistsPreview?: FinalistPreview[] };

function fmtRelative(timestamp: number): string {
  const secAgo = Math.round((Date.now() - timestamp) / 1000);
  if (secAgo < 60) return 'hace segundos';
  if (secAgo < 3600) return `hace ${Math.round(secAgo / 60)} min`;
  if (secAgo < 86400) return `hace ${Math.round(secAgo / 3600)} h`;
  return `hace ${Math.round(secAgo / 86400)} días`;
}

const SOUND_PREF_KEY = 'portal_sound_enabled';

function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const start = ctx.currentTime;
    // Dos notas: re-mi (587 → 659 Hz), 200ms cada una.
    [{ f: 587, t: 0 }, { f: 659, t: 0.22 }].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, start + t);
      gain.gain.exponentialRampToValueAtTime(0.18, start + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + t);
      osc.stop(start + t + 0.22);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* sin sonido */
  }
}

export default function ClientPortalJobView() {
  const { token, jobId } = useParams<{ token: string; jobId: string }>();
  const [view, setView] = useState<ViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [justDoneKeys, setJustDoneKeys] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(SOUND_PREF_KEY) === '1'; } catch { return false; }
  });
  const prevDoneRef = useRef<Set<string>>(new Set());
  const prevFinalistsRef = useRef<number>(-1);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  function handleViewUpdate(next: ViewState) {
    const newDone = new Set(next.job.milestones.filter((m) => m.completed_at !== null).map((m) => m.key));
    const prev = prevDoneRef.current;
    const flashKeys = new Set<string>();
    newDone.forEach((k) => { if (!prev.has(k)) flashKeys.add(k); });

    const isInitial = prev.size === 0 && prevFinalistsRef.current === -1;
    if (!isInitial && flashKeys.size > 0) {
      setJustDoneKeys(flashKeys);
      setTimeout(() => setJustDoneKeys(new Set()), 1600);
    }

    const newFinalists = next.job.funnel?.finalists ?? 0;
    const prevFinalists = prevFinalistsRef.current;
    if (!isInitial && prevFinalists >= 0 && prevFinalists === 0 && newFinalists > 0 && soundEnabledRef.current) {
      playChime();
    }

    prevDoneRef.current = newDone;
    prevFinalistsRef.current = newFinalists;
    setView(next);
  }

  function toggleSound() {
    setSoundEnabled((curr) => {
      const next = !curr;
      try { localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      if (next) playChime(); // feedback inmediato + "warm up" del AudioContext (requiere user gesture)
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    if (!token || !jobId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Reset diff state al cambiar de puesto (evita flash espurio al navegar)
    prevDoneRef.current = new Set();
    prevFinalistsRef.current = -1;
    setJustDoneKeys(new Set());

    // Track job_viewed una vez por (token, jobId) en sesión
    trackPortalEvent(token, { event_type: 'portal.job_viewed', job_id: jobId }, `job_viewed:${token}:${jobId}`);

    async function load(isRefresh = false) {
      try {
        if (config.useApi) {
          const res = await publicApi.getClientPortalJob(token!, jobId!);
          if (cancelled) return;
          if (res?.portal && res.job) {
            handleViewUpdate({ portal: res.portal, job: res.job, finalistsPreview: res.finalists_preview });
            setLastUpdated(Date.now());
            if (!isRefresh) setLoading(false);
            return;
          }
          if (!isRefresh) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }
        // Modo dev sin backend: mock fallback.
        const mock = getPortalJob(token!, jobId!);
        if (cancelled) return;
        if (mock) handleViewUpdate(mockToView(mock));
        else setNotFound(true);
      } catch (err) {
        if (cancelled) return;
        log.warn('portal job load failed', { error: (err as Error).message });
        if (isRefresh) return;  // en refresh silencioso, mantener data previa
        if (config.useApi) {
          setNotFound(true);
          return;
        }
        const mock = getPortalJob(token!, jobId!);
        if (mock) handleViewUpdate(mockToView(mock));
        else setNotFound(true);
      } finally {
        if (!isRefresh && !cancelled) setLoading(false);
      }
    }

    load();

    // Auto-refresh cada 60s solo si la tab está visible
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void load(true);
      }
    }, 60_000);

    return () => { cancelled = true; clearInterval(intervalId); };
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
          <button
            type="button"
            onClick={toggleSound}
            className="cp-sound-toggle"
            aria-pressed={soundEnabled}
            title={soundEnabled
              ? 'Te avisamos con un sonido cuando lleguen los finalistas'
              : 'Activá un aviso sonoro cuando lleguen los finalistas'}
          >
            {soundEnabled ? '🔊 Avisos sonoros' : '🔇 Activar avisos'}
          </button>
          <div className="cp-user-name">{portal.client_name}</div>
          <div className="cp-user-company">{portal.client_company}</div>
        </div>
      </header>

      <main className="cp-main">
        <Link to={`/portal/${token}`} className="cp-back">← Mis puestos</Link>

        <h1 className="cp-job-title-big">{job.display_title}</h1>
        <p className="cp-job-meta">
          Iniciado el {job.created_at}
          <span style={{ marginLeft: 12, fontSize: 11, color: '#9ca3af' }}>
            · Actualizado {fmtRelative(lastUpdated)}
          </span>
        </p>

        <Tracking milestones={job.milestones} estimate={job.funnel?.estimated_finalists_ready} justDoneKeys={justDoneKeys} />

        {job.stage === 'profile_pending' && draft && (
          <DraftApproval draft={draft} token={token!} draftId={(job as { draft_id?: string }).draft_id} />
        )}

        {(job.stage === 'search_started' || job.stage === 'funnel_active') && job.funnel && (
          <FunnelView funnel={job.funnel} />
        )}

        {job.stage === 'finalists_ready' && job.report_token && (
          <FinalistsReady reportToken={job.report_token} preview={view.finalistsPreview} />
        )}

        <ClientHelpBox
          recruiterEmail={portal.recruiter_email}
          recruiterWhatsapp={portal.recruiter_whatsapp}
        />
      </main>

      <PublicPortalFooter />
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

function Tracking({ milestones, estimate, justDoneKeys }: { milestones: PortalMilestone[]; estimate?: string; justDoneKeys?: Set<string> }) {
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
                <div className={`cp-track-dot ${done ? 'is-done' : current ? 'is-current' : ''} ${done && justDoneKeys?.has(m.key) ? 'is-just-done' : ''}`}>
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

function DraftApproval({ draft, token, draftId }: { draft: PortalDraftPayload; token: string; draftId?: string }) {
  const [decision, setDecision] = useState<'approve' | 'request_changes' | 'talk' | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!decision) return;
    if (!draftId) {
      // Fallback: si no tenemos draftId (modo demo/mock), avisar al cliente
      // que use el link específico del email del draft.
      setSubmitError('Para aprobar el perfil del puesto, usá el link que te llegó por email.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (decision === 'approve') {
        const res = await publicApi.approveDraft(token, draftId, comment.trim() || undefined);
        if (!res || !res.ok) throw new Error('No se pudo aprobar');
      } else if (decision === 'request_changes') {
        if (!comment.trim()) {
          setSubmitError('Antes de pedir cambios, escribí qué necesitás ajustar.');
          setSubmitting(false);
          return;
        }
        const res = await publicApi.requestDraftChanges(token, draftId, comment.trim());
        if (!res || !res.ok) throw new Error('No se pudo enviar los cambios');
      }
      // decision === 'talk' no requiere endpoint — solo el aviso visual y email aparte.
      setSubmitted(true);
    } catch (err) {
      setSubmitError((err as Error).message || 'Error desconocido');
    } finally {
      setSubmitting(false);
    }
  }

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
        Después de tu reunión, nuestra IA armó este borrador. Tomate 5 minutos para revisarlo
        y decinos si está alineado.
      </p>

      {/* TL;DR destacado al inicio */}
      <div style={{
        background: 'rgba(218, 253, 111, 0.06)',
        border: '1px solid rgba(218, 253, 111, 0.3)',
        borderRadius: 8,
        padding: '16px 20px',
        margin: '16px 0',
      }}>
        <div style={{ fontSize: 12, color: '#dafd6f', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          En resumen
        </div>
        <div style={{ fontSize: 16, color: '#f3f4f6', fontWeight: 600, marginBottom: 8 }}>
          {draft.title}
        </div>
        <div style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          {draft.context_summary?.slice(0, 280)}
          {draft.context_summary && draft.context_summary.length > 280 && '…'}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: '#a0a8b8' }}>
          <span>💰 {draft.salary_range_text}</span>
          <span>🌎 {draft.modalidad}</span>
          <span>📍 {draft.ubicacion}</span>
        </div>
      </div>

      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', color: '#a0a8b8', fontSize: 13, padding: '8px 0' }}>
          Ver detalle completo del perfil
        </summary>
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
      </details>

      <div className="cp-draft-decision">
        <div className="cp-draft-decision-title">¿Cómo querés seguir?</div>
        <button
          className={`cp-dec-btn cp-dec-approve ${decision === 'approve' ? 'is-selected' : ''}`}
          onClick={() => setDecision(decision === 'approve' ? null : 'approve')}
          style={{
            display: 'block',
            width: '100%',
            marginBottom: 12,
            padding: '14px 20px',
            fontSize: 16,
            fontWeight: 600,
            background: decision === 'approve' ? '#16a34a' : '#dafd6f',
            color: decision === 'approve' ? '#fff' : '#0e1218',
            border: 0,
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          ✓ Aprobar y empezar a buscar candidatos
        </button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`cp-dec-btn cp-dec-changes ${decision === 'request_changes' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'request_changes' ? null : 'request_changes')}
            style={{
              flex: 1,
              minWidth: 140,
              padding: '10px 16px',
              fontSize: 13,
              background: decision === 'request_changes' ? '#fef3c7' : 'transparent',
              color: decision === 'request_changes' ? '#78350f' : '#a0a8b8',
              border: '1px solid #4b5563',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            ✏️ Sugerir ajustes
          </button>
          <button
            className={`cp-dec-btn cp-dec-talk ${decision === 'talk' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'talk' ? null : 'talk')}
            style={{
              flex: 1,
              minWidth: 140,
              padding: '10px 16px',
              fontSize: 13,
              background: decision === 'talk' ? '#dbeafe' : 'transparent',
              color: decision === 'talk' ? '#1e40af' : '#a0a8b8',
              border: '1px solid #4b5563',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            📞 Prefiero hablarlo
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
          <button className="cp-submit-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Enviando…' : 'Enviar mi respuesta'}
          </button>
        )}
        {submitError && (
          <p className="cp-draft-hint" style={{ color: '#dc2626' }}>{submitError}</p>
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

  // Empty state: no hay aplicaciones todavía
  if (funnel.applied === 0) {
    return (
      <section className="cp-section">
        <h2 className="cp-section-title">Funnel de candidatos</h2>
        <div style={{ padding: 24, textAlign: 'center', background: '#f9fafb', borderRadius: 8, border: '1px dashed #d1d5db' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          <p style={{ margin: '0 0 8px 0', fontSize: 15, fontWeight: 600, color: '#1f2937' }}>
            Tu búsqueda está activa. Los primeros candidatos están en camino.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            ETA finalistas: <strong>{funnel.estimated_finalists_ready}</strong>. Te avisamos cuando lleguen los primeros.
          </p>
        </div>
      </section>
    );
  }

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

function FinalistsReady({ reportToken, preview }: { reportToken: string; preview?: FinalistPreview[] }) {
  return (
    <section className="cp-section cp-finalists-ready">
      <h2 className="cp-section-title">🎯 Tus finalistas están listos</h2>
      <p className="cp-section-text">
        Los candidatos completaron todas las evaluaciones (técnica, conductual, integridad).
        Preparamos un reporte detallado con afinidad por dimensión, narrativa IA por candidato,
        comparativo y recomendación final.
      </p>

      {preview && preview.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '20px 0' }}>
          {preview.map((p, idx) => (
            <div
              key={idx}
              style={{
                background: 'rgba(218, 253, 111, 0.05)',
                border: '1px solid rgba(218, 253, 111, 0.3)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: '#dafd6f', color: '#0e1218',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14, flexShrink: 0,
              }}>
                {idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 15, color: '#f3f4f6' }}>{p.display_name}</strong>
                  {p.match_pct != null && (
                    <span style={{ color: '#dafd6f', fontSize: 13, fontWeight: 600 }}>
                      Match {p.match_pct}%
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>{p.one_liner}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link to={`/report/${reportToken}`} className="cp-submit-btn cp-finalists-cta">
        Ver reporte detallado →
      </Link>
    </section>
  );
}
