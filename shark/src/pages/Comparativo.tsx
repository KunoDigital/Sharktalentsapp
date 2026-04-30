import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJobById } from '../data/mockJobs';
import {
  getApplicationsByJobId,
  type Application,
} from '../data/mockApplications';
import './pages.css';
import './comparativo.css';

const MAX_SELECTED = 4;

export default function Comparativo() {
  const { id } = useParams<{ id: string }>();
  const job = id ? getJobById(id) : undefined;
  const allApps = useMemo(() => (job ? getApplicationsByJobId(job.id) : []), [job]);

  // pre-seleccionar finalistas
  const initial = useMemo(
    () => allApps.filter((a) => a.state === 'finalist').slice(0, 3).map((a) => a.id),
    [allApps],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initial);
  const selected = allApps.filter((a) => selectedIds.includes(a.id));

  if (!job) {
    return <p>Puesto no encontrado. <Link to="/jobs">Volver</Link></p>;
  }

  function toggle(appId: string) {
    setSelectedIds((curr) => {
      if (curr.includes(appId)) return curr.filter((id) => id !== appId);
      if (curr.length >= MAX_SELECTED) return curr;
      return [...curr, appId];
    });
  }

  return (
    <div className="comparativo">
      <Link to={`/jobs/${job.id}`} className="back-link">← {job.title}</Link>

      <div className="page-header-row">
        <h1 className="page-title">Comparar candidatos — {job.title}</h1>
        <button className="btn-primary" disabled={selected.length === 0}>
          Preparar reporte para cliente ({selected.length} {selected.length === 1 ? 'candidato' : 'candidatos'})
        </button>
      </div>

      <div className="comp-selector">
        <div className="comp-selector-label">
          Selecciona hasta {MAX_SELECTED} candidatos ({selected.length}/{MAX_SELECTED}):
        </div>
        <div className="comp-selector-chips">
          {allApps.map((a) => {
            const isSelected = selectedIds.includes(a.id);
            const disabled = !isSelected && selected.length >= MAX_SELECTED;
            return (
              <button
                key={a.id}
                className={`comp-chip${isSelected ? ' is-selected' : ''}`}
                disabled={disabled}
                onClick={() => toggle(a.id)}
                title={disabled ? `Máximo ${MAX_SELECTED} candidatos` : ''}
              >
                {isSelected ? '● ' : '+ '}
                {a.candidate_name}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="comp-empty">
          Seleccioná al menos un candidato para comparar.
        </div>
      ) : (
        <div className="comp-sections">
          <DiscSection job={job} selected={selected} />
          <VelnaSection job={job} selected={selected} />
          <CompetenciasSection job={job} selected={selected} />
          <AntiTrampaSection selected={selected} />
          <SalarioSection job={job} selected={selected} />
          <EmocionSection selected={selected} />
          <TecnicaSection job={job} selected={selected} />
          <IntegridadSection selected={selected} />
          <DecisionSection selected={selected} phase="conductual" />
          <DecisionSection selected={selected} phase="integridad" />
        </div>
      )}
    </div>
  );
}

// ============== DISC ==============

function DiscSection({ job, selected }: { job: ReturnType<typeof getJobById>; selected: Application[] }) {
  if (!job) return null;
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">DISC</h2>
      <div className="comp-cards-row">
        <div className="comp-card comp-card-ideal">
          <div className="comp-card-header">Perfil ideal A</div>
          <DiscBars d={job.disc_ideal_a.d} i={job.disc_ideal_a.i} s={job.disc_ideal_a.s} c={job.disc_ideal_a.c} />
          <div className="comp-pk-tag">
            <span className="comp-pk-code">{job.disc_ideal_a.pk_profile_code}</span>
            <span className="comp-pk-name">{job.disc_ideal_a.pk_profile_name}</span>
          </div>
          <ul className="comp-pk-desc">
            {job.disc_ideal_a.description.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
        {job.disc_ideal_b && (
          <div className="comp-card comp-card-ideal">
            <div className="comp-card-header">Perfil ideal B</div>
            <DiscBars d={job.disc_ideal_b.d} i={job.disc_ideal_b.i} s={job.disc_ideal_b.s} c={job.disc_ideal_b.c} />
            <div className="comp-pk-tag">
              <span className="comp-pk-code">{job.disc_ideal_b.pk_profile_code}</span>
              <span className="comp-pk-name">{job.disc_ideal_b.pk_profile_name}</span>
            </div>
            <ul className="comp-pk-desc">
              {job.disc_ideal_b.description.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className="comp-cards-row">
        {selected.map((app) => (
          <div key={app.id} className="comp-card">
            <div className="comp-card-header comp-card-name">
              {app.candidate_name}
              {app.disc && (
                <span className={`comp-similitud comp-similitud-${classifySim(app.disc.similitud_pct)}`}>
                  {app.disc.similitud_pct}% similitud
                </span>
              )}
            </div>
            {app.disc ? (
              <>
                <DiscBars d={app.disc.d} i={app.disc.i} s={app.disc.s} c={app.disc.c} />
                <div className="comp-pk-tag">
                  <span className="comp-pk-code">{app.disc.pk_profile_code}</span>
                  <span className="comp-pk-name">{app.disc.pk_profile_name}</span>
                </div>
              </>
            ) : (
              <div className="comp-pending">Pendiente</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DiscBars({ d, i, s, c }: { d: number; i: number; s: number; c: number }) {
  return (
    <div className="comp-disc-bars">
      {([
        ['D', d, '#ef4444'],
        ['I', i, '#f59e0b'],
        ['S', s, '#10b981'],
        ['C', c, '#3b82f6'],
      ] as const).map(([label, val, color]) => (
        <div key={label} className="comp-disc-bar-col">
          <div className="comp-disc-bar-label">{label}</div>
          <div className="comp-disc-bar-graph">
            <div className="comp-disc-bar-fill" style={{ height: `${val}%`, background: color }} />
          </div>
          <div className="comp-disc-bar-val">{val}</div>
        </div>
      ))}
    </div>
  );
}

// ============== VELNA ==============

function VelnaSection({ job, selected }: { job: ReturnType<typeof getJobById>; selected: Application[] }) {
  if (!job) return null;
  const labels: { key: keyof typeof job.velna_ideal; label: string; color: string }[] = [
    { key: 'verbal', label: 'Verbal', color: '#3b82f6' },
    { key: 'espacial', label: 'Espacial', color: '#10b981' },
    { key: 'logica', label: 'Lógica', color: '#f59e0b' },
    { key: 'numerica', label: 'Numérica', color: '#ef4444' },
    { key: 'abstracta', label: 'Abstracta', color: '#a855f7' },
  ];
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Cognitiva VELNA</h2>
      <div className="comp-card comp-card-ideal">
        <div className="comp-card-header">Perfil ideal</div>
        {labels.map(({ key, label, color }) => (
          <VelnaRow key={key as string} label={label} value={job.velna_ideal[key]} color={color} />
        ))}
      </div>
      <div className="comp-cards-row">
        {selected.map((app) => (
          <div key={app.id} className="comp-card">
            <div className="comp-card-header comp-card-name">
              {app.candidate_name}
              {app.velna && (
                <span className={`comp-similitud comp-similitud-${classifySim(app.velna.similitud_pct)}`}>
                  {app.velna.similitud_pct}% similitud
                </span>
              )}
            </div>
            {app.velna ? (
              labels.map(({ key, label, color }) => (
                <VelnaRow key={key as string} label={label} value={app.velna![key as keyof typeof app.velna]} color={color} />
              ))
            ) : (
              <div className="comp-pending">Pendiente</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function VelnaRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="comp-velna-row">
      <span className="comp-velna-label">{label}</span>
      <div className="comp-velna-track">
        <div className="comp-velna-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="comp-velna-val">{value}</span>
    </div>
  );
}

// ============== Competencias ==============

function CompetenciasSection({ job, selected }: { job: ReturnType<typeof getJobById>; selected: Application[] }) {
  if (!job) return null;
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Competencias</h2>
      <div className="comp-card comp-card-ideal">
        <div className="comp-card-header">Requeridas</div>
        {job.competencias_ideales.map((c) => (
          <div key={c.name} className="comp-comp-row">
            <span className="comp-comp-label">{c.name}</span>
            <span className="comp-comp-required">≥ {c.required_pct}%</span>
          </div>
        ))}
      </div>
      <div className="comp-cards-row">
        {selected.map((app) => (
          <div key={app.id} className="comp-card">
            <div className="comp-card-header comp-card-name">{app.candidate_name}</div>
            <div className="comp-comp-pending">
              <p className="muted">Mock — competencias se calculan post-conductual.</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============== Anti-trampa ==============

function AntiTrampaSection({ selected }: { selected: Application[] }) {
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Monitoreo anti-trampa</h2>
      <div className="comp-cards-row">
        {selected.map((app) => {
          const byPhase = {
            tecnica: app.anti_cheat_events.filter((e) => e.phase === 'tecnica').length,
            conductual: app.anti_cheat_events.filter((e) => e.phase === 'conductual').length,
            integridad: app.anti_cheat_events.filter((e) => e.phase === 'integridad').length,
          };
          const total = app.anti_cheat_events.length;
          return (
            <div key={app.id} className={`comp-card ${total > 0 ? 'comp-card-warn' : ''}`}>
              <div className="comp-card-header comp-card-name">{app.candidate_name}</div>
              {total === 0 ? (
                <div className="comp-no-events">✓ Sin salidas detectadas</div>
              ) : (
                <>
                  <div className="comp-ac-summary">
                    {byPhase.tecnica > 0 && <span className="comp-ac-tag">Técnica: {byPhase.tecnica}</span>}
                    {byPhase.conductual > 0 && <span className="comp-ac-tag">Conductual: {byPhase.conductual}</span>}
                    {byPhase.integridad > 0 && <span className="comp-ac-tag">Integridad: {byPhase.integridad}</span>}
                  </div>
                  <ul className="comp-ac-events">
                    {app.anti_cheat_events.slice(0, 5).map((e, i) => (
                      <li key={i}>
                        {e.phase} · {e.type === 'cursor_out' ? 'cursor fuera' : e.type === 'window_blur' ? 'ventana perdió foco' : 'paste'} en {e.question_id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============== Salario ==============

function SalarioSection({ job, selected }: { job: ReturnType<typeof getJobById>; selected: Application[] }) {
  if (!job) return null;
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Aspiración salarial</h2>
      <div className="comp-salario-range muted">
        Rango del puesto: ${job.salary_range_usd.min.toLocaleString()} – ${job.salary_range_usd.max.toLocaleString()}/mes
      </div>
      <div className="comp-cards-row">
        {selected.map((app) => {
          const inRange = app.salary_aspiration_usd >= job.salary_range_usd.min && app.salary_aspiration_usd <= job.salary_range_usd.max;
          return (
            <div key={app.id} className={`comp-card comp-salario-card ${!inRange ? 'comp-card-warn' : ''}`}>
              <div className="comp-card-header comp-card-name">{app.candidate_name}</div>
              <div className="comp-salario-amount">${app.salary_aspiration_usd.toLocaleString()}<span className="comp-salario-mes">/mes</span></div>
              {!inRange && (
                <div className="comp-salario-flag">
                  {app.salary_aspiration_usd < job.salary_range_usd.min ? 'Debajo del rango' : 'Encima del rango'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============== Emoción ==============

function EmocionSection({ selected }: { selected: Application[] }) {
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Emoción</h2>
      <div className="comp-emocion-track">
        {selected.map((app) => app.emocional && (
          <div key={app.id} className="comp-emocion-marker" style={{ left: `${app.emocional.value}%` }}>
            <div className="comp-emocion-dot" />
            <div className="comp-emocion-name">{app.candidate_name.split(' ')[0]}</div>
          </div>
        ))}
      </div>
      <div className="comp-emocion-axis">
        <span>Espontáneo</span>
        <span>Mesura</span>
        <span>Reflexivo</span>
      </div>
      <div className="comp-emocion-list">
        {selected.map((app) => app.emocional && (
          <span key={app.id} className="comp-emocion-item">
            <strong>{app.candidate_name}</strong>: {app.emocional.label} ({app.emocional.value})
          </span>
        ))}
      </div>
    </section>
  );
}

// ============== Técnica ==============

function TecnicaSection({ job, selected }: { job: ReturnType<typeof getJobById>; selected: Application[] }) {
  if (!job) return null;
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Técnica</h2>
      <div className="comp-tecnica-row">
        <div className="comp-tecnica-min">Mínimo requerido: <strong>{job.tecnica_minimo_pct}%</strong></div>
        {selected.map((app) => (
          <div key={app.id} className={`comp-tecnica-pill ${app.tecnica?.estado === 'Aprobado' ? 'is-aprobado' : app.tecnica?.estado === 'No aprobado' ? 'is-rechazado' : 'is-pendiente'}`}>
            <strong>{app.candidate_name.split(' ')[0]}</strong>: {app.tecnica ? `${app.tecnica.pct}% ${app.tecnica.estado}` : 'Pendiente'}
          </div>
        ))}
      </div>
    </section>
  );
}

// ============== Integridad ==============

function IntegridadSection({ selected }: { selected: Application[] }) {
  const integrityCands = selected.filter((a) => a.integridad);
  if (integrityCands.length === 0) {
    return (
      <section className="comp-section">
        <h2 className="comp-section-title">Integridad</h2>
        <p className="muted">Ningún candidato seleccionado completó integridad todavía.</p>
      </section>
    );
  }
  // Use first candidate's dimensions as reference for the table structure
  const refDims = integrityCands[0].integridad!.dimensions;
  return (
    <section className="comp-section">
      <h2 className="comp-section-title">Integridad</h2>
      <table className="comp-integridad-table">
        <thead>
          <tr>
            <th>Dimensión</th>
            {selected.map((a) => <th key={a.id}>{a.candidate_name.split(' ')[0]}</th>)}
          </tr>
        </thead>
        <tbody>
          {refDims.map((dim) => (
            <tr key={dim.name}>
              <td>{dim.name}</td>
              {selected.map((a) => {
                const candDim = a.integridad?.dimensions.find((d) => d.name === dim.name);
                if (!candDim || candDim.classification === null) return <td key={a.id} className="muted">—</td>;
                return (
                  <td key={a.id} className={`comp-int-${candDim.classification.toLowerCase()}`}>
                    {candDim.classification} {candDim.score_pct != null ? `${candDim.score_pct}%` : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ============== Decisión por fase ==============

function DecisionSection({ selected, phase }: { selected: Application[]; phase: 'conductual' | 'integridad' }) {
  const buttons = phase === 'conductual'
    ? [{ label: 'Siguiente etapa', kind: 'primary' }, { label: 'Duda — Revisar CV', kind: 'warn' }, { label: 'Rechazar', kind: 'danger' }]
    : [{ label: 'Llamar a entrevista', kind: 'primary' }, { label: 'Rechazado', kind: 'danger' }];
  const title = phase === 'conductual' ? 'Decisión — Evaluación Conductual (DISC)' : 'Decisión — Integridad';

  return (
    <section className="comp-section">
      <h2 className="comp-section-title">{title}</h2>
      <div className="comp-decision-list">
        {selected.map((app) => (
          <div key={app.id} className="comp-decision-row">
            <div>
              <div className="comp-decision-name">{app.candidate_name}</div>
              <div className="muted small">{app.candidate_email}</div>
            </div>
            <div className="comp-decision-actions">
              {buttons.map((b) => (
                <button
                  key={b.label}
                  className={`comp-dec-btn comp-dec-${b.kind}`}
                  onClick={() => alert(`Mock: ${app.candidate_name} → ${b.label} (${phase})`)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button className="btn-primary comp-decision-save" onClick={() => alert('Mock: guardar decisiones')}>
        Guardar
      </button>
    </section>
  );
}

// ============== Helpers ==============

function classifySim(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 70) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}
