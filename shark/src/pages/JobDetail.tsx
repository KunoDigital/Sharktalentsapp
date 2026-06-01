import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MOCK_JOBS, getJobById } from '../data/mockJobs';
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
import { useApi } from '../lib/api';
import { adaptToMockApplication } from '../lib/applicationAdapter';
import { config } from '../config';
import './pages.css';

type Phase = 'tecnica' | 'conductual' | 'integridad';

type PhaseColumn = {
  key: string;
  label: string;
  match: (app: Application) => boolean;
  highlight?: 'primary' | 'warn' | 'danger';
};

const PHASE_COLUMNS: Record<Phase, PhaseColumn[]> = {
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
  tecnica: 'Técnica',
  conductual: 'Evaluación Conductual',
  integridad: 'Integridad',
};

function CardKpi({ app, phase }: { app: Application; phase: Phase }): React.ReactElement {
  if (phase === 'tecnica' && app.tecnica) {
    return (
      <div className="kanban-card-detail">
        Técnica: <strong>{app.tecnica.pct}%</strong> ({app.tecnica.estado})
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
  const job = id ? getJobById(id) : undefined;
  const [phase, setPhase] = useState<Phase>('tecnica');
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [tickToast, setTickToast] = useState<string | null>(null);
  const [bumpKey, setBumpKey] = useState(0);
  const [liveApps, setLiveApps] = useState<Application[] | null>(null);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);

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

    setPhaseState(app.id, phase, targetState);
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
          <h1 className="page-title">{job.title}</h1>
          <p className="page-subtitle">
            {job.client_company} · {job.location}
          </p>
        </div>
        <div className="job-detail-toolbar">
          <Link to={`/jobs/${job.id}/edit`} className="btn-toolbar">
            ✏️ Editar
          </Link>
          <Link to={`/jobs/${job.id}/comparar`} className="btn-toolbar">
            Comparar candidatos
          </Link>
          <button className="btn-toolbar" onClick={() => exportCandidatesToExcel(applications, MOCK_JOBS, `candidatos-${slugifyForFilename(job.title)}.xlsx`)}>
            Exportar Excel
          </button>
          <button
            className="btn-toolbar"
            title="Manda email al cliente con el aviso 'tu reporte de finalistas está listo'"
            onClick={async () => {
              const finalistsCount = applications.filter((a) => a.integridad_state === 'llamar_entrevista').length;
              const clientEmail = window.prompt(
                `Email del cliente (lo va a recibir como aviso "reporte listo")\n\nFinalistas detectados: ${finalistsCount}`,
                '',
              );
              if (!clientEmail || !clientEmail.includes('@')) return;
              const clientName = window.prompt('Nombre del cliente (cómo lo saludamos)', '') ?? '';
              try {
                await api.jobs.notifyClientReportReady(job.id, {
                  client_email: clientEmail.trim(),
                  client_name: clientName.trim(),
                  finalist_count: finalistsCount,
                });
                setTickToast(`✓ Aviso enviado a ${clientEmail}`);
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

      <PoolMatchPanel
        jobId={job.id}
        areaTags={job.competencias_ideales?.map((c) => c.name.toLowerCase()) ?? []}
        requiresEnglish={false}
      />

      <h2 className="section-title">Pipeline — {PHASE_LABEL[phase]}</h2>

      <div className="phase-tabs">
        {(['tecnica', 'conductual', 'integridad'] as Phase[]).map((p) => (
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
                  <td>{app.tecnica ? `${app.tecnica.pct}%` : '—'}</td>
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
