import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJob, getIntegrityResults } from '../../services/api';
import type { CSSProperties } from 'react';

const DIM_LABELS: Record<string, string> = {
  honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol',
  drogas: 'Drogas', confiabilidad: 'Confiabilidad', etica_profesional: 'Ética profesional',
  personalidad: 'Personalidad', apuestas: 'Apuestas',
};
const RISK_COLORS: Record<string, string> = { bajo: 'var(--kuno-lime)', medio: '#f39c12', alto: 'var(--kuno-danger)' };

interface IntegrityEntry {
  result_id: string;
  candidate: { id: string; name: string; email: string };
  completed_at: string;
  integrity: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> } | null;
}

export default function IntegrityResults() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [entries, setEntries] = useState<IntegrityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IntegrityEntry | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getJob(id), getIntegrityResults(id)]).then(([j, data]) => {
      setJob(j);
      setEntries(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  return (
    <div>
      <Link to={`/admin/jobs/${id}`} style={backLink}>← Volver al puesto</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 8 }}>
        Resultados de Integridad
      </h1>
      <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14, marginBottom: 24 }}>
        {job?.title} — {job?.company}
      </p>

      {entries.length === 0 ? (
        <div style={emptyCard}>
          <p style={{ color: 'var(--kuno-text-muted)' }}>Ningún candidato ha completado la prueba de integridad.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Left: candidate list */}
          <div style={{ width: 320, flexShrink: 0 }}>
            <h3 style={sectionTitle}>Candidatos ({entries.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map(e => (
                <button key={e.result_id} onClick={() => setSelected(e)}
                  style={selected?.result_id === e.result_id ? cardActive : card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--kuno-cream)' }}>{e.candidate.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{e.candidate.email}</div>
                    </div>
                    {e.integrity && (
                      <span style={{ ...badge, background: RISK_COLORS[e.integrity.overall] || 'var(--kuno-slate)', color: e.integrity.overall === 'bajo' ? 'var(--kuno-dark)' : '#fff' }}>
                        {e.integrity.overall.toUpperCase()}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1 }}>
            {!selected ? (
              <div style={emptyCard}>
                <p style={{ color: 'var(--kuno-text-muted)' }}>Selecciona un candidato para ver el detalle.</p>
              </div>
            ) : !selected.integrity ? (
              <div style={emptyCard}>
                <p style={{ color: 'var(--kuno-text-muted)' }}>Sin datos de integridad para este candidato.</p>
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 4 }}>
                  {selected.candidate.name}
                </h3>
                <p style={{ color: 'var(--kuno-text-muted)', fontSize: 13, marginBottom: 20 }}>
                  {selected.candidate.email}
                </p>

                {/* Overall */}
                <div style={detailCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ ...badgeLg, background: RISK_COLORS[selected.integrity.overall], color: selected.integrity.overall === 'bajo' ? 'var(--kuno-dark)' : '#fff' }}>
                      {selected.integrity.overall.toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--kuno-cream)' }}>
                        {selected.integrity.recomendacion}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--kuno-text-muted)' }}>
                        Riesgo general: {selected.integrity.overall_pct}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dimensions */}
                <h4 style={{ ...sectionTitle, marginTop: 20 }}>Dimensiones</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {Object.entries(selected.integrity.dimensiones).map(([dim, d]) => (
                    <div key={dim} style={dimCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)' }}>
                          {DIM_LABELS[dim] || dim}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: RISK_COLORS[d.nivel] }}>
                          {d.nivel.toUpperCase()} {d.pct}%
                        </span>
                      </div>
                      <div style={{ height: 8, background: 'var(--kuno-dark-2)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.pct}%`, background: RISK_COLORS[d.nivel], borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const sectionTitle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--kuno-lime)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' };
const emptyCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center' };
const card: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', width: '100%' };
const cardActive: CSSProperties = { ...card, borderColor: 'var(--kuno-lime)', background: 'rgba(218,253,111,0.05)' };
const badge: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 12 };
const badgeLg: CSSProperties = { fontSize: 14, fontWeight: 700, padding: '8px 18px', borderRadius: 16 };
const detailCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 20 };
const dimCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: '12px 14px' };
