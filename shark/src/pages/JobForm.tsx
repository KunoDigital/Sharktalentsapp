import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MOCK_JOBS, getJobById, type Job, type JobStatus, type DiscIdealProfile, type VelnaIdealProfile } from '../data/mockJobs';
import { useUndoableState } from '../hooks/useUndoableState';
import { useApi, ApiError } from '../lib/api';
import { apiJobToFormJob } from '../lib/jobAdapter';
import { config } from '../config';
import PrefilterQuestionsPanel from '../components/PrefilterQuestionsPanel';
import { logger } from '../lib/logger';
import './pages.css';
import './job-form.css';

const log = logger('JOB_FORM');

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

// 2026-06-05: empezamos con array vacío para que Cris elija las competencias del
// catálogo cerrado (memoria project_competencias_catalogo_cerrado.md). Los defaults
// anteriores eran free-text que el backend rechazaba con 400 si Cris no editaba.
const DEFAULT_COMPETENCIAS: Array<{ name: string; required_pct: number }> = [];

/**
 * Convierte el state local de DISC/VELNA/competencias al shape que espera el backend.
 * Stripa fields vacíos para no enviar nulls a Catalyst.
 */
function buildIdealProfilePayload(
  jobState: Omit<Job, 'id' | 'applications_count' | 'applications_in_progress' | 'finalists_count'>,
  hasIdealB: boolean,
) {
  const ideal: Record<string, unknown> = {};
  if (jobState.disc_ideal_a) {
    ideal.disc = {
      d: jobState.disc_ideal_a.d,
      i: jobState.disc_ideal_a.i,
      s: jobState.disc_ideal_a.s,
      c: jobState.disc_ideal_a.c,
      ...(jobState.disc_ideal_a.pk_profile_code ? { pk_code: jobState.disc_ideal_a.pk_profile_code } : {}),
      ...(jobState.disc_ideal_a.pk_profile_name ? { pk_name: jobState.disc_ideal_a.pk_profile_name } : {}),
    };
  }
  if (hasIdealB && jobState.disc_ideal_b) {
    ideal.disc_b = {
      d: jobState.disc_ideal_b.d,
      i: jobState.disc_ideal_b.i,
      s: jobState.disc_ideal_b.s,
      c: jobState.disc_ideal_b.c,
      ...(jobState.disc_ideal_b.pk_profile_code ? { pk_code: jobState.disc_ideal_b.pk_profile_code } : {}),
      ...(jobState.disc_ideal_b.pk_profile_name ? { pk_name: jobState.disc_ideal_b.pk_profile_name } : {}),
    };
  }
  if (jobState.velna_ideal) {
    ideal.velna = jobState.velna_ideal;
  }
  if (jobState.competencias_ideales && jobState.competencias_ideales.length > 0) {
    ideal.competencias = jobState.competencias_ideales;
  }
  if (typeof jobState.tecnica_minimo_pct === 'number') {
    ideal.tecnica_minimo_pct = jobState.tecnica_minimo_pct;
  }
  if (jobState.context) {
    ideal.context_summary = jobState.context;
  }
  if (jobState.boss && jobState.boss.name?.trim()) {
    ideal.boss = {
      name: jobState.boss.name.trim(),
      role: jobState.boss.role.trim(),
      style_autonomy_consult: Number(jobState.boss.style_autonomy_consult.toFixed(2)),
      ...(jobState.boss.evidence_quote ? { evidence_quote: jobState.boss.evidence_quote.slice(0, 1000) } : {}),
    };
  }
  if (jobState.auto_rejection_rules) {
    const rules: Record<string, number> = {};
    const r = jobState.auto_rejection_rules;
    if (typeof r.disc_min_similarity === 'number') rules.disc_min_similarity = r.disc_min_similarity;
    if (typeof r.velna_min_indice === 'number') rules.velna_min_indice = r.velna_min_indice;
    if (typeof r.integridad_max_riesgo === 'number') rules.integridad_max_riesgo = r.integridad_max_riesgo;
    if (typeof r.emo_min_score === 'number') rules.emo_min_score = r.emo_min_score;
    if (Object.keys(rules).length > 0) ideal.auto_rejection_rules = rules;
  }
  if (jobState.report_lang === 'es' || jobState.report_lang === 'en') {
    ideal.report_lang = jobState.report_lang;
  }
  // Campos públicos (sitio web del candidato). El backend también los hereda del draft IA
  // si vienen vacíos acá. Mandar solo si admin los escribió.
  if (jobState.que_busco && jobState.que_busco.trim()) {
    ideal.que_busco = jobState.que_busco.trim();
  }
  if (Array.isArray(jobState.que_debe_hacer) && jobState.que_debe_hacer.length > 0) {
    ideal.que_debe_hacer = jobState.que_debe_hacer.filter((s) => s.trim()).map((s) => s.trim());
  }
  if (Array.isArray(jobState.que_debe_saber) && jobState.que_debe_saber.length > 0) {
    ideal.que_debe_saber = jobState.que_debe_saber.filter((s) => s.trim()).map((s) => s.trim());
  }
  if (jobState.salary_range_usd && jobState.salary_range_usd.max > 0) {
    ideal.salary_range_usd = jobState.salary_range_usd;
  }
  return Object.keys(ideal).length > 0 ? ideal : null;
}

/** Multiplicador para calcular fee = salary_max * FEE_MULTIPLIER. Igual al backend (env FEE_MULTIPLIER). */
const FEE_MULTIPLIER = 1.2;

// 2026-06-05: función RejectionRule eliminada — la sección que la usaba estaba
// duplicada con la versión inputs-number y se eliminó. Recuperable de git si re-hace.

function formatStyle(v: number): string {
  if (v >= 0.75) return 'da autonomía';
  if (v >= 0.55) return 'tiende a dar autonomía';
  if (v >= 0.45) return 'neutral';
  if (v >= 0.25) return 'tiende a controlar';
  return 'controlador';
}

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
    report_lang: 'es' as const,
    english_required: false,
    english_min_level: undefined,
    mindset_test_enabled: true,
  };
}

export default function JobForm({ mode }: { mode: Mode }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = useApi();

  // Bug K fix (2026-06-09): cargar el puesto async desde el backend en edit mode.
  // Antes usaba `getJobById(id)` que era mock-only (data/mockJobs.ts) y por eso
  // todos los puestos reales daban "Puesto no encontrado". Ahora hace fetch real
  // y mapea ApiJob → Job vía jobAdapter.apiJobToFormJob().
  //
  // En modo mock (config.useApi false) o create, mantenemos el comportamiento legacy.
  const [existing, setExisting] = useState<Job | undefined>(() => {
    if (mode === 'edit' && id && !config.useApi) return getJobById(id);
    return undefined;
  });
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'not_found' | 'error'>(
    mode === 'edit' && id && config.useApi ? 'loading' : 'idle',
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !id || !config.useApi) return;
    let cancelled = false;
    setLoadState('loading');
    api.jobs.get(id).then((res) => {
      if (cancelled) return;
      setExisting(apiJobToFormJob(res.job));
      setLoadState('loaded');
    }).catch((err: unknown) => {
      if (cancelled) return;
      log.warn('failed to load job for edit', { id, error: (err as Error).message });
      if (err instanceof ApiError && err.code === 'not_found') {
        setLoadState('not_found');
      } else {
        setLoadState('error');
        setLoadError((err as Error).message);
      }
    });
    return () => { cancelled = true; };
  }, [id, mode, api.jobs]);

  const [hasIdealB, setHasIdealB] = useState(!!existing?.disc_ideal_b);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sincronizar hasIdealB cuando llega existing del async load.
  useEffect(() => {
    if (existing?.disc_ideal_b) setHasIdealB(true);
  }, [existing?.disc_ideal_b]);

  const initialJob = existing
    ? {
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
        boss: existing.boss,
        auto_rejection_rules: existing.auto_rejection_rules,
        report_lang: existing.report_lang ?? 'es',
        english_required: existing.english_required ?? false,
        english_min_level: existing.english_min_level,
        mindset_test_enabled: existing.mindset_test_enabled ?? true,
      }
    : emptyJob();

  const { state: job, set: setJob, undo, redo, canUndo, canRedo } = useUndoableState(initialJob, { debounceMs: 500, maxHistory: 60 });

  // Estados de carga async (Bug K). Loading → error → not_found → loaded.
  if (mode === 'edit' && loadState === 'loading') {
    return <p className="page" style={{ padding: 24 }}>Cargando puesto...</p>;
  }
  if (mode === 'edit' && loadState === 'error') {
    return (
      <div className="page" style={{ padding: 24 }}>
        <p>Error al cargar el puesto.</p>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>{loadError}</p>
        <Link to="/jobs">← Volver</Link>
      </div>
    );
  }
  if (mode === 'edit' && loadState === 'not_found') {
    return <p>Puesto no encontrado. <Link to="/jobs">Volver</Link></p>;
  }
  if (mode === 'edit' && !existing) {
    // Fallback defensivo: no debería pasar pero por las dudas
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!job.title || !job.client_company || !job.slug) {
      alert('Completá título, cliente y slug.');
      return;
    }
    const payload = {
      ...job,
      disc_ideal_b: hasIdealB ? job.disc_ideal_b : undefined,
    };

    // Modo API: persistir contra el backend real
    if (config.useApi) {
      setSubmitting(true);
      try {
        const idealProfile = buildIdealProfilePayload(job, hasIdealB);
        if (mode === 'create') {
          const result = await api.jobs.create({
            title: job.title,
            company: job.client_company,
            cognitive_level: 'mid',
            tech_prompt: null,
            company_context: job.context ?? null,
            is_active: job.status === 'active',
            ideal_profile: idealProfile,
            fee_usd: Number.isFinite(job.fee_usd) && job.fee_usd > 0 ? job.fee_usd : null,
          });
          navigate(`/jobs/${result.job.ROWID}`);
        } else if (mode === 'edit' && existing) {
          await api.jobs.update(existing.id, {
            title: job.title,
            company: job.client_company,
            company_context: job.context ?? null,
            is_active: job.status === 'active',
            ideal_profile: idealProfile,
            fee_usd: Number.isFinite(job.fee_usd) && job.fee_usd > 0 ? job.fee_usd : null,
          });
          navigate(`/jobs/${existing.id}`);
        }
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          setSubmitError(`${err.code}: ${err.message}${err.traceId ? ` (trace: ${err.traceId})` : ''}`);
        } else {
          setSubmitError((err as Error).message);
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Modo mock: mutación en memoria (legado)
    if (mode === 'create') {
      const newJob: Job = {
        id: `job_new_${Date.now()}`,
        ...payload,
        applications_count: 0,
        applications_in_progress: 0,
        finalists_count: 0,
      };
      MOCK_JOBS.push(newJob);
      alert(`✓ Puesto creado: ${newJob.title}\n\n(Modo demo — VITE_USE_API=false. Para persistir, prendé el toggle.)`);
      navigate(`/jobs/${newJob.id}`);
    } else if (mode === 'edit' && existing) {
      Object.assign(existing, payload);
      alert('✓ Cambios guardados (mock).');
      navigate(`/jobs/${existing.id}`);
    }
  }

  return (
    <div className="job-form-page">
      <Link to={mode === 'edit' && existing ? `/jobs/${existing.id}` : '/jobs'} className="back-link">
        ← {mode === 'edit' ? 'Volver al puesto' : 'Volver a Jobs'}
      </Link>

      <div className="page-header-row">
        <div>
          <h1 className="page-title">
            {mode === 'create' ? 'Nuevo puesto' : `Editar: ${existing?.title}`}
          </h1>
          <p className="page-subtitle">
            {mode === 'create'
              ? 'Definí el puesto y su perfil ideal. Después publicás y los candidatos pueden aplicar.'
              : 'Editá los campos. Los cambios se reflejan inmediatamente en pipeline y comparativos.'}
          </p>
        </div>
        <div className="job-form-undo-bar" role="group" aria-label="Historial">
          <button
            type="button"
            className="btn-toolbar"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer (⌘Z)"
            aria-label="Deshacer"
          >
            ↶ Deshacer
          </button>
          <button
            type="button"
            className="btn-toolbar"
            onClick={redo}
            disabled={!canRedo}
            title="Rehacer (⌘⇧Z)"
            aria-label="Rehacer"
          >
            ↷ Rehacer
          </button>
        </div>
      </div>

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
          <h2>Lo que verá el candidato en la oferta</h2>
          <p style={{ color: '#4b5563', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Si dejás vacío, se hereda automático del draft generado por IA (objetivo, responsabilidades, herramientas).
            Editá acá si querés cambiar lo que se publica en sharktalents.ai.
          </p>
          <Field label="Qué busco (1-2 frases del rol)">
            <textarea
              rows={2}
              maxLength={500}
              value={job.que_busco ?? ''}
              onChange={(e) => patch('que_busco', e.target.value)}
              placeholder="Líder de Desarrollo Backend para fintech panameña, lidera squad de 8 ingenieros y migración ISO 20022."
            />
          </Field>
          <Field label="Qué tiene que hacer (uno por línea, máx 6)">
            <textarea
              rows={5}
              value={(job.que_debe_hacer ?? []).join('\n')}
              onChange={(e) => patch('que_debe_hacer', e.target.value.split('\n').slice(0, 6))}
              placeholder={'Lidera squad de 8 ingenieros\nEjecuta migración ISO 20022 Q4\nReporta directamente al CTO'}
            />
          </Field>
          <Field label="Qué tiene que saber (uno por línea, máx 6)">
            <textarea
              rows={5}
              value={(job.que_debe_saber ?? []).join('\n')}
              onChange={(e) => patch('que_debe_saber', e.target.value.split('\n').slice(0, 6))}
              placeholder={'5+ años Node.js + PostgreSQL\nLiderazgo técnico de squads\nExperiencia en sistemas transaccionales'}
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
                onChange={(e) => {
                  const min = Number(e.target.value);
                  // Si max < min, sincronizamos max = min (caso típico: monto único)
                  const max = job.salary_range_usd.max < min ? min : job.salary_range_usd.max;
                  patch('salary_range_usd', { min, max });
                }}
              />
            </Field>
            <Field label="Salario max (USD/mes)">
              <input
                type="number"
                value={job.salary_range_usd.max}
                onChange={(e) => patch('salary_range_usd', { ...job.salary_range_usd, max: Number(e.target.value) })}
              />
              <small style={{ color: '#4b5563', fontSize: '0.75rem' }}>
                Si el cliente da un solo número, poné el mismo valor en min y max.
              </small>
            </Field>
            <Field label="Fee (calculado automático)">
              <input
                type="number"
                value={Math.round(job.salary_range_usd.max * FEE_MULTIPLIER)}
                readOnly
                disabled
                style={{ background: '#f3f4f6', color: '#1f2937' }}
              />
              <small style={{ color: '#4b5563', fontSize: '0.75rem' }}>
                Salario max × {FEE_MULTIPLIER} — se calcula al guardar el puesto.
              </small>
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
          <div className="job-form-grid-2">
            <Field label="Idioma del reporte cliente">
              <select
                value={job.report_lang ?? 'es'}
                onChange={(e) => patch('report_lang', e.target.value as 'es' | 'en')}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="job-form-section">
          <h2>Tests opcionales del candidato</h2>
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            Configurá qué tests adicionales corre el candidato según el puesto.
          </p>

          <Field label="Test de inglés">
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={!!job.english_required}
                onChange={(e) => patch('english_required', e.target.checked)}
              />
              <span>Requiere test de inglés</span>
            </label>
            {job.english_required && (
              <select
                value={job.english_min_level ?? 'B1'}
                onChange={(e) => patch('english_min_level', e.target.value as 'A2' | 'B1' | 'B2' | 'C1')}
              >
                <option value="A2">Comunicación básica — entiende y se hace entender</option>
                <option value="B1">Profesional intermedio — sostiene reuniones simples</option>
                <option value="B2">Profesional fluido — maneja discusiones complejas</option>
                <option value="C1">Avanzado — negocia, presenta, escribe formal</option>
              </select>
            )}
          </Field>

          <Field label="Test de mentalidades (adaptabilidad)">
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={job.mindset_test_enabled !== false}
                onChange={(e) => patch('mindset_test_enabled', e.target.checked)}
              />
              <span>Incluir test de mentalidades en la evaluación</span>
            </label>
            <p className="muted small" style={{ marginTop: '0.25rem' }}>
              10 preguntas situacionales (~7 min). El candidato no ve el nombre del test.
            </p>
          </Field>
        </section>

        <section className="job-form-section">
          <h2>Reglas de auto-rechazo (opcional)</h2>
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            Si seteás reglas, el sistema rechaza automáticamente al candidato cuando no las cumpla
            (sin que vos tengas que revisar). Dejá vacío si querés que todos los candidatos te lleguen
            para revisión manual.
          </p>
          <div className="job-form-grid-2">
            <Field label="Mínimo similitud DISC (%)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.auto_rejection_rules?.disc_min_similarity ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  patch('auto_rejection_rules', {
                    ...(job.auto_rejection_rules ?? {}),
                    disc_min_similarity: v,
                  });
                }}
                placeholder="ej: 60 (vacío = no aplicar)"
              />
            </Field>
            <Field label="Mínimo VELNA índice (%)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.auto_rejection_rules?.velna_min_indice ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  patch('auto_rejection_rules', {
                    ...(job.auto_rejection_rules ?? {}),
                    velna_min_indice: v,
                  });
                }}
                placeholder="ej: 50 (vacío = no aplicar)"
              />
            </Field>
            <Field label="Máximo riesgo integridad (%)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.auto_rejection_rules?.integridad_max_riesgo ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  patch('auto_rejection_rules', {
                    ...(job.auto_rejection_rules ?? {}),
                    integridad_max_riesgo: v,
                  });
                }}
                placeholder="ej: 30 (0=solo bajo, 100=todos pasan)"
              />
            </Field>
            <Field label="Mínimo emocional (score 0-100)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.auto_rejection_rules?.emo_min_score ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  patch('auto_rejection_rules', {
                    ...(job.auto_rejection_rules ?? {}),
                    emo_min_score: v,
                  });
                }}
                placeholder="ej: 40 (vacío = no aplicar)"
              />
            </Field>
            <Field label="Mínimo adaptabilidad (mindset, 0-100)">
              <input
                type="number"
                min={0}
                max={100}
                value={job.auto_rejection_rules?.mindset_min_adaptability ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  patch('auto_rejection_rules', {
                    ...(job.auto_rejection_rules ?? {}),
                    mindset_min_adaptability: v,
                  });
                }}
                placeholder="ej: 50 (vacío = no aplicar)"
              />
            </Field>
          </div>

          {job.english_required && (
            <Field label="Inglés">
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={!!job.auto_rejection_rules?.require_english_passed}
                  onChange={(e) =>
                    patch('auto_rejection_rules', {
                      ...(job.auto_rejection_rules ?? {}),
                      require_english_passed: e.target.checked,
                    })
                  }
                />
                <span>Auto-rechazar si NO pasa el test de inglés ({job.english_min_level})</span>
              </label>
            </Field>
          )}

          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            Un candidato es auto-rechazado si <strong>cualquiera</strong> de las reglas seteadas falla.
            Tu Cris recibe notificación y puede ver el detalle en el reporte.
          </p>
        </section>

        <section className="job-form-section">
          <h2>Estilo del jefe directo (opcional)</h2>
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            La prueba situacional de doble eje compara el estilo del candidato contra el del jefe.
            Si está vacío, el match queda neutral (no penaliza ni premia).
          </p>
          <div className="job-form-grid-2">
            <Field label="Nombre del jefe">
              <input
                type="text"
                value={job.boss?.name ?? ''}
                onChange={(e) => patch('boss', {
                  ...(job.boss ?? { name: '', role: '', style_autonomy_consult: 0.5 }),
                  name: e.target.value,
                })}
                placeholder="Carlos Pérez"
              />
            </Field>
            <Field label="Cargo">
              <input
                type="text"
                value={job.boss?.role ?? ''}
                onChange={(e) => patch('boss', {
                  ...(job.boss ?? { name: '', role: '', style_autonomy_consult: 0.5 }),
                  role: e.target.value,
                })}
                placeholder="Director de Tecnología"
              />
            </Field>
          </div>
          <Field label={`Estilo de delegación: ${formatStyle(job.boss?.style_autonomy_consult ?? 0.5)}`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((job.boss?.style_autonomy_consult ?? 0.5) * 100)}
              onChange={(e) => patch('boss', {
                ...(job.boss ?? { name: '', role: '', style_autonomy_consult: 0.5 }),
                style_autonomy_consult: Number(e.target.value) / 100,
              })}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--st-fg-muted)' }}>
              <span>0 · Quiere que consulten</span>
              <span>1 · Da autonomía</span>
            </div>
          </Field>
          <Field label="Cita de la transcripción (opcional)">
            <textarea
              value={job.boss?.evidence_quote ?? ''}
              onChange={(e) => patch('boss', {
                ...(job.boss ?? { name: '', role: '', style_autonomy_consult: 0.5 }),
                evidence_quote: e.target.value,
              })}
              rows={2}
              placeholder='"Yo no soy de los que estoy encima de cada decisión. Mejor que me traigan la propuesta."'
            />
          </Field>
        </section>

        {/* 2026-06-05: eliminada la segunda sección duplicada "Reglas de auto-rechazo"
            que usaba RejectionRule sliders. La sección de arriba (line 521) es la
            canónica — tiene 5 reglas + englés_required, la segunda solo 4 sin english. */}

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

        {mode === 'edit' && existing && (
          <section className="job-form-section">
            <h2>Prefilter (preguntas iniciales — opcional)</h2>
            <PrefilterQuestionsPanel jobId={existing.id} />
          </section>
        )}

        {submitError && (
          <div className="cd-alert cd-alert-warn" style={{ marginBottom: '0.75rem' }}>
            ⚠️ Error al guardar: {submitError}
          </div>
        )}

        <div className="job-form-actions">
          <Link to={mode === 'edit' && existing ? `/jobs/${existing.id}` : '/jobs'} className="cd-btn-ghost">
            Cancelar
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Guardando...' : (mode === 'create' ? 'Crear puesto' : 'Guardar cambios')}
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
