import type { ApiJob } from './api';
import type {
  Job, JobStatus, DiscIdealProfile, VelnaIdealProfile, BossProfile, AutoRejectionRules,
  IdealCompetencia,
} from '../data/mockJobs';

/**
 * Convierte un ApiJob del backend al shape `Job` que usa JobForm/JobDetail en el frontend.
 *
 * El backend devuelve `ideal_profile` como JSON string. Acá lo parseamos y mapeamos cada sub-campo
 * al field correspondiente del frontend. Si el JSON es inválido o falta un campo, defaulteamos
 * a valores razonables (DiscIdealProfile centrado en 50, VelnaIdealProfile con valores neutros).
 *
 * Counts (applications_count, etc) se setean en 0 — JobForm no los usa, solo JobDetail los muestra.
 */

const DEFAULT_DISC: DiscIdealProfile = {
  d: 50, i: 50, s: 50, c: 50,
  pk_profile_code: '', pk_profile_name: '', description: [],
};

const DEFAULT_VELNA: VelnaIdealProfile = {
  verbal: 70, espacial: 65, logica: 75, numerica: 70, abstracta: 70,
};

type IdealProfileParsed = {
  disc?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  disc_b?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  velna?: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  competencias?: Array<{ name?: string; id?: string; required_pct?: number }>;
  tecnica_minimo_pct?: number;
  context_summary?: string;
  boss?: { name?: string; role?: string; style_autonomy_consult?: number; evidence_quote?: string };
  auto_rejection_rules?: Record<string, number | boolean>;
  report_lang?: 'es' | 'en';
  english_required?: boolean;
  english_min_level?: 'A2' | 'B1' | 'B2' | 'C1';
  mindset_test_enabled?: boolean;
  salary_range_usd?: { min?: number; max?: number };
  que_busco?: string;
  que_debe_hacer?: string[];
  que_debe_saber?: string[];
};

function parseIdealProfile(raw: string | null | undefined): IdealProfileParsed {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as IdealProfileParsed;
  } catch {
    return {};
  }
}

function discFromApi(d: NonNullable<IdealProfileParsed['disc']>): DiscIdealProfile {
  return {
    d: Number(d.d) || 0,
    i: Number(d.i) || 0,
    s: Number(d.s) || 0,
    c: Number(d.c) || 0,
    pk_profile_code: d.pk_code ?? '',
    pk_profile_name: d.pk_name ?? '',
    description: [],
  };
}

export function apiJobToFormJob(apiJob: ApiJob): Job {
  const ideal = parseIdealProfile(apiJob.ideal_profile);

  const status: JobStatus = apiJob.is_active ? 'active' : 'paused';

  const disc_ideal_a: DiscIdealProfile = ideal.disc ? discFromApi(ideal.disc) : DEFAULT_DISC;
  const disc_ideal_b: DiscIdealProfile | undefined = ideal.disc_b ? discFromApi(ideal.disc_b) : undefined;

  const velna_ideal: VelnaIdealProfile = ideal.velna
    ? {
        verbal: Number(ideal.velna.verbal) || DEFAULT_VELNA.verbal,
        espacial: Number(ideal.velna.espacial) || DEFAULT_VELNA.espacial,
        logica: Number(ideal.velna.logica) || DEFAULT_VELNA.logica,
        numerica: Number(ideal.velna.numerica) || DEFAULT_VELNA.numerica,
        abstracta: Number(ideal.velna.abstracta) || DEFAULT_VELNA.abstracta,
      }
    : DEFAULT_VELNA;

  const competencias_ideales: IdealCompetencia[] = Array.isArray(ideal.competencias)
    ? ideal.competencias
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          name: c.name ?? c.id ?? '',
          required_pct: Number(c.required_pct) || 0,
        }))
        .filter((c) => c.name.length > 0)
    : [];

  const boss: BossProfile | undefined = ideal.boss && ideal.boss.name
    ? {
        name: ideal.boss.name,
        role: ideal.boss.role ?? '',
        style_autonomy_consult: typeof ideal.boss.style_autonomy_consult === 'number'
          ? ideal.boss.style_autonomy_consult
          : 0.5,
        evidence_quote: ideal.boss.evidence_quote,
      }
    : undefined;

  const auto_rejection_rules: AutoRejectionRules | undefined = ideal.auto_rejection_rules
    ? (() => {
        const r = ideal.auto_rejection_rules as Record<string, unknown>;
        const vpdRaw = r.velna_per_dimension as Record<string, unknown> | undefined;
        const velna_per_dimension = vpdRaw ? {
          verbal: typeof vpdRaw.verbal === 'number' ? vpdRaw.verbal : undefined,
          espacial: typeof vpdRaw.espacial === 'number' ? vpdRaw.espacial : undefined,
          logica: typeof vpdRaw.logica === 'number' ? vpdRaw.logica : undefined,
          numerica: typeof vpdRaw.numerica === 'number' ? vpdRaw.numerica : undefined,
          abstracta: typeof vpdRaw.abstracta === 'number' ? vpdRaw.abstracta : undefined,
        } : undefined;
        return {
          disc_min_similarity: typeof r.disc_min_similarity === 'number' ? r.disc_min_similarity : undefined,
          velna_min_indice: typeof r.velna_min_indice === 'number' ? r.velna_min_indice : undefined,
          integridad_max_riesgo: typeof r.integridad_max_riesgo === 'number' ? r.integridad_max_riesgo : undefined,
          emo_min_score: typeof r.emo_min_score === 'number' ? r.emo_min_score : undefined,
          require_english_passed: typeof r.require_english_passed === 'boolean' ? r.require_english_passed : undefined,
          mindset_min_adaptability: typeof r.mindset_min_adaptability === 'number' ? r.mindset_min_adaptability : undefined,
          velna_per_dimension,
        };
      })()
    : undefined;

  const salary_range_usd = ideal.salary_range_usd
    ? {
        min: Number(ideal.salary_range_usd.min) || 0,
        max: Number(ideal.salary_range_usd.max) || 0,
      }
    : { min: 0, max: 0 };

  return {
    id: apiJob.ROWID,
    // slug no se devuelve en /api/jobs/:id (no es editable). Para el form se ignora.
    slug: '',
    title: apiJob.title,
    client_company: apiJob.company,
    client_industry: '',
    location: '',
    status,
    created_at: apiJob.created_at,
    applications_count: 0,
    applications_in_progress: 0,
    finalists_count: 0,
    fee_usd: typeof apiJob.fee_usd === 'number' ? apiJob.fee_usd : 0,
    salary_range_usd,
    disc_ideal_a,
    disc_ideal_b,
    velna_ideal,
    competencias_ideales,
    tecnica_minimo_pct: typeof ideal.tecnica_minimo_pct === 'number' ? ideal.tecnica_minimo_pct : 70,
    context: ideal.context_summary ?? apiJob.company_context ?? '',
    boss,
    auto_rejection_rules,
    report_lang: ideal.report_lang ?? 'es',
    english_required: ideal.english_required ?? false,
    english_min_level: ideal.english_min_level,
    mindset_test_enabled: ideal.mindset_test_enabled ?? true,
    que_busco: ideal.que_busco,
    que_debe_hacer: ideal.que_debe_hacer,
    que_debe_saber: ideal.que_debe_saber,
  };
}
