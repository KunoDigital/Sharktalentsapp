export type JobStatus = 'draft' | 'active' | 'paused' | 'closed';

export type DiscIdealProfile = {
  d: number;
  i: number;
  s: number;
  c: number;
  pk_profile_code: string;
  pk_profile_name: string;
  description: string[];
};

export type VelnaIdealProfile = {
  verbal: number;
  espacial: number;
  logica: number;
  numerica: number;
  abstracta: number;
};

export type IdealCompetencia = {
  name: string;
  required_pct: number;
};

export type Job = {
  id: string;
  slug: string;
  title: string;
  client_company: string;
  client_industry: string;
  location: string;
  status: JobStatus;
  created_at: string;
  applications_count: number;
  applications_in_progress: number;
  finalists_count: number;
  fee_usd: number;
  salary_range_usd: { min: number; max: number };
  // Perfil ideal del puesto
  disc_ideal_a: DiscIdealProfile;
  disc_ideal_b?: DiscIdealProfile; // opcional, perfil alternativo
  velna_ideal: VelnaIdealProfile;
  competencias_ideales: IdealCompetencia[];
  tecnica_minimo_pct: number;
  context: string; // contexto de la empresa
  // Perfil del jefe directo (doc 19) — para match estilo candidato↔jefe
  boss?: BossProfile;
  // Auto-rejection rules (doc 18) — si seteado, el sistema rechaza automático al fallar
  auto_rejection_rules?: AutoRejectionRules;
  // Idioma del reporte cliente (default 'es')
  report_lang?: 'es' | 'en';
  // Test de inglés (opcional por puesto) — ver doc 25
  english_required?: boolean;
  english_min_level?: 'A2' | 'B1' | 'B2' | 'C1';
  // Test de mentalidades (opcional por puesto, default true) — ver doc 26
  mindset_test_enabled?: boolean;
  // Campos públicos que el candidato ve en sharktalents.ai/jobs/:slug
  // Si no se llenan acá, se heredan del draft IA al aprobar (objetivo_cargo, responsabilidades, etc.)
  que_busco?: string;
  que_debe_hacer?: string[];
  que_debe_saber?: string[];
};

export type BossProfile = {
  name: string;
  role: string;
  /** 0-1: 0 = quiere que consulten, 1 = da autonomía */
  style_autonomy_consult: number;
  evidence_quote?: string;
};

/** Reglas de auto-rechazo del candidato según scores. Todas opcionales. */
export type AutoRejectionRules = {
  /** Mínimo de similitud DISC vs ideal (0-100). */
  disc_min_similarity?: number;
  /** Mínimo VELNA índice (0-100). */
  velna_min_indice?: number;
  /** Máximo % de riesgo integridad (0-100). 0=solo bajo permitido; 100=todos pasan. */
  integridad_max_riesgo?: number;
  /** Mínimo score emocional (0-100). */
  emo_min_score?: number;
  /** Si true, rechaza al candidato que no haya pasado el test de inglés (cuando el job lo requiere). */
  require_english_passed?: boolean;
  /** Mínimo score de adaptabilidad (0-100). Útil para puestos donde la mentalidad es crítica. */
  mindset_min_adaptability?: number;
};

const COMPETENCIAS_DEFAULT: IdealCompetencia[] = [
  { name: 'Resolución de problemas complejos', required_pct: 60 },
  { name: 'Adaptabilidad', required_pct: 60 },
  { name: 'Comunicación digital', required_pct: 60 },
  { name: 'Resiliencia, tolerancia al estrés y flexibilidad', required_pct: 60 },
  { name: 'Planificación', required_pct: 60 },
];

export const MOCK_JOBS: Job[] = [
  {
    id: 'job_1',
    slug: 'desarrollador-fullstack-senior',
    title: 'Desarrollador Fullstack Senior',
    client_company: 'AcmeTech Panamá',
    client_industry: 'SaaS B2B',
    location: 'Ciudad de Panamá (híbrido)',
    status: 'active',
    created_at: '2026-04-12',
    applications_count: 23,
    applications_in_progress: 8,
    finalists_count: 0,
    fee_usd: 4500,
    salary_range_usd: { min: 1500, max: 2500 },
    disc_ideal_a: {
      d: 70, i: 30, s: 40, c: 75,
      pk_profile_code: 'PK-07',
      pk_profile_name: 'Estructurado/a — Calidad',
      description: [
        'Revisa y verifica minuciosamente',
        'Conoce/se en ambientes estructurados',
        'Se comunica en base a datos',
      ],
    },
    velna_ideal: { verbal: 80, espacial: 70, logica: 85, numerica: 75, abstracta: 80 },
    competencias_ideales: COMPETENCIAS_DEFAULT,
    tecnica_minimo_pct: 60,
    context: 'AcmeTech es un SaaS B2B en LATAM. Buscan a alguien que pueda arquitectar features complejos, comunicarse con cliente directo y mantener la calidad del código. Equipo de 8 ingenieros.',
    english_required: true,
    english_min_level: 'B2',
    mindset_test_enabled: true,
  },
  {
    id: 'job_2',
    slug: 'gerente-comercial-banca',
    title: 'Gerente Comercial — Banca PyME',
    client_company: 'Banco Pacífico',
    client_industry: 'Banca',
    location: 'Ciudad de Panamá (presencial)',
    status: 'active',
    created_at: '2026-04-18',
    applications_count: 14,
    applications_in_progress: 5,
    finalists_count: 3,
    fee_usd: 6800,
    salary_range_usd: { min: 3000, max: 4500 },
    disc_ideal_a: {
      d: 75, i: 70, s: 30, c: 50,
      pk_profile_code: 'PK-03',
      pk_profile_name: 'Líder — Persuasivo',
      description: [
        'Alta orientación a resultados',
        'Persuasivo, construye relaciones rápido',
        'Toma decisiones bajo presión',
      ],
    },
    disc_ideal_b: {
      d: 60, i: 80, s: 40, c: 40,
      pk_profile_code: 'PK-04',
      pk_profile_name: 'Influyente — Carismático',
      description: [
        'Construye redes amplias',
        'Comunicador natural',
        'Más enfocado en relación que en proceso',
      ],
    },
    velna_ideal: { verbal: 85, espacial: 60, logica: 80, numerica: 90, abstracta: 70 },
    competencias_ideales: [
      { name: 'Negociación', required_pct: 80 },
      { name: 'Orientación al cliente', required_pct: 80 },
      { name: 'Análisis financiero', required_pct: 75 },
      { name: 'Liderazgo de equipos', required_pct: 70 },
      { name: 'Persuasión', required_pct: 75 },
    ],
    tecnica_minimo_pct: 70,
    context: 'Banco Pacífico expande su división PyME. Buscan gerente con cartera propia, dispuesto a viajar a interior. Resultados ligados a comisión.',
    english_required: false,
    mindset_test_enabled: true,
  },
  {
    id: 'job_3',
    slug: 'data-engineer-mid',
    title: 'Data Engineer (mid-level)',
    client_company: 'Fintech Caribe',
    client_industry: 'Fintech',
    location: 'Remoto LATAM',
    status: 'paused',
    created_at: '2026-03-30',
    applications_count: 31,
    applications_in_progress: 0,
    finalists_count: 0,
    fee_usd: 3800,
    salary_range_usd: { min: 1800, max: 2800 },
    disc_ideal_a: {
      d: 40, i: 20, s: 60, c: 80,
      pk_profile_code: 'PK-08',
      pk_profile_name: 'Preciso/a — Analítico/a — Calidad',
      description: [
        'Analítico, valora datos y precisión',
        'Sigue procedimientos',
        'Trabaja bien en autonomía',
      ],
    },
    velna_ideal: { verbal: 70, espacial: 75, logica: 90, numerica: 95, abstracta: 80 },
    competencias_ideales: COMPETENCIAS_DEFAULT,
    tecnica_minimo_pct: 65,
    context: 'Fintech Caribe procesa pagos en 5 países. Buscan data engineer con SQL avanzado, Python, dbt. Trabajo remoto, equipo distribuido.',
  },
  {
    id: 'job_4',
    slug: 'jefe-rrhh',
    title: 'Jefe de Recursos Humanos',
    client_company: 'Hotel Pacifica Resort',
    client_industry: 'Hotelería',
    location: 'Bocas del Toro',
    status: 'draft',
    created_at: '2026-04-25',
    applications_count: 0,
    applications_in_progress: 0,
    finalists_count: 0,
    fee_usd: 5200,
    salary_range_usd: { min: 2500, max: 3500 },
    disc_ideal_a: {
      d: 50, i: 70, s: 70, c: 40,
      pk_profile_code: 'PK-12',
      pk_profile_name: 'Empático/a — Coordinador/a',
      description: [
        'Empático, escucha activa',
        'Coordina equipos multiculturales',
        'Resuelve conflictos con calma',
      ],
    },
    velna_ideal: { verbal: 85, espacial: 60, logica: 70, numerica: 60, abstracta: 70 },
    competencias_ideales: COMPETENCIAS_DEFAULT,
    tecnica_minimo_pct: 50,
    context: 'Hotel Pacifica Resort, 200 colaboradores temporada alta. Necesitan jefe de RRHH para Bocas. Reto: rotación alta de temporada.',
  },
];

export function getJobById(id: string): Job | undefined {
  return MOCK_JOBS.find((j) => j.id === id);
}
