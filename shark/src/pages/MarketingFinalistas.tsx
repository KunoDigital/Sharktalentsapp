import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../config';

type SourceBucket = 'demo' | 'finalista' | 'meta_ads' | 'linkedin' | 'manual' | 'otros';

type Finalista = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  client_id: string | null;
  client_company: string;
  client_email: string;
  source_bucket: SourceBucket;
  pipeline_stage: string;
  test1_status: 'pending' | 'complete';
  test2_status: 'pending' | 'complete';
  reporte: boolean;
  started_at: string | null;
  completed_at: string | null;
  dias_espera: number;
};

type Stats = {
  total: number;
  sin_arrancar: number;
  en_proceso: number;
  reporte_listo: number;
};

const SOURCE_LABELS: Record<SourceBucket, { label: string; bg: string; fg: string }> = {
  demo: { label: 'Demo', bg: '#eff6ff', fg: '#2563eb' },
  finalista: { label: 'Finalista', bg: '#f5f3ff', fg: '#7c3aed' },
  meta_ads: { label: 'Meta Ads', bg: '#fdf2f8', fg: '#db2777' },
  linkedin: { label: 'LinkedIn', bg: '#ecfdf5', fg: '#059669' },
  manual: { label: 'Manual', bg: '#f3f4f6', fg: '#6b7280' },
  otros: { label: 'Otros', bg: '#f3f4f6', fg: '#9ca3af' },
};

export default function MarketingFinalistas() {
  const { getToken } = useAuth();
  const [finalistas, setFinalistas] = useState<Finalista[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const url = `${config.apiBase}/api/marketing/finalistas${params.toString() ? '?' + params.toString() : ''}`;
      const token = await getToken();
      const res = await fetch(url, { headers: { 'X-Clerk-Token': token ?? '' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { finalistas: Finalista[]; stats: Stats };
      setFinalistas(data.finalistas ?? []);
      setStats(data.stats ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getToken, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Marketing → Finalistas</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Personas que están haciendo las pruebas conductual + integridad. Se conectan con el cliente que los mandó.
          </p>
        </div>
        <button
          onClick={() => void load()}
          style={{ background: '#fff', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#111827' }}
        >
          ↻ Refrescar
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
          <StatCard label="Total finalistas" value={stats.total} />
          <StatCard label="Sin arrancar" value={stats.sin_arrancar} color="#d97706" />
          <StatCard label="En proceso" value={stats.en_proceso} color="#2563eb" />
          <StatCard label="Reporte listo" value={stats.reporte_listo} color="#059669" />
        </div>
      )}

      {/* Filtros */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Estado</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          >
            <option value="all">Todos</option>
            <option value="pending">Sin arrancar</option>
            <option value="in_progress">En proceso</option>
            <option value="complete">Tests completos (analizando)</option>
            <option value="report_sent">Reporte enviado</option>
          </select>
        </label>
        <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
          Mostrando <strong style={{ color: '#111827' }}>{finalistas.length}</strong> finalistas
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : finalistas.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#9ca3af' }}>
          Sin finalistas que matcheen los filtros.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f7f8fa', borderBottom: '1px solid #e5e7eb' }}>
                <Th>Finalista</Th>
                <Th>Cliente que lo mandó</Th>
                <Th>Origen</Th>
                <Th>Conductual</Th>
                <Th>Integridad</Th>
                <Th>Reporte</Th>
                <Th>Días</Th>
              </tr>
            </thead>
            <tbody>
              {finalistas.map((f) => {
                const src = SOURCE_LABELS[f.source_bucket];
                return (
                  <tr key={f.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{f.candidate_name}</div>
                      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>{f.candidate_email}</div>
                    </Td>
                    <Td>
                      <div>{f.client_company}</div>
                      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>{f.client_email}</div>
                    </Td>
                    <Td>
                      <span style={{ background: src.bg, color: src.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>
                        {src.label}
                      </span>
                    </Td>
                    <Td><StatusPill status={f.test1_status} /></Td>
                    <Td><StatusPill status={f.test2_status} /></Td>
                    <Td>
                      {f.reporte ? (
                        <span style={{ background: '#ecfdf5', color: '#059669', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✓ Enviado</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </Td>
                    <Td>{f.dias_espera}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color = '#111827' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af', fontWeight: 700 }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '12px 14px', fontSize: 13, color: '#111827' }}>{children}</td>;
}

function StatusPill({ status }: { status: 'pending' | 'complete' }) {
  if (status === 'complete') {
    return <span style={{ background: '#ecfdf5', color: '#059669', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✓ Completo</span>;
  }
  return <span style={{ background: '#fef3c7', color: '#d97706', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Pendiente</span>;
}
