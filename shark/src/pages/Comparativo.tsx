/**
 * CandidateComparison — vista comparativa de 3-4 candidatos finalistas lado a lado.
 *
 * Reemplaza el comparativo viejo (oculto desde V1 con hooks order bugs).
 *
 * Decisión confirmada (BUGS_FEEDBACK M3): hacer nuevo desde cero con shape doble eje (Opción B)
 * — máximo 3-4 candidatos lado a lado.
 *
 * Secciones:
 *   - Cabecera con nombre, edad, salario aspirado
 *   - DISC (4 ejes vs perfil ideal)
 *   - VELNA (5 dimensiones)
 *   - Técnico (puntaje + estilo situacional + match con jefe + validez)
 *   - Inglés / Mindset / Integridad (estados)
 *   - Recomendación rápida (avanzar / duda CV / rechazar)
 *
 * URL: /jobs/:jobId/compare?candidates=id1,id2,id3,id4
 */
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import type { Application } from '../data/mockApplications';
import { useApi } from '../lib/api';
import { adaptToMockApplication } from '../lib/applicationAdapter';
import { config } from '../config';
import { Term } from '../components/Tooltip';

const MAX_CANDIDATES = 4;

type ScoreCellProps = {
  value: number | null | undefined;
  thresholdGood?: number;
  thresholdMid?: number;
  suffix?: string;
};

function ScoreCell({ value, thresholdGood = 70, thresholdMid = 50, suffix = '%' }: ScoreCellProps) {
  if (value == null) return <span style={{ color: '#6b7280' }}>—</span>;
  const color = value >= thresholdGood ? '#047857'
    : value >= thresholdMid ? '#1f2937'
    : '#b45309';
  return (
    <strong style={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {value}{suffix}
    </strong>
  );
}

function TextCell({ value, accent }: { value: string | null | undefined; accent?: 'good' | 'warn' | 'bad' }) {
  if (!value) return <span style={{ color: '#6b7280' }}>—</span>;
  const color = accent === 'good' ? '#047857'
    : accent === 'warn' ? '#b45309'
    : accent === 'bad' ? '#b91c1c'
    : '#1f2937';
  return <span style={{ color, fontWeight: accent ? 600 : 400 }}>{value}</span>;
}

function Bar({ value, max = 100 }: { value: number | null | undefined; max?: number }) {
  if (value == null) return <span style={{ color: '#6b7280' }}>—</span>;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const fillColor = pct >= 70 ? '#047857' : pct >= 50 ? '#1f2937' : '#b45309';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ flex: 1, height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', minWidth: '60px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: fillColor, borderRadius: '4px' }} />
      </div>
      <span style={{ color: '#1f2937', fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem', minWidth: '32px', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

// Barras verticales DISC con colores fijos por eje (réplica del Comparativo V1)
const DISC_AXIS_COLOR: Record<'d' | 'i' | 's' | 'c', string> = {
  d: '#ef4444', // rojo
  i: '#f59e0b', // dorado
  s: '#10b981', // verde
  c: '#3b82f6', // azul
};
const DISC_AXIS_LABEL: Record<'d' | 'i' | 's' | 'c', string> = {
  d: 'D',
  i: 'I',
  s: 'S',
  c: 'C',
};

function DiscVerticalBars({ disc }: { disc: { d: number; i: number; s: number; c: number } | null | undefined }) {
  if (!disc) return <span style={{ color: '#6b7280' }}>—</span>;
  const axes: ('d' | 'i' | 's' | 'c')[] = ['d', 'i', 's', 'c'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', height: '100px', justifyContent: 'center' }}>
      {axes.map((ax) => {
        const val = disc[ax];
        const h = Math.max(8, Math.min(100, val)) + '%';
        return (
          <div key={ax} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.72rem', color: '#1f2937', fontWeight: 600 }}>{val}</span>
            <div style={{ width: '24px', height: '70px', background: '#f3f4f6', borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: h, background: DISC_AXIS_COLOR[ax], borderRadius: '4px' }} />
            </div>
            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700 }}>{DISC_AXIS_LABEL[ax]}</span>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBar({ value, label, max = 100 }: { value: number; label: string; max?: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem' }}>
      <span style={{ minWidth: '80px', color: '#1f2937', fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #3b82f6)', borderRadius: '4px' }} />
      </div>
      <span style={{ minWidth: '32px', textAlign: 'right', color: '#1f2937', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function PhaseAlertRow({ label, count }: { label: string; count: number }) {
  const isAlert = count > 0;
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: '0.8rem',
      padding: '4px 8px',
      borderRadius: '4px',
      background: isAlert ? '#fef3c7' : 'transparent',
      color: isAlert ? '#92400e' : '#374151',
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700 }}>
        {isAlert ? `${count} alerta${count > 1 ? 's' : ''}` : '0 alertas'}
      </span>
    </div>
  );
}

function EmotionalSlider({ value, name }: { value: number | null | undefined; name: string }) {
  if (value == null) return null;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#374151', marginBottom: '4px' }}>
        <span>Espontáneo</span>
        <span>Reflexivo</span>
      </div>
      <div style={{ position: 'relative', height: '8px', background: 'linear-gradient(90deg, #f59e0b 0%, #d4d4d4 50%, #3b82f6 100%)', borderRadius: '4px' }}>
        <div style={{
          position: 'absolute',
          left: `${pct}%`,
          top: '-4px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#1f2937',
          border: '2px solid #fff',
          transform: 'translateX(-50%)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <div style={{ marginTop: '4px', fontSize: '0.82rem', color: '#1f2937', fontWeight: 600 }}>
        {name}: {value}/100
      </div>
    </div>
  );
}

function PhaseRecommendation({ app }: { app: Application }) {
  // Recomendación rápida basada en estados del adapter
  const isRejected = app.state === 'auto_rejected_low_score'
    || app.state === 'rejected_by_admin'
    || app.integridad_state === 'rechazado'
    || app.tecnica_state === 'rechazado';
  const isDuda = app.tecnica_state === 'duda_cv'
    || app.conductual_state === 'duda_cv'
    || app.integridad_state === 'duda_cv'
    || (app.needs_review_reasons && app.needs_review_reasons.length > 0);
  const isFinalist = app.state === 'finalist' || app.state === 'offered' || app.state === 'hired';

  if (isRejected) {
    return (
      <span style={{
        background: '#fef2f2', color: '#991b1b', padding: '4px 10px', borderRadius: '999px',
        fontSize: '0.78rem', fontWeight: 600, display: 'inline-block',
      }}>❌ Rechazar</span>
    );
  }
  if (isFinalist) {
    return (
      <span style={{
        background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: '999px',
        fontSize: '0.78rem', fontWeight: 600, display: 'inline-block',
      }}>✅ Llamar a entrevista</span>
    );
  }
  if (isDuda) {
    return (
      <span style={{
        background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: '999px',
        fontSize: '0.78rem', fontWeight: 600, display: 'inline-block',
      }}>🟡 Duda CV</span>
    );
  }
  return (
    <span style={{
      background: '#dbeafe', color: '#1e40af', padding: '4px 10px', borderRadius: '999px',
      fontSize: '0.78rem', fontWeight: 600, display: 'inline-block',
    }}>🔵 Avanzar</span>
  );
}

type IdealProfileDISC = { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string; description?: string[] };
type IdealProfileVELNA = { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
type IdealProfileCompetencia = { name: string; required_pct: number };
type ParsedIdealProfile = {
  disc?: IdealProfileDISC;
  disc_b?: IdealProfileDISC;
  velna?: IdealProfileVELNA;
  competencias?: IdealProfileCompetencia[];
  tecnica_minimo_pct?: number;
};

export default function CandidateComparison() {
  const { id: jobId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const api = useApi();
  const [candidates, setCandidates] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [idealProfile, setIdealProfile] = useState<ParsedIdealProfile | null>(null);
  // Anti-cheat events agrupados por (candidateId → phase → count). Cargado desde readScores.
  const [antiCheatMap, setAntiCheatMap] = useState<Record<string, Record<string, number>>>({});

  const candidateIds = useMemo(() => {
    const raw = searchParams.get('candidates') ?? '';
    return raw.split(',').filter(Boolean).slice(0, MAX_CANDIDATES);
  }, [searchParams]);

  useEffect(() => {
    if (!config.useApi || candidateIds.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        // Cargar job para el título + ideal_profile
        if (jobId) {
          try {
            const jobRes = await api.jobs.get(jobId);
            if (!cancelled) {
              setJobTitle(`${jobRes.job.title} — ${jobRes.job.company}`);
              if (jobRes.job.ideal_profile) {
                try {
                  const parsed = JSON.parse(jobRes.job.ideal_profile) as ParsedIdealProfile;
                  setIdealProfile(parsed);
                } catch {
                  // Sin perfil ideal, secciones nuevas no se muestran
                }
              }
            }
          } catch {
            // No critical
          }
        }

        // Cargar applications + scores en paralelo
        const loaded: Application[] = [];
        for (const id of candidateIds) {
          try {
            const appResp = await api.applications.get(id);
            const a = appResp.application;
            const [candResp, scoresResp, integrityResp] = await Promise.all([
              api.candidates.get(a.candidate_id).catch(() => null),
              api.applications.readScores(a.ROWID).catch(() => null),
              api.applications.readIntegrity(a.ROWID).catch(() => null),
            ]);
            // Acumular anti-cheat events por candidato → fase
            if (scoresResp?.anti_cheat_by_phase) {
              setAntiCheatMap((prev) => ({ ...prev, [a.ROWID]: scoresResp.anti_cheat_by_phase! }));
            }
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
              // readScores ya trae integrity_dimensions; fallback a readIntegrity si vino vacío
              ((scoresResp?.integrity_dimensions?.length
                ? scoresResp.integrity_dimensions
                : integrityResp?.integrity?.dimensions) ?? []).map((d) => ({
                dimension: d.dimension,
                nivel: d.nivel,
                pct: d.pct,
              })),
            );
            loaded.push(adapted);
          } catch (err) {
            console.warn(`Failed to load candidate ${id}`, err);
          }
        }
        if (!cancelled) {
          setCandidates(loaded);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [candidateIds, jobId, api]);

  if (candidateIds.length === 0) {
    return (
      <div style={{ padding: '2rem' }}>
        <h2>Comparar finalistas</h2>
        <p style={{ color: '#374151' }}>
          Selecciona 2 a {MAX_CANDIDATES} candidatos para comparar. Usa la URL con
          <code>?candidates=id1,id2,id3,id4</code>.
        </p>
        <Link to={`/jobs/${jobId}`}>← Volver al puesto</Link>
      </div>
    );
  }

  if (loading) return <p style={{ padding: '2rem' }}>Cargando candidatos...</p>;
  if (error) return <p style={{ padding: '2rem', color: '#b91c1c' }}>Error: {error}</p>;
  if (candidates.length === 0) {
    return <p style={{ padding: '2rem' }}>No se pudieron cargar los candidatos.</p>;
  }

  // Estilos compartidos
  const rowLabelStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    fontSize: '0.82rem',
    color: '#1f2937',
    fontWeight: 600,
    borderBottom: '1px solid #e5e7eb',
    background: '#f3f4f6',
    minWidth: '180px',
    verticalAlign: 'middle',
  };
  const cellStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    fontSize: '0.9rem',
    color: '#1f2937',
    borderBottom: '1px solid #e5e7eb',
    textAlign: 'center',
    verticalAlign: 'middle',
  };
  const sectionHeaderStyle: React.CSSProperties = {
    padding: '0.4rem 0.75rem',
    fontSize: '0.72rem',
    background: '#e2e8f0',
    color: '#1f2937',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  // Estilos de card reutilizables para secciones nuevas (estilo V1)
  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    padding: '1rem 1.25rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  };
  const cardTitleStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '0.75rem',
  };

  return (
    <div style={{ padding: '1.5rem', background: '#f9fafb' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <Link to={`/jobs/${jobId}`} style={{ color: '#374151', fontSize: '0.85rem' }}>← Volver al puesto</Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: '0.4rem 0', fontSize: '1.5rem', color: '#1f2937' }}>Comparar candidatos — {jobTitle}</h1>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {candidates.map((c) => {
                const isRejected = c.state === 'auto_rejected_low_score' || c.state === 'rejected_by_admin'
                  || c.integridad_state === 'rechazado' || c.tecnica_state === 'rechazado';
                return (
                  <span key={c.id} style={{
                    background: isRejected ? '#fee2e2' : '#dcfce7',
                    color: isRejected ? '#991b1b' : '#166534',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}>
                    {isRejected ? '❌' : '✅'} {c.candidate_name}
                  </span>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            style={{
              background: '#1f2937',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            onClick={() => {
              const ids = candidates.map((c) => c.id).join(',');
              window.location.href = `/app/#/jobs/${jobId}/reporte?candidates=${ids}`;
            }}
          >
            📤 Preparar reporte para cliente ({candidates.length} candidatos)
          </button>
        </div>
      </header>

      {/* SECCIÓN DISC: Perfil Ideal A/B + tarjetas candidato */}
      {idealProfile?.disc && (
        <section style={{ ...cardStyle, marginBottom: '1.25rem' }}>
          <div style={cardTitleStyle}>🧩 DISC — Perfil Ideal y Candidatos</div>
          <div style={{ display: 'grid', gridTemplateColumns: idealProfile.disc_b ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.9rem', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.5rem' }}>Perfil Ideal A</div>
              <DiscVerticalBars disc={idealProfile.disc} />
              {(idealProfile.disc.pk_code || idealProfile.disc.pk_name) && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151', textAlign: 'center' }}>
                  <strong>{idealProfile.disc.pk_code}</strong> {idealProfile.disc.pk_name}
                </div>
              )}
            </div>
            {idealProfile.disc_b && (
              <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.9rem', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.5rem' }}>Perfil Ideal B (alternativo)</div>
                <DiscVerticalBars disc={idealProfile.disc_b} />
                {(idealProfile.disc_b.pk_code || idealProfile.disc_b.pk_name) && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151', textAlign: 'center' }}>
                    <strong>{idealProfile.disc_b.pk_code}</strong> {idealProfile.disc_b.pk_name}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(candidates.length, 4)}, 1fr)`, gap: '0.75rem' }}>
            {candidates.map((c) => {
              const sim = c.disc?.similitud_pct;
              const simColor = sim == null ? '#6b7280' : sim >= 70 ? '#047857' : sim >= 50 ? '#1f2937' : '#b45309';
              return (
                <div key={c.id} style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.8rem', border: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1f2937' }}>{c.candidate_name}</span>
                    {sim != null && <span style={{ fontSize: '1rem', fontWeight: 700, color: simColor }}>{sim}%</span>}
                  </div>
                  <DiscVerticalBars disc={c.disc ? { d: c.disc.d, i: c.disc.i, s: c.disc.s, c: c.disc.c } : null} />
                  {c.disc?.pk_profile_code && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.74rem', color: '#374151', textAlign: 'center' }}>
                      {c.disc.pk_profile_code} {c.disc.pk_profile_name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECCIÓN VELNA: Perfil Ideal + barras candidatos */}
      {idealProfile?.velna && (
        <section style={{ ...cardStyle, marginBottom: '1.25rem' }}>
          <div style={cardTitleStyle}>🧠 Cognitiva VELNA</div>
          <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.9rem', border: '1px solid #e5e7eb', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.5rem' }}>Perfil Ideal</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <HorizontalBar value={idealProfile.velna.verbal} label="Verbal" />
              <HorizontalBar value={idealProfile.velna.espacial} label="Espacial" />
              <HorizontalBar value={idealProfile.velna.logica} label="Lógica" />
              <HorizontalBar value={idealProfile.velna.numerica} label="Numérica" />
              <HorizontalBar value={idealProfile.velna.abstracta} label="Abstracta" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(candidates.length, 4)}, 1fr)`, gap: '0.75rem' }}>
            {candidates.map((c) => {
              const sim = c.velna?.similitud_pct;
              const simColor = sim == null ? '#6b7280' : sim >= 70 ? '#047857' : sim >= 50 ? '#1f2937' : '#b45309';
              return (
                <div key={c.id} style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.8rem', border: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1f2937' }}>{c.candidate_name}</span>
                    {sim != null && <span style={{ fontSize: '0.92rem', fontWeight: 700, color: simColor }}>{sim}%</span>}
                  </div>
                  {c.velna && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <HorizontalBar value={c.velna.verbal} label="Verbal" />
                      <HorizontalBar value={c.velna.espacial} label="Espacial" />
                      <HorizontalBar value={c.velna.logica} label="Lógica" />
                      <HorizontalBar value={c.velna.numerica} label="Numérica" />
                      <HorizontalBar value={c.velna.abstracta} label="Abstracta" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECCIÓN EMOCIÓN: slider continuo por candidato */}
      <section style={{ ...cardStyle, marginBottom: '1.25rem' }}>
        <div style={cardTitleStyle}>😊 Emoción · Espontáneo ↔ Reflexivo</div>
        {candidates.map((c) => (
          <EmotionalSlider key={c.id} value={c.emocional?.value ?? null} name={c.candidate_name} />
        ))}
      </section>

      {/* SECCIÓN ANTI-TRAMPA: alertas por fase */}
      <section style={{ ...cardStyle, marginBottom: '1.25rem' }}>
        <div style={cardTitleStyle}>🚨 Monitoreo anti-trampa</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(candidates.length, 4)}, 1fr)`, gap: '0.75rem' }}>
          {candidates.map((c) => {
            const phases = antiCheatMap[c.id] ?? {};
            const tecnica = phases['tecnica'] ?? 0;
            const conductual = phases['disc'] ?? phases['conductual'] ?? 0;
            const integridad = phases['integridad'] ?? 0;
            const total = tecnica + conductual + integridad;
            return (
              <div key={c.id} style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.8rem', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.6rem' }}>
                  {c.candidate_name}
                  {total === 0 && <span style={{ marginLeft: '0.4rem', color: '#047857', fontSize: '0.75rem' }}>✅ Limpio</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <PhaseAlertRow label="Técnica" count={tecnica} />
                  <PhaseAlertRow label="Conductual" count={conductual} />
                  <PhaseAlertRow label="Integridad" count={integridad} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECCIÓN ASPIRACIÓN SALARIAL */}
      <section style={{ ...cardStyle, marginBottom: '1.25rem' }}>
        <div style={cardTitleStyle}>💰 Aspiración salarial</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(candidates.length, 4)}, 1fr)`, gap: '0.75rem' }}>
          {candidates.map((c) => (
            <div key={c.id} style={{ background: '#f9fafb', borderRadius: '8px', padding: '0.8rem', border: '1px solid #e5e7eb', textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1f2937' }}>{c.candidate_name}</div>
              {c.salary_aspiration_usd > 0 ? (
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', marginTop: '0.3rem' }}>
                  ${c.salary_aspiration_usd.toLocaleString()}
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: '0.4rem' }}>No declarado</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...rowLabelStyle, fontSize: '0.85rem', borderBottom: '2px solid #cbd5e1' }}>Candidato</th>
              {candidates.map((c) => (
                <th key={c.id} style={{ ...cellStyle, borderBottom: '2px solid #cbd5e1', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                    <Link to={`/candidates/${c.id}`} style={{ color: '#1f2937', textDecoration: 'none', fontWeight: 700, fontSize: '0.95rem' }}>
                      {c.candidate_name}
                    </Link>
                    <span style={{ fontSize: '0.75rem', color: '#374151' }}>{c.candidate_age} años</span>
                    <PhaseRecommendation app={c} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Salario */}
            <tr>
              <th style={rowLabelStyle}>Salario aspirado</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  {c.salary_aspiration_usd > 0
                    ? <span style={{ fontWeight: 600 }}>${c.salary_aspiration_usd.toLocaleString()}/mes</span>
                    : <span style={{ color: '#6b7280' }}>—</span>}
                </td>
              ))}
            </tr>

            {/* Sección Técnica */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>🔧 Técnica</td></tr>
            <tr>
              <th style={rowLabelStyle}>Puntaje técnico</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.tecnica?.pct} thresholdGood={75} thresholdMid={60} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}><Term name="estilo profesional">Estilo situacional</Term></th>
              {candidates.map((c) => {
                const s = c.tecnica?.style_autonomy_consult;
                if (s == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#6b7280' }}>—</span></td>;
                const label = s >= 65 ? '⚡ Autonomía' : s <= 35 ? '🤝 Consulta' : '🔄 Balanceado';
                return <td key={c.id} style={cellStyle}>{label}</td>;
              })}
            </tr>
            <tr>
              <th style={rowLabelStyle}><Term name="match con jefe">Match con jefe</Term></th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.tecnica?.style_match_with_boss_pct} thresholdGood={75} thresholdMid={50} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}><Term name="validez situacional">Validez situacional</Term></th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.tecnica?.situational_validity_pct} thresholdGood={75} thresholdMid={50} />
                </td>
              ))}
            </tr>

            {/* Sección Conductual */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>🧩 Conductual</td></tr>
            <tr>
              <th style={rowLabelStyle}><Term name="DISC">DISC</Term> <Term name="similitud">similitud</Term> vs ideal</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.disc?.similitud_pct} thresholdGood={70} thresholdMid={50} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}>Perfil DISC dominante</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <TextCell value={c.disc?.dominant_label} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}><Term name="PK">Código PK</Term></th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <TextCell value={c.disc?.pk_profile_code} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}>Nombre PK</th>
              {candidates.map((c) => (
                <td key={c.id} style={{ ...cellStyle, fontSize: '0.82rem' }}>
                  <TextCell value={c.disc?.pk_profile_name} />
                </td>
              ))}
            </tr>
            {/* DISC desglosado por eje — para ver el rango completo, no solo el dominante */}
            {(['d', 'i', 's', 'c'] as const).map((axis) => {
              const labels = { d: 'D · Dominante', i: 'I · Influyente', s: 'S · Sólido', c: 'C · Cumplidor' };
              return (
                <tr key={`disc-${axis}`}>
                  <th style={{ ...rowLabelStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>{labels[axis]}</th>
                  {candidates.map((c) => (
                    <td key={c.id} style={cellStyle}>
                      <Bar value={c.disc?.[axis] ?? null} max={100} />
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr>
              <th style={rowLabelStyle}><Term name="VELNA">VELNA</Term> similitud vs ideal</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.velna?.similitud_pct} thresholdGood={70} thresholdMid={50} />
                </td>
              ))}
            </tr>
            {/* VELNA desglosado por dimensión cognitiva */}
            {(['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const).map((dim) => {
              const labels = { verbal: 'Verbal', espacial: 'Espacial', logica: 'Lógica', numerica: 'Numérica', abstracta: 'Abstracta' };
              return (
                <tr key={`velna-${dim}`}>
                  <th style={{ ...rowLabelStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>{labels[dim]}</th>
                  {candidates.map((c) => (
                    <td key={c.id} style={cellStyle}>
                      <Bar value={c.velna?.[dim] ?? null} max={100} />
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr>
              <th style={rowLabelStyle}><Term name="perfil emocional">Emocional</Term></th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <TextCell value={c.emocional?.label} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={{ ...rowLabelStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>Score emocional (0-100)</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <Bar value={c.emocional?.value ?? null} max={100} />
                </td>
              ))}
            </tr>

            {/* Sección Plus (opcionales) */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>✨ Plus (si el puesto los pidió)</td></tr>
            <tr>
              <th style={rowLabelStyle}>🇬🇧 Inglés</th>
              {candidates.map((c) => {
                const s = c.english_state;
                if (s == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#6b7280' }}>No requerido</span></td>;
                if (s === 'completado') return <td key={c.id} style={cellStyle}><TextCell value="✅ Aprobado" accent="good" /></td>;
                if (s === 'fallo') return <td key={c.id} style={cellStyle}><TextCell value="❌ No pasó" accent="warn" /></td>;
                return <td key={c.id} style={cellStyle}><TextCell value="⏳ En proceso" /></td>;
              })}
            </tr>
            <tr>
              <th style={rowLabelStyle}>🧠 <Term name="mindset">Mindset</Term></th>
              {candidates.map((c) => {
                const m = c.mindset_perfil;
                if (m == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#6b7280' }}>No requerido</span></td>;
                const label = m === 'adaptable' ? 'Adaptable'
                  : m === 'mixto' ? 'Mixto'
                  : m === 'rigido' ? 'Rígido'
                  : 'En proceso';
                return <td key={c.id} style={cellStyle}>{label}</td>;
              })}
            </tr>

            {/* Sección Integridad */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>🛡️ <Term name="integridad">Integridad</Term></td></tr>
            <tr>
              <th style={rowLabelStyle}>Resultado global</th>
              {candidates.map((c) => {
                if (!c.integridad) return <td key={c.id} style={cellStyle}><span style={{ color: '#6b7280' }}>—</span></td>;
                const obs = c.integridad.observations.length;
                if (c.integridad_state === 'rechazado') {
                  return <td key={c.id} style={cellStyle}><TextCell value="❌ Riesgos altos" accent="bad" /></td>;
                }
                if (obs === 0) return <td key={c.id} style={cellStyle}><TextCell value="✅ Sin alertas" accent="good" /></td>;
                return <td key={c.id} style={cellStyle}><TextCell value={`⚠️ ${obs} observación${obs > 1 ? 'es' : ''}`} accent="warn" /></td>;
              })}
            </tr>
            {/* Integridad desglosada por dimensión — orden: hard-rejects primero, después review dims */}
            {([
              { key: 'hurto', label: 'Hurto' },
              { key: 'soborno', label: 'Soborno' },
              { key: 'drogas', label: 'Drogas' },
              { key: 'alcohol', label: 'Alcohol' },
              { key: 'confiabilidad', label: 'Confiabilidad' },
              { key: 'autenticidad', label: 'Autenticidad' },
              { key: 'inteligencia_social', label: 'Inteligencia social' },
              { key: 'imparcialidad', label: 'Imparcialidad' },
              { key: 'sencillez', label: 'Sencillez' },
              { key: 'dominio_personal', label: 'Dominio personal' },
              { key: 'honestidad', label: 'Honestidad' },
              { key: 'apuestas', label: 'Apuestas' },
              { key: 'buena_impresion', label: 'Buena impresión (Lie scale)' },
            ] as const).map(({ key, label }) => (
              <tr key={`int-${key}`}>
                <th style={{ ...rowLabelStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>
                  {key === 'buena_impresion' ? <Term name="buena impresión">{label}</Term> : label}
                </th>
                {candidates.map((c) => {
                  const dim = c.integridad?.dimensions.find((d) => d.name === key);
                  if (!dim) return <td key={c.id} style={cellStyle}><span style={{ color: '#6b7280' }}>—</span></td>;
                  const cls = dim.classification;
                  const pct = dim.score_pct;
                  // Color del nivel: para hard-rejects, "Alto" es malo. Para buena_impresion también "Alto" es malo (lie scale).
                  // Para review dims (autenticidad, etc.), "Bajo" es lo malo.
                  const isLieScaleOrHardReject = ['hurto', 'soborno', 'drogas', 'alcohol', 'confiabilidad', 'buena_impresion'].includes(key);
                  const clsColor = cls == null ? '#6b7280'
                    : isLieScaleOrHardReject
                      ? (cls === 'Bajo' ? '#047857' : cls === 'Medio' ? '#b45309' : '#b91c1c')
                      : (cls === 'Alto' ? '#047857' : cls === 'Medio' ? '#b45309' : '#b91c1c');
                  return (
                    <td key={c.id} style={cellStyle}>
                      <span style={{ color: clsColor, fontWeight: 600, fontSize: '0.82rem' }}>{cls ?? '—'}</span>
                      {pct != null && <span style={{ color: '#6b7280', marginLeft: '0.4rem', fontSize: '0.78rem' }}>{pct}%</span>}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Video */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>🎥 Video</td></tr>
            <tr>
              <th style={rowLabelStyle}>Estado</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  {c.video_state === 'grabado'
                    ? <TextCell value="✅ Grabado" accent="good" />
                    : <TextCell value="⏳ Pendiente" />}
                </td>
              ))}
            </tr>

            {/* Acciones */}
            <tr>
              <th style={{ ...rowLabelStyle, background: '#f8fafc' }}>Acción</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <Link
                    to={`/candidates/${c.id}`}
                    style={{
                      background: '#1f2937',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    Ver ficha completa →
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: '1.5rem', color: '#374151', fontSize: '0.85rem' }}>
        💡 La recomendación rápida (avanzar / duda CV / rechazar) se calcula automáticamente según los datos. Tú decides al final.
      </p>
    </div>
  );
}
