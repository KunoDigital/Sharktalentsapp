import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { config } from '../config';
import { MOCK_JOBS } from '../data/mockJobs';
import { MOCK_APPLICATIONS, STATE_LABELS } from '../data/mockApplications';
import { MOCK_DRAFTS } from '../data/mockDrafts';
import { MOCK_MESSAGES } from '../data/mockOutreach';
import { MOCK_REPORTS } from '../data/mockReports';
import SetupChecklist from '../components/SetupChecklist';
import { useApi } from '../lib/api';
import { useApiData } from '../hooks/useApiData';
import './pages.css';
import './dashboard.css';

const NEUTRAL = '#8a93a3';
const ACCENT = '#dafd6f';
const COLORS_DISC = { D: '#ef4444', I: '#f59e0b', S: '#10b981', C: '#3b82f6' };
const COLORS_SOURCE = ['#dafd6f', '#f59e0b', '#3b82f6', '#a855f7', '#10b981'];

export default function Dashboard() {
  const api = useApi();
  // Counts en vivo del backend cuando useApi=true. Fallback a mock.
  const { data: jobsData } = useApiData(
    () => (config.useApi ? api.jobs.list() : Promise.resolve(null)),
    [config.useApi],
  );
  const { data: appsData } = useApiData(
    () => (config.useApi ? api.applications.list({ limit: 500 }) : Promise.resolve(null)),
    [config.useApi],
  );

  const liveJobs = config.useApi && jobsData ? jobsData.jobs : null;
  const liveApps = config.useApi && appsData ? appsData.applications : null;

  const activeJobs = liveJobs
    ? liveJobs.filter((j) => j.is_active).length
    : MOCK_JOBS.filter((j) => j.status === 'active').length;
  const totalApps = liveApps ? liveApps.length : MOCK_APPLICATIONS.length;
  const inProgress = liveApps
    ? liveApps.filter((a) => !['hired', 'rejected_by_admin', 'auto_rejected_low_score', 'offer_declined', 'withdrew'].includes(a.pipeline_stage)).length
    : MOCK_APPLICATIONS.filter((a) =>
        !['hired', 'rejected_by_admin', 'auto_rejected_low_score'].includes(a.state),
      ).length;
  const finalists = liveApps
    ? liveApps.filter((a) => ['finalist', 'awaiting_client_review', 'interview_scheduled', 'offered', 'hired'].includes(a.pipeline_stage)).length
    : MOCK_APPLICATIONS.filter((a) => a.state === 'finalist').length;

  // Action queue: lo que requiere atención de Cris HOY
  const draftsPending = MOCK_DRAFTS.filter((d) => d.status === 'draft_generated' || d.status === 'in_review');
  const botNeedsReview = MOCK_APPLICATIONS.filter((a) => a.bot_decision?.needs_review === true);
  const inboxNeedsResponse = MOCK_MESSAGES.filter((m) => m.needs_response);
  const finalistsToInterview = MOCK_APPLICATIONS.filter((a) => a.state === 'finalist');
  const reportsWithNewFeedback = Object.values(MOCK_REPORTS).filter(
    (r) => r.client_feedback && r.client_feedback.length > 0,
  );

  const totalActions =
    draftsPending.length + botNeedsReview.length + inboxNeedsResponse.length +
    finalistsToInterview.length + reportsWithNewFeedback.length;

  // Funnel data
  const funnelStages = [
    { name: 'Aplicaron', value: MOCK_APPLICATIONS.length },
    { name: 'Prefiltro OK', value: MOCK_APPLICATIONS.filter((a) => a.tecnica_state !== 'registrado' || a.state === 'prefilter_passed' || a.tecnica != null).length },
    { name: 'Técnica completa', value: MOCK_APPLICATIONS.filter((a) => a.tecnica != null).length },
    { name: 'Conductual completa', value: MOCK_APPLICATIONS.filter((a) => a.disc != null).length },
    { name: 'Integridad completa', value: MOCK_APPLICATIONS.filter((a) => a.integridad != null).length },
    { name: 'Finalistas', value: finalists },
  ];

  // DISC dominant distribution
  const discCount = { D: 0, I: 0, S: 0, C: 0 };
  MOCK_APPLICATIONS.forEach((a) => {
    if (!a.disc) return;
    const m = Math.max(a.disc.d, a.disc.i, a.disc.s, a.disc.c);
    if (a.disc.d === m) discCount.D += 1;
    else if (a.disc.i === m) discCount.I += 1;
    else if (a.disc.s === m) discCount.S += 1;
    else discCount.C += 1;
  });
  const discPie = Object.entries(discCount)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Source distribution
  const sourceCount: Record<string, number> = {};
  MOCK_APPLICATIONS.forEach((a) => {
    sourceCount[a.source] = (sourceCount[a.source] ?? 0) + 1;
  });
  const sourcePie = Object.entries(sourceCount).map(([name, value]) => ({ name, value }));

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">
        {totalActions === 0
          ? 'Todo bajo control. No hay nada urgente que requiera tu atención.'
          : `Hay ${totalActions} ${totalActions === 1 ? 'cosa' : 'cosas'} que requieren tu atención hoy.`}
        {config.useApi && (liveJobs || liveApps) && (
          <span className="muted small"> · Counts en vivo del backend</span>
        )}
      </p>

      <SetupChecklist />

      {totalActions > 0 && (
        <section className="action-queue">
          <h2 className="action-queue-title">Tu cola</h2>
          <div className="action-queue-list">
            {draftsPending.length > 0 && (
              <ActionItem
                icon="📋"
                count={draftsPending.length}
                label={`${draftsPending.length === 1 ? 'Draft pendiente' : 'Drafts pendientes'} de revisar`}
                hint="Post-reunión con cliente — la IA armó el borrador, vos validás antes de mandárselo"
                cta="Revisar drafts"
                to="/drafts"
                priority="warn"
              />
            )}
            {botNeedsReview.length > 0 && (
              <ActionItem
                icon="🤖"
                count={botNeedsReview.length}
                label={`${botNeedsReview.length === 1 ? 'Decisión del bot' : 'Decisiones del bot'} con baja confianza`}
                hint="El bot prefiere que vos decidas — confidence debajo del umbral"
                cta="Ver review queue"
                to="/bot/review"
                priority="warn"
              />
            )}
            {finalistsToInterview.length > 0 && (
              <ActionItem
                icon="🎯"
                count={finalistsToInterview.length}
                label={`${finalistsToInterview.length === 1 ? 'Finalista listo' : 'Finalistas listos'} para entrevista`}
                hint="Pasaron todas las evaluaciones — agendá entrevista 1:1"
                cta="Ver finalistas"
                to="/candidates"
                priority="good"
              />
            )}
            {inboxNeedsResponse.length > 0 && (
              <ActionItem
                icon="💬"
                count={inboxNeedsResponse.length}
                label={`${inboxNeedsResponse.length === 1 ? 'Mensaje sin responder' : 'Mensajes sin responder'} en inbox outbound`}
                hint="Respuestas de candidatos vía LinkedIn / email"
                cta="Ir al inbox"
                to="/inbox"
                priority="info"
              />
            )}
            {reportsWithNewFeedback.length > 0 && (
              <ActionItem
                icon="✉️"
                count={reportsWithNewFeedback.length}
                label={`${reportsWithNewFeedback.length === 1 ? 'Cliente respondió' : 'Clientes respondieron'} feedback de reportes`}
                hint="Eligieron candidatos para entrevistar"
                cta="Ver reportes"
                to="/reports"
                priority="good"
              />
            )}
          </div>
        </section>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{activeJobs}</div>
          <div className="stat-label">Puestos activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalApps}</div>
          <div className="stat-label">Aplicaciones totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{inProgress}</div>
          <div className="stat-label">En pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{finalists}</div>
          <div className="stat-label">Finalistas</div>
        </div>
      </div>

      <div className="dashboard-charts-grid">
        <div className="chart-card chart-card-wide">
          <div className="chart-card-title">Funnel de conversión</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={funnelStages} layout="vertical" margin={{ left: 30, right: 30 }}>
              <XAxis type="number" stroke={NEUTRAL} fontSize={12} />
              <YAxis type="category" dataKey="name" stroke={NEUTRAL} fontSize={12} width={140} />
              <Tooltip
                contentStyle={{ background: '#161b24', border: '1px solid #2c3442', borderRadius: 6 }}
                labelStyle={{ color: '#f3f4f6' }}
              />
              <Bar dataKey="value" fill={ACCENT} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-card-title">Distribución DISC dominante</div>
          {discPie.length === 0 ? (
            <div className="chart-empty">Aún no hay candidatos con DISC completo</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={discPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {discPie.map((entry) => (
                    <Cell key={entry.name} fill={COLORS_DISC[entry.name as keyof typeof COLORS_DISC]} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: '#161b24', border: '1px solid #2c3442', borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <div className="chart-card-title">Origen de candidatos</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={sourcePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                {sourcePie.map((entry, idx) => (
                  <Cell key={entry.name} fill={COLORS_SOURCE[idx % COLORS_SOURCE.length]} />
                ))}
              </Pie>
              <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#161b24', border: '1px solid #2c3442', borderRadius: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <CostsWidget />

      <MarketingFunnelWidget />

      <h2 className="section-title">Estados del pipeline</h2>
      <div className="dashboard-states-grid">
        {Object.entries(STATE_LABELS).map(([state, label]) => {
          const count = MOCK_APPLICATIONS.filter((a) => a.state === state).length;
          if (count === 0) return null;
          return (
            <div key={state} className="dashboard-state-pill">
              <span className="dashboard-state-count">{count}</span>
              <span className="dashboard-state-label">{label}</span>
            </div>
          );
        })}
      </div>

      <h2 className="section-title">Tus puestos</h2>
      <div className="job-cards">
        {MOCK_JOBS.slice(0, 3).map((job) => (
          <Link key={job.id} to={`/jobs/${job.id}`} className="job-card">
            <div className="job-card-status">{job.status}</div>
            <div className="job-card-title">{job.title}</div>
            <div className="job-card-company">{job.client_company}</div>
            <div className="job-card-meta">
              <span>{job.applications_count} apps</span>
              <span>·</span>
              <span>{job.finalists_count} finalistas</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="muted-note">
        💡 Datos mock — el backend (Catalyst Datastore) todavía no está conectado. Ver{' '}
        <code>shark/src/data/mock*.ts</code>.
      </p>
    </div>
  );
}

type Priority = 'warn' | 'good' | 'info';

function ActionItem({
  icon,
  count,
  label,
  hint,
  cta,
  to,
  priority,
}: {
  icon: string;
  count: number;
  label: string;
  hint: string;
  cta: string;
  to: string;
  priority: Priority;
}) {
  return (
    <Link to={to} className={`action-item action-priority-${priority}`}>
      <div className="action-icon">{icon}</div>
      <div className="action-body">
        <div className="action-label">
          <span className="action-count">{count}</span>
          {label}
        </div>
        <div className="action-hint">{hint}</div>
      </div>
      <div className="action-cta">{cta} →</div>
    </Link>
  );
}

function CostsWidget() {
  const [data, setData] = useState<{ total: number; calls: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    fetch(`${config.apiBase}/api/admin/token-usage?hours=720`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 503) {
          setMissing(true);
          return;
        }
        if (!res.ok) return;
        const body = await res.json();
        const rows = (body.usage ?? []) as Array<{ cost_usd_estimated?: number }>;
        const total = rows.reduce((sum, r) => sum + (r.cost_usd_estimated ?? 0), 0);
        setData({ total, calls: rows.length });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!config.useApi || loading || missing) return null;
  if (!data || data.calls === 0) return null;

  return (
    <section style={{
      marginTop: '1.5rem',
      padding: '1rem 1.25rem',
      background: 'rgba(245, 158, 11, 0.08)',
      border: '1px solid rgba(245, 158, 11, 0.3)',
      borderRadius: '8px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <div>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--st-fg-muted)', letterSpacing: '0.05em' }}>
          Costo IA — últimos 30 días
        </div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
          ${data.total.toFixed(2)} USD
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--st-fg-muted)' }}>
          {data.calls} llamadas a Claude
        </div>
      </div>
      <Link to="/settings?tab=costs" className="link" style={{ fontSize: '0.85rem' }}>
        Ver detalle →
      </Link>
    </section>
  );
}

type FunnelStats = {
  total: number;
  new: number;
  eval_requested: number;
  eval_completed: number;
  call_booked: number;
  won: number;
  lost: number;
};

function MarketingFunnelWidget() {
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    fetch(`${config.apiBase}/api/marketing/leads?limit=1`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 503) {
          setTableMissing(true);
          return;
        }
        if (!res.ok) return;
        const body = await res.json();
        if (body.stats) setStats(body.stats as FunnelStats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!config.useApi || loading || tableMissing) return null;
  if (!stats || stats.total === 0) return null;

  const stages: Array<{ key: keyof FunnelStats; label: string; emoji: string }> = [
    { key: 'new', label: 'Nuevos', emoji: '🆕' },
    { key: 'eval_requested', label: 'Eval pedida', emoji: '⏳' },
    { key: 'eval_completed', label: 'Eval completa', emoji: '✅' },
    { key: 'call_booked', label: 'Call agendada', emoji: '📞' },
    { key: 'won', label: 'Won', emoji: '🏆' },
    { key: 'lost', label: 'Lost', emoji: '❌' },
  ];

  const conversionRate = stats.total > 0 ? Math.round((stats.won / stats.total) * 100) : 0;

  return (
    <section style={{
      marginTop: '1.5rem',
      padding: '1rem 1.25rem',
      background: 'rgba(99, 102, 241, 0.08)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--st-fg-muted)', letterSpacing: '0.05em' }}>
          📥 Funnel marketing — {stats.total} leads
        </div>
        <Link to="/settings?tab=leads" className="link" style={{ fontSize: '0.85rem' }}>
          Ver leads →
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {stages.map((s) => {
          const value = stats[s.key];
          const pct = stats.total > 0 ? Math.round((value / stats.total) * 100) : 0;
          return (
            <div key={s.key} style={{
              flex: '1 1 100px',
              minWidth: 100,
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, color: 'var(--st-fg-muted)' }}>{s.emoji} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>{pct}%</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--st-fg-muted)' }}>
        Conversion rate (won/total): <strong style={{ color: stats.won > 0 ? '#22c55e' : 'inherit' }}>{conversionRate}%</strong>
      </div>
    </section>
  );
}
