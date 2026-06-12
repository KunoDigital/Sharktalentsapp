import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('HEALTH_PAGE');

type HealthData = Awaited<ReturnType<ReturnType<typeof useApi>['health']['check']>>;

const STATUS_COLOR: Record<HealthData['status'], string> = {
  ok: '#16a34a',
  degraded: '#d97706',
  critical: '#dc2626',
};

const STATUS_LABEL: Record<HealthData['status'], string> = {
  ok: '✓ Todo en orden',
  degraded: '⚠️ Servicio degradado',
  critical: '🚨 Crítico',
};

const BREAKER_LABEL: Record<string, string> = {
  anthropic: 'IA (Anthropic)',
  zeptomail: 'Email (ZeptoMail)',
  zoho_recruit: 'Zoho Recruit',
  zoho_bookings: 'Zoho Bookings',
  zoho_crm: 'Zoho CRM',
  zoho_sign: 'Zoho Sign',
  whatsapp: 'WhatsApp (Meta)',
  twilio_whatsapp: 'WhatsApp (Twilio)',
  whisper: 'Whisper (transcripción)',
  heyreach: 'HeyReach (LinkedIn)',
};

const ENV_LABEL: Record<string, { label: string; importance: 'critical' | 'recommended' | 'optional' }> = {
  zeptomail: { label: 'ZeptoMail (emails)', importance: 'critical' },
  anthropic: { label: 'Anthropic (IA)', importance: 'critical' },
  twilio_whatsapp: { label: 'Twilio WhatsApp', importance: 'recommended' },
  meta_whatsapp: { label: 'Meta WhatsApp', importance: 'optional' },
  zoho_recruit_oauth: { label: 'Zoho Recruit OAuth', importance: 'recommended' },
  recruiter_notify_email: { label: 'Email de notificaciones', importance: 'optional' },
};

function fmtSince(opened_at: number | null): string {
  if (!opened_at) return '';
  const min = Math.round((Date.now() - opened_at) / 60000);
  return `abierto hace ${min} min`;
}

export default function HealthPage() {
  const api = useApi();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; status?: number } | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  async function refresh() {
    try {
      const res = await api.health.check();
      setData(res);
      setLastRefresh(Date.now());
      setLoadError(null);
    } catch (err) {
      const e = err as { message?: string; status?: number };
      log.warn('health check failed', { error: e.message, status: e.status });
      setLoadError({ message: e.message ?? 'Error desconocido', status: e.status });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading && !data) {
    return (
      <div className="page">
        <h1 className="page-title">Health</h1>
        <p>Cargando estado del sistema…</p>
      </div>
    );
  }

  if (!data && loadError) {
    return (
      <div className="page">
        <h1 className="page-title">Health</h1>
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 16, borderRadius: 8, marginTop: 16 }}>
          <strong>No pude cargar el estado del sistema.</strong>
          <p style={{ margin: '8px 0 0 0', fontSize: 14 }}>
            {loadError.status ? `Código HTTP ${loadError.status}. ` : ''}
            {loadError.message}
          </p>
          <p style={{ margin: '12px 0 0 0', fontSize: 13, color: '#7f1d1d' }}>
            Posibles causas:
          </p>
          <ul style={{ margin: '4px 0 0 0', fontSize: 13, color: '#7f1d1d' }}>
            <li>El backend no se redeployó después del último cambio.</li>
            <li>La tabla <code>SystemAlerts</code> no existe aún en este ambiente.</li>
            <li>Problema temporal de Catalyst — probá refrescar en 30s.</li>
          </ul>
          <button className="btn-toolbar" style={{ marginTop: 12 }} onClick={refresh}>↻ Reintentar</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <h1 className="page-title">Health</h1>
        <p>Cargando estado del sistema…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Health{' '}
            <span style={{ color: STATUS_COLOR[data.status], fontSize: 14, marginLeft: 12 }}>
              {STATUS_LABEL[data.status]}
            </span>
          </h1>
          <p className="page-subtitle">
            Última verificación: {new Date(lastRefresh).toLocaleTimeString('es-419')} · Auto-refresh 30s
          </p>
        </div>
        <button className="btn-toolbar" onClick={refresh}>↻ Refrescar</button>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', marginTop: 24 }}>
        {/* Servicios externos (circuit breakers) */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Servicios externos</h3>
          {data.breakers.length === 0 ? (
            <p style={{ color: '#4b5563', fontSize: 13 }}>Ningún servicio se llamó todavía en esta instancia.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.breakers.map((b) => (
                <li key={b.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 14, color: '#1f2937' }}>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                      background: b.state === 'closed' ? '#16a34a' : b.state === 'open' ? '#dc2626' : '#d97706',
                      marginRight: 8,
                    }} />
                    {BREAKER_LABEL[b.name] ?? b.name}
                  </span>
                  <span style={{ fontSize: 12, color: '#4b5563' }}>
                    {b.state === 'open' ? fmtSince(b.opened_at) : `${b.total_calls} llamadas, ${b.total_failures} fallos`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Outbox */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Cola de eventos (outbox)</h3>
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: data.outbox.pending > 100 ? '#d97706' : '#1f2937' }}>
                {data.outbox.pending}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Pendientes</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: data.outbox.failed > 0 ? '#dc2626' : '#1f2937' }}>
                {data.outbox.failed}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Fallidos</div>
            </div>
            {data.outbox.oldest_pending_min != null && (
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: data.outbox.oldest_pending_min > 30 ? '#d97706' : '#1f2937' }}>
                  {data.outbox.oldest_pending_min} min
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Más viejo pending</div>
              </div>
            )}
          </div>
          {data.outbox.oldest_pending_min != null && data.outbox.oldest_pending_min > 30 && (
            <p style={{ marginTop: 12, fontSize: 13, color: '#d97706' }}>
              ⚠️ El cron del outbox podría no estar corriendo. Revisá la configuración en Catalyst Console.
            </p>
          )}
        </div>

        {/* Alertas */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Alertas críticas</h3>
          <div style={{ fontSize: 32, fontWeight: 700, color: data.alerts.open_critical > 0 ? '#dc2626' : '#16a34a' }}>
            {data.alerts.open_critical}
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: 13, color: '#6b7280' }}>
            {data.alerts.open_critical === 0 ? 'Ninguna alerta crítica abierta' : 'Mirá la página de Alertas para detalles'}
          </p>
        </div>

        {/* Errores 500 última hora */}
        {data.recent_5xx && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Errores 500 (última hora)</h3>
            <div style={{ fontSize: 32, fontWeight: 700, color: data.recent_5xx.count_last_hour > 0 ? '#dc2626' : '#16a34a' }}>
              {data.recent_5xx.count_last_hour}
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 13, color: '#6b7280' }}>
              {data.recent_5xx.count_last_hour === 0
                ? 'Sin errores 500 en la última hora'
                : `${data.recent_5xx.endpoints.length} ${data.recent_5xx.endpoints.length === 1 ? 'endpoint afectado' : 'endpoints afectados'}`}
            </p>
            {data.recent_5xx.endpoints.length > 0 && (
              <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none', fontSize: 12, color: '#7f1d1d' }}>
                {data.recent_5xx.endpoints.slice(0, 5).map((ep) => (
                  <li key={ep} style={{ padding: '3px 0', fontFamily: 'monospace' }}>{ep}</li>
                ))}
                {data.recent_5xx.endpoints.length > 5 && (
                  <li style={{ padding: '3px 0', color: '#6b7280' }}>… y {data.recent_5xx.endpoints.length - 5} más</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Configuración */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Configuración (env vars)</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {Object.entries(ENV_LABEL).map(([key, meta]) => {
              const ok = data.env_configured[key];
              return (
                <li key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 14, color: '#1f2937' }}>
                    <span style={{ marginRight: 8 }}>{ok ? '✓' : (meta.importance === 'critical' ? '✗' : '○')}</span>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>
                    {meta.importance}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
