import { useEffect, useState, useRef } from 'react';
import { getCandidates, searchCandidates } from '../../services/api';
import CandidateSidebar from '../../components/CandidateSidebar';
import type { CSSProperties } from 'react';

interface Candidate {
  id: number;
  name: string;
  email: string;
  age: number | null;
  availability: string | null;
  jobs_count: number;
  created_at: string;
}

const AVAIL_LABELS: Record<string, { text: string; color: string }> = {
  disponible: { text: 'Disponible', color: 'var(--kuno-lime)' },
  '15_dias': { text: '15 días', color: '#f39c12' },
  negociar: { text: 'Negociar', color: 'var(--kuno-text-muted)' },
};

export default function CandidateList() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sidebarId, setSidebarId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { getCandidates().then(d => { setCandidates(d); setLoading(false); }); }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (q.trim()) {
        const results = await searchCandidates(q);
        setCandidates(results);
      } else {
        const all = await getCandidates();
        setCandidates(all);
      }
    }, 300);
  };

  return (
    <div>
      <div style={headerRow}>
        <h1 style={titleStyle}>Candidatos</h1>
        <input
          type="text"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Buscar por nombre o email..."
          style={searchInput}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--kuno-text-muted)' }}>Cargando...</p>
      ) : candidates.length === 0 ? (
        <p style={{ color: 'var(--kuno-text-muted)' }}>No se encontraron candidatos.</p>
      ) : (
        <div style={tableWrapper}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Edad</th>
                <th style={thStyle}>Disponibilidad</th>
                <th style={thStyle}>Puestos</th>
                <th style={thStyle}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.id}>
                  <td style={tdStyle}><span style={{ fontWeight: 600 }}>{c.name}</span></td>
                  <td style={tdStyle}>{c.email}</td>
                  <td style={tdStyle}>{c.age || '—'}</td>
                  <td style={tdStyle}>
                    {c.availability ? (
                      <span style={{ color: AVAIL_LABELS[c.availability]?.color || 'var(--kuno-cream)', fontSize: 13 }}>
                        {AVAIL_LABELS[c.availability]?.text || c.availability}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={tdStyle}>{c.jobs_count}</td>
                  <td style={tdStyle}>
                    <button onClick={() => setSidebarId(c.id)} style={btnView}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sidebarId && (
        <CandidateSidebar candidateId={sidebarId} jobId="" onClose={() => setSidebarId(null)} />
      )}
    </div>
  );
}

const headerRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 };
const titleStyle: CSSProperties = { fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)' };
const searchInput: CSSProperties = { width: 300, padding: '10px 14px', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 14 };
const tableWrapper: CSSProperties = { overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--kuno-border)' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: CSSProperties = { padding: '12px 16px', fontSize: 12, fontWeight: 600, color: 'var(--kuno-cream)', background: 'var(--kuno-slate)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px' };
const tdStyle: CSSProperties = { padding: '12px 16px', fontSize: 14, color: 'var(--kuno-cream)', background: 'var(--kuno-dark)', borderTop: '1px solid var(--kuno-border)' };
const btnView: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-lime)', fontSize: 12, fontWeight: 500, padding: '5px 14px', borderRadius: 'var(--radius)', cursor: 'pointer' };
