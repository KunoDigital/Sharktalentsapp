/**
 * PipelineDashboard — vista principal del pipeline de candidatos.
 *
 * Versión 2 (2026-06-17): rediseño completo según mockup confirmado por Cris.
 * Dark mode + 4 sub-columnas dentro de cada banda + cards ricas con score + badges.
 *
 * Estructura:
 * - 6 fases secuenciales: Prefiltro → Técnica → Conductual → Integridad → Video → Finalistas
 * - 7 bandas de conteo arriba (las 6 fases + Rechazados)
 * - Cada banda colapsable; cuando expandida muestra 4 sub-columnas internas:
 *   Completado · Siguiente Etapa · Rechazado · Duda CV
 *   (excepción: Integridad y Finalistas usan "Llamar a entrevista")
 * - Cada candidato aparece UNA SOLA VEZ en su fase actual
 * - 2 vistas: Tabla densa (default) y Tablero (kanban anidado)
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Application } from '../data/mockApplications';

// ===== Tipos =====

type PipelinePhase = 'prefiltro' | 'tecnica' | 'conductual' | 'integridad' | 'video' | 'finalistas' | 'rechazados';
type SubState = 'completado' | 'siguiente' | 'rechazado' | 'duda_cv' | 'llamar_entrevista';

const PHASE_LABEL: Record<PipelinePhase, string> = {
  prefiltro: 'Prefiltro',
  tecnica: 'Técnica',
  conductual: 'Conductual',
  integridad: 'Integridad',
  video: 'Video',
  finalistas: 'Finalistas',
  rechazados: 'Rechazados',
};

const PHASE_COLOR: Record<PipelinePhase, string> = {
  prefiltro: '#94a3b8',     // gris
  tecnica: '#dafd6f',       // verde lima (accent SharkTalents)
  conductual: '#a855f7',    // púrpura
  integridad: '#f97316',    // naranja
  video: '#22d3ee',         // cyan
  finalistas: '#22c55e',    // verde
  rechazados: '#ef4444',    // rojo
};

const PHASE_SUBLABEL: Record<PipelinePhase, string> = {
  prefiltro: 'Validación CV + cuestionario inicial',
  tecnica: 'Técnico (25 preguntas) + Inglés + Mindset — bloque continuo',
  conductual: 'DISC + VELNA + Emoción',
  integridad: '13 dimensiones de riesgo',
  video: 'Entrevista con análisis IA',
  finalistas: 'Llamar a entrevista',
  rechazados: 'Auto-rechazo + manual',
};

// ===== Derivar fase actual del candidato =====

function getCurrentPhase(app: Application): PipelinePhase {
  if (app.state === 'auto_rejected_low_score' || app.state === 'rejected_by_admin') return 'rechazados';
  if (app.state === 'finalist' || app.state === 'offered' || app.state === 'hired') return 'finalistas';
  if (app.state === 'videos_completed' || (app.video_state === 'grabado' && app.state !== 'integridad_completed')) return 'video';
  if (app.integridad_state === 'completado' && app.video_state === 'pendiente') return 'video';
  if (app.state === 'integridad_completed'
    || app.integridad_state === 'en_progreso'
    || app.integridad_state === 'duda_cv'
    || app.integridad_state === 'rechazado'
    || app.integridad_state === 'llamar_entrevista') return 'integridad';
  if (app.conductual_state === 'siguiente_etapa' || app.conductual_state === 'completado') return 'integridad';
  if (app.state === 'conductual_completed' || app.conductual_state === 'en_progreso') return 'conductual';
  if (app.tecnica_state === 'siguiente_etapa' || app.tecnica_state === 'completado') return 'conductual';
  if (app.state === 'tecnica_completed'
    || app.tecnica_state === 'en_progreso'
    || app.tecnica_state === 'duda_cv'
    || app.tecnica_state === 'rechazado') return 'tecnica';
  // 2026-06-17: `prefilter_passed` con `tecnica_state='registrado'` = ya pasó prefilter
  // pero NO empezó técnica todavía → se queda en Prefiltro (columna "Siguiente Etapa").
  return 'prefiltro';
}

/** Sub-estado dentro de la fase actual (para clasificar en las 4 columnas internas del Tablero). */
function getSubState(app: Application, phase: PipelinePhase): SubState {
  switch (phase) {
    case 'prefiltro':
      if (app.state === 'prefilter_passed') return 'siguiente';
      if (app.state === 'salary_out_of_range') return 'duda_cv';
      return 'completado';
    case 'tecnica':
      if (app.tecnica_state === 'rechazado') return 'rechazado';
      if (app.tecnica_state === 'duda_cv') return 'duda_cv';
      if (app.tecnica_state === 'siguiente_etapa') return 'siguiente';
      return 'completado';
    case 'conductual':
      if (app.conductual_state === 'rechazado') return 'rechazado';
      if (app.conductual_state === 'duda_cv') return 'duda_cv';
      if (app.conductual_state === 'siguiente_etapa') return 'siguiente';
      return 'completado';
    case 'integridad':
      if (app.integridad_state === 'rechazado') return 'rechazado';
      if (app.integridad_state === 'duda_cv') return 'duda_cv';
      if (app.integridad_state === 'llamar_entrevista') return 'llamar_entrevista';
      return 'completado';
    case 'video':
      return app.video_state === 'grabado' ? 'completado' : 'siguiente';
    case 'finalistas':
      return 'llamar_entrevista';
    case 'rechazados':
      return 'rechazado';
  }
}

/** Texto de status que va debajo del nombre del candidato (ej. "Técnica", "En progreso · falta Inglés", etc). */
function getStatusText(app: Application, phase: PipelinePhase, sub: SubState): string {
  if (phase === 'tecnica') {
    if (sub === 'rechazado') return 'Score técnico bajo';
    if (sub === 'duda_cv') return app.english_state === 'fallo' ? 'Inglés bajo el mínimo' : 'Revisar manualmente';
    if (sub === 'siguiente') {
      if (app.english_state === 'en_progreso') return 'En progreso · falta Inglés';
      return '→ Conductual';
    }
    return 'Técnica';
  }
  if (phase === 'conductual') {
    if (sub === 'siguiente') return '→ Integridad';
    return 'Conductual';
  }
  if (phase === 'integridad') {
    if (sub === 'rechazado') return 'Riesgo alto';
    if (sub === 'duda_cv') return 'Observación pendiente';
    if (sub === 'llamar_entrevista') return 'Llamar a entrevista';
    return 'Integridad';
  }
  if (phase === 'video') return sub === 'completado' ? 'Video grabado' : 'Pendiente de grabar';
  if (phase === 'finalistas') {
    if (app.state === 'hired') return 'Contratado';
    if (app.state === 'offered') return 'Oferta enviada';
    return 'Llamar a entrevista';
  }
  if (phase === 'rechazados') return app.state === 'rejected_by_admin' ? 'Rechazo manual' : 'Auto-rechazo';
  return 'En proceso';
}

/** Días desde que aplicó al puesto. */
function daysAgo(applied_at: string): string {
  const d = Math.floor((Date.now() - new Date(applied_at).getTime()) / (1000 * 60 * 60 * 24));
  return `${Math.max(d, 0)}d`;
}

/** Score principal a mostrar en la card (depende de la fase). */
function getMainScore(app: Application, phase: PipelinePhase): { value: number | null; isGood: boolean } {
  if (phase === 'tecnica' || phase === 'rechazados') {
    const v = app.tecnica?.pct ?? null;
    return { value: v, isGood: v != null && v >= 60 };
  }
  if (phase === 'conductual') {
    const v = app.disc?.similitud_pct ?? null;
    return { value: v, isGood: v != null && v >= 60 };
  }
  if (phase === 'integridad' || phase === 'video' || phase === 'finalistas') {
    const v = app.tecnica?.pct ?? null;
    return { value: v, isGood: v != null && v >= 60 };
  }
  return { value: null, isGood: true };
}

// ===== Sub-componentes =====

function CountBand({
  phase, count, active, onClick,
}: { phase: PipelinePhase; count: number; active: boolean; onClick: () => void }) {
  const color = PHASE_COLOR[phase];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.15rem',
        padding: '0.6rem 0.9rem',
        background: active ? `${color}1f` : '#161a23',
        border: `1px solid ${active ? color : '#1f2937'}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: '8px',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
        <strong style={{ fontSize: '1.5rem', color, fontWeight: 800 }}>{count}</strong>
        <span style={{ fontSize: '0.85rem', color: '#f3f4f6', fontWeight: 600 }}>{PHASE_LABEL[phase]}</span>
      </span>
      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{PHASE_SUBLABEL[phase]}</span>
    </button>
  );
}

function TechBadges({ app, dark }: { app: Application; dark: boolean }) {
  const t = app.tecnica;
  const tecCompletado = !!t;
  const techOk = t?.estado === 'Aprobado';

  const badgeStyle = (color: string, bgIntensity = '26'): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '0.7rem',
    background: dark ? `${color}${bgIntensity}` : `${color}1a`,
    color,
    fontWeight: 600,
  });

  // Estado del badge Técnico
  const techColor = !tecCompletado ? '#fbbf24' : techOk ? '#34d399' : '#f87171';
  const techIcon = !tecCompletado ? '⏳' : techOk ? '✅' : '❌';
  const techTitle = !tecCompletado ? 'Técnico: pendiente' : `Técnico ${t?.pct}%`;

  // Estado del badge Inglés
  const englishState = app.english_state;
  const englishColor = englishState == null ? '#64748b'
    : englishState === 'completado' ? '#34d399'
    : englishState === 'fallo' ? '#f87171'
    : '#fbbf24';
  const englishIcon = englishState == null ? '—'
    : englishState === 'completado' ? '✅'
    : englishState === 'fallo' ? '❌'
    : '⏳';
  const englishTitle = englishState == null ? 'El puesto no requiere esta evaluación'
    : englishState === 'completado' ? 'Inglés aprobado'
    : englishState === 'fallo' ? 'Inglés bajo el mínimo'
    : 'Inglés en proceso';

  // Estado del Mindset — slider horizontal Rígido ←—●—→ Adaptable
  const mindsetPerfil = app.mindset_perfil;
  const mindsetTitle = mindsetPerfil == null ? 'El puesto no requiere esta evaluación'
    : mindsetPerfil === 'adaptable' ? 'Adaptable — Se ajusta bien a cambios'
    : mindsetPerfil === 'mixto' ? 'Mixto — Mezcla de adaptabilidad y estructura'
    : mindsetPerfil === 'rigido' ? 'Rígido — Prefiere ambientes estables y predecibles'
    : 'Mindset en proceso';
  // Posición del ● en el slider (0 = Rígido extremo, 100 = Adaptable extremo)
  const mindsetPos = mindsetPerfil == null ? null
    : mindsetPerfil === 'rigido' ? 18
    : mindsetPerfil === 'mixto' ? 50
    : mindsetPerfil === 'adaptable' ? 82
    : null; // en_progreso

  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={badgeStyle(techColor)} title={techTitle}>
        🔧 {techIcon}
      </span>
      <span style={badgeStyle(englishColor)} title={englishTitle}>
        🇬🇧 {englishIcon}
      </span>
      {/* Mindset: slider horizontal Rígido ←—●—→ Adaptable */}
      <span
        title={mindsetTitle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 6px',
          borderRadius: '4px',
          fontSize: '0.65rem',
          background: dark ? '#1f293726' : '#1f29371a',
          color: '#94a3b8',
          fontWeight: 600,
        }}
      >
        🧠
        {mindsetPos == null ? (
          <span style={{ color: '#64748b', padding: '0 2px' }}>
            {mindsetPerfil === 'en_progreso' ? '⏳' : '—'}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.6rem' }}>R</span>
            <span style={{
              position: 'relative',
              width: '40px',
              height: '4px',
              background: '#1f2937',
              borderRadius: '2px',
              display: 'inline-block',
            }}>
              <span style={{
                position: 'absolute',
                left: `${mindsetPos}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#34d399',
                boxShadow: '0 0 0 1px #0e1218',
              }} />
            </span>
            <span style={{ color: '#94a3b8', fontSize: '0.6rem' }}>A</span>
          </span>
        )}
      </span>
    </div>
  );
}

/** Card del candidato dentro de una sub-columna del Tablero. */
function CandidateCard({
  app, phase, sub,
}: { app: Application & { _phase: PipelinePhase }; phase: PipelinePhase; sub: SubState }) {
  const status = getStatusText(app, phase, sub);
  const score = getMainScore(app, phase);

  // Color del score según valor
  const scoreColor = score.value == null ? '#94a3b8'
    : sub === 'rechazado' ? '#f87171'
    : sub === 'duda_cv' ? '#fbbf24'
    : score.isGood ? '#34d399' : '#fbbf24';

  return (
    <Link
      to={`/candidates/${app.id}`}
      style={{
        display: 'block',
        background: '#161a23',
        border: '1px solid #1f2937',
        borderRadius: '6px',
        padding: '0.7rem 0.8rem',
        textDecoration: 'none',
        color: '#f3f4f6',
        marginBottom: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.95rem', color: '#f3f4f6' }}>{app.candidate_name}</strong>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{daysAgo(app.applied_at)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{status}</span>
        {score.value != null && (
          <strong style={{ fontSize: '0.95rem', color: scoreColor, fontWeight: 700 }}>{score.value}%</strong>
        )}
      </div>
      <TechBadges app={app} dark />
    </Link>
  );
}

// ===== Componente principal =====

type SortKey = 'name' | 'phase' | 'tecnica' | 'salary' | 'days';

export function PipelineDashboard({
  applications,
  jobTitle,
  jobId,
}: { applications: Application[]; jobTitle: string; jobId?: string }) {
  const [view, setView] = useState<'tabla' | 'tablero'>('tablero');
  const [phaseFilter, setPhaseFilter] = useState<PipelinePhase | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('tecnica');
  const [sortDesc, setSortDesc] = useState(true);

  const { appsWithPhase, counts } = useMemo(() => {
    const apps = applications.map((a) => ({ ...a, _phase: getCurrentPhase(a) }));
    const c: Record<PipelinePhase, number> = {
      prefiltro: 0, tecnica: 0, conductual: 0, integridad: 0,
      video: 0, finalistas: 0, rechazados: 0,
    };
    for (const a of apps) c[a._phase]++;
    return { appsWithPhase: apps, counts: c };
  }, [applications]);

  const filtered = useMemo(() => {
    if (!phaseFilter) return appsWithPhase;
    return appsWithPhase.filter((a) => a._phase === phaseFilter);
  }, [appsWithPhase, phaseFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': cmp = a.candidate_name.localeCompare(b.candidate_name); break;
        case 'phase': cmp = a._phase.localeCompare(b._phase); break;
        case 'tecnica': cmp = (a.tecnica?.pct ?? 0) - (b.tecnica?.pct ?? 0); break;
        case 'salary': cmp = a.salary_aspiration_usd - b.salary_aspiration_usd; break;
        case 'days': cmp = a.applied_at.localeCompare(b.applied_at); break;
      }
      return sortDesc ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortBy, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDesc(!sortDesc);
    else { setSortBy(key); setSortDesc(true); }
  }

  const finalistas = appsWithPhase.filter((a) => a._phase === 'finalistas').slice(0, 4);

  return (
    <div style={{ background: '#0e1218', minHeight: '70vh', padding: '1rem 0', borderRadius: '8px' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0 1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f3f4f6' }}>{jobTitle}</h2>
          <p style={{ margin: '0.2rem 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            {applications.length} candidatos en el pipeline
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {jobId && counts.finalistas >= 2 && (
            <Link
              to={`/jobs/${jobId}/comparar?candidates=${finalistas.map((a) => a.id).join(',')}`}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#22c55e',
                color: 'white',
                border: '1px solid #16a34a',
                borderRadius: '6px',
                fontSize: '0.85rem',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              ⚖️ Comparar finalistas ({Math.min(counts.finalistas, 4)})
            </Link>
          )}
          <button
            onClick={() => setView('tabla')}
            style={{
              padding: '0.4rem 0.8rem',
              background: view === 'tabla' ? '#dafd6f' : '#161a23',
              color: view === 'tabla' ? '#0e1218' : '#f3f4f6',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            📋 Tabla
          </button>
          <button
            onClick={() => setView('tablero')}
            style={{
              padding: '0.4rem 0.8rem',
              background: view === 'tablero' ? '#dafd6f' : '#161a23',
              color: view === 'tablero' ? '#0e1218' : '#f3f4f6',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            🗂️ Tablero
          </button>
        </div>
      </header>

      {/* Bandas de conteo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem', marginBottom: '1.25rem', padding: '0 1rem' }}>
        {(['prefiltro', 'tecnica', 'conductual', 'integridad', 'video', 'finalistas', 'rechazados'] as PipelinePhase[]).map((phase) => (
          <CountBand
            key={phase}
            phase={phase}
            count={counts[phase]}
            active={phaseFilter === phase}
            onClick={() => setPhaseFilter(phaseFilter === phase ? null : phase)}
          />
        ))}
      </div>

      {phaseFilter && (
        <p style={{ margin: '0 1rem 0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
          Filtrando por fase: <strong style={{ color: '#f3f4f6' }}>{PHASE_LABEL[phaseFilter]}</strong>{' '}
          <button onClick={() => setPhaseFilter(null)} style={{ background: 'transparent', border: 'none', color: '#dafd6f', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.85rem', padding: 0 }}>
            quitar filtro
          </button>
        </p>
      )}

      <div style={{ padding: '0 1rem' }}>
        {view === 'tabla' && <TableView applications={sorted} sortBy={sortBy} sortDesc={sortDesc} onSort={toggleSort} />}
        {view === 'tablero' && <BoardView applications={appsWithPhase} />}
      </div>
    </div>
  );
}

// ===== Vista Tabla (dark mode) =====

function TableView({
  applications, sortBy, sortDesc, onSort,
}: {
  applications: Array<Application & { _phase: PipelinePhase }>;
  sortBy: SortKey; sortDesc: boolean; onSort: (k: SortKey) => void;
}) {
  if (applications.length === 0) {
    return <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>Sin candidatos en esta vista.</p>;
  }

  const SortArrow = ({ k }: { k: SortKey }) => sortBy === k ? <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem' }}>{sortDesc ? '▼' : '▲'}</span> : null;

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '0.6rem 0.5rem',
    fontSize: '0.75rem',
    color: '#94a3b8',
    fontWeight: 600,
    borderBottom: '1px solid #1f2937',
    cursor: 'pointer',
    userSelect: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };
  const tdStyle: React.CSSProperties = {
    padding: '0.6rem 0.5rem',
    fontSize: '0.85rem',
    borderBottom: '1px solid #1f2937',
    color: '#f3f4f6',
  };

  return (
    <div style={{ overflowX: 'auto', background: '#161a23', borderRadius: '8px', border: '1px solid #1f2937' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#0e1218' }}>
            <th style={thStyle} onClick={() => onSort('name')}>Nombre<SortArrow k="name" /></th>
            <th style={thStyle} onClick={() => onSort('phase')}>Fase actual<SortArrow k="phase" /></th>
            <th style={thStyle} onClick={() => onSort('tecnica')}>Téc + Inglés + Mindset<SortArrow k="tecnica" /></th>
            <th style={thStyle}>DISC%</th>
            <th style={thStyle}>VELNA%</th>
            <th style={thStyle} onClick={() => onSort('days')}>Aplicó<SortArrow k="days" /></th>
            <th style={thStyle}>⋯</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => {
            const sub = getSubState(app, app._phase);
            const status = getStatusText(app, app._phase, sub);
            const color = PHASE_COLOR[app._phase];
            return (
              <tr key={app.id}>
                <td style={tdStyle}>
                  <Link to={`/candidates/${app.id}`} style={{ color: '#f3f4f6', textDecoration: 'none', fontWeight: 600 }}>
                    {app.candidate_name}
                  </Link>
                </td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '2px 8px', borderRadius: '999px',
                    background: `${color}22`, color, fontSize: '0.75rem',
                    fontWeight: 600, border: `1px solid ${color}55`,
                  }}>
                    ● {PHASE_LABEL[app._phase]} · {status}
                  </span>
                </td>
                <td style={tdStyle}><TechBadges app={app} dark /></td>
                <td style={tdStyle}>
                  {app.disc?.similitud_pct != null ? (
                    <span style={{ color: app.disc.similitud_pct >= 70 ? '#34d399' : app.disc.similitud_pct >= 50 ? '#f3f4f6' : '#fbbf24', fontWeight: 600 }}>
                      {app.disc.similitud_pct}%
                    </span>
                  ) : <span style={{ color: '#64748b' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  {app.velna?.similitud_pct != null ? (
                    <span style={{ color: app.velna.similitud_pct >= 70 ? '#34d399' : app.velna.similitud_pct >= 50 ? '#f3f4f6' : '#fbbf24', fontWeight: 600 }}>
                      {app.velna.similitud_pct}%
                    </span>
                  ) : <span style={{ color: '#64748b' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{daysAgo(app.applied_at)}</span>
                </td>
                <td style={tdStyle}>
                  <Link to={`/candidates/${app.id}`} style={{ color: '#dafd6f', textDecoration: 'none' }}>Ver →</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===== Vista Tablero (dark mode + sub-columnas) =====

function BoardView({ applications }: { applications: Array<Application & { _phase: PipelinePhase }> }) {
  const [expanded, setExpanded] = useState<PipelinePhase | null>('tecnica');
  const phases: PipelinePhase[] = ['prefiltro', 'tecnica', 'conductual', 'integridad', 'video', 'finalistas'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {phases.map((phase) => {
        const apps = applications.filter((a) => a._phase === phase);
        const color = PHASE_COLOR[phase];
        const isOpen = expanded === phase;

        // Agrupar por sub-estado
        const buckets: Record<SubState, typeof apps> = {
          completado: [], siguiente: [], rechazado: [], duda_cv: [], llamar_entrevista: [],
        };
        for (const a of apps) buckets[getSubState(a, phase)].push(a);

        // Sub-columnas según fase
        const isIntegridad = phase === 'integridad';
        const isFinalistas = phase === 'finalistas';
        const subColumns: { key: SubState; label: string; color: string }[] = isFinalistas
          ? [{ key: 'llamar_entrevista', label: 'Llamar a entrevista', color: '#34d399' }]
          : isIntegridad
          ? [
              { key: 'completado', label: 'Completado', color: '#34d399' },
              { key: 'llamar_entrevista', label: 'Llamar a entrevista', color: '#dafd6f' },
              { key: 'rechazado', label: 'Rechazado', color: '#f87171' },
              { key: 'duda_cv', label: 'Duda CV', color: '#fbbf24' },
            ]
          : [
              { key: 'completado', label: 'Completado', color: '#34d399' },
              { key: 'siguiente', label: 'Siguiente etapa', color: '#dafd6f' },
              { key: 'rechazado', label: 'Rechazado', color: '#f87171' },
              { key: 'duda_cv', label: 'Duda CV', color: '#fbbf24' },
            ];

        return (
          <div key={phase} style={{
            background: '#0e1218',
            border: '1px solid #1f2937',
            borderLeft: `3px solid ${color}`,
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setExpanded(isOpen ? null : phase)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.9rem 1.2rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: '#f3f4f6',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>{isOpen ? '▼' : '▶'}</span>
                <strong style={{ fontSize: '1.1rem', color }}>{PHASE_LABEL[phase]}</strong>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{PHASE_SUBLABEL[phase]}</span>
              </span>
              <span style={{ display: 'flex', gap: '1.2rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                {subColumns.map((c) => (
                  <span key={c.key}>
                    {c.label} <strong style={{ color: c.color, fontSize: '0.9rem' }}>{buckets[c.key].length}</strong>
                  </span>
                ))}
              </span>
            </button>

            {isOpen && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${subColumns.length}, 1fr)`,
                gap: '0.75rem',
                padding: '0.5rem 1.2rem 1.2rem',
              }}>
                {subColumns.map((col) => (
                  <div key={col.key}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.4rem 0.6rem',
                      marginBottom: '0.5rem',
                      borderBottom: `1px solid ${col.color}33`,
                    }}>
                      <span style={{ color: col.color, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '1px' }}>
                        {col.label.toUpperCase()}
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
                        {buckets[col.key].length}
                      </span>
                    </div>
                    {buckets[col.key].length === 0 ? (
                      <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>—</p>
                    ) : (
                      buckets[col.key].map((app) => (
                        <CandidateCard key={app.id} app={app} phase={phase} sub={col.key} />
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
