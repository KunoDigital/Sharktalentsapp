import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('FUNNEL_TIMELINE');

type Stats = Awaited<ReturnType<ReturnType<typeof useApi>['jobs']['getFunnelTimeline']>>;

function fmtWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-419', { day: '2-digit', month: 'short' });
}

export function JobFunnelTimelinePanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeksBack, setWeeksBack] = useState(12);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.jobs.getFunnelTimeline(jobId, weeksBack).then((res) => {
      if (cancelled) return;
      setStats(res);
    }).catch((err) => {
      log.debug('funnel timeline load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId, weeksBack]);

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando tendencia…</div>;
  if (!stats || stats.weeks.length === 0) {
    return (
      <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📈 Tendencia del embudo</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          Sin aplicaciones en los últimos {weeksBack} semanas.
        </p>
      </div>
    );
  }

  const maxApplied = Math.max(...stats.weeks.map((w) => w.applied), 1);
  const barWidth = 100 / stats.weeks.length;

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📈 Tendencia del embudo</h3>
        <select
          value={weeksBack}
          onChange={(e) => setWeeksBack(Number(e.target.value))}
          style={{ padding: '4px 8px', border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 13 }}
        >
          <option value={4}>4 semanas</option>
          <option value={12}>12 semanas</option>
          <option value={26}>26 semanas</option>
          <option value={52}>52 semanas</option>
        </select>
      </div>

      <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--st-fg-muted)' }}>
        {stats.total_applied} aplicaciones totales en {stats.weeks.length} semanas
      </p>

      {/* Chart simple */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, marginBottom: 8 }}>
        {stats.weeks.map((w) => {
          const heightPct = (w.applied / maxApplied) * 100;
          const finalistsHeight = w.applied > 0 ? (w.finalists / w.applied) * heightPct : 0;
          return (
            <div
              key={w.week_start}
              style={{ flex: `0 0 ${barWidth}%`, position: 'relative', height: '100%' }}
              title={`${fmtWeek(w.week_start)}: ${w.applied} aplicaron, ${w.passed_prescreening} pasaron prescreening, ${w.finalists} finalistas`}
            >
              <div style={{
                position: 'absolute', bottom: 0, left: 2, right: 2,
                background: '#dbeafe', height: `${heightPct}%`, borderRadius: '2px 2px 0 0',
              }} />
              {w.finalists > 0 && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 2, right: 2,
                  background: '#16a34a', height: `${finalistsHeight}%`, borderRadius: '2px 2px 0 0',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* X axis labels */}
      <div style={{ display: 'flex', gap: 2, fontSize: 10, color: 'var(--st-fg-muted)' }}>
        {stats.weeks.map((w, i) => (
          <div key={w.week_start} style={{ flex: `0 0 ${barWidth}%`, textAlign: 'center' }}>
            {i % 2 === 0 || stats.weeks.length <= 12 ? fmtWeek(w.week_start) : ''}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--st-fg-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dbeafe', verticalAlign: 'middle', marginRight: 4 }} />Aplicaron</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', verticalAlign: 'middle', marginRight: 4 }} />Llegaron a finalista</span>
      </div>
    </div>
  );
}
