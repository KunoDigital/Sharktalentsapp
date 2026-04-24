import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getJob, getJobs, getPipeline, downloadReport, markReviewed, setPipelineStage, copyCandidateToJob } from '../../services/api';
import CandidateSidebar from '../../components/CandidateSidebar';
import type { CSSProperties } from 'react';

interface PipelineCandidate {
  result_id: number;
  candidate: { id: number; name: string; email: string; age?: number; salary_expectation?: number };
  status: 'opened' | 'in_progress' | 'completed';
  started_at: string;
  completed_at: string | null;
  report_downloaded_at: string | null;
  screen_exits?: number;
  screen_exit_log?: { section: string; questionIdx: number; questionId: string; type: string; duration?: number }[];
  score_pct?: number | null;
  passed?: boolean | null;
  disc_letter?: string | null;
  disc_score?: Record<string, number> | null;
  cognitive_score?: { total: number; max: number } | null;
  emotional?: { score: number; perfil: string } | null;
  integrity_overall?: string | null;
  integrity_recomendacion?: string | null;
  pipeline_stage?: string | null;
}

interface PipelineGroup {
  assessment_id: number;
  public_token: string;
  candidates: PipelineCandidate[];
}

type PipelineData = Record<string, PipelineGroup>;

const TABS = [
  { key: 'technical', label: 'Técnica' },
  { key: 'kudert', label: 'Evaluación Conductual' },
  { key: 'integrity', label: 'Integridad' },
];

const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const EMOTION_COLORS: Record<string, string> = { espontaneo: '#f39c12', mesura: '#3498db', reflexivo: '#9b59b6' };
const DISC_NAMES: Record<string, string> = { D: 'Dominante', I: 'Influyente', S: 'Sólido', C: 'Cumplidor' };

type ColumnKey = 'registered' | 'in_progress' | 'completed' | 'rejected' | 'next_stage' | 'salary_out_of_range' | 'next_stage_kudert' | 'review_cv_kudert' | 'rejected_kudert' | 'interview_integrity' | 'rejected_integrity';
type SortKey = 'default' | 'name' | 'score' | 'completed';

export default function JobPipeline() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [activeTab, setActiveTab] = useState('technical');
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [allJobs, setAllJobs] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    getJob(id).then(setJob);
    getPipeline(id).then(setPipeline);
    getJobs().then((j: any[]) => setAllJobs(j.filter(jj => (jj.ROWID || jj.id) !== id)));
  }, [id]);

  const nav = useNavigate();
  const [sidebarCandidate, setSidebarCandidate] = useState<number | null>(null);

  const refreshPipeline = () => { if (id) getPipeline(id).then(setPipeline); };

  const handleMove = async (resultId: number, stage: string | null) => {
    // Optimistic update: move the card locally before server responds
    setPipeline(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      for (const type of Object.keys(updated)) {
        updated[type] = {
          ...updated[type],
          candidates: updated[type].candidates.map((c: PipelineCandidate) =>
            c.result_id === resultId ? { ...c, pipeline_stage: stage || null } : c
          ),
        };
      }
      return updated;
    });
    try {
      await setPipelineStage(resultId, stage);
    } catch {
      // Revert on error
      refreshPipeline();
    }
  };

  if (!job || !pipeline) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  const group = pipeline[activeTab];
  const isTechnical = activeTab === 'technical';

  // Sort function
  const sortCandidates = (list: PipelineCandidate[]): PipelineCandidate[] => {
    if (sortBy === 'default') return list;
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.candidate.name || '').localeCompare(b.candidate.name || '');
      if (sortBy === 'score') return (b.score_pct ?? -1) - (a.score_pct ?? -1);
      if (sortBy === 'completed') {
        const ta = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const tb = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return tb - ta;
      }
      return 0;
    });
  };

  // Distribute candidates into columns
  const allCandidates = group?.candidates || [];

  const isKudert = activeTab === 'kudert';
  const isIntegrity = activeTab === 'integrity';

  const byStatus: Record<ColumnKey, PipelineCandidate[]> = {
    registered: [],
    in_progress: [],
    completed: [],
    rejected: [],
    next_stage: [],
    salary_out_of_range: [],
    next_stage_kudert: [],
    review_cv_kudert: [],
    rejected_kudert: [],
    interview_integrity: [],
    rejected_integrity: [],
  };

  for (const c of allCandidates) {
    // Manual stage overrides auto-assignment for completed candidates
    if (c.pipeline_stage === 'next_stage') {
      byStatus.next_stage.push(c);
    } else if (c.pipeline_stage === 'salary_out_of_range') {
      byStatus.salary_out_of_range.push(c);
    } else if (c.pipeline_stage === 'next_stage_kudert') {
      byStatus.next_stage_kudert.push(c);
    } else if (c.pipeline_stage === 'review_cv_kudert') {
      byStatus.review_cv_kudert.push(c);
    } else if (c.pipeline_stage === 'rejected_kudert') {
      byStatus.rejected_kudert.push(c);
    } else if (c.pipeline_stage === 'interview_integrity') {
      byStatus.interview_integrity.push(c);
    } else if (c.pipeline_stage === 'rejected_integrity') {
      byStatus.rejected_integrity.push(c);
    } else if (c.status === 'opened') {
      byStatus.registered.push(c);
    } else if (c.status === 'in_progress') {
      byStatus.in_progress.push(c);
    } else if (c.status === 'completed') {
      if (isTechnical && c.score_pct != null && c.score_pct < 70 && !c.pipeline_stage) {
        byStatus.rejected.push(c);
      } else {
        byStatus.completed.push(c);
      }
    }
  }

  // Apply sorting to each column
  for (const key of Object.keys(byStatus) as ColumnKey[]) {
    byStatus[key] = sortCandidates(byStatus[key]);
  }

  const columns: { key: ColumnKey; label: string; color?: string }[] = [
    { key: 'registered', label: 'Registrado' },
    { key: 'in_progress', label: 'En progreso' },
    { key: 'completed', label: 'Completado' },
    ...(isTechnical ? [
      { key: 'next_stage' as ColumnKey, label: 'Siguiente etapa', color: 'rgba(218,253,111,0.15)' },
      { key: 'salary_out_of_range' as ColumnKey, label: 'Salario fuera de rango', color: 'rgba(243,156,18,0.1)' },
      { key: 'rejected' as ColumnKey, label: 'Rechazado' },
    ] : []),
    ...(isKudert ? [
      { key: 'next_stage_kudert' as ColumnKey, label: 'Siguiente etapa', color: 'rgba(218,253,111,0.15)' },
      { key: 'review_cv_kudert' as ColumnKey, label: 'Duda - Revisar CV', color: 'rgba(52,152,219,0.1)' },
      { key: 'rejected_kudert' as ColumnKey, label: 'Rechazado' },
    ] : []),
    ...(isIntegrity ? [
      { key: 'interview_integrity' as ColumnKey, label: 'Llamar a entrevista', color: 'rgba(218,253,111,0.15)' },
      { key: 'rejected_integrity' as ColumnKey, label: 'Rechazado' },
    ] : []),
  ];

  return (
    <div>
      <Link to={`/admin/jobs/${id}`} style={backLink}>← Volver al detalle</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 16 }}>
        Pipeline — {job.title as string}
      </h1>

      {/* Tabs + Sort controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={tabsContainer}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={activeTab === tab.key ? tabActive : tabInactive}>
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>Ordenar:</span>
          {([
            { key: 'default', label: 'Reciente' },
            { key: 'name', label: 'A-Z' },
            { key: 'score', label: 'Puntaje' },
            { key: 'completed', label: 'Terminado' },
          ] as { key: SortKey; label: string }[]).map(s => (
            <button key={s.key} onClick={() => setSortBy(s.key)} style={sortBy === s.key ? sortBtnActive : sortBtn}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...kanbanGrid, gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
        {columns.map(col => (
          <div key={col.key} style={
            col.key === 'rejected' || col.key === 'rejected_kudert' || col.key === 'rejected_integrity' ? columnRejected :
            col.key === 'next_stage' || col.key === 'next_stage_kudert' || col.key === 'interview_integrity' ? columnNext :
            col.key === 'salary_out_of_range' ? columnSalary :
            col.key === 'review_cv_kudert' ? columnReviewCv : columnStyle
          }>
            <div style={columnHeader}>
              <span style={columnTitle}>{col.label}</span>
              <span style={countBadge}>{byStatus[col.key].length}</span>
            </div>
            <div style={columnBody}>
              {byStatus[col.key].length === 0 ? (
                <p style={{ color: 'var(--kuno-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin candidatos</p>
              ) : (
                byStatus[col.key].map(c => (
                  <CandidateCard
                    key={c.result_id}
                    candidate={c}
                    type={activeTab}
                    jobId={id!}
                    columnKey={col.key}
                    isTechnical={isTechnical}
                    isKudert={isKudert}
                    isIntegrity={isIntegrity}
                    isRejected={col.key === 'rejected' || col.key === 'rejected_kudert' || col.key === 'rejected_integrity'}
                    onReviewed={refreshPipeline}
                    onNameClick={() => setSidebarCandidate(c.candidate.id)}
                    onViewReport={() => nav(`/admin/jobs/${id}/candidates/${c.candidate.id}/report`)}
                    onMove={handleMove}
                    otherJobs={allJobs}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {sidebarCandidate && (
        <CandidateSidebar candidateId={sidebarCandidate} jobId={id!} onClose={() => setSidebarCandidate(null)} />
      )}
    </div>
  );
}

function CandidateCard({ candidate: c, type, jobId, columnKey, isTechnical, isKudert, isIntegrity, isRejected, onReviewed, onNameClick, onViewReport, onMove, otherJobs }: {
  candidate: PipelineCandidate; type: string; jobId: string; columnKey: ColumnKey; isTechnical: boolean; isKudert: boolean; isIntegrity: boolean; isRejected: boolean;
  onReviewed: () => void; onNameClick: () => void; onViewReport: () => void;
  onMove: (resultId: number, stage: string | null) => Promise<void>;
  otherJobs: any[];
}) {
  const [downloading, setDownloading] = useState(false);
  const [reviewed, setReviewed] = useState(!!c.report_downloaded_at);
  const [moving, setMoving] = useState(false);
  const [showExitLog, setShowExitLog] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copying, setCopying] = useState(false);

  const handleReport = async () => {
    setDownloading(true);
    try {
      const blob = await downloadReport(jobId, c.candidate.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe-${c.candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await markReviewed(c.result_id);
      setReviewed(true);
      onReviewed();
    } catch {
      alert('Error al generar informe');
    }
    setDownloading(false);
  };

  const doMove = async (stage: string | null) => {
    setMoving(true);
    await onMove(c.result_id, stage);
    setMoving(false);
  };

  const timeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr + 'Z').getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  // Move options based on current column
  const moveOptions: { label: string; stage: string | null; icon: string; style?: 'next' | 'salary' | 'reject' | 'back' }[] = [];
  if (isTechnical && c.status === 'completed') {
    if (columnKey !== 'next_stage') moveOptions.push({ label: 'Siguiente etapa', stage: 'next_stage', icon: '→', style: 'next' });
    if (columnKey !== 'salary_out_of_range') moveOptions.push({ label: 'Salario fuera de rango', stage: 'salary_out_of_range', icon: '$', style: 'salary' });
    if (columnKey === 'next_stage' || columnKey === 'salary_out_of_range') moveOptions.push({ label: 'Devolver a completado', stage: '', icon: '←', style: 'back' });
  }
  if (isKudert && c.status === 'completed') {
    if (columnKey !== 'next_stage_kudert') moveOptions.push({ label: 'Siguiente etapa', stage: 'next_stage_kudert', icon: '→', style: 'next' });
    if (columnKey !== 'review_cv_kudert') moveOptions.push({ label: 'Duda - Revisar CV', stage: 'review_cv_kudert', icon: '?', style: 'salary' });
    if (columnKey !== 'rejected_kudert') moveOptions.push({ label: 'Rechazado', stage: 'rejected_kudert', icon: '✕', style: 'reject' });
    if (columnKey === 'next_stage_kudert' || columnKey === 'rejected_kudert' || columnKey === 'review_cv_kudert') moveOptions.push({ label: 'Devolver a completado', stage: '', icon: '←', style: 'back' });
  }
  if (isIntegrity && c.status === 'completed') {
    if (columnKey !== 'interview_integrity') moveOptions.push({ label: 'Llamar a entrevista', stage: 'interview_integrity', icon: '→', style: 'next' });
    if (columnKey !== 'rejected_integrity') moveOptions.push({ label: 'Rechazado', stage: 'rejected_integrity', icon: '✕', style: 'reject' });
    if (columnKey === 'interview_integrity' || columnKey === 'rejected_integrity') moveOptions.push({ label: 'Devolver a completado', stage: '', icon: '←', style: 'back' });
  }

  return (
    <div style={isRejected ? cardRejected : cardStyle}>
      {/* Header: name + badges */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span onClick={onNameClick} style={nameLink}>{c.candidate.name}</span>
          {(c.screen_exits || 0) > 0 && (c.screen_exits || 0) < 3 && <span onClick={() => setShowExitLog(true)} style={{ ...exitBadgeWarn, cursor: 'pointer' }}>{'\u26A0\uFE0F'} {c.screen_exits}</span>}
          {(c.screen_exits || 0) >= 3 && <span onClick={() => setShowExitLog(true)} style={{ ...exitBadgeDanger, cursor: 'pointer' }}>{'\u{1F6A8}'} {c.screen_exits}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{c.candidate.email}</div>
      </div>

      {/* Candidate info */}
      {(c.candidate.age || c.candidate.salary_expectation) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {c.candidate.age && <span style={infoChip}>{c.candidate.age} a</span>}
          {c.candidate.salary_expectation && <span style={infoChip}>${c.candidate.salary_expectation}/mes</span>}
        </div>
      )}

      {/* In progress */}
      {c.status === 'in_progress' && c.started_at && (
        <div style={chipMuted}>En curso hace {timeSince(c.started_at)}</div>
      )}

      {/* Technical score */}
      {c.status === 'completed' && type === 'technical' && c.score_pct != null && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: isRejected ? 'var(--kuno-danger)' : 'var(--kuno-cream)' }}>{c.score_pct}%</span>
          <span style={c.passed ? chipPass : chipFail}>{c.passed ? 'Aprobado' : 'No aprobado'}</span>
        </div>
      )}

      {/* Evaluacion Conductual */}
      {c.status === 'completed' && type === 'kudert' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.disc_letter && <span style={{ ...discBadge, background: DISC_COLORS[c.disc_letter] || 'var(--kuno-slate)' }}>{c.disc_letter} — {DISC_NAMES[c.disc_letter] || c.disc_letter}</span>}
          {c.cognitive_score && <span style={chipMuted}>Cog {Math.round((c.cognitive_score.total / c.cognitive_score.max) * 100)}%</span>}
          {c.emotional && <span style={{ ...emotionChip, background: EMOTION_COLORS[c.emotional.perfil] || 'var(--kuno-slate)' }}>{c.emotional.perfil === 'espontaneo' ? 'E' : c.emotional.perfil === 'mesura' ? 'M' : 'R'}</span>}
        </div>
      )}

      {/* Integrity */}
      {c.status === 'completed' && type === 'integrity' && c.integrity_overall && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={riskChip(c.integrity_overall)}>{c.integrity_overall.toUpperCase()}</span>
          {c.integrity_overall === 'alto' && <span style={{ fontSize: 11, color: 'var(--kuno-danger)' }}>{c.integrity_recomendacion}</span>}
        </div>
      )}

      {/* Report buttons */}
      {c.status === 'completed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <button onClick={onViewReport} style={btnViewReport}>Ver reporte</button>
          <button onClick={handleReport} disabled={downloading} style={downloading ? btnPdfLoading : btnPdfSmall}>
            {downloading ? '...' : 'PDF'}
          </button>
          <span style={reviewed ? reviewedBadge : pendingBadge}>
            {reviewed ? '\u2713 Revisado' : 'Pendiente'}
          </span>
        </div>
      )}

      {/* Move buttons */}
      {moveOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {moveOptions.map(opt => (
            <button
              key={opt.stage ?? 'back'}
              onClick={() => doMove(opt.stage)}
              disabled={moving}
              style={opt.style === 'next' ? btnMoveNext : opt.style === 'salary' ? btnMoveSalary : opt.style === 'reject' ? btnMoveReject : btnMoveBack}
            >
              {moving ? '...' : `${opt.icon} ${opt.label}`}
            </button>
          ))}
        </div>
      )}

      {/* Copy to another job */}
      {c.status === 'completed' && otherJobs.length > 0 && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          <button onClick={() => setShowCopyMenu(!showCopyMenu)} disabled={copying} style={btnCopyJob}>
            {copying ? 'Enviando...' : '📋 Enviar a otro puesto'}
          </button>
          {showCopyMenu && (
            <div style={copyMenuStyle}>
              {otherJobs.filter(j => String(j.is_active) === '1').map(j => (
                <button key={j.ROWID || j.id} style={copyMenuItem} onClick={async () => {
                  setCopying(true);
                  try {
                    const res = await copyCandidateToJob(c.candidate.id, j.ROWID || j.id);
                    alert(`${c.candidate.name} enviado a "${j.title}" — Kudert: ${res.kudert}, Integridad: ${res.integrity}`);
                  } catch { alert('Error al enviar'); }
                  setCopying(false);
                  setShowCopyMenu(false);
                }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{j.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>{j.company}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exit log modal */}
      {showExitLog && (
        <div style={exitModalOverlay} onClick={() => setShowExitLog(false)}>
          <div style={exitModalCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--kuno-cream)', margin: 0 }}>
                Salidas de pantalla — {c.candidate.name}
              </h3>
              <button onClick={() => setShowExitLog(false)} style={{ background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>Total: {c.screen_exits || 0} salidas registradas</p>
            {(!c.screen_exit_log || c.screen_exit_log.length === 0) ? (
              <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', textAlign: 'center', padding: 20 }}>
                No hay detalle disponible (prueba anterior al sistema de registro detallado).
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {c.screen_exit_log.map((log, i) => {
                  const typeLabel = log.type === 'tab' ? 'Cambio de pestaña' : log.type === 'window' ? 'Salida de ventana' : 'Cursor fuera';
                  const typeColor = log.type === 'tab' ? 'var(--kuno-danger)' : log.type === 'window' ? '#f39c12' : 'var(--kuno-text-muted)';
                  return (
                    <div key={i} style={{ padding: '10px 14px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: typeColor }}>{typeLabel}</span>
                        {log.duration != null && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: log.duration > 10 ? 'var(--kuno-danger)' : log.duration > 5 ? '#f39c12' : 'var(--kuno-text-muted)' }}>
                            {log.duration}s fuera
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--kuno-cream)' }}>
                        Sección: <strong>{log.section || 'General'}</strong> — Pregunta #{log.questionIdx}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Styles */
const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const tabsContainer: CSSProperties = { display: 'flex', gap: 4, background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', padding: 4, width: 'fit-content' };
const tabBase: CSSProperties = { padding: '8px 20px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' };
const tabActive: CSSProperties = { ...tabBase, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600 };
const tabInactive: CSSProperties = { ...tabBase, background: 'transparent', color: 'var(--kuno-text-muted)' };

const sortBtn: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const sortBtnActive: CSSProperties = { ...sortBtn, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', borderColor: 'var(--kuno-lime)', fontWeight: 600 };

const kanbanGrid: CSSProperties = { display: 'grid', gap: 12, minHeight: 400 };
const columnStyle: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 };
const columnRejected: CSSProperties = { ...columnStyle, borderColor: 'rgba(231,76,60,0.3)' };
const columnNext: CSSProperties = { ...columnStyle, borderColor: 'rgba(218,253,111,0.4)', background: 'rgba(218,253,111,0.03)' };
const columnSalary: CSSProperties = { ...columnStyle, borderColor: 'rgba(243,156,18,0.4)', background: 'rgba(243,156,18,0.03)' };
const columnReviewCv: CSSProperties = { ...columnStyle, borderColor: 'rgba(52,152,219,0.4)', background: 'rgba(52,152,219,0.03)' };
const columnHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--kuno-border)' };
const columnTitle: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--kuno-cream)', textTransform: 'uppercase', letterSpacing: '0.5px' };
const countBadge: CSSProperties = { background: 'var(--kuno-dark-2)', color: 'var(--kuno-text-muted)', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 10 };
const columnBody: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' };

const cardStyle: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: 12, display: 'flex', flexDirection: 'column', gap: 5 };
const cardRejected: CSSProperties = { ...cardStyle, background: 'rgba(231,76,60,0.08)', borderColor: 'rgba(231,76,60,0.25)' };

const infoChip: CSSProperties = { background: 'var(--kuno-dark)', color: 'var(--kuno-text-muted)', fontSize: 11, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--kuno-border)' };
const chipMuted: CSSProperties = { background: 'var(--kuno-slate)', color: 'var(--kuno-cream)', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 12, alignSelf: 'flex-start' };
const chipPass: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12 };
const chipFail: CSSProperties = { background: 'var(--kuno-danger)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12 };
const discBadge: CSSProperties = { color: '#fff', fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 14 };
const emotionChip: CSSProperties = { color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 14 };
const riskChip = (nivel: string): CSSProperties => {
  const bg = nivel === 'bajo' ? 'var(--kuno-lime)' : nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
  const color = nivel === 'bajo' ? 'var(--kuno-dark)' : '#fff';
  return { background: bg, color, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 14 };
};

const nameLink: CSSProperties = { fontWeight: 600, fontSize: 14, color: 'var(--kuno-cream)', cursor: 'pointer', borderBottom: '1px dashed var(--kuno-border)' };
const exitBadgeWarn: CSSProperties = { background: '#f39c12', color: 'var(--kuno-dark)', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10 };
const exitBadgeDanger: CSSProperties = { background: 'var(--kuno-danger)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10 };
const btnViewReport: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 11, padding: '5px 12px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnPdfSmall: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontWeight: 500, fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnPdfLoading: CSSProperties = { ...btnPdfSmall, opacity: 0.5, cursor: 'wait' };
const reviewedBadge: CSSProperties = { background: 'rgba(218,253,111,0.15)', color: 'var(--kuno-lime)', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 };
const pendingBadge: CSSProperties = { background: 'var(--kuno-dark)', color: 'var(--kuno-text-muted)', fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--kuno-border)' };

const btnMoveBase: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnMoveNext: CSSProperties = { ...btnMoveBase, background: 'rgba(218,253,111,0.2)', color: 'var(--kuno-lime)', border: '1px solid rgba(218,253,111,0.3)' };
const btnMoveSalary: CSSProperties = { ...btnMoveBase, background: 'rgba(243,156,18,0.15)', color: '#f39c12', border: '1px solid rgba(243,156,18,0.3)' };
const exitModalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const exitModalCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto' };
const btnMoveReject: CSSProperties = { ...btnMoveBase, background: 'rgba(231,76,60,0.15)', color: 'var(--kuno-danger)', border: '1px solid rgba(231,76,60,0.3)' };
const btnMoveBack: CSSProperties = { ...btnMoveBase, background: 'transparent', color: 'var(--kuno-text-muted)', border: '1px solid var(--kuno-border)' };
const btnCopyJob: CSSProperties = { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', background: 'transparent', border: '1px dashed var(--kuno-lime)', color: 'var(--kuno-lime)', width: '100%' };
const copyMenuStyle: CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', zIndex: 50, maxHeight: 200, overflowY: 'auto', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' };
const copyMenuItem: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--kuno-border)', color: 'var(--kuno-cream)', cursor: 'pointer' };
