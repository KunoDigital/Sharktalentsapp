import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MOCK_JOBS } from '../../data/mockJobs';
import './candidate-test.css';
import './candidate-apply.css';

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
  const job = MOCK_JOBS.find((j) => j.slug === jobSlug);

  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  if (!job) {
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !job) return;
    // Mock: en backend creás JobApplication, generás token de test, mandás email
    console.log('[APPLY] submitted', { jobId: job.id, form });
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
            <span><strong>{job.client_company}</strong></span>
            <span>·</span>
            <span>{job.location}</span>
            <span>·</span>
            <span>{job.client_industry}</span>
          </div>
          <p className="apply-job-desc">{job.context}</p>
          <div className="apply-job-stats">
            <div>
              <div className="apply-stat-label">Salario</div>
              <div className="apply-stat-value">${job.salary_range_usd.min.toLocaleString()}–${job.salary_range_usd.max.toLocaleString()} USD</div>
            </div>
            <div>
              <div className="apply-stat-label">Modalidad</div>
              <div className="apply-stat-value">{job.location.includes('Remoto') ? 'Remoto' : job.location.includes('híbrido') ? 'Híbrido' : 'Presencial'}</div>
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
              Acepto que <strong>{job.client_company}</strong> y Kuno Digital procesen mis datos para esta búsqueda. Mis datos se borran 6 meses después del cierre del proceso (Ley de Protección de Datos PA / GDPR).
            </span>
          </label>
          {errors.consent_data && <div className="apply-error-msg">{errors.consent_data}</div>}

          <label className="ct-consent-check">
            <input type="checkbox" checked={form.consent_communications} onChange={(e) => setField('consent_communications', e.target.checked)} />
            <span>Quiero que Kuno Digital me considere para otros puestos similares (opcional).</span>
          </label>

          <button type="submit" className="ct-start-btn">
            Enviar aplicación →
          </button>
        </form>
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
