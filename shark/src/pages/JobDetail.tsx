import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MOCK_JOBS, getJobById, type Job } from '../data/mockJobs';
import {
  getApplicationsByJobId,
  STATE_LABELS,
  SOURCE_LABELS,
  type Application,
} from '../data/mockApplications';
import { exportCandidatesToExcel } from '../lib/excelExport';
import { slugifyForFilename } from '../lib/pdfExport';
import { setPhaseState } from '../lib/applicationOverrides';
import { isTransitionAllowed, type PhaseState } from '../lib/scoring';
import PoolMatchPanel from '../components/PoolMatchPanel';
import { JobCostsPanel } from '../components/JobCostsPanel';
import { JobBudgetPanel } from '../components/JobBudgetPanel';
import { JobPrescreeningPanel } from '../components/JobPrescreeningPanel';
import { JobTechQuestionsPanel } from '../components/JobTechQuestionsPanel';
import { JobPrescreeningStatsPanel } from '../components/JobPrescreeningStatsPanel';
import { JobSalaryPanel } from '../components/JobSalaryPanel';
import { JobStageTimingPanel } from '../components/JobStageTimingPanel';
import { JobFunnelTimelinePanel } from '../components/JobFunnelTimelinePanel';
import { FavoriteButton } from '../components/FavoriteButton';
import { useFavoriteShortcut } from '../hooks/useFavorites';
import { useApi } from '../lib/api';
import { adaptToMockApplication } from '../lib/applicationAdapter';
import { config } from '../config';
import './pages.css';

type Phase = 'prefiltro' | 'tecnica' | 'conductual' | 'integridad';

type PhaseColumn = {
  key: string;
  label: string;
  match: (app: Application) => boolean;
  highlight?: 'primary' | 'warn' | 'danger';
};

const PHASE_COLUMNS: Record<Phase, PhaseColumn[]> = {
  // 2026-06-05: agregamos la tab Prefiltro para que los candidatos recién aplicados
  // (pipeline_stage='prefilter_pending') no queden invisibles en el board. Las columnas
  // matchean contra app.state (que viene mapeado del pipeline_stage del backend).
  prefiltro: [
    { key: 'prefilter_pending', label: 'Recién aplicado', match: (a) => a.state === 'prefilter_pending' },
    { key: 'prefilter_passed', label: 'Pasó pre-filtro', match: (a) => a.state === 'prefilter_passed', highlight: 'primary' },
    { key: 'salary_out_of_range', label: 'Salario fuera de rango', match: (a) => a.state === 'salary_out_of_range', highlight: 'warn' },
    { key: 'auto_rejected_low_score', label: 'Rechazo automático', match: (a) => a.state === 'auto_rejected_low_score', highlight: 'danger' },
    { key: 'rejected_by_admin', label: 'Rechazado manual', match: (a) => a.state === 'rejected_by_admin', highlight: 'danger' },
  ],
  tecnica: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.tecnica_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.tecnica_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.tecnica_state === 'completado' },
    { key: 'siguiente_etapa', label: 'Siguiente etapa', match: (a) => a.tecnica_state === 'siguiente_etapa', highlight: 'primary' },
    { key: 'salario_fuera_rango', label: 'Salario fuera de rango', match: (a) => a.tecnica_state === 'salario_fuera_rango', highlight: 'warn' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.tecnica_state === 'rechazado', highlight: 'danger' },
  ],
  conductual: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.conductual_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.conductual_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.conductual_state === 'completado' },
    { key: 'siguiente_etapa', label: 'Siguiente etapa', match: (a) => a.conductual_state === 'siguiente_etapa', highlight: 'primary' },
    { key: 'duda_cv', label: 'Duda — Revisar CV', match: (a) => a.conductual_state === 'duda_cv', highlight: 'warn' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.conductual_state === 'rechazado', highlight: 'danger' },
  ],
  integridad: [
    { key: 'registrado', label: 'Registrado', match: (a) => a.integridad_state === 'registrado' },
    { key: 'en_progreso', label: 'En progreso', match: (a) => a.integridad_state === 'en_progreso' },
    { key: 'completado', label: 'Completado', match: (a) => a.integridad_state === 'completado' },
    { key: 'llamar_entrevista', label: 'Llamar a entrevista', match: (a) => a.integridad_state === 'llamar_entrevista', highlight: 'primary' },
    { key: 'rechazado', label: 'Rechazado', match: (a) => a.integridad_state === 'rechazado', highlight: 'danger' },
  ],
};

const PHASE_LABEL: Record<Phase, string> = {
  prefiltro: 'Prefiltro',
  tecnica: 'Técnica',
  conductual: 'Evaluación Conductual',
  integridad: 'Integridad',
};

function CardKpi({ app, phase }: { app: Application; phase: Phase }): React.ReactElement {
  if (phase === 'prefiltro') {
    return (
      <div className="kanban-card-detail muted">
        {app.disponibilidad ? `Disponible: ${app.disponibilidad}` : 'Sin datos aún'}
      </div>
    );
  }
  if (phase === 'tecnica' && app.tecnica) {
    const t = app.tecnica;
    // Doble eje (doc 19): si están disponibles los campos nuevos, agregar resumen compacto.
    // Candidatos legacy o que no completaron técnica con scoring server-side no los tienen.
    const hasDoubleAxis = t.style_autonomy_consult != null
      || t.style_match_with_boss_pct != null
      || (t.situational_validity_pct != null && t.situational_validity_pct < 75);
    return (
      <div className="kanban-card-detail">
        <div>Técnica: <strong>{t.pct}%</strong> ({t.estado})</div>
        {hasDoubleAxis && (
          <div style={{ marginTop: '0.25rem', fontSize: '0.72rem', color: '#1f2937', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {t.style_autonomy_consult != null && (
              <span title="Estilo profesional">
                {t.style_autonomy_consult >= 65 ? '⚡ Autonomía'
                  : t.style_autonomy_consult <= 35 ? '🤝 Consulta'
                  : '🔄 Balanceado'}
              </span>
            )}
            {t.style_match_with_boss_pct != null && (
              <span
                title="Match con estilo del jefe"
                style={{ color: t.style_match_with_boss_pct >= 75 ? '#047857' : t.style_match_with_boss_pct >= 50 ? '#1f2937' : '#b45309' }}
              >
                Match jefe: <strong>{t.style_match_with_boss_pct}%</strong>
              </span>
            )}
            {t.situational_validity_pct != null && t.situational_validity_pct < 75 && (
              <span title="Validez situacional baja — revisar en entrevista" style={{ color: '#b45309' }}>
                ⚠️ Validez {t.situational_validity_pct}%
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
  if (phase === 'conductual' && app.disc) {
    return (
      <div className="kanban-card-detail">
        DISC sim: <strong>{app.disc.similitud_pct}%</strong> · VELNA: {app.velna?.similitud_pct ?? '—'}%
      </div>
    );
  }
  if (phase === 'integridad' && app.integridad) {
    const obs = app.integridad.observations.length;
    return (
      <div className="kanban-card-detail">
        Integridad: {obs === 0 && !app.integridad.buena_impresion_alta ? 'Sin alertas' : `${obs} obs.`}
      </div>
    );
  }
  return <div className="kanban-card-detail muted">Sin datos en esta fase</div>;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  // 2026-06-04: BUG histórico — `getJobById(id)` busca en data MOCK del frontend.
  // El ID que viene en la URL es el ROWID real del backend (ej: "28606000000867227").
  // Como ese ID NO existe en mockJobs, `job` salía undefined y la página mostraba
  // "Puesto no encontrado", aunque el backend tuviera el puesto.
  // Fix: en modo useApi cargamos el puesto del backend; en modo dev/mock seguimos con
  // getJobById como antes.
  const mockJob = useMemo(() => (id ? getJobById(id) : undefined), [id]);
  const [liveJob, setLiveJob] = useState<Job | null>(null);
  const [jobLoadFailed, setJobLoadFailed] = useState(false);
  const job = liveJob ?? mockJob;
  useFavoriteShortcut('job', id ?? null, job ? `${job.title} · ${job.client_company}` : undefined);
  const [phase, setPhase] = useState<Phase>('prefiltro');
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [tickToast, setTickToast] = useState<string | null>(null);
  const [bumpKey, setBumpKey] = useState(0);
  const [liveApps, setLiveApps] = useState<Application[] | null>(null);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);

  // Cargar el Job real del backend cuando useApi=true.
  useEffect(() => {
    if (!id || !config.useApi) return;
    let cancelled = false;
    api.jobs.get(id)
      .then((resp) => {
        if (cancelled) return;
        // Adaptar ApiJob → Job (tipo del frontend). El backend devuelve menos campos
        // que el mock; rellenamos los faltantes con defaults razonables para que el
        // resto del componente siga funcionando sin romperse.
        const aj = resp.job;
        setLiveJob({
          id: aj.ROWID,
          slug: aj.ROWID,
          title: aj.title,
          client_company: aj.company,
          client_industry: '',
          location: '',
          status: aj.is_active ? 'active' : 'closed',
          created_at: aj.created_at,
          applications_count: 0,
          applications_in_progress: 0,
          finalists_count: 0,
          fee_usd: aj.fee_usd ?? 0,
          salary_range_usd: { min: 0, max: 0 },
          disc_ideal_a: { d: 50, i: 50, s: 50, c: 50 } as Job['disc_ideal_a'],
          velna_ideal: { verbal: 50, espacial: 50, logica: 50, numerica: 50, abstracta: 50 } as Job['velna_ideal'],
          competencias_ideales: [],
          tecnica_minimo_pct: 60,
          context: aj.company_context ?? '',
        } as Job);
      })
      .catch(() => {
        if (!cancelled) setJobLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [id, api]);

  useEffect(() => {
    if (!id || !config.useApi) return;
    let cancelled = false;
    async function load() {
      try {
        const [appsResp, candResp] = await Promise.all([
          api.applications.list({ jobId: id, limit: 200 }),
          api.candidates.list({ limit: 500 }),
        ]);
        if (cancelled) return;
        const candById = new Map(candResp.candidates.map((c) => [c.ROWID, c]));
        const adapted = await Promise.all(
          appsResp.applications.map(async (a) => {
            try {
              const s = await api.applications.readScores(a.ROWID);
              return adaptToMockApplication(a, candById.get(a.candidate_id), s.scores, s.integrity_dimensions);
            } catch {
              return adaptToMockApplication(a, candById.get(a.candidate_id), null, []);
            }
          }),
        );
        if (!cancelled) setLiveApps(adapted);
      } catch {
        if (!cancelled) setLiveLoadFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, api]);

  // Loading: mientras no haya job ni vino mockJob, mostrar "Cargando…" en lugar de mock data o "no encontrado".
  if (!job && config.useApi && !jobLoadFailed) {
    return <div style={{ padding: '2rem' }}>Cargando puesto…</div>;
  }

  if (!job) {
    return (
      <div>
        <p>
          Puesto no encontrado. <Link to="/jobs">Volver</Link>
        </p>
      </div>
    );
  }

  const applications = liveApps ?? getApplicationsByJobId(job.id);
  const columns = PHASE_COLUMNS[phase];
  const usingFallbackMock = config.useApi && liveLoadFailed && !liveApps;

  function getCurrentPhaseState(app: Application, p: Phase): PhaseState {
    if (p === 'tecnica') return app.tecnica_state as PhaseState;
    if (p === 'conductual') return app.conductual_state as PhaseState;
    return app.integridad_state as PhaseState;
  }

  function handleDrop(targetColKey: string, e: React.DragEvent) {
    e.preventDefault();
    setHoverColumn(null);
    if (!draggedAppId) return;
    const app = applications.find((a) => a.id === draggedAppId);
    if (!app) return;

    // La tab "Prefiltro" muestra el stage real del backend (pipeline_stage). No se
    // permite drag-and-drop ahí — los movimientos en prefiltro pasan automáticos vía
    // el bot decisor o via los botones de CandidateDetail.
    if (phase === 'prefiltro') {
      setTickToast('Prefiltro se mueve automático — usá CandidateDetail para forzar.');
      setTimeout(() => setTickToast(null), 3500);
      setDraggedAppId(null);
      return;
    }

    const currentState = getCurrentPhaseState(app, phase);
    const targetState = targetColKey as PhaseState;

    if (currentState === targetState) {
      setDraggedAppId(null);
      return;
    }

    if (!isTransitionAllowed(currentState, targetState)) {
      setTickToast(`✕ No podés mover de "${currentState}" a "${targetState}" (regla del state machine)`);
      setTimeout(() => setTickToast(null), 3500);
      setDraggedAppId(null);
      return;
    }

    setPhaseState(app.id, phase as Exclude<Phase, 'prefiltro'>, targetState);
    // mutación in-memory para reflejar al instante (mock — backend haría refetch)
    if (phase === 'tecnica') app.tecnica_state = targetState as Application['tecnica_state'];
    else if (phase === 'conductual') app.conductual_state = targetState as Application['conductual_state'];
    else app.integridad_state = targetState as Application['integridad_state'];

    setTickToast(`✓ ${app.candidate_name} movido a "${targetState}"`);
    setTimeout(() => setTickToast(null), 2500);
    setDraggedAppId(null);
    setBumpKey((k) => k + 1);
  }

  return (
    <div>
      <Link to="/jobs" className="back-link">← Jobs</Link>
      {usingFallbackMock && (
        <p className="muted-note">⚠️ Backend no respondió — mostrando candidatos mock para esta vista.</p>
      )}

      <div className="page-header-row">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FavoriteButton type="job" resourceId={job.id} label={`${job.title} · ${job.client_company}`} size={22} />
            {job.title}
          </h1>
          <p className="page-subtitle">
            {job.client_company} · {job.location}
          </p>
        </div>
        <div className="job-detail-toolbar">
          <Link to={`/jobs/${job.id}/edit`} className="btn-toolbar">
            ✏️ Editar
          </Link>
          {/* Comparativo escondido hasta v2 — pantalla rompe con datos reales del backend
              (hooks order violation + getJobById mock-only). Re-habilitar cuando se reescriba. */}
          <button className="btn-toolbar" onClick={() => exportCandidatesToExcel(applications, MOCK_JOBS, `candidatos-${slugifyForFilename(job.title)}.xlsx`)}>
            Exportar Excel
          </button>
          <button
            className="btn-toolbar"
            title="Manda email al cliente con el aviso 'tu reporte de finalistas está listo'. El backend resuelve email/nombre/finalists/URL desde el Job."
            onClick={async () => {
              const ok = window.confirm(
                `Mandar email "reporte de finalistas listo" al cliente de ${job.client_company}?\n\nEl backend usa el email/nombre del Job y firma el link al reporte automáticamente.`,
              );
              if (!ok) return;
              try {
                await api.jobs.notifyClientReportReady(job.id);
                setTickToast(`✓ Email enviado al cliente`);
                setTimeout(() => setTickToast(null), 3500);
              } catch (err) {
                setTickToast(`✗ Error al enviar: ${(err as Error).message}`);
                setTimeout(() => setTickToast(null), 5000);
              }
            }}
          >
            📤 Avisar cliente reporte listo
          </button>
          <span className={`status-tag status-${job.status}`}>{job.status}</span>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{job.applications_count}</div>
          <div className="stat-label">Aplicaciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{applications.length}</div>
          <div className="stat-label">Total en pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{applications.filter((a) => a.integridad_state === 'llamar_entrevista').length}</div>
          <div className="stat-label">Listos para entrevista</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${job.fee_usd.toLocaleString()}</div>
          <div className="stat-label">Fee</div>
        </div>
      </div>

      <div style={{ marginBottom: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        <JobPrescreeningPanel jobId={job.id} />
        <JobTechQuestionsPanel jobId={job.id} />
        <JobPrescreeningStatsPanel jobId={job.id} />
        <JobSalaryPanel jobId={job.id} />
        <JobStageTimingPanel jobId={job.id} />
        <JobFunnelTimelinePanel jobId={job.id} />
        <JobBudgetPanel jobId={job.id} />
        <JobCostsPanel jobId={job.id} />
      </div>

      <PoolMatchPanel
        jobId={job.id}
        areaTags={job.competencias_ideales?.map((c) => c.name.toLowerCase()) ?? []}
        requiresEnglish={false}
      />

      <h2 className="section-title">Pipeline — {PHASE_LABEL[phase]}</h2>

      <div className="phase-tabs">
        {(['prefiltro', 'tecnica', 'conductual', 'integridad'] as Phase[]).map((p) => (
          <button
            key={p}
            className={`phase-tab${phase === p ? ' is-active' : ''}`}
            onClick={() => setPhase(p)}
          >
            {PHASE_LABEL[p]}
          </button>
        ))}
        <span className="phase-tabs-hint">
          Orden: prefiltro → técnica → conductual → integridad
        </span>
      </div>

      <p className="muted small kanban-hint">
        💡 Arrastrá una tarjeta entre columnas para cambiar su estado. Las transiciones inválidas se rechazan.
      </p>

      <div className="kanban" key={bumpKey}>
        {columns.map((col) => {
          const items = applications.filter(col.match);
          const isHover = hoverColumn === col.key;
          return (
            <div
              key={col.key}
              className={`kanban-col${col.highlight ? ` kanban-col-${col.highlight}` : ''}${isHover ? ' is-drop-hover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (hoverColumn !== col.key) setHoverColumn(col.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (hoverColumn === col.key) setHoverColumn(null);
              }}
              onDrop={(e) => handleDrop(col.key, e)}
            >
              <div className="kanban-col-header">
                <span>{col.label}</span>
                <span className="kanban-count">{items.length}</span>
              </div>
              <div className="kanban-col-body">
                {items.map((app) => (
                  <div
                    key={app.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedAppId(app.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', app.id);
                    }}
                    onDragEnd={() => {
                      setDraggedAppId(null);
                      setHoverColumn(null);
                    }}
                    className={`kanban-card kanban-card-draggable${draggedAppId === app.id ? ' is-dragging' : ''}`}
                  >
                    <Link to={`/candidates/${app.id}`} className="kanban-card-link-inner">
                      <div className="kanban-card-name">{app.candidate_name}</div>
                      <div className="kanban-card-meta">
                        <span className="source-tag">{SOURCE_LABELS[app.source]}</span>
                      </div>
                      <div className="kanban-card-detail muted">
                        {app.candidate_age} a · ${app.salary_aspiration_usd}/mes
                      </div>
                      <CardKpi app={app} phase={phase} />
                      {app.anti_cheat_events.length > 0 && (
                        <div className="kanban-card-detail kanban-card-warn">
                          ⚠️ {app.anti_cheat_events.length} eventos anti-trampa
                        </div>
                      )}
                    </Link>
                    <span className="kanban-drag-handle" aria-hidden="true">⋮⋮</span>
                  </div>
                ))}
                {items.length === 0 && <div className="kanban-empty">Sin candidatos</div>}
              </div>
            </div>
          );
        })}
      </div>

      {tickToast && (
        <div className={`kanban-toast${tickToast.startsWith('✕') ? ' is-error' : ''}`}>
          {tickToast}
        </div>
      )}

      {applications.length > 0 && (
        <>
          <h2 className="section-title">Tabla completa</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Source</th>
                <th>Estado</th>
                <th>DISC</th>
                <th>Técnica</th>
                <th>Anti-trampa</th>
                <th>Bot conf.</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id}>
                  <td>
                    <Link to={`/candidates/${app.id}`} className="link">{app.candidate_name}</Link>
                  </td>
                  <td className="muted">{SOURCE_LABELS[app.source]}</td>
                  <td>{STATE_LABELS[app.state]}</td>
                  <td className="muted">{app.disc ? `sim ${app.disc.similitud_pct}%` : '—'}</td>
                  <td>
                    {app.tecnica ? (
                      <>
                        <strong>{app.tecnica.pct}%</strong>
                        {app.tecnica.style_autonomy_consult != null && (
                          <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#1f2937' }} title="Estilo">
                            {app.tecnica.style_autonomy_consult >= 65 ? '⚡' : app.tecnica.style_autonomy_consult <= 35 ? '🤝' : '🔄'}
                          </span>
                        )}
                        {app.tecnica.style_match_with_boss_pct != null && (
                          <span
                            style={{ marginLeft: 4, fontSize: '0.75rem', color: app.tecnica.style_match_with_boss_pct >= 75 ? '#047857' : app.tecnica.style_match_with_boss_pct >= 50 ? '#1f2937' : '#b45309' }}
                            title="Match con jefe"
                          >
                            {app.tecnica.style_match_with_boss_pct}%
                          </span>
                        )}
                        {app.tecnica.situational_validity_pct != null && app.tecnica.situational_validity_pct < 75 && (
                          <span style={{ marginLeft: 4, fontSize: '0.75rem', color: '#b45309' }} title="Validez situacional baja">
                            ⚠️
                          </span>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className={app.anti_cheat_events.length > 0 ? 'cd-tecnica-no-aprobado' : 'muted'}>
                    {app.anti_cheat_events.length > 0 ? `⚠️ ${app.anti_cheat_events.length}` : '—'}
                  </td>
                  <td>{app.bot_confidence != null ? `${(app.bot_confidence * 100).toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
