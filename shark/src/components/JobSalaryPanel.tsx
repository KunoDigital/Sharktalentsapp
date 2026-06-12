import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('SALARY_PANEL');

type Stats = Awaited<ReturnType<ReturnType<typeof useApi>['jobs']['getSalaryDistribution']>>;

function fmtUsd(n?: number): string {
  if (n == null) return '—';
  return `USD ${n.toLocaleString('en-US')}`;
}

export function JobSalaryPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.jobs.getSalaryDistribution(jobId).then((res) => {
      if (cancelled) return;
      setStats(res);
    }).catch((err) => {
      log.debug('salary load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando expectativas salariales…</div>;
  if (!stats || stats.count === 0) {
    return (
      <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>💵 Expectativas salariales</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          {stats?.message ?? 'Sin datos todavía.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>💵 Expectativas salariales</h3>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>Mediana</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUsd(stats.median)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>Promedio</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>{fmtUsd(stats.avg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>Rango</div>
          <div style={{ fontSize: 14, color: 'var(--st-fg-muted)' }}>{fmtUsd(stats.min)} – {fmtUsd(stats.max)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>Muestra</div>
          <div style={{ fontSize: 14, color: 'var(--st-fg-muted)' }}>{stats.count} candidatos</div>
        </div>
      </div>

      {stats.vs_job_range && (
        <>
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--st-fg-muted)', marginBottom: 6 }}>
              Rango ofrecido: {fmtUsd(stats.vs_job_range.job_min)} – {fmtUsd(stats.vs_job_range.job_max)}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{stats.vs_job_range.pct_within_range}%</span>
                <span style={{ fontSize: 12, color: 'var(--st-fg-muted)', marginLeft: 4 }}>en rango</span>
              </div>
              <div>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>{stats.vs_job_range.pct_above_max}%</span>
                <span style={{ fontSize: 12, color: 'var(--st-fg-muted)', marginLeft: 4 }}>arriba del max</span>
              </div>
            </div>
          </div>
          {stats.vs_job_range.warning && (
            <div style={{ marginTop: 12, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: 10, fontSize: 13, color: '#78350f' }}>
              ⚠️ {stats.vs_job_range.warning}
            </div>
          )}
        </>
      )}
    </div>
  );
}
