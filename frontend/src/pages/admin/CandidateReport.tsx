import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReportData, downloadReport, markReviewed } from '../../services/api';
import type { CSSProperties } from 'react';

const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const DISC_NAMES: Record<string, string> = { D: 'Dominante', I: 'Influyente', S: 'Sólido', C: 'Cumplidor' };
const COG_DIMS = [
  { key: 'verbal', label: 'Verbal' }, { key: 'espacial', label: 'Espacial' },
  { key: 'logica', label: 'Lógica' }, { key: 'numerica', label: 'Numérica' }, { key: 'abstracta', label: 'Abstracta' },
];
const INT_LABELS: Record<string, string> = {
  honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol',
  drogas: 'Drogas', confiabilidad: 'Confiabilidad', etica_profesional: 'Ética profesional', personalidad: 'Personalidad', apuestas: 'Apuestas',
};

export default function CandidateReport() {
  const { id: jobId, candidateId } = useParams<{ id: string; candidateId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!jobId || !candidateId) return;
    getReportData(jobId, Number(candidateId))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [jobId, candidateId]);

  const handlePdf = async () => {
    if (!jobId || !candidateId) return;
    setDownloading(true);
    try {
      const blob = await downloadReport(jobId, Number(candidateId));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe-${data?.candidate?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Mark as reviewed
      // Find any result_id for this candidate to mark
      await markReviewed(Number(candidateId)).catch(() => {});
    } catch { alert('Error al descargar PDF'); }
    setDownloading(false);
  };

  if (loading) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Generando informe...</p>;
  if (!data) return <p style={{ color: 'var(--kuno-danger)', padding: 24 }}>No se encontraron resultados.</p>;

  const { candidate, job, disc, cognitive, emotional, technical, integrity, ideal_competencias, competencias, reportText, screen_exits } = data;
  const screenExits: number = screen_exits || 0;
  const discTotal = disc ? disc.score.D + disc.score.I + disc.score.S + disc.score.C || 1 : 1;
  const maxPerDim = cognitive ? Math.max(1, Math.round(cognitive.score.max / 5)) : 10;
  const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Link to={`/admin/jobs/${jobId}/pipeline`} style={backLink}>← Volver al pipeline</Link>

      {/* Header */}
      <div style={headerCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 4 }}>{candidate.name}</h1>
            <p style={{ fontSize: 14, color: 'var(--kuno-text-muted)' }}>{job.title} — {job.company}</p>
            <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginTop: 4 }}>{dateStr}</p>
          </div>
          <button onClick={handlePdf} disabled={downloading} style={downloading ? btnPdfLoading : btnPdf}>
            {downloading ? 'Descargando...' : 'Descargar PDF'}
          </button>
        </div>
      </div>

      {/* DISC */}
      {disc && (
        <ReportSection title="Perfil Conductual DISC">
          <div style={discChartContainer}>
            {(['D', 'I', 'S', 'C'] as const).map(dim => {
              const pct = Math.round((disc.score[dim] / discTotal) * 100);
              return (
                <div key={dim} style={discCol}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: DISC_COLORS[dim] }}>{pct}%</span>
                  <div style={discTrack}>
                    <div style={{ ...discFill, height: `${pct}%`, background: DISC_COLORS[dim] }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: DISC_COLORS[dim], marginTop: 6 }}>{dim}</span>
                  <span style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>{DISC_NAMES[dim]}</span>
                </div>
              );
            })}
          </div>
          <div style={profileBadge}>
            <span style={{ color: DISC_COLORS[disc.perfil_dominante], fontWeight: 600, fontSize: 14 }}>
              Perfil dominante: {DISC_NAMES[disc.perfil_dominante]} — Compatibilidad: {disc.match_percentage}%
            </span>
          </div>
        </ReportSection>
      )}

      {/* Cognitive VELNA */}
      {cognitive && (
        <ReportSection title="Capacidades Cognitivas VELNA">
          {COG_DIMS.map(d => {
            const val = (cognitive.score as any)[d.key] || 0;
            const pct = Math.round((val / maxPerDim) * 100);
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ width: 90, fontSize: 13, color: 'var(--kuno-cream)', fontWeight: 500 }}>{d.label}</span>
                <div style={velnaTrack}>
                  <div style={{ ...velnaFill, width: `${pct}%` }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)', width: 50, textAlign: 'right' }}>{val}/{maxPerDim}</span>
              </div>
            );
          })}
          <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginTop: 8 }}>
            Total: {cognitive.score.total}/{cognitive.score.max} ({Math.round((cognitive.score.total / cognitive.score.max) * 100)}%) — Compatibilidad: {cognitive.match_percentage}%
          </p>
        </ReportSection>
      )}

      {/* Emotional */}
      {emotional && (
        <ReportSection title="Inteligencia Emocional">
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <div style={emoTrack}>
              <div style={{ ...emoIndicator, left: `${emotional.score}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: '#f39c12' }}>Espontáneo</span>
              <span style={{ fontSize: 12, color: '#3498db' }}>Mesura</span>
              <span style={{ fontSize: 12, color: '#9b59b6' }}>Reflexivo</span>
            </div>
          </div>
          <div style={profileBadge}>
            <span style={{ fontSize: 14, fontWeight: 600, color: emotional.perfil === 'espontaneo' ? '#f39c12' : emotional.perfil === 'mesura' ? '#3498db' : '#9b59b6' }}>
              {emotional.perfil === 'espontaneo' ? 'Espontáneo' : emotional.perfil === 'mesura' ? 'Mesura' : 'Reflexivo'} ({emotional.score}/100)
            </span>
          </div>
        </ReportSection>
      )}

      {/* Technical */}
      {technical && (
        <ReportSection title="Evaluación Técnica">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 40, fontWeight: 700, color: technical.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{technical.score}%</span>
            <span style={{ background: technical.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)', color: technical.passed ? 'var(--kuno-dark)' : '#fff', fontSize: 14, fontWeight: 600, padding: '6px 16px', borderRadius: 20 }}>
              {technical.passed ? 'Aprobado' : 'No aprobado'}
            </span>
          </div>
        </ReportSection>
      )}

      {/* Monitoring */}
      <ReportSection title="Monitoreo anti-trampa">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            background: screenExits === 0 ? 'rgba(218,253,111,0.15)' : screenExits < 3 ? 'rgba(243,156,18,0.15)' : 'rgba(231,76,60,0.15)',
          }}>
            {screenExits === 0 ? '\u2705' : screenExits < 3 ? '\u26A0\uFE0F' : '\u{1F6A8}'}
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: screenExits === 0 ? 'var(--kuno-lime)' : screenExits < 3 ? '#f39c12' : 'var(--kuno-danger)' }}>
              {screenExits === 0 ? 'Sin salidas detectadas' : `${screenExits} salidas detectadas`}
            </p>
            <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginTop: 2 }}>
              Nivel de riesgo: <span style={{ fontWeight: 600, color: screenExits === 0 ? 'var(--kuno-lime)' : screenExits < 3 ? '#f39c12' : 'var(--kuno-danger)' }}>
                {screenExits === 0 ? 'Bajo' : screenExits < 3 ? 'Medio' : 'Alto'}
              </span>
            </p>
          </div>
        </div>
      </ReportSection>

      {/* Integrity */}
      {integrity?.dimensiones && (
        <ReportSection title="Integridad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={riskBadge(integrity.overall)}>{integrity.overall.toUpperCase()}</span>
            <span style={{ fontSize: 14, color: 'var(--kuno-cream)' }}>{integrity.recomendacion}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(integrity.dimensiones).map(([dim, d]: [string, any]) => {
              const color = d.nivel === 'bajo' ? 'var(--kuno-lime)' : d.nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
              return (
                <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--kuno-cream)', flex: 1 }}>{INT_LABELS[dim] || dim}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color }}>{d.nivel.charAt(0).toUpperCase() + d.nivel.slice(1)}</span>
                </div>
              );
            })}
          </div>
        </ReportSection>
      )}

      {/* Competencias */}
      {competencias && ideal_competencias?.length > 0 && (
        <ReportSection title="Competencias">
          {ideal_competencias.map((ic: any) => {
            const cc = competencias.find((x: any) => x.id === ic.id);
            const score = cc?.score || 0;
            const met = score >= ic.nivel_esperado;
            return (
              <div key={ic.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--kuno-cream)' }}>{cc?.nombre || ic.id}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: met ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{score} / {ic.nivel_esperado}</span>
                </div>
                <div style={{ height: 8, background: 'var(--kuno-dark-2)', borderRadius: 4, position: 'relative', overflow: 'visible' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, score)}%`, background: met ? 'var(--kuno-lime)' : 'var(--kuno-danger)', borderRadius: 4 }} />
                  <div style={{ position: 'absolute', top: -2, left: `${Math.min(100, ic.nivel_esperado)}%`, width: 2, height: 12, background: 'var(--kuno-cream)', opacity: 0.5 }} />
                </div>
              </div>
            );
          })}
        </ReportSection>
      )}

      {/* AI Report Text */}
      {reportText && (
        <ReportSection title="Informe ejecutivo">
          <div style={{ fontSize: 14, color: 'var(--kuno-cream)', lineHeight: 1.8 }}>
            {reportText.split('\n').filter((p: string) => p.trim()).map((p: string, i: number) => {
              const isTitle = /^\d+[\.\)]?\s/.test(p.trim()) || /^(RESUMEN|ANÁLISIS|EVALUACIÓN|CAPACIDADES|COMPATIBILIDAD|RECOMENDACIÓN|PERFIL)/i.test(p.trim());
              return isTitle
                ? <h4 key={i} style={{ fontSize: 15, fontWeight: 700, color: 'var(--kuno-lime)', marginTop: 16, marginBottom: 6 }}>{p.trim()}</h4>
                : <p key={i} style={{ marginBottom: 10 }}>{p.trim()}</p>;
            })}
          </div>
        </ReportSection>
      )}

      {/* Bottom PDF button */}
      <button onClick={handlePdf} disabled={downloading} style={{ ...btnPdf, width: '100%', marginBottom: 40, padding: '14px 24px', fontSize: 15 }}>
        {downloading ? 'Descargando...' : 'Descargar informe PDF completo'}
      </button>
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sectionCard}>
      <h3 style={sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const headerCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24, marginBottom: 20 };
const sectionCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24, marginBottom: 16 };
const sectionTitle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--kuno-lime)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.5px' };

const discChartContainer: CSSProperties = { display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', padding: '0 24px', marginBottom: 16 };
const discCol: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 };
const discTrack: CSSProperties = { width: 40, height: 120, background: 'var(--kuno-dark-2)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' };
const discFill: CSSProperties = { width: '100%', borderRadius: 6, transition: 'height 0.5s' };
const profileBadge: CSSProperties = { padding: '10px 16px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' };

const velnaTrack: CSSProperties = { flex: 1, height: 10, background: 'var(--kuno-dark-2)', borderRadius: 5, overflow: 'hidden' };
const velnaFill: CSSProperties = { height: '100%', background: 'var(--kuno-lime)', borderRadius: 5, transition: 'width 0.5s' };

const emoTrack: CSSProperties = { height: 10, background: 'linear-gradient(to right, #f39c12, #3498db, #9b59b6)', borderRadius: 5, position: 'relative' };
const emoIndicator: CSSProperties = { position: 'absolute', top: -5, width: 20, height: 20, background: '#fff', borderRadius: '50%', border: '3px solid var(--kuno-dark)', transform: 'translateX(-50%)', transition: 'left 0.5s' };

const riskBadge = (nivel: string): CSSProperties => {
  const bg = nivel === 'bajo' ? 'var(--kuno-lime)' : nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
  const color = nivel === 'bajo' ? 'var(--kuno-dark)' : '#fff';
  return { background: bg, color, fontSize: 13, fontWeight: 600, padding: '5px 14px', borderRadius: 20 };
};

const btnPdf: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnPdfLoading: CSSProperties = { ...btnPdf, opacity: 0.6, cursor: 'wait' };
