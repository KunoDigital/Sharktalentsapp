import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getReportByToken, type ReportCandidateNarrative, type Report } from '../../data/mockReports';
import { getJobById, type Job } from '../../data/mockJobs';
import { getApplicationById, type Application } from '../../data/mockApplications';
import { exportElementToPdf, slugifyForFilename } from '../../lib/pdfExport';
import { config } from '../../config';
import { publicApi, type BundleVideoAnalysis, type BundleMindset, type BundleEnglish } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { adaptBundleReport } from '../../lib/reportAdapter';
import { logger } from '../../lib/logger';
import './public-report.css';

const log = logger('PUBLIC_REPORT');

type LoadedReport = {
  job: Job;
  report: Report;
  applications: Application[];
  videosByApp: Record<string, BundleVideoAnalysis[]>;
  mindsetByApp: Record<string, BundleMindset>;
  englishByApp: Record<string, BundleEnglish>;
  narrativesStatus: 'ok' | 'partial' | 'failed' | 'mock';
};

const VIDEO_CATEGORY_LABEL: Record<string, string> = {
  technical: '🔧 Técnica',
  weakness_followup: '⚠️ Debilidad',
  situational: '🎬 Situacional',
  cv_claim_check: '📄 Validar CV',
  integrity_check: '🛡 Integridad',
  english_check: '🇺🇸 Inglés',
};

type FeedbackChoice = 'interview' | 'pass' | 'maybe' | null;
type FeedbackState = Record<string, { choice: FeedbackChoice; comment: string }>;

export default function PublicReport() {
  const { token } = useParams<{ token: string }>();
  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [feedback, setFeedback] = useState<FeedbackState>({});
  const [submitted, setSubmitted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) { setNotFound(true); setLoading(false); return; }

    async function load() {
      try {
        if (config.useApi) {
          const res = await publicApi.getReportBundle(token!);
          if (cancelled) return;
          if (res?.report) {
            const adapted = adaptBundleReport(res.report, token!);
            setLoaded({
              ...adapted,
              narrativesStatus: res.report.narratives?.status ?? 'failed',
            });
            setLoading(false);
            return;
          }
        }
        // Fallback: mock
        const mockReport = getReportByToken(token!);
        const mockJob = mockReport ? getJobById(mockReport.job_id) : undefined;
        if (cancelled) return;
        if (mockReport && mockJob) {
          const apps = mockReport.candidate_app_ids
            .map((id) => getApplicationById(id))
            .filter((a): a is Application => a !== undefined);
          setLoaded({
            job: mockJob,
            report: mockReport,
            applications: apps,
            videosByApp: {},
            mindsetByApp: buildMockMindset(apps),
            englishByApp: buildMockEnglish(apps, mockJob.english_required, mockJob.english_min_level),
            narrativesStatus: 'mock',
          });
        } else {
          setNotFound(true);
        }
      } catch (err) {
        if (cancelled) return;
        log.warn('report load failed', { error: (err as Error).message });
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          setNotFound(true);
        } else {
          // Fallback a mock en errores transitorios
          const mockReport = getReportByToken(token!);
          const mockJob = mockReport ? getJobById(mockReport.job_id) : undefined;
          if (mockReport && mockJob) {
            const apps = mockReport.candidate_app_ids
              .map((id) => getApplicationById(id))
              .filter((a): a is Application => a !== undefined);
            setLoaded({ job: mockJob, report: mockReport, applications: apps, videosByApp: {}, mindsetByApp: buildMockMindset(apps), englishByApp: buildMockEnglish(apps, mockJob.english_required, mockJob.english_min_level), narrativesStatus: 'mock' });
          } else {
            setNotFound(true);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <div className="pr-not-found"><h1>Cargando reporte…</h1></div>;
  }

  if (notFound || !loaded) {
    return (
      <div className="pr-not-found">
        <h1>Reporte no encontrado</h1>
        <p>El link puede haber expirado o ser inválido. Contactá a Kuno Digital para más info.</p>
      </div>
    );
  }

  const { job, report, applications, videosByApp, mindsetByApp, englishByApp, narrativesStatus } = loaded;
  const candidates = applications;

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

  async function handleDownloadPdf() {
    if (!reportRef.current || !job || !report) return;
    setExporting(true);
    try {
      const filename = `reporte-${slugifyForFilename(job.title)}-${report.published_at}.pdf`;
      await exportElementToPdf(reportRef.current, filename);
    } catch (err) {
      alert(`Error al generar PDF: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="pr-root">
      <header className="pr-header">
        <div className="pr-header-brand">
          <span className="pr-brand">SharkTalents.AI</span>
          <span className="pr-brand-tag">Evaluación de talento con inteligencia artificial</span>
        </div>
        <div className="pr-header-actions">
          <button
            className="pr-download-btn"
            onClick={handleDownloadPdf}
            disabled={exporting}
            title="Descargar como PDF"
          >
            {exporting ? 'Generando…' : '📄 Descargar PDF'}
          </button>
          <div className="pr-header-finalists">
            {candidates.length} {candidates.length === 1 ? 'persona evaluada' : 'finalistas'}
          </div>
        </div>
      </header>

      <main className="pr-main" ref={reportRef as React.RefObject<HTMLElement>}>
        <div className="pr-title-block">
          <h1 className="pr-title">{job.title.toUpperCase()}</h1>
          <div className="pr-subtitle">{report.tenant_name}</div>
          <div className="pr-date">{formatMonth(report.published_at)}</div>
          <div className="pr-confidential">CONFIDENCIAL</div>
        </div>

        {(narrativesStatus === 'partial' || narrativesStatus === 'failed') && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '6px',
            marginBottom: '1rem',
            color: '#f59e0b',
            fontSize: '0.85rem',
          }}>
            ⚠️ Las narrativas IA {narrativesStatus === 'partial' ? 'se generaron parcialmente' : 'no se pudieron generar'}.
            Los scores y datos de los candidatos son reales; el análisis textual puede aparecer vacío en algunas secciones.
          </div>
        )}

        {narrativesStatus === 'mock' && (
          <div style={{
            padding: '0.6rem 1rem',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px dashed rgba(99, 102, 241, 0.4)',
            borderRadius: '6px',
            marginBottom: '1rem',
            color: '#a5b4fc',
            fontSize: '0.8rem',
          }}>
            📺 Demo · Estás viendo un reporte de ejemplo con datos ficticios. Cuando el backend esté activo y haya candidatos finalistas reales, este reporte muestra datos del cliente.
          </div>
        )}

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
          <h2 className="pr-section-title">
            {candidates.length === 1 ? 'Tu reporte está listo' : 'Sus finalistas están listos'}
          </h2>
          <p className="pr-section-text">
            {candidates.length === 1
              ? `${candidates[0].candidate_name} completó las evaluaciones disponibles en este reporte. Abajo encontrás el análisis detallado por dimensión. Las secciones que no fueron evaluadas en esta versión aparecen marcadas como "No disponible".`
              : `Los ${candidates.length} candidatos completaron las evaluaciones conductual, cognitiva, emocional, integridad y técnica. Los ordenamos por afinidad con el perfil ideal para ayudarte a decidir a quién entrevistar primero.`}
          </p>
          <p className="pr-section-text pr-section-strong">
            {candidates.length === 1
              ? 'Siguiente paso: revisá el análisis y decidí si avanzar con esta persona.'
              : 'Siguiente paso: entrevista personal con el candidato de tu preferencia.'}
          </p>
        </section>

        {candidates.length > 1 && (
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
        )}

        {candidates.map((app) => (
          <CandidateCard
            key={app.id}
            app={app}
            narrative={report.narratives[app.id]}
            videos={videosByApp[app.id] ?? null}
            mindset={mindsetByApp[app.id] ?? null}
            english={englishByApp[app.id] ?? null}
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
  videos,
  mindset,
  english,
  feedback,
  onChoiceChange,
  onCommentChange,
}: {
  app: Application;
  narrative: ReportCandidateNarrative;
  videos: BundleVideoAnalysis[] | null;
  mindset: BundleMindset | null;
  english: BundleEnglish | null;
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

      {app.tecnica ? (
        <div className="pr-tecnica-block">
          <div className="pr-tecnica-pill">
            Prueba técnica: <strong>{app.tecnica.pct}%</strong> {app.tecnica.estado}
          </div>
          <div className="pr-tecnica-min">Mínimo requerido: {app.tecnica.minimo_requerido_pct}%</div>
        </div>
      ) : (
        <NotAvailableBlock
          icon="🔧"
          title="Prueba técnica"
          message="No evaluada en este reporte. La prueba técnica se personaliza por rol (lenguaje, framework, nivel de complejidad) y forma parte del servicio completo."
        />
      )}

      {mindset && mindset.adaptability_score_pct !== null ? (
        <div className="pr-mindset-block" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            🧠 Adaptabilidad y resiliencia
          </h4>
          <div style={{ marginBottom: '0.5rem' }}>
            Patrón: <strong>{mindset.adaptability_pattern?.toUpperCase() ?? '—'}</strong>
            {' · '}
            Score: <strong>{mindset.adaptability_score_pct}%</strong>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--st-fg-muted)', marginBottom: '0.5rem' }}>
            Mide cómo el candidato aborda situaciones cotidianas (basado en marco McKinsey Forward).
            Un score alto indica mentalidades adaptables (crecimiento, agente, exploración) por defecto.
          </p>
        </div>
      ) : (
        <NotAvailableBlock
          icon="🧠"
          title="Adaptabilidad y resiliencia"
          message="No evaluada en este reporte. Mide cómo el candidato responde al cambio y la presión (marco McKinsey Forward). Forma parte del servicio completo."
        />
      )}

      {english && english.total_score_pct !== null ? (
        <div className="pr-english-block" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            🇺🇸 Inglés ({english.level_required ?? 'CEFR'})
          </h4>
          <div>
            Resultado: <strong>{english.passed ? '✓ Cumple' : '✗ No alcanza'}</strong>
            {' · '}
            Score: <strong>{english.total_score_pct}%</strong>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--st-fg-muted)', marginTop: '0.5rem', marginBottom: 0 }}>
            Combinado de comprensión escrita, audio y producción escrita evaluada por IA.
          </p>
        </div>
      ) : (
        <NotAvailableBlock
          icon="🇺🇸"
          title="Inglés (CEFR)"
          message="No evaluado en este reporte. Mide nivel CEFR (A2-C1) con comprensión escrita, audio y producción evaluada por IA. Forma parte del servicio completo."
        />
      )}

      {videos && videos.length > 0 ? (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(99, 102, 241, 0.04)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '8px' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            🎥 Análisis de respuestas en video ({videos.length})
          </h4>
          <p style={{ fontSize: '0.78rem', color: 'var(--st-fg-muted)', marginBottom: '0.75rem' }}>
            Análisis IA de las respuestas en video del candidato. Solo el resumen analítico —
            los videos crudos quedan en el sistema interno por privacidad del candidato.
          </p>
          {videos.map((v) => (
            <details key={v.question_id} style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', padding: '0.4rem 0.6rem', background: 'rgba(0,0,0,0.15)', borderRadius: '4px' }}>
                <strong>{VIDEO_CATEGORY_LABEL[v.category] ?? v.category}</strong>
                {' · '}
                <span style={{ color: 'var(--st-fg-muted)' }}>{v.question_text.slice(0, 80)}{v.question_text.length > 80 ? '…' : ''}</span>
                {v.analysis?.overall_pct != null && (
                  <span style={{ float: 'right', fontWeight: 600 }}>{v.analysis.overall_pct}%</span>
                )}
              </summary>
              <div style={{ padding: '0.6rem', marginTop: '0.3rem' }}>
                <p style={{ fontStyle: 'italic', marginBottom: '0.5rem' }}>{v.question_text}</p>
                {v.analysis_status === 'pending' && (
                  <p className="muted small">⏳ Análisis IA pendiente.</p>
                )}
                {v.analysis_status === 'failed' && (
                  <p className="muted small">⚠️ El análisis IA falló.</p>
                )}
                {v.analysis && (
                  <>
                    {v.analysis.observations && v.analysis.observations.length > 0 && (
                      <ul style={{ paddingLeft: '1rem', marginBottom: '0.4rem' }}>
                        {v.analysis.observations.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    )}
                    {v.analysis.flags && v.analysis.flags.length > 0 && (
                      <p style={{ color: '#fca5a5', marginBottom: '0.3rem' }}>🚩 {v.analysis.flags.join(', ')}</p>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: 'var(--st-fg-muted)' }}>
                      {v.analysis.signals_matched_pct != null && <span>Señales: {v.analysis.signals_matched_pct}%</span>}
                      {v.analysis.claim_corroborated != null && (
                        <span>Claim CV: {v.analysis.claim_corroborated ? '✓ corroborado' : '✗ no corroborado'}</span>
                      )}
                      {v.analysis.integrity_concern_pct != null && (
                        <span>Riesgo integridad: {v.analysis.integrity_concern_pct}%</span>
                      )}
                      {v.analysis.english_level_pct != null && (
                        <span>Nivel inglés: {v.analysis.english_level_pct}%</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <NotAvailableBlock
          icon="🎥"
          title="Análisis de respuestas en video"
          message="No incluidas en este reporte. En el servicio completo, el candidato responde preguntas en video y nuestra IA analiza fluidez, claridad, integridad y conocimiento técnico. Forma parte del servicio completo."
        />
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

/** Genera mindset scores fake para demo mode. Determinístico por app.id. */
function buildMockMindset(apps: Application[]): Record<string, BundleMindset> {
  const out: Record<string, BundleMindset> = {};
  for (const app of apps) {
    // Determinístico: hash del id para scores predecibles entre reloads
    const seed = app.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const adaptScore = 50 + (seed % 45); // 50-94 range
    const pattern: 'adaptable' | 'mixto' | 'limitante' =
      adaptScore >= 70 ? 'adaptable' : adaptScore >= 50 ? 'mixto' : 'limitante';

    out[app.id] = {
      adaptability_score_pct: adaptScore,
      adaptability_pattern: pattern,
      polos_adaptables: {
        crecimiento: 8 + (seed % 6),
        curiosa: 7 + ((seed * 3) % 6),
        creativa: 9 + ((seed * 5) % 5),
        agente: 10 + ((seed * 7) % 5),
        abundancia: 6 + ((seed * 2) % 7),
        exploracion: 8 + ((seed * 4) % 5),
        oportunidad: 7 + ((seed * 6) % 6),
      },
    };
  }
  return out;
}

/**
 * Bloque "No disponible en este reporte" — se usa para secciones (técnica, mindset,
 * inglés, videos) que no fueron evaluadas. Comunica al cliente qué incluye el servicio
 * completo sin dejar el reporte vacío o roto.
 */
function NotAvailableBlock({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div style={{
      marginTop: '1rem',
      padding: '14px 18px',
      background: 'rgba(107, 114, 128, 0.06)',
      border: '1px dashed rgba(107, 114, 128, 0.35)',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
    }}>
      <div style={{ fontSize: '24px', opacity: 0.5, lineHeight: 1 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--st-fg-muted)',
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {title} · No disponible
        </div>
        <p style={{
          fontSize: '13px',
          color: 'var(--st-fg-muted)',
          margin: 0,
          lineHeight: 1.55,
        }}>
          {message}
        </p>
      </div>
    </div>
  );
}

/** Genera english sessions fake para demo mode (solo si el job requiere inglés). */
function buildMockEnglish(
  apps: Application[],
  englishRequired: boolean | undefined,
  level: 'A2' | 'B1' | 'B2' | 'C1' | undefined,
): Record<string, BundleEnglish> {
  if (!englishRequired || !level) return {};
  const thresholds: Record<typeof level, number> = { A2: 60, B1: 65, B2: 70, C1: 75 };
  const out: Record<string, BundleEnglish> = {};
  for (const app of apps) {
    const seed = app.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const score = 55 + (seed % 40); // 55-94
    out[app.id] = {
      level_required: level,
      total_score_pct: score,
      passed: score >= thresholds[level],
    };
  }
  return out;
}
