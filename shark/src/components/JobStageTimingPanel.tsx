import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { getStageLabel } from '../lib/stageLabels';
import { logger } from '../lib/logger';

const log = logger('STAGE_TIMING');

type Stats = Awaited<ReturnType<ReturnType<typeof useApi>['jobs']['getStageTiming']>>;

function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} días`;
}

export function JobStageTimingPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.jobs.getStageTiming(jobId).then((res) => {
      if (cancelled) return;
      setStats(res);
    }).catch((err) => {
      log.debug('timing load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando tiempos de pipeline…</div>;
  if (!stats || stats.stages.length === 0) {
    return (
      <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>⏱️ Tiempo en pipeline</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          Sin transiciones registradas todavía. Cuando los candidatos avancen verás cuánto promedian en cada etapa.
        </p>
      </div>
    );
  }

  const maxAvg = Math.max(...stats.stages.map((s) => s.avg_hours), 1);

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>⏱️ Tiempo en pipeline</h3>

      {stats.bottlenecks.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13, color: '#78350f' }}>
          ⚠️ <strong>Bottlenecks detectados:</strong> {stats.bottlenecks.map((b) => `${getStageLabel(b.stage).shortLabel} (${b.avg_days} días)`).join(', ')}.
          Los candidatos se quedan mucho tiempo en estas etapas.
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {stats.stages.map((s) => {
          const label = getStageLabel(s.stage);
          const widthPct = (s.avg_hours / maxAvg) * 100;
          const isBottleneck = stats.bottlenecks.some((b) => b.stage === s.stage);
          return (
            <li key={s.stage} style={{ padding: '8px 0', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: label.color }}>
                  {label.shortLabel}
                </span>
                <span style={{ fontSize: 13, color: 'var(--st-fg-muted)' }}>
                  {fmtDuration(s.avg_hours)} <span style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>(n={s.sample_size})</span>
                </span>
              </div>
              <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{ background: isBottleneck ? '#d97706' : label.color, width: `${widthPct}%`, height: '100%' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--st-fg-muted)', marginTop: 2 }}>
                Rango: {fmtDuration(s.min_hours)} – {fmtDuration(s.max_hours)}
              </div>
            </li>
          );
        })}
      </ul>

      <p style={{ margin: '12px 0 0 0', fontSize: 11, color: 'var(--st-fg-muted)' }}>
        Basado en {stats.total_transitions} transiciones de PipelineTransitions.
      </p>
    </div>
  );
}
