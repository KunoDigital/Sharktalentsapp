import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { MOCK_JOBS } from '../data/mockJobs';
import { MOCK_APPLICATIONS, STATE_LABELS } from '../data/mockApplications';
import './pages.css';
import './dashboard.css';

const NEUTRAL = '#8a93a3';
const ACCENT = '#c5fc6f';
const COLORS_DISC = { D: '#ef4444', I: '#f59e0b', S: '#10b981', C: '#3b82f6' };
const COLORS_SOURCE = ['#c5fc6f', '#f59e0b', '#3b82f6', '#a855f7', '#10b981'];

export default function Dashboard() {
  const activeJobs = MOCK_JOBS.filter((j) => j.status === 'active').length;
  const totalApps = MOCK_APPLICATIONS.length;
  const inProgress = MOCK_APPLICATIONS.filter((a) =>
    !['hired', 'rejected_by_admin', 'auto_rejected_low_score'].includes(a.state),
  ).length;
  const finalists = MOCK_APPLICATIONS.filter((a) => a.state === 'finalist').length;

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
        Vista general de los puestos activos y candidatos en pipeline.
      </p>
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
