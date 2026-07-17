import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('PRESC_STATS');

type Stats = Awaited<ReturnType<ReturnType<typeof useApi>['jobs']['getPrescreeningStats']>>;

export function JobPrescreeningStatsPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.jobs.getPrescreeningStats(jobId).then((res) => {
      if (cancelled) return;
      setStats(res);
    }).catch((err) => {
      log.warn('stats failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando stats…</div>;
  if (!stats || stats.error) {
    return (
      <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📊 Stats prescreening</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          {stats?.error ?? 'Sin datos todavía.'}
        </p>
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📊 Stats prescreening</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          Sin candidatos evaluados aún. Cuando empiecen a aplicar verás aquí cuántos pasan y dónde se filtran.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📊 Stats prescreening</h3>
      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total}</div>
          <div style={{ fontSize: 12, color: 'var(--st-fg-muted)' }}>Total respondieron</div>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{stats.passed}</div>
          <div style={{ fontSize: 12, color: 'var(--st-fg-muted)' }}>Pasaron</div>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{stats.failed}</div>
          <div style={{ fontSize: 12, color: 'var(--st-fg-muted)' }}>Filtrados</div>
        </div>
        <div>
          <div style={{
            fontSize: 24, fontWeight: 700,
            color: (stats.pass_rate_pct ?? 0) < 20 ? '#d97706' : '#1f2937',
          }}>
            {stats.pass_rate_pct ?? 0}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--st-fg-muted)' }}>Tasa de pase</div>
        </div>
      </div>

      {stats.pass_rate_pct != null && stats.pass_rate_pct < 20 && stats.total >= 5 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13, color: '#78350f' }}>
          ⚠️ Solo el {stats.pass_rate_pct}% pasa. Probablemente estás filtrando demasiado — revisa las preguntas más restrictivas abajo.
        </div>
      )}

      {stats.by_question.length > 0 && (
        <>
          <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--st-fg-muted)' }}>Filtros por pregunta (de más a menos)</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {stats.by_question.map((q) => (
              <li key={q.question_id} style={{ padding: '8px 0', borderTop: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--st-fg)', flex: 1 }}>{q.question_text}</span>
                  <span style={{ fontSize: 12, color: '#dc2626', marginLeft: 8 }}>
                    {q.fails} filtrados ({q.pct_of_total}%)
                  </span>
                </div>
                {q.criterion && (
                  <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>Criterio: {q.criterion}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
