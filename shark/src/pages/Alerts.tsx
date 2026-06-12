import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { TableNotReadyBanner } from '../components/TableNotReadyBanner';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('ALERTS_PAGE');

type AlertStatus = 'open' | 'acknowledged' | 'resolved';
type AlertSeverity = 'critical' | 'warning' | 'info';

type Alert = {
  ROWID: string;
  severity: AlertSeverity;
  code: string;
  message: string;
  context: string | null;
  resource_type: string | null;
  resource_id: string | null;
  status: AlertStatus;
  occurrence_count: number;
  created_at: string;
  last_occurred_at: string;
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: '🚨 Crítica',
  warning: '⚠️ Warning',
  info: 'ℹ️ Info',
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#0284c7',
};

export default function AlertsPage() {
  const api = useApi();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openCritical, setOpenCritical] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AlertStatus>('open');
  const [acting, setActing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.alerts.list(statusFilter, 100);
      if (res.error === 'alerts_table_not_ready') {
        setTableNotReady(true);
        setAlerts([]);
      } else {
        setAlerts(res.alerts);
        setCounts(res.counts_by_status);
        setOpenCritical(res.open_critical);
        setTableNotReady(false);
      }
    } catch (err) {
      log.warn('alerts load failed', { error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function handleAcknowledge(id: string) {
    setActing(id);
    try {
      await api.alerts.acknowledge(id);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setActing(null);
    }
  }

  async function handleResolve(id: string) {
    setActing(id);
    try {
      await api.alerts.resolve(id);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setActing(null);
    }
  }

  if (tableNotReady) {
    return (
      <div className="page">
        <h1 className="page-title">Alertas</h1>
        <TableNotReadyBanner tableName="SystemAlerts" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Alertas
            {openCritical > 0 && (
              <span style={{ marginLeft: 12, padding: '2px 10px', borderRadius: 99, background: '#dc2626', color: '#fff', fontSize: 13 }}>
                {openCritical} críticas abiertas
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            Notificaciones automáticas del sistema. Las críticas te llegaron también por email.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['open', 'acknowledged', 'resolved'] as AlertStatus[]).map((s) => (
            <button
              key={s}
              className={`btn-toolbar ${statusFilter === s ? 'btn-toolbar-active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'open' ? 'Abiertas' : s === 'acknowledged' ? 'Vistas' : 'Resueltas'}
              {counts[s] != null && counts[s] > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>({counts[s]})</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p>Cargando…</p>
      ) : alerts.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          {statusFilter === 'open' ? '✓ No hay alertas abiertas. Todo en orden.' : 'No hay alertas en este estado.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {alerts.map((a) => (
            <AlertCard
              key={a.ROWID}
              alert={a}
              acting={acting === a.ROWID}
              onAcknowledge={() => handleAcknowledge(a.ROWID)}
              onResolve={() => handleResolve(a.ROWID)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  acting,
  onAcknowledge,
  onResolve,
}: {
  alert: Alert;
  acting: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLOR[alert.severity];
  const isOpen = alert.status === 'open';
  const isAcknowledged = alert.status === 'acknowledged';

  return (
    <div style={{ border: `1px solid ${color}`, borderLeft: `4px solid ${color}`, borderRadius: 6, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color, fontWeight: 600, fontSize: 13 }}>{SEVERITY_LABEL[alert.severity]}</span>
            <code style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{alert.code}</code>
            {alert.occurrence_count > 1 && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>×{alert.occurrence_count} ocurrencias</span>
            )}
          </div>
          <p style={{ margin: 0, color: '#1f2937' }}>{alert.message}</p>
          <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#6b7280' }}>
            Primera vez: {new Date(alert.created_at).toLocaleString('es-419')} · Última:{' '}
            {new Date(alert.last_occurred_at).toLocaleString('es-419')}
          </p>
          {alert.resource_type && alert.resource_id && (
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6b7280' }}>
              Recurso: {alert.resource_type}:{alert.resource_id}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isOpen && (
            <button className="btn-toolbar" disabled={acting} onClick={onAcknowledge}>
              Marcar visto
            </button>
          )}
          {(isOpen || isAcknowledged) && (
            <button className="btn-toolbar" disabled={acting} onClick={onResolve}>
              Resolver
            </button>
          )}
        </div>
      </div>
      {alert.context && (
        <div style={{ marginTop: 12 }}>
          <button
            style={{ background: 'transparent', border: 0, color: '#0284c7', cursor: 'pointer', fontSize: 12, padding: 0 }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▼ Ocultar contexto' : '▶ Ver contexto técnico'}
          </button>
          {expanded && (
            <pre style={{ background: '#f9fafb', padding: 12, marginTop: 8, fontSize: 12, overflowX: 'auto', borderRadius: 4 }}>
              {alert.context}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
