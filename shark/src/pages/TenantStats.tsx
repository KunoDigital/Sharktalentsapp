import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('TENANT_STATS');

type Stats = Awaited<ReturnType<ReturnType<typeof useApi>['tenant']['stats']>>;
type Sources = Awaited<ReturnType<ReturnType<typeof useApi>['tenant']['sources']>>;

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function Kpi({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#1f2937', lineHeight: 1.1 }}>
        {value == null ? '—' : value}
      </div>
      {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default function TenantStatsPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthsBack, setMonthsBack] = useState(6);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.tenant.stats(monthsBack),
      api.tenant.sources(monthsBack).catch(() => null),
    ]).then(([s, sr]) => {
      if (cancelled) return;
      setStats(s);
      setSources(sr);
    }).catch((err) => {
      log.warn('stats load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [monthsBack]);

  if (loading || !stats) return <div className="page"><p>Cargando…</p></div>;
  const s = stats.summary;

  // Para charts simples
  const maxMonthlyApplied = Math.max(...stats.monthly.map((m) => m.applied), 1);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stats del negocio</h1>
          <p className="page-subtitle">Últimos {monthsBack} meses · KPIs operativos</p>
        </div>
        <select
          value={monthsBack}
          onChange={(e) => setMonthsBack(Number(e.target.value))}
          className="filter-select"
        >
          <option value={3}>Últimos 3 meses</option>
          <option value={6}>Últimos 6 meses</option>
          <option value={12}>Últimos 12 meses</option>
          <option value={24}>Últimos 24 meses</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 24 }}>
        <Kpi label="Jobs creados" value={fmtNum(s.jobs_created)} hint={`${s.jobs_active} activos`} />
        <Kpi label="Aplicaciones" value={fmtNum(s.total_applied)} />
        <Kpi label="Llegaron a finalist" value={fmtNum(s.finalists)} hint={s.finalist_rate_pct != null ? `${s.finalist_rate_pct}% del total` : ''} />
        <Kpi label="Contratados" value={fmtNum(s.hired)} hint={s.conversion_rate_pct != null ? `${s.conversion_rate_pct}% conversión` : ''} />
        <Kpi label="Tiempo promedio cierre" value={s.avg_fill_days != null ? `${s.avg_fill_days} días` : '—'} />
        <Kpi label="Pool de candidatos" value={s.pool_size != null ? fmtNum(s.pool_size) : '—'} hint="histórico cross-jobs" />
        <Kpi label="Auto-rechazados" value={fmtNum(s.auto_rejected)} />
        <Kpi label="Rechazo manual" value={fmtNum(s.admin_rejected)} />
      </div>

      {/* Chart mensual simple */}
      <div style={{ marginTop: 32, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Tendencia mensual</h3>
        {stats.monthly.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Sin datos en este período.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Mes</th>
                  <th style={{ padding: 8 }}>Jobs nuevos</th>
                  <th style={{ padding: 8 }}>Aplicaron</th>
                  <th style={{ padding: 8 }}>Finalistas</th>
                  <th style={{ padding: 8 }}>Contratados</th>
                  <th style={{ padding: 8, width: '30%' }}>Volumen</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthly.map((m) => (
                  <tr key={m.month} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{m.month}</td>
                    <td style={{ padding: 8 }}>{m.jobs_created}</td>
                    <td style={{ padding: 8 }}>{m.applied}</td>
                    <td style={{ padding: 8, color: '#16a34a' }}>{m.finalists}</td>
                    <td style={{ padding: 8, color: '#15803d', fontWeight: 600 }}>{m.hired}</td>
                    <td style={{ padding: 8 }}>
                      <div style={{ background: '#dbeafe', height: 8, borderRadius: 4, position: 'relative' }}>
                        <div style={{
                          background: '#3b82f6',
                          width: `${(m.applied / maxMonthlyApplied) * 100}%`,
                          height: '100%',
                          borderRadius: 4,
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Comparativa por fuente */}
      {sources && sources.sources.length > 0 && (
        <div style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>📡 Comparativa por fuente</h3>
          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#6b7280' }}>
            De dónde vienen tus candidatos y cuán bien convierten. La fuente con mejor conversión es donde más rinde invertir.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Fuente</th>
                <th style={{ padding: 8 }}>Aplicaron</th>
                <th style={{ padding: 8 }}>Pasaron prescreening</th>
                <th style={{ padding: 8 }}>Completaron pruebas</th>
                <th style={{ padding: 8 }}>Finalistas</th>
                <th style={{ padding: 8 }}>Tasa finalista</th>
                <th style={{ padding: 8 }}>Contratados</th>
                <th style={{ padding: 8 }}>Conversión</th>
              </tr>
            </thead>
            <tbody>
              {sources.sources.map((s) => (
                <tr key={s.source} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{s.label}</td>
                  <td style={{ padding: 8 }}>{s.applied}</td>
                  <td style={{ padding: 8 }}>{s.passed_prescreening} <span style={{ color: '#9ca3af', fontSize: 11 }}>({s.applied > 0 ? Math.round((s.passed_prescreening / s.applied) * 100) : 0}%)</span></td>
                  <td style={{ padding: 8 }}>{s.completed_tests}</td>
                  <td style={{ padding: 8, color: '#16a34a' }}>{s.finalists}</td>
                  <td style={{ padding: 8, color: '#16a34a', fontWeight: 600 }}>{s.finalist_rate_pct != null ? `${s.finalist_rate_pct}%` : '—'}</td>
                  <td style={{ padding: 8, color: '#15803d', fontWeight: 600 }}>{s.hired}</td>
                  <td style={{ padding: 8, color: '#15803d', fontWeight: 700 }}>{s.conversion_rate_pct != null ? `${s.conversion_rate_pct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
        Datos basados en transiciones reales del pipeline. La tasa de cierre depende de tu volumen y de qué tan buenos sean los matches.
      </p>
    </div>
  );
}
