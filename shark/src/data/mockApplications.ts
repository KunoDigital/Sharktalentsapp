export type ApplicationState =
  | 'prefilter_pending'
  | 'prefilter_passed'
  | 'salary_out_of_range'
  | 'tecnica_completed'
  | 'conductual_completed'
  | 'integridad_completed'
  | 'videos_completed'
  | 'bot_decision_advance'
  | 'finalist'
  | 'offered'
  | 'hired'
  | 'auto_rejected_low_score'
  | 'rejected_by_admin';

export type ApplicationSource =
  | 'recruit_free'
  | 'linkedin_paid'
  | 'outbound_heyreach'
  | 'outbound_internal'
  | 'direct';

export type DiscScores = {
  d: number;
  i: number;
  s: number;
  c: number;
  dominant_label: string; // ej: "C — Cumplidor"
  pk_profile_code: string; // ej: "PK-08"
  pk_profile_name: string; // ej: "Preciso/a - Analítico/a - Calidad"
  similitud_pct: number; // 0-100 vs perfil ideal del puesto
};

export type VelnaScores = {
  verbal: number;
  espacial: number;
  logica: number;
  numerica: number;
  abstracta: number;
  similitud_pct: number;
};

export type IntegrityDimension = {
  name: string;
  classification: 'Bajo' | 'Medio' | 'Alto' | null;
  score_pct: number | null;
};

export type IntegrityScores = {
  dimensions: IntegrityDimension[];
  buena_impresion_alta: boolean; // flag deseabilidad social
  observations: string[];
};

export type EmotionalScore = {
  value: number; // 0-100, lower=espontáneo, higher=reflexivo
  label: 'Espontáneo' | 'Mesura' | 'Reflexivo';
};

export type TechnicalScore = {
  pct: number;
  estado: 'Aprobado' | 'Pendiente' | 'No aprobado';
  minimo_requerido_pct: number;
};

export type AntiCheatEvent = {
  phase: 'tecnica' | 'conductual' | 'integridad';
  type: 'cursor_out' | 'window_blur' | 'paste';
  question_id: string;
  duration_sec?: number;
};

export type TimelineEvent = {
  at: string; // ISO date
  actor: 'system' | 'admin' | 'bot' | 'candidate' | 'webhook';
  summary_text: string; // español plano, legible
  category: 'application' | 'evaluation' | 'decision' | 'communication' | 'alert';
};

export type Application = {
  id: string;
  job_id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_age: number;
  candidate_phone: string;
  source: ApplicationSource;
  state: ApplicationState;
  applied_at: string;
  salary_aspiration_usd: number;
  disponibilidad: string;
  // phase states (per-fase)
  tecnica_state: 'registrado' | 'en_progreso' | 'completado' | 'siguiente_etapa' | 'salario_fuera_rango' | 'rechazado';
  conductual_state: 'registrado' | 'en_progreso' | 'completado' | 'siguiente_etapa' | 'duda_cv' | 'rechazado';
  integridad_state: 'registrado' | 'en_progreso' | 'completado' | 'llamar_entrevista' | 'rechazado';
  // scores
  disc?: DiscScores;
  velna?: VelnaScores;
  integridad?: IntegrityScores;
  emocional?: EmotionalScore;
  tecnica?: TechnicalScore;
  // anti-trampa
  anti_cheat_events: AntiCheatEvent[];
  // bot
  bot_confidence?: number;
  bot_recommendation?: string;
  // ia summary (hardcoded mock; cuando haya backend, generado al cambiar de etapa)
  ia_summary: string;
  // timeline
  timeline: TimelineEvent[];
};

export const STATE_LABELS: Record<ApplicationState, string> = {
  prefilter_pending: 'Prefiltro pendiente',
  prefilter_passed: 'Prefiltro OK',
  salary_out_of_range: 'Salario fuera de rango',
  tecnica_completed: 'Técnica completa',
  conductual_completed: 'Conductual completa',
  integridad_completed: 'Integridad completa',
  videos_completed: 'Videos completos',
  bot_decision_advance: 'Bot recomienda avanzar',
  finalist: 'Finalista',
  offered: 'Oferta enviada',
  hired: 'Contratado',
  auto_rejected_low_score: 'Auto-rechazado (score bajo)',
  rejected_by_admin: 'Rechazado',
};

export const SOURCE_LABELS: Record<ApplicationSource, string> = {
  recruit_free: 'Recruit (hub gratis)',
  linkedin_paid: 'LinkedIn (Apply pago)',
  outbound_heyreach: 'Outbound HeyReach',
  outbound_internal: 'Pool interno',
  direct: 'Directo (web)',
};

const DEFAULT_INTEGRITY_DIMS: IntegrityDimension[] = [
  { name: 'Autenticidad', classification: 'Bajo', score_pct: 14 },
  { name: 'Inteligencia social', classification: 'Bajo', score_pct: 5 },
  { name: 'Imparcialidad', classification: 'Bajo', score_pct: 19 },
  { name: 'Sencillez', classification: 'Bajo', score_pct: 14 },
  { name: 'Dominio personal', classification: 'Medio', score_pct: 33 },
  { name: 'Honestidad', classification: 'Bajo', score_pct: 24 },
  { name: 'Hurto', classification: 'Bajo', score_pct: 10 },
  { name: 'Soborno', classification: 'Medio', score_pct: 28 },
  { name: 'Alcohol', classification: 'Bajo', score_pct: 11 },
  { name: 'Drogas', classification: 'Medio', score_pct: 25 },
  { name: 'Confiabilidad', classification: 'Bajo', score_pct: 24 },
  { name: 'Apuestas', classification: 'Bajo', score_pct: 6 },
  { name: 'Ética profesional', classification: null, score_pct: null },
  { name: 'Personalidad', classification: null, score_pct: null },
  { name: 'Buena impresión', classification: 'Alto', score_pct: 83 },
];

const PIPELINE_AcmeTech: Application[] = [
  {
    id: 'app_1',
    job_id: 'job_1',
    candidate_name: 'Carla Méndez',
    candidate_email: 'carla.m@gmail.com',
    candidate_age: 28,
    candidate_phone: '+507 6123-4567',
    source: 'linkedin_paid',
    state: 'finalist',
    applied_at: '2026-04-15',
    salary_aspiration_usd: 1800,
    disponibilidad: 'Totalmente disponible',
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'siguiente_etapa',
    integridad_state: 'llamar_entrevista',
    disc: {
      d: 65,
      i: 20,
      s: 47,
      c: 70,
      dominant_label: 'D — Dominante / Calidad',
      pk_profile_code: 'PK-07',
      pk_profile_name: 'Estructurado/a — Calidad',
      similitud_pct: 78,
    },
    velna: {
      verbal: 85,
      espacial: 72,
      logica: 80,
      numerica: 65,
      abstracta: 78,
      similitud_pct: 82,
    },
    integridad: {
      dimensions: DEFAULT_INTEGRITY_DIMS.map((d) => ({ ...d, score_pct: d.score_pct ? Math.max(0, d.score_pct - 5) : null })),
      buena_impresion_alta: false,
      observations: [],
    },
    emocional: { value: 65, label: 'Mesura' },
    tecnica: { pct: 87, estado: 'Aprobado', minimo_requerido_pct: 60 },
    anti_cheat_events: [],
    bot_confidence: 0.89,
    bot_recommendation: 'Avanzar a finalista',
    ia_summary:
      'Carla, 28 años, perfil D-Dominante con orientación a calidad (similitud 78% con perfil ideal). Cognitiva alta (82%), Verbal y Lógica fuertes. Técnica aprobada con 87%. Integridad sin alertas. Aspiración salarial $1800/mes — dentro del rango. Sin anti-trampa flags. Bot recomienda: avanzar a finalista (confidence 89%). Lista para entrevista 1:1.',
    timeline: [
      { at: '2026-04-15', actor: 'webhook', summary_text: 'Aplicó vía LinkedIn (Apply pago) al puesto Desarrollador Fullstack Senior.', category: 'application' },
      { at: '2026-04-15', actor: 'system', summary_text: 'Prefiltro automático: salario y disponibilidad en rango. Avanza a técnica.', category: 'evaluation' },
      { at: '2026-04-16', actor: 'candidate', summary_text: 'Completó prueba técnica: 87% (aprobada, mínimo 60%).', category: 'evaluation' },
      { at: '2026-04-17', actor: 'candidate', summary_text: 'Completó evaluación conductual: DISC similitud 78% con perfil ideal, VELNA 82%.', category: 'evaluation' },
      { at: '2026-04-18', actor: 'candidate', summary_text: 'Completó prueba de integridad: sin alertas en las 15 dimensiones.', category: 'evaluation' },
      { at: '2026-04-19', actor: 'bot', summary_text: 'Bot decisor recomienda avanzar a finalista (confidence 89%). Razón: técnica alta, DISC alineado, integridad limpia.', category: 'decision' },
      { at: '2026-04-19', actor: 'admin', summary_text: 'Cris confirmó: marca como finalista para entrevista 1:1.', category: 'decision' },
    ],
  },
  {
    id: 'app_2',
    job_id: 'job_1',
    candidate_name: 'Diego Salas',
    candidate_email: 'diego.salas@hotmail.com',
    candidate_age: 34,
    candidate_phone: '+507 6987-1234',
    source: 'recruit_free',
    state: 'tecnica_completed',
    applied_at: '2026-04-17',
    salary_aspiration_usd: 1500,
    disponibilidad: '15 días',
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'completado',
    integridad_state: 'registrado',
    disc: {
      d: 35,
      i: 25,
      s: 55,
      c: 75,
      dominant_label: 'C — Cumplidor / Sólido',
      pk_profile_code: 'PK-08',
      pk_profile_name: 'Preciso/a — Analítico/a — Calidad',
      similitud_pct: 62,
    },
    velna: {
      verbal: 70,
      espacial: 60,
      logica: 75,
      numerica: 80,
      abstracta: 65,
      similitud_pct: 71,
    },
    emocional: { value: 50, label: 'Mesura' },
    tecnica: { pct: 78, estado: 'Aprobado', minimo_requerido_pct: 60 },
    anti_cheat_events: [],
    ia_summary:
      'Diego, 34 años, perfil C-Cumplidor (similitud 62% — moderada). Cognitiva 71%, Numérica fuerte. Técnica aprobada con 78%. Integridad pendiente. Aspiración salarial $1500/mes — en rango. Sin anti-trampa flags. Pendiente: completar integridad antes de decidir.',
    timeline: [
      { at: '2026-04-17', actor: 'webhook', summary_text: 'Aplicó vía Recruit (hub gratis).', category: 'application' },
      { at: '2026-04-17', actor: 'system', summary_text: 'Prefiltro pasó. Avanza a técnica.', category: 'evaluation' },
      { at: '2026-04-18', actor: 'candidate', summary_text: 'Completó técnica: 78% (aprobada).', category: 'evaluation' },
      { at: '2026-04-19', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 62%, VELNA 71%.', category: 'evaluation' },
      { at: '2026-04-19', actor: 'system', summary_text: 'Email enviado: link a prueba de integridad.', category: 'communication' },
    ],
  },
  {
    id: 'app_3',
    job_id: 'job_1',
    candidate_name: 'Ariana Malo',
    candidate_email: 'arianamalo09@gmail.com',
    candidate_age: 31,
    candidate_phone: '+507 6555-2233',
    source: 'recruit_free',
    state: 'conductual_completed',
    applied_at: '2026-04-19',
    salary_aspiration_usd: 600,
    disponibilidad: 'Totalmente disponible',
    tecnica_state: 'completado',
    conductual_state: 'completado',
    integridad_state: 'registrado',
    disc: {
      d: 30,
      i: 5,
      s: 10,
      c: 100,
      dominant_label: 'C — Cumplidor / Calidad',
      pk_profile_code: 'PK-08',
      pk_profile_name: 'Preciso/a — Analítico/a — Calidad',
      similitud_pct: 35,
    },
    velna: {
      verbal: 95,
      espacial: 10,
      logica: 30,
      numerica: 35,
      abstracta: 85,
      similitud_pct: 51,
    },
    emocional: { value: 65, label: 'Mesura' },
    tecnica: { pct: 0, estado: 'Pendiente', minimo_requerido_pct: 60 },
    anti_cheat_events: [
      { phase: 'conductual', type: 'cursor_out', question_id: 'DISC #5', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Espacial #2', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Numérico #1', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Numérico #6', duration_sec: 0 },
      { phase: 'conductual', type: 'window_blur', question_id: 'Abstracto #1', duration_sec: 3 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'DISC #5', duration_sec: 0 },
    ],
    ia_summary:
      'Ariana, 31 años, perfil C-Cumplidor (similitud 35% — baja con perfil ideal). Cognitiva 51% (Verbal alto, Espacial muy bajo). Técnica pendiente de completar. Aspiración salarial $600/mes — debajo del rango del puesto. ⚠️ Anti-trampa: 6 salidas detectadas durante conductual (5 cursor + 1 ventana). Recomendación: revisar CV y considerar entrevistar antes de avanzar.',
    timeline: [
      { at: '2026-04-19', actor: 'webhook', summary_text: 'Aplicó vía Recruit (hub gratis).', category: 'application' },
      { at: '2026-04-19', actor: 'system', summary_text: 'Prefiltro: salario aspirado $600 — debajo del rango sugerido para el puesto. Avanzó igual con flag.', category: 'alert' },
      { at: '2026-04-20', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 35%, VELNA 51%.', category: 'evaluation' },
      { at: '2026-04-20', actor: 'system', summary_text: 'Anti-trampa: 6 salidas de pantalla detectadas durante conductual. Flag levantado.', category: 'alert' },
      { at: '2026-04-20', actor: 'system', summary_text: 'Email enviado: link a prueba técnica.', category: 'communication' },
    ],
  },
  {
    id: 'app_4',
    job_id: 'job_1',
    candidate_name: 'Roberto Wong',
    candidate_email: 'rwong@gmail.com',
    candidate_age: 26,
    candidate_phone: '+507 6111-9988',
    source: 'recruit_free',
    state: 'prefilter_passed',
    applied_at: '2026-04-21',
    salary_aspiration_usd: 1700,
    disponibilidad: '7 días',
    tecnica_state: 'registrado',
    conductual_state: 'registrado',
    integridad_state: 'registrado',
    anti_cheat_events: [],
    ia_summary:
      'Roberto, 26 años. Recién aplicó. Aspiración salarial $1700/mes — en rango. Prefiltro pasó. Pendiente: comenzar evaluaciones.',
    timeline: [
      { at: '2026-04-21', actor: 'webhook', summary_text: 'Aplicó vía Recruit (hub gratis).', category: 'application' },
      { at: '2026-04-21', actor: 'system', summary_text: 'Prefiltro pasó. Email con link a técnica enviado.', category: 'communication' },
    ],
  },
  {
    id: 'app_5',
    job_id: 'job_1',
    candidate_name: 'Marta Linares',
    candidate_email: 'mlinares@yahoo.com',
    candidate_age: 42,
    candidate_phone: '+507 6444-7788',
    source: 'direct',
    state: 'auto_rejected_low_score',
    applied_at: '2026-04-14',
    salary_aspiration_usd: 1600,
    disponibilidad: '30 días',
    tecnica_state: 'rechazado',
    conductual_state: 'registrado',
    integridad_state: 'registrado',
    tecnica: { pct: 42, estado: 'No aprobado', minimo_requerido_pct: 60 },
    anti_cheat_events: [],
    bot_confidence: 0.92,
    bot_recommendation: 'Auto-rechazar (técnica 42% < mínimo 60%)',
    ia_summary:
      'Marta, 42 años. Técnica 42% — debajo del mínimo requerido (60%). Bot auto-rechazó (confidence 92%). No avanza a otras fases.',
    timeline: [
      { at: '2026-04-14', actor: 'webhook', summary_text: 'Aplicó vía web directa.', category: 'application' },
      { at: '2026-04-14', actor: 'system', summary_text: 'Prefiltro pasó.', category: 'evaluation' },
      { at: '2026-04-15', actor: 'candidate', summary_text: 'Completó técnica: 42% (no aprobada, mínimo 60%).', category: 'evaluation' },
      { at: '2026-04-15', actor: 'bot', summary_text: 'Bot auto-rechazó (confidence 92%). Razón: técnica debajo del mínimo.', category: 'decision' },
      { at: '2026-04-15', actor: 'system', summary_text: 'Email de rechazo cordial enviado a la candidata.', category: 'communication' },
    ],
  },
];

const PIPELINE_BancoPacifico: Application[] = [
  {
    id: 'app_10',
    job_id: 'job_2',
    candidate_name: 'Luis Tejada',
    candidate_email: 'ltejada@gmail.com',
    candidate_age: 38,
    candidate_phone: '+507 6222-1111',
    source: 'linkedin_paid',
    state: 'finalist',
    applied_at: '2026-04-19',
    salary_aspiration_usd: 3500,
    disponibilidad: 'Totalmente disponible',
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'siguiente_etapa',
    integridad_state: 'llamar_entrevista',
    disc: {
      d: 75,
      i: 65,
      s: 30,
      c: 50,
      dominant_label: 'D — Dominante / Influyente',
      pk_profile_code: 'PK-03',
      pk_profile_name: 'Líder — Persuasivo',
      similitud_pct: 88,
    },
    velna: {
      verbal: 90,
      espacial: 75,
      logica: 88,
      numerica: 92,
      abstracta: 80,
      similitud_pct: 90,
    },
    emocional: { value: 35, label: 'Espontáneo' },
    tecnica: { pct: 91, estado: 'Aprobado', minimo_requerido_pct: 70 },
    anti_cheat_events: [],
    bot_confidence: 0.93,
    bot_recommendation: 'Top finalista — entrevistar primero',
    ia_summary:
      'Luis, 38 años, D-Dominante con alta influencia (similitud 88%). Cognitiva 90%, Numérica fuerte (92%). Técnica 91%. Integridad limpia. Aspiración $3500 — en rango. Bot: top finalista (confidence 93%). Recomienda entrevistar primero.',
    timeline: [
      { at: '2026-04-19', actor: 'webhook', summary_text: 'Aplicó vía LinkedIn (Apply pago) al puesto Gerente Comercial Banca PyME.', category: 'application' },
      { at: '2026-04-20', actor: 'candidate', summary_text: 'Completó técnica: 91%.', category: 'evaluation' },
      { at: '2026-04-21', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 88%, VELNA 90%.', category: 'evaluation' },
      { at: '2026-04-22', actor: 'candidate', summary_text: 'Completó integridad: sin alertas.', category: 'evaluation' },
      { at: '2026-04-22', actor: 'bot', summary_text: 'Bot recomienda top finalista (confidence 93%).', category: 'decision' },
      { at: '2026-04-23', actor: 'admin', summary_text: 'Cris confirmó top finalista. Pendiente entrevista 1:1.', category: 'decision' },
    ],
  },
];

export const MOCK_APPLICATIONS: Application[] = [...PIPELINE_AcmeTech, ...PIPELINE_BancoPacifico];

export function getApplicationsByJobId(jobId: string): Application[] {
  return MOCK_APPLICATIONS.filter((a) => a.job_id === jobId);
}

export function getApplicationById(id: string): Application | undefined {
  return MOCK_APPLICATIONS.find((a) => a.id === id);
}
