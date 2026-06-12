import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('EXPENSES_PAGE');

type ServiceBreakdown = { service: string; total_usd: number; events_count: number };
type JobBreakdown = {
  job_id: string;
  title: string;
  company: string;
  fee_usd: number | null;
  total_usd: number;
  ratio_pct: number | null;
  by_service: Record<string, number>;
};
type ClientBreakdown = {
  company: string;
  total_usd: number;
  jobs_count: number;
  by_service: Record<string, number>;
};
type ExpensesData = {
  month: string;
  range: { from_iso: string; to_iso: string };
  total_usd: number;
  total_fee_usd: number;
  ratio_overall_pct: number | null;
  by_service: ServiceBreakdown[];
  by_job: JobBreakdown[];
  by_client: ClientBreakdown[];
  warnings: string[];
};

const SERVICE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic IA',
  email: 'Email',
  whatsapp: 'WhatsApp',
  storage: 'Storage',
  ads: 'Ads (manual)',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 10 ? 4 : 2)}`;
}

function formatRatio(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct.toFixed(1)}%`;
}

function ratioColor(pct: number | null): string {
  if (pct == null) return '#6b7280';
  if (pct >= 20) return '#b45309';
  if (pct >= 15) return '#a16207';
  return '#047857';
}

function buildMonthOptions(): string[] {
  // Últimos 12 meses + el actual.
  const options: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    options.push(`${y}-${String(m).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return options;
}

export default function Expenses() {
  const api = useApi();
  const [month, setMonth] = useState<string>(currentMonth());
  const [data, setData] = useState<ExpensesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'by_service' | 'by_job' | 'by_client'>('by_service');

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.operations.expenses(month)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = (err as Error).message ?? 'Error';
          log.warn('expenses load failed', { error: msg });
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, month]);

  return (
    <div className="page-root">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Gastos operativos</h1>
          <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>
            Desglose de costos del mes por servicio, puesto y cliente.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#1f2937', fontSize: '0.85rem' }}>Mes:</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
      </header>

      {loading && <div style={{ color: '#4b5563' }}>Cargando datos del mes…</div>}
      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 6, color: '#1f2937', marginBottom: '1rem' }}>
          ⚠️ No se pudo cargar: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.warnings.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              {data.warnings.map((w, i) => (
                <div key={i} style={{ padding: '0.5rem 0.75rem', background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 6, color: '#1f2937', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                  ⚠️ {w}
                </div>
              ))}
            </div>
          )}

          {/* Resumen */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.5rem',
          }}>
            <Card label="Total gastado" value={formatUsd(data.total_usd)} />
            <Card label="Facturado (fees)" value={formatUsd(data.total_fee_usd)} />
            <Card
              label="Ratio costos / facturación"
              value={formatRatio(data.ratio_overall_pct)}
              valueColor={ratioColor(data.ratio_overall_pct)}
              hint={data.ratio_overall_pct != null && data.ratio_overall_pct >= 20 ? 'Por encima del 20% objetivo' : 'Dentro del 20% objetivo'}
            />
            <Card label="Puestos del mes" value={String(data.by_job.length)} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
            {(['by_service', 'by_job', 'by_client'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '0.5rem 1rem',
                  border: 'none',
                  background: view === v ? '#1f2937' : 'transparent',
                  color: view === v ? '#fff' : '#1f2937',
                  borderRadius: '6px 6px 0 0',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {v === 'by_service' ? 'Por servicio' : v === 'by_job' ? 'Por puesto' : 'Por cliente'}
              </button>
            ))}
          </div>

          {/* Vista seleccionada */}
          {view === 'by_service' && <ByServiceTable rows={data.by_service} total={data.total_usd} />}
          {view === 'by_job' && <ByJobTable rows={data.by_job} />}
          {view === 'by_client' && <ByClientTable rows={data.by_client} />}

          {data.by_job.length === 0 && data.by_client.length === 0 && data.by_service.length === 0 && (
            <div style={{ textAlign: 'center', color: '#4b5563', padding: '2rem', background: '#f9fafb', borderRadius: 8 }}>
              No hay gastos registrados en este mes todavía.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ label, value, valueColor, hint }: { label: string; value: string; valueColor?: string; hint?: string }) {
  return (
    <div style={{
      padding: '0.85rem 1rem',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: '0.78rem', color: '#4b5563', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 600, color: valueColor ?? '#1f2937' }}>{value}</div>
      {hint && <div style={{ fontSize: '0.72rem', color: '#4b5563', marginTop: '0.3rem' }}>{hint}</div>}
    </div>
  );
}

function ByServiceTable({ rows, total }: { rows: ServiceBreakdown[]; total: number }) {
  if (rows.length === 0) return <Empty />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Servicio</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Total USD</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>% del mes</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Eventos</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pct = total > 0 ? (r.total_usd / total) * 100 : 0;
          return (
            <tr key={r.service}>
              <td style={tdStyle}>{SERVICE_LABELS[r.service] ?? r.service}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatUsd(r.total_usd)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: '#4b5563' }}>{pct.toFixed(1)}%</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: '#4b5563' }}>{r.events_count}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ByJobTable({ rows }: { rows: JobBreakdown[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Puesto</th>
          <th style={thStyle}>Cliente</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Fee</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Gastado</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Ratio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.job_id}>
            <td style={tdStyle}>{r.title}</td>
            <td style={{ ...tdStyle, color: '#4b5563' }}>{r.company}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{r.fee_usd != null ? formatUsd(r.fee_usd) : '—'}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatUsd(r.total_usd)}</td>
            <td style={{ ...tdStyle, textAlign: 'right', color: ratioColor(r.ratio_pct), fontWeight: 600 }}>
              {formatRatio(r.ratio_pct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ByClientTable({ rows }: { rows: ClientBreakdown[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Cliente</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Puestos</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Total gastado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.company}>
            <td style={tdStyle}>{r.company}</td>
            <td style={{ ...tdStyle, textAlign: 'right', color: '#4b5563' }}>{r.jobs_count}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatUsd(r.total_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty() {
  return (
    <div style={{ textAlign: 'center', color: '#4b5563', padding: '1.5rem', background: '#f9fafb', borderRadius: 6 }}>
      Sin datos para esta vista.
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.85rem',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '0.78rem',
  color: '#4b5563',
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: '0.6rem 0.85rem',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.88rem',
  color: '#1f2937',
};
