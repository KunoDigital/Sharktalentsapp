import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('DUPLICATES_PAGE');

type Data = Awaited<ReturnType<ReturnType<typeof useApi>['candidates']['findDuplicates']>>;

const TYPE_LABEL: Record<Data['duplicates'][number]['type'], { icon: string; label: string }> = {
  phone: { icon: '📞', label: 'Mismo teléfono' },
  email: { icon: '✉️', label: 'Mismo email (duplicado de registro)' },
  name: { icon: '👤', label: 'Mismo nombre' },
};

export default function DuplicatesPage() {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.candidates.findDuplicates().then(setData).catch((err) => {
      log.warn('duplicates load failed', { error: (err as Error).message });
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return <div className="page"><p>Cargando…</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Candidatos duplicados</h1>
          <p className="page-subtitle">
            {data.duplicate_groups} grupos detectados · {data.affected_candidates} candidatos afectados · {data.total_candidates} candidatos en total
          </p>
        </div>
      </div>

      {data.duplicates.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: 8, marginTop: 16 }}>
          <p style={{ color: '#15803d', fontSize: 16, margin: 0 }}>✓ Sin duplicados detectados. Tu base está limpia.</p>
        </div>
      ) : (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.duplicates.map((group, idx) => {
            const meta = TYPE_LABEL[group.type];
            return (
              <div
                key={`${group.type}:${idx}`}
                style={{
                  border: `1px solid ${group.severity === 'high' ? '#dc2626' : '#d97706'}`,
                  borderLeft: `4px solid ${group.severity === 'high' ? '#dc2626' : '#d97706'}`,
                  borderRadius: 8, padding: 16, background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                      {meta.icon} {meta.label}
                    </h3>
                    <code style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, fontSize: 12, marginTop: 4, display: 'inline-block' }}>
                      {group.match}
                    </code>
                  </div>
                  <span style={{
                    padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: group.severity === 'high' ? '#fee2e2' : '#fef3c7',
                    color: group.severity === 'high' ? '#7f1d1d' : '#78350f',
                  }}>
                    {group.severity === 'high' ? 'Alta probabilidad' : 'Media probabilidad'}
                  </span>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 6 }}>Nombre</th>
                      <th style={{ padding: 6 }}>Email</th>
                      <th style={{ padding: 6 }}>Teléfono</th>
                      <th style={{ padding: 6 }}>Registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.candidates.map((c) => (
                      <tr key={c.ROWID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: 6 }}>
                          <Link to={`/candidates/${c.ROWID}`} className="link">{c.name || 'Sin nombre'}</Link>
                        </td>
                        <td style={{ padding: 6, color: '#6b7280' }}>{c.email}</td>
                        <td style={{ padding: 6, color: '#6b7280' }}>{c.phone ?? '—'}</td>
                        <td style={{ padding: 6, color: '#9ca3af', fontSize: 11 }}>
                          {new Date(c.created_at).toLocaleDateString('es-419')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
        Detección por teléfono (alta probabilidad), email duplicado (bug del sistema) y nombre normalizado (posible homonimia).
      </p>
    </div>
  );
}
