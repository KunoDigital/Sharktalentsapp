import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('LIVE_ACTION_QUEUE');

type Queue = Awaited<ReturnType<ReturnType<typeof useApi>['dashboard']['queue']>>;

const TYPE_META: Record<Queue['queue'][number]['type'], { icon: string; title: string; priority: 'warn' | 'critical' | 'good' | 'info' }> = {
  critical_alert: { icon: '🚨', title: 'Alertas críticas', priority: 'critical' },
  draft_pending: { icon: '📋', title: 'Drafts pendientes', priority: 'warn' },
  bot_review: { icon: '🤖', title: 'Bot necesita tu decisión', priority: 'warn' },
  finalists_ready_to_send: { icon: '🎯', title: 'Finalistas listos para enviar al cliente', priority: 'good' },
  candidate_stuck: { icon: '⏸', title: 'Candidatos sin avance > 5 días', priority: 'info' },
  good_news: { icon: '🎉', title: 'Novedades', priority: 'good' },
};

const PRIORITY_ORDER: Record<string, number> = { critical: 0, warn: 1, good: 2, info: 3 };

const PRIORITY_BG: Record<string, string> = {
  critical: '#fee2e2',
  warn: '#fef3c7',
  good: '#dcfce7',
  info: '#dbeafe',
};

const PRIORITY_BORDER: Record<string, string> = {
  critical: '#dc2626',
  warn: '#d97706',
  good: '#16a34a',
  info: '#0284c7',
};

export function LiveActionQueue() {
  const api = useApi();
  const [data, setData] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.dashboard.queue().then((res) => {
        if (cancelled) return;
        setData(res);
      }).catch((err) => {
        log.debug('queue load failed', { error: (err as Error).message });
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    load();
    const id = setInterval(load, 60_000); // refresh cada 60s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loading || !data) return null;
  if (data.total === 0) {
    return (
      <section style={{ background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: 8, padding: 16, margin: '16px 0' }}>
        <h2 style={{ margin: 0, fontSize: 16, color: '#15803d' }}>✓ Sin pendientes</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#166534' }}>
          No hay acciones críticas. Buen momento para tomarte un té.
        </p>
      </section>
    );
  }

  // Ordenar por prioridad
  const sortedQueue = [...data.queue].sort((a, b) => {
    const pa = PRIORITY_ORDER[TYPE_META[a.type].priority] ?? 99;
    const pb = PRIORITY_ORDER[TYPE_META[b.type].priority] ?? 99;
    return pa - pb;
  });

  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600 }}>
        Tu cola hoy
        <span style={{ marginLeft: 8, background: '#0e1218', color: '#dafd6f', padding: '1px 10px', borderRadius: 99, fontSize: 13 }}>
          {data.total}
        </span>
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sortedQueue.map((item) => {
          const meta = TYPE_META[item.type];
          return (
            <div
              key={item.type}
              style={{
                background: PRIORITY_BG[meta.priority],
                border: `1px solid ${PRIORITY_BORDER[meta.priority]}`,
                borderLeft: `4px solid ${PRIORITY_BORDER[meta.priority]}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                    {meta.icon} {meta.title}
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#374151' }}>
                    {item.count} {item.count === 1 ? 'item' : 'items'}
                  </p>
                </div>
                {item.items?.[0] && (
                  <Link
                    to={item.items[0].link}
                    style={{
                      background: '#0e1218', color: '#fff', padding: '6px 14px',
                      borderRadius: 4, fontSize: 13, textDecoration: 'none',
                    }}
                  >
                    Ir →
                  </Link>
                )}
              </div>
              {item.items && item.items.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0 0' }}>
                  {item.items.slice(0, 3).map((it) => (
                    <li key={it.id} style={{ padding: '4px 0', fontSize: 12, color: '#4b5563' }}>
                      <Link to={it.link} style={{ color: '#0284c7', textDecoration: 'none' }}>
                        {it.label}
                      </Link>
                      {it.hint && <span style={{ color: '#9ca3af', marginLeft: 6 }}>· {it.hint}</span>}
                    </li>
                  ))}
                  {item.items.length > 3 && (
                    <li style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      ... y {item.count - 3} más
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
