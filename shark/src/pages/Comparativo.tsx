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
  if (value == null) return <span style={{ color: '#94a3b8' }}>—</span>;
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
  if (!value) return <span style={{ color: '#94a3b8' }}>—</span>;
  const color = accent === 'good' ? '#047857'
    : accent === 'warn' ? '#b45309'
    : accent === 'bad' ? '#b91c1c'
    : '#1f2937';
  return <span style={{ color, fontWeight: accent ? 600 : 400 }}>{value}</span>;
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

export default function CandidateComparison() {
  const { id: jobId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const api = useApi();
  const [candidates, setCandidates] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string>('');

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
        // Cargar job para el título
        if (jobId) {
          try {
            const jobRes = await api.jobs.get(jobId);
            if (!cancelled) setJobTitle(`${jobRes.job.title} — ${jobRes.job.company}`);
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
        <p style={{ color: '#64748b' }}>
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
    fontSize: '0.78rem',
    color: '#475569',
    fontWeight: 600,
    borderBottom: '1px solid #f1f5f9',
    background: '#f8fafc',
    minWidth: '180px',
    verticalAlign: 'middle',
  };
  const cellStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    fontSize: '0.9rem',
    borderBottom: '1px solid #f1f5f9',
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

  return (
    <div style={{ padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <Link to={`/jobs/${jobId}`} style={{ color: '#64748b', fontSize: '0.85rem' }}>← Volver al puesto</Link>
        <h1 style={{ margin: '0.4rem 0', fontSize: '1.5rem' }}>Comparar {candidates.length} candidatos</h1>
        <p style={{ margin: 0, color: '#64748b' }}>{jobTitle}</p>
      </header>

      <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
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
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{c.candidate_age} años</span>
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
                    : <span style={{ color: '#94a3b8' }}>—</span>}
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
                if (s == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#94a3b8' }}>—</span></td>;
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
              <th style={rowLabelStyle}><Term name="VELNA">VELNA</Term> similitud vs ideal</th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <ScoreCell value={c.velna?.similitud_pct} thresholdGood={70} thresholdMid={50} />
                </td>
              ))}
            </tr>
            <tr>
              <th style={rowLabelStyle}><Term name="perfil emocional">Emocional</Term></th>
              {candidates.map((c) => (
                <td key={c.id} style={cellStyle}>
                  <TextCell value={c.emocional?.label} />
                </td>
              ))}
            </tr>

            {/* Sección Plus (opcionales) */}
            <tr><td colSpan={candidates.length + 1} style={sectionHeaderStyle}>✨ Plus (si el puesto los pidió)</td></tr>
            <tr>
              <th style={rowLabelStyle}>🇬🇧 Inglés</th>
              {candidates.map((c) => {
                const s = c.english_state;
                if (s == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#94a3b8' }}>No requerido</span></td>;
                if (s === 'completado') return <td key={c.id} style={cellStyle}><TextCell value="✅ Aprobado" accent="good" /></td>;
                if (s === 'fallo') return <td key={c.id} style={cellStyle}><TextCell value="❌ No pasó" accent="warn" /></td>;
                return <td key={c.id} style={cellStyle}><TextCell value="⏳ En proceso" /></td>;
              })}
            </tr>
            <tr>
              <th style={rowLabelStyle}>🧠 <Term name="mindset">Mindset</Term></th>
              {candidates.map((c) => {
                const m = c.mindset_perfil;
                if (m == null) return <td key={c.id} style={cellStyle}><span style={{ color: '#94a3b8' }}>No requerido</span></td>;
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
                if (!c.integridad) return <td key={c.id} style={cellStyle}><span style={{ color: '#94a3b8' }}>—</span></td>;
                const obs = c.integridad.observations.length;
                if (c.integridad_state === 'rechazado') {
                  return <td key={c.id} style={cellStyle}><TextCell value="❌ Riesgos altos" accent="bad" /></td>;
                }
                if (obs === 0) return <td key={c.id} style={cellStyle}><TextCell value="✅ Sin alertas" accent="good" /></td>;
                return <td key={c.id} style={cellStyle}><TextCell value={`⚠️ ${obs} observación${obs > 1 ? 'es' : ''}`} accent="warn" /></td>;
              })}
            </tr>

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

      <p style={{ marginTop: '1.5rem', color: '#64748b', fontSize: '0.85rem' }}>
        💡 La recomendación rápida (avanzar / duda CV / rechazar) se calcula automáticamente según los datos. Tú decides al final.
      </p>
    </div>
  );
}
