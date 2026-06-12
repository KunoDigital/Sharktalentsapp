import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('JOB_COSTS');

type CostsResponse = Awaited<ReturnType<ReturnType<typeof useApi>['jobs']['getCosts']>>;
type Summary = CostsResponse['summary'];

const TYPE_LABEL: Record<keyof Summary['by_type'], { label: string; icon: string }> = {
  anthropic: { label: 'IA (Anthropic)', icon: '🧠' },
  email: { label: 'Emails', icon: '✉️' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  storage: { label: 'Storage', icon: '💾' },
  ads: { label: 'Pauta LinkedIn', icon: '📣' },
};

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function JobCostsPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.jobs.getCosts(jobId)
      .then((res) => {
        if (cancelled) return;
        setSummary(res.summary);
      })
      .catch((err) => {
        if (cancelled) return;
        log.debug('cost summary failed', { error: (err as Error).message });
        setTableNotReady(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando costos…</div>;
  if (tableNotReady || !summary) {
    return (
      <div style={{ padding: 12, color: '#4b5563', fontSize: 13 }}>
        Cost tracking aún no disponible (tabla JobCosts pendiente de crear).
      </div>
    );
  }

  const noActivity = summary.total_events === 0;

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>💰 Gastos del puesto</h3>
        <div style={{ fontSize: 20, fontWeight: 700, color: noActivity ? '#6b7280' : '#1f2937' }}>
          {fmtUsd(summary.total_usd)}
        </div>
      </div>
      {noActivity ? (
        <p style={{ margin: 0, color: '#4b5563', fontSize: 13 }}>Sin actividad registrada todavía.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {(Object.keys(TYPE_LABEL) as Array<keyof Summary['by_type']>).map((type) => {
              const data = summary.by_type[type];
              return (
                <div key={type} style={{ padding: 10, background: 'var(--st-bg-elev-2)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--st-fg-muted)', marginBottom: 4 }}>
                    {TYPE_LABEL[type].icon} {TYPE_LABEL[type].label}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>{fmtUsd(data.total_usd)}</div>
                  <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>{data.count} {data.count === 1 ? 'evento' : 'eventos'}</div>
                </div>
              );
            })}
          </div>
          {summary.first_event_at && summary.last_event_at && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--st-fg-muted)' }}>
              Primer evento: {new Date(summary.first_event_at).toLocaleDateString('es-419')} ·
              Último: {new Date(summary.last_event_at).toLocaleDateString('es-419')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
