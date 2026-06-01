import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getApplicationById,
  STATE_LABELS,
  SOURCE_LABELS,
  type Application,
  type TimelineEvent,
} from '../data/mockApplications';
import { getJobById } from '../data/mockJobs';
import { Term } from '../components/Tooltip';
import CandidateVideosPanel from '../components/CandidateVideosPanel';
import CandidateMindsetPanel from '../components/CandidateMindsetPanel';
import CandidateEnglishPanel from '../components/CandidateEnglishPanel';
import PrefilterAnswersPanel from '../components/PrefilterAnswersPanel';
import OfferForm from '../components/OfferForm';
import { useApi, ApiError } from '../lib/api';
import { adaptToMockApplication } from '../lib/applicationAdapter';
import { config } from '../config';
import './pages.css';
import './candidate-detail.css';
import './bot.css';

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
  const api = useApi();
  const [liveApp, setLiveApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(config.useApi);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !config.useApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const appResp = await api.applications.get(id!);
        const a = appResp.application;
        const [candResp, scoresResp, integrityResp] = await Promise.all([
          api.candidates.get(a.candidate_id).catch(() => null),
          api.applications.readScores(a.ROWID).catch(() => null),
          api.applications.readIntegrity(a.ROWID).catch(() => null),
        ]);
        if (cancelled) return;
        const adapted = adaptToMockApplication(
          {
            ROWID: a.ROWID,
            assessment_id: a.assessment_id,
            candidate_id: a.candidate_id,
            pipeline_stage: a.pipeline_stage,
            started_at: a.started_at,
            completed_at: a.completed_at,
          },
          candResp ? {
            name: candResp.candidate.name,
            email: candResp.candidate.email,
            phone: candResp.candidate.phone,
            age: candResp.candidate.age ?? null,
          } : undefined,
          scoresResp?.scores ?? null,
          (integrityResp?.integrity?.dimensions ?? []).map((d) => ({
            dimension: d.dimension,
            nivel: d.nivel,
            pct: d.pct,
          })),
        );
        setLiveApp(adapted);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setLoadError('Application no encontrada en backend.');
        } else {
          setLoadError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, api]);

  const mockApp = id ? getApplicationById(id) : undefined;
  const app: Application | undefined = liveApp ?? mockApp;

  if (loading && !app) {
    return <div><p className="muted">Cargando candidato…</p></div>;
  }

  if (!app) {
    return (
      <div>
        <p>
          Candidato no encontrado. <Link to="/candidates">Volver</Link>
          {loadError && <span className="muted small"> · {loadError}</span>}
        </p>
      </div>
    );
  }

  const job = getJobById(app.job_id);
  const hasAntiCheat = app.anti_cheat_events.length > 0;
  const usingFallbackMock = config.useApi && !liveApp && mockApp;

  return (
    <div className="candidate-detail">
      {usingFallbackMock && (
        <p className="muted-note">⚠️ Datos del backend no disponibles — mostrando mock para esta vista.</p>
      )}
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
      </section>

      <PrefilterAnswersPanel applicationId={app.id} />

      {app.state === 'finalist' && (
        <section style={{ marginBottom: '1rem' }}>
          <OfferForm
            applicationId={app.id}
            candidateName={app.candidate_name}
            jobTitle={job?.title}
          />
        </section>
      )}

      {app.bot_decision && (
        <section className={`cd-bot-section ${app.bot_decision.needs_review ? 'cd-bot-needs-review-card' : ''}`}>
          <div className="cd-bot-header">
            <div>
              <div className="cd-bot-title">Decisión del bot — modo {app.bot_decision.mode}</div>
              <div className="cd-bot-recommendation">{app.bot_decision.recommendation}</div>
            </div>
            <div className="cd-bot-confidence-block">
              <div className={`cd-bot-confidence-pct ${app.bot_decision.confidence < app.bot_decision.threshold ? 'is-low' : 'is-high'}`}>
                {(app.bot_decision.confidence * 100).toFixed(0)}%
              </div>
              <div className="cd-bot-confidence-label">
                confidence · umbral {(app.bot_decision.threshold * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {app.bot_decision.needs_review && (
            <div className="cd-bot-needs-review">
              ⚠️ Confidence debajo del umbral — el bot no auto-aplicó esta decisión y la dejó para tu revisión.
            </div>
          )}

          <p className="cd-bot-rationale-text">{app.bot_decision.rationale_text}</p>

          <div className="cd-bot-factors">
            <div className="cd-bot-factors-label">Factores que pesó (peso · señal)</div>
            {app.bot_decision.rationale_factors.map((f, i) => (
              <div key={i} className="cd-bot-factor-row">
                <div className="cd-bot-factor-label">
                  {f.label} <span className="muted small">({(f.weight * 100).toFixed(0)}%)</span>
                </div>
                <div className="cd-bot-factor-signal">{f.signal}</div>
              </div>
            ))}
          </div>

          <div className="cd-bot-rag">
            <div className="cd-bot-rag-label">Casos similares que el bot consultó (RAG)</div>
            <div className="cd-bot-rag-list">
              {app.bot_decision.rag_examples.map((ex, i) => (
                <div key={i} className="cd-bot-rag-item">
                  <div>
                    <div className="cd-bot-rag-item-name">{ex.candidate_name}</div>
                    <div className="cd-bot-rag-item-outcome">{ex.outcome}</div>
                  </div>
                  <span className="cd-bot-rag-similarity">{ex.similarity_pct}% similar</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {hasAntiCheat && (
        <section className="cd-anticheat-banner">
          <div className="cd-ac-title">⚠️ <Term name="anti-trampa">ANTI-TRAMPA</Term> — {app.anti_cheat_events.length} eventos detectados</div>
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
          <div className="cd-stat-label"><Term name="DISC">DISC</Term></div>
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
          <div className="cd-stat-label"><Term name="VELNA">VELNA</Term> Cognitiva</div>
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
          <div className="cd-stat-label"><Term name="integridad">Integridad</Term></div>
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

      <CandidateMindsetPanel applicationId={app.id} />

      <CandidateEnglishPanel applicationId={app.id} />

      <CandidateVideosPanel applicationId={app.id} />

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
