import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MOCK_JOBS } from '../../data/mockJobs';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import './candidate-test.css';
import './candidate-apply.css';

const log = logger('CANDIDATE_APPLY');

type PublicJobInfo = {
  id: string;
  title: string;
  company: string;
  cognitive_level: string;
  context: string | null;
};

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  city: string;
  salary_aspiration_usd: string;
  disponibilidad: string;
  cv_filename: string | null;
  linkedin_url: string;
  consent_data: boolean;
  consent_communications: boolean;
};

const INITIAL: FormState = {
  full_name: '',
  email: '',
  phone: '',
  city: '',
  salary_aspiration_usd: '',
  disponibilidad: 'Totalmente disponible',
  cv_filename: null,
  linkedin_url: '',
  consent_data: false,
  consent_communications: false,
};

export default function CandidateApply() {
  const { tenantSlug, jobSlug } = useParams<{ tenantSlug: string; jobSlug: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<PublicJobInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cargar info pública del job desde el backend (con fallback a mock)
  useEffect(() => {
    if (!tenantSlug || !jobSlug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      if (config.useApi) {
        try {
          const res = await publicApi.getPublicJobInfo(tenantSlug!, jobSlug!);
          if (cancelled) return;
          if (res?.job) {
            setJob({
              id: res.job.id,
              title: res.job.title,
              company: res.job.company,
              cognitive_level: res.job.cognitive_level,
              context: res.job.context,
            });
            setLoading(false);
            return;
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
            setNotFound(true);
            setLoading(false);
            return;
          }
          log.warn('public job load failed, falling back to mock', { error: (err as Error).message });
        }
      }
      // Fallback al mock
      const mockJob = MOCK_JOBS.find((j) => j.slug === jobSlug);
      if (cancelled) return;
      if (mockJob) {
        setJob({
          id: mockJob.id,
          title: mockJob.title,
          company: mockJob.client_company,
          cognitive_level: 'mid',
          context: mockJob.context,
        });
      } else {
        setNotFound(true);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [tenantSlug, jobSlug]);

  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  if (loading) {
    return <div className="ct-not-found"><h1>Cargando puesto…</h1></div>;
  }
  if (notFound || !job) {
    return (
      <div className="ct-not-found">
        <h1>Puesto no encontrado</h1>
        <p>El link puede haber expirado o el puesto cerró.</p>
      </div>
    );
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((curr) => ({ ...curr, [key]: value }));
    setErrors((curr) => ({ ...curr, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Tu nombre completo';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Email inválido';
    if (!form.phone.trim()) errs.phone = 'Teléfono';
    if (!form.salary_aspiration_usd || isNaN(Number(form.salary_aspiration_usd))) {
      errs.salary_aspiration_usd = 'Ingresá un monto válido en USD';
    }
    if (!form.cv_filename) errs.cv_filename = 'Subí tu CV';
    if (!form.consent_data) errs.consent_data = 'Necesitamos tu consentimiento para procesar tus datos';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !job) return;
    setSubmitError(null);

    if (config.useApi && tenantSlug && jobSlug) {
      setSubmitting(true);
      try {
        const res = await publicApi.submitPublicApplication(tenantSlug, jobSlug, {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          consent_data: form.consent_data,
          consent_communications: form.consent_communications,
          salary_aspiration_usd: Number(form.salary_aspiration_usd) || undefined,
          disponibilidad: form.disponibilidad,
          linkedin_url: form.linkedin_url || undefined,
        });
        if (!res?.created_now) {
          alert(res?.message ?? 'Ya tenías una aplicación a este puesto.');
        }
        setSubmitted(true);
        setTimeout(() => navigate(`/apply/${tenantSlug}/${jobSlug}/done`), 600);
      } catch (err) {
        const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
        setSubmitError(msg);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Modo demo (sin backend)
    log.info('apply submitted (demo mode)', { jobId: job.id, name: form.full_name });
    setSubmitted(true);
    setTimeout(() => navigate(`/apply/${tenantSlug}/${jobSlug}/done`), 600);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const sizeMb = file.size / 1024 / 1024;
      if (sizeMb > 5) {
        setErrors((curr) => ({ ...curr, cv_filename: 'El archivo es muy grande (máx 5MB)' }));
        return;
      }
      setField('cv_filename', file.name);
    }
  }

  if (submitted) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <div className="ct-thanks-icon">✓</div>
            <h1>Recibimos tu aplicación</h1>
            <p>Te llegará un email a <strong>{form.email}</strong> en los próximos minutos con el link a la primera prueba (técnica).</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <header className="ct-header">
        <div className="ct-brand">SharkTalents.AI</div>
        <div className="ct-brand-tag">Aplicación</div>
      </header>

      <main className="ct-main">
        <section className="apply-job-card">
          <div className="apply-job-tag">Aplicar al puesto</div>
          <h1>{job.title}</h1>
          <div className="apply-job-meta">
            <span><strong>{job.company}</strong></span>
          </div>
          {job.context && <p className="apply-job-desc">{job.context}</p>}
          <div className="apply-job-stats">
            <div>
              <div className="apply-stat-label">Nivel</div>
              <div className="apply-stat-value">{job.cognitive_level}</div>
            </div>
          </div>
        </section>

        <form className="apply-form" onSubmit={handleSubmit}>
          <h2>Tus datos</h2>
          <p className="ct-instructions">
            Llenamos lo más importante. <strong>No es un CV largo</strong> — solo lo que necesitamos para empezar la evaluación. Después vas a hacer 4 pruebas (técnica → conductual → integridad → 7 videos cortos).
          </p>

          <Field label="Nombre completo" error={errors.full_name}>
            <input type="text" value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} placeholder="Carla Méndez" />
          </Field>

          <div className="apply-grid-2">
            <Field label="Email" error={errors.email}>
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="tu@email.com" />
            </Field>
            <Field label="Teléfono / WhatsApp" error={errors.phone}>
              <input type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+507 6XXX-XXXX" />
            </Field>
          </div>

          <div className="apply-grid-2">
            <Field label="Ciudad / país">
              <input type="text" value={form.city} onChange={(e) => setField('city', e.target.value)} placeholder="Ciudad de Panamá, Panamá" />
            </Field>
            <Field label="LinkedIn (opcional)">
              <input type="url" value={form.linkedin_url} onChange={(e) => setField('linkedin_url', e.target.value)} placeholder="linkedin.com/in/tu-perfil" />
            </Field>
          </div>

          <div className="apply-grid-2">
            <Field label="Aspiración salarial (USD/mes)" error={errors.salary_aspiration_usd}>
              <input type="number" value={form.salary_aspiration_usd} onChange={(e) => setField('salary_aspiration_usd', e.target.value)} placeholder="2000" />
            </Field>
            <Field label="Disponibilidad">
              <select value={form.disponibilidad} onChange={(e) => setField('disponibilidad', e.target.value)}>
                <option>Totalmente disponible</option>
                <option>7 días de pre-aviso</option>
                <option>15 días de pre-aviso</option>
                <option>30 días de pre-aviso</option>
                <option>60+ días</option>
              </select>
            </Field>
          </div>

          <Field label="CV (PDF, máx 5MB)" error={errors.cv_filename}>
            <label className="apply-file-input">
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} />
              <span className="apply-file-btn">📎 {form.cv_filename ?? 'Elegir archivo'}</span>
              {form.cv_filename && <span className="apply-file-hint muted">subido</span>}
            </label>
          </Field>

          <h3 className="apply-consent-title">Consentimientos</h3>

          <label className="ct-consent-check">
            <input type="checkbox" checked={form.consent_data} onChange={(e) => setField('consent_data', e.target.checked)} />
            <span>
              Acepto que <strong>{job.company}</strong> y Kuno Digital procesen mis datos para esta búsqueda. Mis datos se borran 6 meses después del cierre del proceso (Ley de Protección de Datos PA / GDPR).
            </span>
          </label>
          {errors.consent_data && <div className="apply-error-msg">{errors.consent_data}</div>}

          <label className="ct-consent-check">
            <input type="checkbox" checked={form.consent_communications} onChange={(e) => setField('consent_communications', e.target.checked)} />
            <span>Quiero que Kuno Digital me considere para otros puestos similares (opcional).</span>
          </label>

          {submitError && (
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '0.75rem' }}>
              ⚠️ {submitError}
            </div>
          )}

          <button type="submit" className="ct-start-btn" disabled={submitting}>
            {submitting ? 'Enviando…' : 'Enviar aplicación →'}
          </button>
        </form>

        <p style={{ marginTop: '2rem', textAlign: 'center', fontSize: 14, color: '#666' }}>
          ¿Ya aplicaste y perdiste el link de tu prueba?{' '}
          <a
            href={`#/apply/${tenantSlug}/${jobSlug}/recover`}
            style={{ color: '#2563eb', textDecoration: 'underline' }}
          >
            Reenviármelo
          </a>
        </p>
      </main>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="apply-field">
      <div className="apply-field-label">
        {label}
        {error && <span className="apply-field-error">· {error}</span>}
      </div>
      <div className={`apply-field-input ${error ? 'has-error' : ''}`}>{children}</div>
    </div>
  );
}
