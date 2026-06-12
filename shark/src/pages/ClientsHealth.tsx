import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('CLIENTS_HEALTH_PAGE');

type Health = Awaited<ReturnType<ReturnType<typeof useApi>['clients']['health']>>;

const STATUS_META: Record<Health['clients'][number]['status'], { label: string; color: string; bg: string }> = {
  needs_attention: { label: '⚠️ Necesita atención', color: '#d97706', bg: '#fef3c7' },
  healthy: { label: '✓ Saludable', color: '#16a34a', bg: '#dcfce7' },
  stale: { label: '○ Sin actividad', color: '#6b7280', bg: '#f3f4f6' },
};

export default function ClientsHealthPage() {
  const api = useApi();
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | Health['clients'][number]['status']>('all');

  useEffect(() => {
    let cancelled = false;
    api.clients.health().then((res) => {
      if (cancelled) return;
      setData(res);
    }).catch((err) => {
      log.warn('clients health failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading || !data) return <div className="page"><p>Cargando…</p></div>;

  // Defensive: si el backend devolvió sin `counts` (early return en fallback de tabla
  // missing), no rompemos la página — usamos 0s y mostramos vacío.
  const counts = data.counts ?? { healthy: 0, needs_attention: 0, stale: 0 };
  const filtered = statusFilter === 'all' ? data.clients : data.clients.filter((c) => c.status === statusFilter);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Salud de clientes</h1>
          <p className="page-subtitle">{data.total_clients} clientes · ordenados por urgencia</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn-toolbar ${statusFilter === 'all' ? 'btn-toolbar-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Todos ({data.total_clients})
          </button>
          <button
            className={`btn-toolbar ${statusFilter === 'needs_attention' ? 'btn-toolbar-active' : ''}`}
            onClick={() => setStatusFilter('needs_attention')}
            style={{ color: counts.needs_attention > 0 ? '#d97706' : undefined }}
          >
            ⚠️ Atención ({counts.needs_attention})
          </button>
          <button
            className={`btn-toolbar ${statusFilter === 'healthy' ? 'btn-toolbar-active' : ''}`}
            onClick={() => setStatusFilter('healthy')}
          >
            ✓ OK ({counts.healthy})
          </button>
          <button
            className={`btn-toolbar ${statusFilter === 'stale' ? 'btn-toolbar-active' : ''}`}
            onClick={() => setStatusFilter('stale')}
          >
            ○ Stale ({counts.stale})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Sin clientes en este filtro.
        </div>
      ) : (
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Jobs</th>
              <th>Candidatos</th>
              <th>Finalists pendientes</th>
              <th>Drafts pendientes</th>
              <th>Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <tr key={c.client_email}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.client_company}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{c.client_name} · {c.client_email}</div>
                  </td>
                  <td>
                    <span style={{
                      padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                      background: meta.bg, color: meta.color,
                    }}>
                      {meta.label}
                    </span>
                  </td>
                  <td>{c.jobs_active} activos / {c.jobs_total} total</td>
                  <td>{c.candidates_total}</td>
                  <td style={{ color: c.finalists_awaiting_decision > 0 ? '#d97706' : undefined, fontWeight: c.finalists_awaiting_decision > 0 ? 600 : undefined }}>
                    {c.finalists_awaiting_decision}
                  </td>
                  <td style={{ color: c.drafts_pending_approval > 0 ? '#d97706' : undefined, fontWeight: c.drafts_pending_approval > 0 ? 600 : undefined }}>
                    {c.drafts_pending_approval}
                  </td>
                  <td className="muted">
                    {c.days_since_last_activity == null ? 'nunca'
                      : c.days_since_last_activity === 0 ? 'hoy'
                        : c.days_since_last_activity === 1 ? 'ayer'
                          : `hace ${c.days_since_last_activity} días`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
