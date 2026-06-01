import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { MOCK_REPORTS } from '../data/mockReports';
import { getJobById } from '../data/mockJobs';
import { useApi, ApiError, type ReportSummary } from '../lib/api';
import { config } from '../config';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('REPORTES');

type SortKey = 'recent' | 'finalists' | 'opens';
type FilterKey = 'all' | 'with_finalists' | 'cached' | 'opened';

export default function Reportes() {
  const api = useApi();
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [filterBy, setFilterBy] = useState<FilterKey>('all');

  useEffect(() => {
    let cancelled = false;
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.reports.list()
      .then((res) => {
        if (cancelled) return;
        setItems(res.reports);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('list reports failed', { error: (err as Error).message });
        if (err instanceof ApiError) {
          setError(`${err.code}: ${err.message}`);
        } else {
          setError((err as Error).message);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadTick]);

  if (loading) return <div><h1 className="page-title">Reportes</h1><p className="muted">Cargando…</p></div>;

  if (!config.useApi) {
    return <ReportesMock />;
  }

  if (error) {
    return (
      <div>
        <h1 className="page-title">Reportes</h1>
        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
        <ReportesMock />
      </div>
    );
  }

  const allReports = items ?? [];

  // Stats agregados
  const stats = {
    total: allReports.length,
    with_finalists: allReports.filter((r) => r.finalists_count > 0).length,
    cached: allReports.filter((r) => r.cache_status === 'cached').length,
    total_opens: allReports.reduce((s, r) => s + (r.opened_count ?? 0), 0),
  };

  // Filter
  let reports = allReports.filter((r) => {
    if (filterBy === 'with_finalists') return r.finalists_count > 0;
    if (filterBy === 'cached') return r.cache_status === 'cached';
    if (filterBy === 'opened') return (r.opened_count ?? 0) > 0;
    return true;
  });

  // Sort
  reports = [...reports].sort((a, b) => {
    if (sortBy === 'finalists') return b.finalists_count - a.finalists_count;
    if (sortBy === 'opens') return (b.opened_count ?? 0) - (a.opened_count ?? 0);
    // recent: by last_opened_at if exists, else by job_id (latest first heuristic)
    const aTime = a.last_opened_at ? new Date(a.last_opened_at).getTime() : 0;
    const bTime = b.last_opened_at ? new Date(b.last_opened_at).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Reportes</h1>
          <p className="page-subtitle">
            Puestos con finalistas listos. Click "Ver comparativo" para abrir la vista que comparte al cliente.
          </p>
        </div>
        <button type="button" className="btn-toolbar" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
          {loading ? '⟳…' : '⟳ Refrescar'}
        </button>
      </div>

      {allReports.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Con finalistas" value={stats.with_finalists} highlight />
          <StatCard label="Cacheados" value={stats.cached} />
          <StatCard label="Aperturas totales" value={stats.total_opens} />
        </div>
      )}

      {allReports.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <label>
            Filtrar:&nbsp;
            <select value={filterBy} onChange={(e) => setFilterBy(e.target.value as FilterKey)}>
              <option value="all">Todos</option>
              <option value="with_finalists">Con finalistas</option>
              <option value="cached">Cacheados</option>
              <option value="opened">Abiertos por cliente</option>
            </select>
          </label>
          <label>
            Ordenar:&nbsp;
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              <option value="recent">Más recientes (última apertura)</option>
              <option value="finalists">Más finalistas</option>
              <option value="opens">Más aperturas</option>
            </select>
          </label>
        </div>
      )}

      {reports.length === 0 ? (
        <div className="stub-card">
          <p>{allReports.length === 0
            ? 'Aún no hay puestos con finalistas. Cuando un candidato pase a stage finalist, aparece acá.'
            : 'Sin reportes que matcheen el filtro.'}
          </p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Cliente</th>
              <th>Finalistas</th>
              <th>Total apps</th>
              <th>Cache</th>
              <th>Aperturas</th>
              <th>Última apertura</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.job_id}>
                <td>
                  <Link to={`/jobs/${r.job_id}`} className="link">{r.job_title}</Link>
                </td>
                <td className="muted">{r.job_company}</td>
                <td><strong>{r.finalists_count}</strong></td>
                <td className="muted">{r.total_applications}</td>
                <td>
                  {r.cache_status === 'cached' ? (
                    <span className="status-tag status-active">Cached</span>
                  ) : r.cache_status === 'missing' ? (
                    <span className="muted small">Sin cache</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{r.opened_count > 0 ? r.opened_count : <span className="muted">0</span>}</td>
                <td className="muted small">
                  {r.last_opened_at ? new Date(r.last_opened_at).toLocaleDateString() : '—'}
                </td>
                <td>
                  <Link to={`/jobs/${r.job_id}/comparar`} className="link">
                    Ver comparativo →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted-note">
        💡 El reporte se genera al vuelo desde <code>/report/bundle/&lt;token&gt;</code> con narrativas IA. Cuando exista <code>ClientReports</code>, se cachea 7 días + tracking de aperturas.
      </p>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '0.6rem 0.8rem',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '1.4rem',
        fontWeight: 700,
        color: highlight ? 'var(--st-ok, #22c55e)' : 'var(--st-fg)',
        lineHeight: 1.1,
        marginBottom: '0.15rem',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--st-fg-muted)' }}>
        {label}
      </div>
    </div>
  );
}

function ReportesMock() {
  const reports = Object.values(MOCK_REPORTS);
  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <div style={{ padding: '0.75rem 1rem', background: 'rgba(99, 102, 241, 0.08)', border: '1px dashed rgba(99, 102, 241, 0.4)', borderRadius: '6px', marginBottom: '1rem', color: '#a5b4fc', fontSize: '0.85rem' }}>
        📺 Modo demo — datos ficticios. Activá VITE_USE_API y deployá backend para ver tus reportes reales.
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Puesto</th>
            <th>Cliente</th>
            <th>Finalistas</th>
            <th>Publicado</th>
            <th>Cliente abrió</th>
            <th>Feedback</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((rpt) => {
            const job = getJobById(rpt.job_id);
            const fb = rpt.client_feedback ?? [];
            const interview = fb.filter((f) => f.decision === 'interview').length;
            const maybe = fb.filter((f) => f.decision === 'maybe').length;
            const pass = fb.filter((f) => f.decision === 'pass').length;
            return (
              <tr key={rpt.token}>
                <td>{job?.title ?? '—'}</td>
                <td className="muted">{job?.client_company ?? '—'}</td>
                <td>{rpt.candidate_app_ids.length}</td>
                <td className="muted">{rpt.published_at}</td>
                <td>
                  {rpt.client_opened_at ? (
                    <span className="status-tag status-active">{new Date(rpt.client_opened_at).toLocaleDateString()}</span>
                  ) : (
                    <span className="muted">No abierto</span>
                  )}
                </td>
                <td>
                  {fb.length === 0 ? (
                    <span className="muted">Sin feedback</span>
                  ) : (
                    <span>
                      {interview > 0 && <span className="report-fb-tag is-interview">{interview} entrevistar</span>}
                      {maybe > 0 && <span className="report-fb-tag is-maybe">{maybe} tal vez</span>}
                      {pass > 0 && <span className="report-fb-tag is-pass">{pass} pasar</span>}
                    </span>
                  )}
                </td>
                <td>
                  <Link to={`/report/${rpt.token}`} className="link" target="_blank">Ver reporte ↗</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
