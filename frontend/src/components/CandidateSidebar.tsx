import { useEffect, useState } from 'react';
import { getCandidateProfile, downloadReport } from '../services/api';
import type { CSSProperties } from 'react';

interface Props {
  candidateId: number;
  jobId: string;
  onClose: () => void;
}

interface Results {
  disc?: { D: number; I: number; S: number; C: number; perfil_dominante: string };
  cognitive?: { total: number; max: number; verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  emotional?: { score: number; perfil: string };
  technical?: { score: number; passed: boolean; screen_exits: number };
  integrity?: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> };
  competencias?: { id: string; nombre: string; score: number }[];
  monitoring?: { total_screen_exits: number; by_test: { type: string; screen_exits: number }[] };
}

interface JobEntry {
  jobId: number;
  jobTitle: string;
  jobCompany: string;
  results: Results;
}

interface CandidateData {
  id: number; name: string; email: string; phone?: string; age?: number;
  salary_expectation?: number; availability?: string; created_at?: string;
}

const AVAIL_LABELS: Record<string, { text: string; color: string }> = {
  disponible: { text: 'Totalmente disponible', color: 'var(--kuno-lime)' },
  '15_dias': { text: 'Necesita 15 días', color: '#f39c12' },
  negociar: { text: 'Debe negociar', color: 'var(--kuno-text-muted)' },
};
const DISC_LABELS: Record<string, string> = {
  D: 'Dominante — Directo, orientado a resultados',
  I: 'Influyente — Comunicativo, entusiasta',
  S: 'Sólido — Paciente, leal, busca estabilidad',
  C: 'Cumplidor — Analítico, metódico',
};
const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const COG_DIMS = [
  { key: 'verbal', label: 'Verbal', short: 'V' },
  { key: 'espacial', label: 'Espacial', short: 'E' },
  { key: 'logica', label: 'Lógica', short: 'L' },
  { key: 'numerica', label: 'Numérica', short: 'N' },
  { key: 'abstracta', label: 'Abstracta', short: 'A' },
];
const INT_DIM_LABELS: Record<string, string> = {
  honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol',
  drogas: 'Drogas', confiabilidad: 'Confiabilidad', etica_profesional: 'Ética profesional', personalidad: 'Personalidad', apuestas: 'Apuestas',
};

export default function CandidateSidebar({ candidateId, jobId, onClose }: Props) {
  const [candidate, setCandidate] = useState<CandidateData | null>(null);
  const [singleResults, setSingleResults] = useState<Results | null>(null);
  const [idealCompetencias, setIdealCompetencias] = useState<{ id: string; nivel_esperado: number }[]>([]);
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([]);
  const [activeJobTab, setActiveJobTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const isMultiJob = !jobId;

  useEffect(() => {
    getCandidateProfile(candidateId, jobId || undefined)
      .then(data => {
        setCandidate(data.candidate);
        if (data.jobs) {
          // Multi-job mode
          setJobEntries(data.jobs);
        } else {
          // Single-job mode
          setSingleResults(data.results);
          setIdealCompetencias(data.ideal_competencias || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [candidateId, jobId]);

  const handleDownload = async (jId: string) => {
    setDownloading(true);
    try {
      const blob = await downloadReport(jId, candidateId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe-${candidate?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'candidato'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert('Error al generar informe'); }
    setDownloading(false);
  };

  return (
    <>
      <div style={overlay} onClick={onClose} />
      <div style={sidebar}>
        <div style={sidebarHeader}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--kuno-cream)', margin: 0 }}>
            {loading ? 'Cargando...' : candidate?.name}
          </h2>
          <button onClick={onClose} style={btnClose}>✕</button>
        </div>

        {loading || !candidate ? (
          <p style={{ color: 'var(--kuno-text-muted)', padding: 20 }}>Cargando perfil...</p>
        ) : (
          <div style={sidebarBody}>
            {/* Personal data */}
            <Section title="Datos personales">
              <InfoRow label="Email" value={candidate.email} />
              {candidate.phone && <InfoRow label="Teléfono" value={candidate.phone} />}
              {candidate.age && <InfoRow label="Edad" value={`${candidate.age} años`} />}
              {candidate.salary_expectation && <InfoRow label="Aspiración salarial" value={`$${candidate.salary_expectation.toLocaleString()} USD/mes`} />}
              {candidate.availability && (
                <div style={infoRow}>
                  <span style={infoLabel}>Disponibilidad</span>
                  <span style={{ fontSize: 13, color: AVAIL_LABELS[candidate.availability]?.color || 'var(--kuno-cream)' }}>
                    {AVAIL_LABELS[candidate.availability]?.text || candidate.availability}
                  </span>
                </div>
              )}
              {candidate.created_at && <InfoRow label="Registrado" value={new Date(candidate.created_at + 'Z').toLocaleDateString('es-MX')} />}
            </Section>

            {/* Single-job results */}
            {!isMultiJob && singleResults && (
              <>
                <ResultsView r={singleResults} idealCompetencias={idealCompetencias} />
                <button onClick={() => handleDownload(jobId)} disabled={downloading} style={downloading ? btnDlLoading : btnDl}>
                  {downloading ? 'Generando informe...' : 'Descargar informe completo'}
                </button>
              </>
            )}

            {/* Multi-job tabs */}
            {isMultiJob && jobEntries.length > 0 && (
              <Section title={`Participaciones (${jobEntries.length})`}>
                <div style={tabsRow}>
                  {jobEntries.map((je, i) => (
                    <button key={je.jobId} onClick={() => setActiveJobTab(i)} style={i === activeJobTab ? tabAct : tabInact}>
                      {je.jobTitle}
                    </button>
                  ))}
                </div>
                {jobEntries[activeJobTab] && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>{jobEntries[activeJobTab].jobCompany}</p>
                    <ResultsView r={jobEntries[activeJobTab].results} idealCompetencias={[]} />
                    <button onClick={() => handleDownload(String(jobEntries[activeJobTab].jobId))} disabled={downloading} style={downloading ? btnDlLoading : btnDl}>
                      {downloading ? 'Generando...' : 'Descargar informe'}
                    </button>
                  </div>
                )}
              </Section>
            )}

            {isMultiJob && jobEntries.length === 0 && (
              <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>Sin resultados completados aún.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Results View (reusable) ── */
function ResultsView({ r, idealCompetencias }: { r: Results; idealCompetencias: { id: string; nivel_esperado: number }[] }) {
  const maxPerDim = r.cognitive ? Math.max(1, Math.round(r.cognitive.max / 5)) : 10;

  return (
    <>
      {r.technical && (
        <Section title="Prueba Técnica">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: r.technical.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{r.technical.score}%</span>
            <span style={{ background: r.technical.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)', color: r.technical.passed ? 'var(--kuno-dark)' : '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12 }}>
              {r.technical.passed ? 'Aprobado' : 'No aprobado'}
            </span>
          </div>
        </Section>
      )}

      {r.monitoring && (
        <Section title="Monitoreo anti-trampa">
          {r.monitoring.total_screen_exits === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: 'var(--kuno-lime)', fontSize: 13 }}>{'\u2705'}</span>
              <span style={{ color: 'var(--kuno-lime)', fontSize: 13, fontWeight: 500 }}>Sin salidas detectadas</span>
            </div>
          ) : r.monitoring.total_screen_exits < 3 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>{'\u26A0\uFE0F'}</span>
              <span style={{ color: '#f39c12', fontSize: 13, fontWeight: 600 }}>{r.monitoring.total_screen_exits} salidas detectadas</span>
            </div>
          ) : (
            <div style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 8 }}>
              <span style={{ color: 'var(--kuno-danger)', fontSize: 13, fontWeight: 700 }}>{'\u{1F6A8}'} {r.monitoring.total_screen_exits} salidas — posible trampa</span>
            </div>
          )}
          </Section>
      )}

      {r.disc && (
        <Section title="Perfil DISC">
          <div style={discChart}>
            {(['D', 'I', 'S', 'C'] as const).map((dim) => {
              const total = r.disc!.D + r.disc!.I + r.disc!.S + r.disc!.C || 1;
              const pct = Math.round((r.disc![dim] / total) * 100);
              return (
                <div key={dim} style={discBarCol}>
                  <div style={discBarTrack}><div style={{ ...discBarFill, height: `${pct}%`, background: DISC_COLORS[dim] }} /></div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: DISC_COLORS[dim], marginTop: 4 }}>{dim}</span>
                  <span style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: DISC_COLORS[r.disc.perfil_dominante] }}>{DISC_LABELS[r.disc.perfil_dominante] || r.disc.perfil_dominante}</span>
          </div>
        </Section>
      )}

      {r.cognitive && (
        <Section title="Cognitiva VELNA">
          {COG_DIMS.map(d => {
            const val = (r.cognitive as any)[d.key] || 0;
            const pct = Math.round((val / maxPerDim) * 100);
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 75, fontSize: 11, color: 'var(--kuno-text-muted)' }}>{d.short} {d.label}</span>
                <div style={cogBarTrack}><div style={{ ...cogBarFill, width: `${pct}%` }} /></div>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--kuno-cream)', width: 32, textAlign: 'right' }}>{val}/{maxPerDim}</span>
              </div>
            );
          })}
          <p style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 6 }}>
            Total: {r.cognitive.total}/{r.cognitive.max} ({Math.round((r.cognitive.total / r.cognitive.max) * 100)}%)
          </p>
        </Section>
      )}

      {r.emotional && (
        <Section title="Emoción">
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <div style={emotionTrack}><div style={{ ...emotionIndicator, left: `${r.emotional.score}%` }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, color: '#f39c12' }}>Espontáneo</span>
              <span style={{ fontSize: 10, color: '#3498db' }}>Mesura</span>
              <span style={{ fontSize: 10, color: '#9b59b6' }}>Reflexivo</span>
            </div>
          </div>
          <div style={{ background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', padding: '6px 10px', border: '1px solid var(--kuno-border)' }}>
            <span style={{ fontSize: 12, color: r.emotional.perfil === 'espontaneo' ? '#f39c12' : r.emotional.perfil === 'mesura' ? '#3498db' : '#9b59b6', fontWeight: 600 }}>
              {r.emotional.perfil === 'espontaneo' ? 'Espontáneo' : r.emotional.perfil === 'mesura' ? 'Mesura' : 'Reflexivo'} ({r.emotional.score})
            </span>
          </div>
        </Section>
      )}

      {r.integrity && (
        <Section title={`Integridad — ${r.integrity.overall.toUpperCase()}`}>
          <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 8 }}>{r.integrity.recomendacion}</p>
          {Object.entries(r.integrity.dimensiones).map(([dim, d]) => {
            const icon = d.nivel === 'bajo' ? '\u{1F7E2}' : d.nivel === 'medio' ? '\u{1F7E1}' : '\u{1F534}';
            return (
              <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                <span>{icon}</span>
                <span style={{ color: 'var(--kuno-cream)', flex: 1 }}>{INT_DIM_LABELS[dim] || dim}</span>
                <span style={{ color: d.nivel === 'bajo' ? 'var(--kuno-lime)' : d.nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)', fontWeight: 600, fontSize: 11 }}>
                  {d.nivel.charAt(0).toUpperCase() + d.nivel.slice(1)}
                </span>
              </div>
            );
          })}
        </Section>
      )}

      {r.competencias && idealCompetencias.length > 0 && (
        <Section title="Competencias">
          {idealCompetencias.map(ic => {
            const cc = r.competencias!.find(x => x.id === ic.id);
            const score = cc?.score || 0;
            const met = score >= ic.nivel_esperado;
            return (
              <div key={ic.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--kuno-cream)' }}>{cc?.nombre || ic.id}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: met ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{score}/{ic.nivel_esperado}</span>
                </div>
                <div style={compTrack}>
                  <div style={{ ...compFill, width: `${Math.min(100, score)}%`, background: met ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }} />
                  <div style={{ ...compTarget, left: `${Math.min(100, ic.nivel_esperado)}%` }} />
                </div>
              </div>
            );
          })}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={sectionBlock}><h3 style={sectionTitle}>{title}</h3>{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div style={infoRow}><span style={infoLabel}>{label}</span><span style={{ fontSize: 13, color: 'var(--kuno-cream)' }}>{value}</span></div>;
}

/* ── Styles ── */
const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 };
const sidebar: CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: 'var(--kuno-dark)', borderLeft: '1px solid var(--kuno-border)', zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const sidebarHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--kuno-border)', flexShrink: 0 };
const btnClose: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 20, cursor: 'pointer', padding: 4 };
const sidebarBody: CSSProperties = { flex: 1, overflowY: 'auto', padding: '20px 24px' };
const sectionBlock: CSSProperties = { marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--kuno-border)' };
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--kuno-lime)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' };
const infoRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 };
const infoLabel: CSSProperties = { fontSize: 13, color: 'var(--kuno-text-muted)' };

const discChart: CSSProperties = { display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', height: 100, padding: '0 16px' };
const discBarCol: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const discBarTrack: CSSProperties = { width: 28, height: 80, background: 'var(--kuno-dark-2)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' };
const discBarFill: CSSProperties = { width: '100%', borderRadius: 4, transition: 'height 0.3s' };

const cogBarTrack: CSSProperties = { flex: 1, height: 7, background: 'var(--kuno-dark-2)', borderRadius: 3, overflow: 'hidden' };
const cogBarFill: CSSProperties = { height: '100%', background: 'var(--kuno-lime)', borderRadius: 3, transition: 'width 0.3s' };

const emotionTrack: CSSProperties = { height: 7, background: 'linear-gradient(to right, #f39c12, #3498db, #9b59b6)', borderRadius: 3, position: 'relative' };
const emotionIndicator: CSSProperties = { position: 'absolute', top: -4, width: 14, height: 14, background: '#fff', borderRadius: '50%', border: '3px solid var(--kuno-dark)', transform: 'translateX(-50%)', transition: 'left 0.3s' };

const compTrack: CSSProperties = { height: 5, background: 'var(--kuno-dark-2)', borderRadius: 2, position: 'relative', overflow: 'visible' };
const compFill: CSSProperties = { height: '100%', borderRadius: 2, transition: 'width 0.3s' };
const compTarget: CSSProperties = { position: 'absolute', top: -2, width: 2, height: 9, background: 'var(--kuno-cream)', opacity: 0.5 };

const btnDl: CSSProperties = { width: '100%', background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 13, padding: '12px 20px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', marginTop: 8 };
const btnDlLoading: CSSProperties = { ...btnDl, opacity: 0.6, cursor: 'wait' };

const tabsRow: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const tabBase: CSSProperties = { padding: '6px 14px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer' };
const tabAct: CSSProperties = { ...tabBase, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600 };
const tabInact: CSSProperties = { ...tabBase, background: 'var(--kuno-dark-2)', color: 'var(--kuno-text-muted)', border: '1px solid var(--kuno-border)' };
