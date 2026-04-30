import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MOCK_JOBS, getJobById, type Job, type JobStatus, type DiscIdealProfile, type VelnaIdealProfile } from '../data/mockJobs';
import './pages.css';
import './job-form.css';

type Mode = 'create' | 'edit';

const DEFAULT_DISC_A: DiscIdealProfile = {
  d: 50, i: 50, s: 50, c: 50,
  pk_profile_code: 'PK-XX',
  pk_profile_name: 'Perfil personalizado',
  description: ['Descripción 1', 'Descripción 2', 'Descripción 3'],
};

const DEFAULT_VELNA: VelnaIdealProfile = {
  verbal: 70, espacial: 65, logica: 75, numerica: 70, abstracta: 70,
};

const DEFAULT_COMPETENCIAS = [
  { name: 'Resolución de problemas complejos', required_pct: 60 },
  { name: 'Adaptabilidad', required_pct: 60 },
  { name: 'Comunicación digital', required_pct: 60 },
  { name: 'Resiliencia, tolerancia al estrés y flexibilidad', required_pct: 60 },
  { name: 'Planificación', required_pct: 60 },
];

function emptyJob(): Omit<Job, 'id' | 'applications_count' | 'applications_in_progress' | 'finalists_count'> {
  return {
    slug: '',
    title: '',
    client_company: '',
    client_industry: '',
    location: '',
    status: 'draft',
    created_at: new Date().toISOString().slice(0, 10),
    fee_usd: 4000,
    salary_range_usd: { min: 1500, max: 2500 },
    disc_ideal_a: DEFAULT_DISC_A,
    velna_ideal: DEFAULT_VELNA,
    competencias_ideales: DEFAULT_COMPETENCIAS,
    tecnica_minimo_pct: 60,
    context: '',
  };
}

export default function JobForm({ mode }: { mode: Mode }) {
  const { id } = useParams<{ id: string }>();
  const existing = mode === 'edit' && id ? getJobById(id) : undefined;
  const navigate = useNavigate();
  const [hasIdealB, setHasIdealB] = useState(!!existing?.disc_ideal_b);
  const [job, setJob] = useState(() => {
    if (existing) {
      return {
        slug: existing.slug,
        title: existing.title,
        client_company: existing.client_company,
        client_industry: existing.client_industry,
        location: existing.location,
        status: existing.status,
        created_at: existing.created_at,
        fee_usd: existing.fee_usd,
        salary_range_usd: existing.salary_range_usd,
        disc_ideal_a: existing.disc_ideal_a,
        disc_ideal_b: existing.disc_ideal_b,
        velna_ideal: existing.velna_ideal,
        competencias_ideales: existing.competencias_ideales,
        tecnica_minimo_pct: existing.tecnica_minimo_pct,
        context: existing.context,
      };
    }
    return emptyJob();
  });

  if (mode === 'edit' && !existing) {
    return <p>Puesto no encontrado. <Link to="/jobs">Volver</Link></p>;
  }

  function patch<K extends keyof typeof job>(key: K, value: typeof job[K]) {
    setJob((curr) => ({ ...curr, [key]: value }));
  }

  function patchDiscA<K extends keyof DiscIdealProfile>(key: K, value: DiscIdealProfile[K]) {
    setJob((curr) => ({ ...curr, disc_ideal_a: { ...curr.disc_ideal_a, [key]: value } }));
  }

  function patchDiscB<K extends keyof DiscIdealProfile>(key: K, value: DiscIdealProfile[K]) {
    setJob((curr) => ({
      ...curr,
      disc_ideal_b: { ...(curr.disc_ideal_b ?? DEFAULT_DISC_A), [key]: value },
    }));
  }

  function patchVelna<K extends keyof VelnaIdealProfile>(key: K, value: number) {
    setJob((curr) => ({ ...curr, velna_ideal: { ...curr.velna_ideal, [key]: value } }));
  }

  function autoSlug() {
    if (job.title && !job.slug) {
      patch('slug', job.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!job.title || !job.client_company || !job.slug) {
      alert('Completá título, cliente y slug.');
      return;
    }
    const payload = {
      ...job,
      disc_ideal_b: hasIdealB ? job.disc_ideal_b : undefined,
    };
    if (mode === 'create') {
      const newJob: Job = {
        id: `job_new_${Date.now()}`,
        ...payload,
        applications_count: 0,
        applications_in_progress: 0,
        finalists_count: 0,
      };
      MOCK_JOBS.push(newJob); // mutación en memoria — en backend sería POST
      alert(`✓ Puesto creado: ${newJob.title}\n\nMock: en backend persistiría a Catalyst Datastore.`);
      navigate(`/jobs/${newJob.id}`);
    } else if (mode === 'edit' && existing) {
      Object.assign(existing, payload); // mutación in-place mock
      alert('✓ Cambios guardados (mock).');
      navigate(`/jobs/${existing.id}`);
    }
  }

  return (
    <div className="job-form-page">
      <Link to={mode === 'edit' && existing ? `/jobs/${existing.id}` : '/jobs'} className="back-link">
        ← {mode === 'edit' ? 'Volver al puesto' : 'Volver a Jobs'}
      </Link>

      <h1 className="page-title">
        {mode === 'create' ? 'Nuevo puesto' : `Editar: ${existing?.title}`}
      </h1>
      <p className="page-subtitle">
        {mode === 'create'
          ? 'Definí el puesto y su perfil ideal. Después publicás y los candidatos pueden aplicar.'
          : 'Editá los campos. Los cambios se reflejan inmediatamente en pipeline y comparativos.'}
      </p>

      <form onSubmit={handleSubmit} className="job-form">
        <section className="job-form-section">
          <h2>Datos básicos</h2>
          <Field label="Título del puesto" required>
            <input
              type="text"
              value={job.title}
              onChange={(e) => patch('title', e.target.value)}
              onBlur={autoSlug}
              placeholder="Desarrollador Fullstack Senior"
              required
            />
          </Field>
          <div className="job-form-grid-2">
            <Field label="Cliente / empresa" required>
              <input
                type="text"
                value={job.client_company}
                onChange={(e) => patch('client_company', e.target.value)}
                placeholder="AcmeTech Panamá"
                required
              />
            </Field>
            <Field label="Industria">
              <input
                type="text"
                value={job.client_industry}
                onChange={(e) => patch('client_industry', e.target.value)}
                placeholder="SaaS B2B"
              />
            </Field>
          </div>
          <div className="job-form-grid-2">
            <Field label="Ubicación / modalidad">
              <input
                type="text"
                value={job.location}
                onChange={(e) => patch('location', e.target.value)}
                placeholder="Ciudad de Panamá (híbrido)"
              />
            </Field>
            <Field label="Slug (URL)">
              <input
                type="text"
                value={job.slug}
                onChange={(e) => patch('slug', e.target.value)}
                placeholder="desarrollador-fullstack-senior"
              />
            </Field>
          </div>
          <Field label="Contexto de la empresa (sirve para que IA arme preguntas técnicas custom)">
            <textarea
              rows={4}
              value={job.context}
              onChange={(e) => patch('context', e.target.value)}
              placeholder="AcmeTech es un SaaS B2B en LATAM. Buscan a alguien que pueda..."
            />
          </Field>
        </section>

        <section className="job-form-section">
          <h2>Salario, fee y estado</h2>
          <div className="job-form-grid-3">
            <Field label="Salario min (USD/mes)">
              <input
                type="number"
                value={job.salary_range_usd.min}
                onChange={(e) => patch('salary_range_usd', { ...job.salary_range_usd, min: Number(e.target.value) })}
              />
            </Field>
            <Field label="Salario max (USD/mes)">
              <input
                type="number"
                value={job.salary_range_usd.max}
                onChange={(e) => patch('salary_range_usd', { ...job.salary_range_usd, max: Number(e.target.value) })}
              />
            </Field>
            <Field label="Fee (USD)">
              <input
                type="number"
                value={job.fee_usd}
                onChange={(e) => patch('fee_usd', Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="job-form-grid-2">
            <Field label="Estado">
              <select value={job.status} onChange={(e) => patch('status', e.target.value as JobStatus)}>
                <option value="draft">Borrador</option>
                <option value="active">Activo (publicado)</option>
                <option value="paused">Pausado</option>
                <option value="closed">Cerrado</option>
              </select>
            </Field>
            <Field label="Mínimo técnica (%)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.tecnica_minimo_pct}
                onChange={(e) => patch('tecnica_minimo_pct', Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="job-form-section">
          <h2>Perfil DISC ideal A</h2>
          <Field label="PK profile">
            <div className="job-form-grid-2">
              <input
                type="text"
                value={job.disc_ideal_a.pk_profile_code}
                onChange={(e) => patchDiscA('pk_profile_code', e.target.value)}
                placeholder="PK-07"
              />
              <input
                type="text"
                value={job.disc_ideal_a.pk_profile_name}
                onChange={(e) => patchDiscA('pk_profile_name', e.target.value)}
                placeholder="Estructurado/a — Calidad"
              />
            </div>
          </Field>
          <DiscBars
            d={job.disc_ideal_a.d}
            i={job.disc_ideal_a.i}
            s={job.disc_ideal_a.s}
            c={job.disc_ideal_a.c}
            onChange={(axis, value) => patchDiscA(axis, value)}
          />
          <Field label="Descripción del perfil (3 bullets)">
            {job.disc_ideal_a.description.map((d, i) => (
              <input
                key={i}
                type="text"
                value={d}
                onChange={(e) => {
                  const newDesc = [...job.disc_ideal_a.description];
                  newDesc[i] = e.target.value;
                  patchDiscA('description', newDesc);
                }}
                style={{ marginBottom: '0.4rem' }}
              />
            ))}
          </Field>
        </section>

        <section className="job-form-section">
          <div className="job-form-toggle-row">
            <label className="notif-toggle">
              <input
                type="checkbox"
                checked={hasIdealB}
                onChange={(e) => setHasIdealB(e.target.checked)}
              />
              <span className="notif-toggle-slider" />
            </label>
            <h2 style={{ margin: 0 }}>Perfil DISC ideal B (alternativo)</h2>
          </div>
          {hasIdealB && (
            <>
              <p className="muted small">
                Útil cuando el puesto admite 2 perfiles distintos válidos. Ej: "líder D" o "vendedor I" para gerente comercial.
              </p>
              <Field label="PK profile B">
                <div className="job-form-grid-2">
                  <input
                    type="text"
                    value={job.disc_ideal_b?.pk_profile_code ?? ''}
                    onChange={(e) => patchDiscB('pk_profile_code', e.target.value)}
                    placeholder="PK-04"
                  />
                  <input
                    type="text"
                    value={job.disc_ideal_b?.pk_profile_name ?? ''}
                    onChange={(e) => patchDiscB('pk_profile_name', e.target.value)}
                    placeholder="Influyente — Carismático"
                  />
                </div>
              </Field>
              <DiscBars
                d={job.disc_ideal_b?.d ?? 50}
                i={job.disc_ideal_b?.i ?? 50}
                s={job.disc_ideal_b?.s ?? 50}
                c={job.disc_ideal_b?.c ?? 50}
                onChange={(axis, value) => patchDiscB(axis, value)}
              />
            </>
          )}
        </section>

        <section className="job-form-section">
          <h2>VELNA ideal (capacidad cognitiva)</h2>
          <div className="job-form-velna">
            {(['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const).map((k) => (
              <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={job.velna_ideal[k]}
                  onChange={(e) => patchVelna(k, Number(e.target.value))}
                />
              </Field>
            ))}
          </div>
        </section>

        <section className="job-form-section">
          <h2>Competencias clave (5)</h2>
          {job.competencias_ideales.map((c, i) => (
            <div key={i} className="job-form-competencia-row">
              <input
                type="text"
                value={c.name}
                onChange={(e) => {
                  const newComps = [...job.competencias_ideales];
                  newComps[i] = { ...c, name: e.target.value };
                  patch('competencias_ideales', newComps);
                }}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={c.required_pct}
                onChange={(e) => {
                  const newComps = [...job.competencias_ideales];
                  newComps[i] = { ...c, required_pct: Number(e.target.value) };
                  patch('competencias_ideales', newComps);
                }}
              />
              <span>%</span>
            </div>
          ))}
        </section>

        <div className="job-form-actions">
          <Link to={mode === 'edit' && existing ? `/jobs/${existing.id}` : '/jobs'} className="cd-btn-ghost">
            Cancelar
          </Link>
          <button type="submit" className="btn-primary">
            {mode === 'create' ? 'Crear puesto' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="job-form-field">
      <div className="job-form-label">
        {label}{required && <span className="job-form-required"> *</span>}
      </div>
      {children}
    </div>
  );
}

function DiscBars({
  d, i, s, c, onChange,
}: {
  d: number; i: number; s: number; c: number;
  onChange: (axis: 'd' | 'i' | 's' | 'c', value: number) => void;
}) {
  const items = [
    { axis: 'd' as const, val: d, color: '#ef4444', label: 'D' },
    { axis: 'i' as const, val: i, color: '#f59e0b', label: 'I' },
    { axis: 's' as const, val: s, color: '#10b981', label: 'S' },
    { axis: 'c' as const, val: c, color: '#3b82f6', label: 'C' },
  ];
  return (
    <div className="job-form-disc-bars">
      {items.map(({ axis, val, color, label }) => (
        <div key={axis} className="job-form-disc-bar">
          <span className="job-form-disc-label">{label}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={val}
            onChange={(e) => onChange(axis, Number(e.target.value))}
            className="job-form-disc-slider"
            style={{ accentColor: color }}
          />
          <span className="job-form-disc-val">{val}</span>
        </div>
      ))}
    </div>
  );
}
