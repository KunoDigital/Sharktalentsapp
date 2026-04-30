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

export type BotMode = 'cold' | 'warm' | 'hot';

export type RagExample = {
  application_id: string;
  candidate_name: string;
  similarity_pct: number;
  outcome: string; // "Cris aprobó como finalista" / "Auto-rechazado" / etc.
};

export type BotDecisionDetail = {
  id: string;
  decided_at: string;
  stage: 'prefilter' | 'tecnica' | 'conductual' | 'integridad' | 'finalist';
  recommendation: string; // ej: "Avanzar a integridad"
  confidence: number; // 0-1
  threshold: number;
  mode: BotMode;
  rationale_text: string; // español plano, párrafo
  rationale_factors: { label: string; weight: number; signal: string }[];
  rag_examples: RagExample[];
  needs_review: boolean; // true si confidence < threshold
  auto_applied: boolean;
  admin_override?: {
    decided_at: string;
    by: string;
    decision: string;
    reason: string;
  };
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
  bot_decision?: BotDecisionDetail; // detalle completo cuando existe
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
    bot_decision: {
      id: 'bd_1',
      decided_at: '2026-04-19',
      stage: 'finalist',
      recommendation: 'Marcar como finalista',
      confidence: 0.89,
      threshold: 0.75,
      mode: 'warm',
      rationale_text:
        'Carla cumple los 4 criterios principales del puesto: técnica alta (87% > 60% mínimo), DISC similitud fuerte con perfil ideal A (78%), VELNA agregado 82% con perfil ideal, e integridad sin alertas. Su perfil D-Dominante con orientación a calidad calza con lo que busca AcmeTech. Aspiración salarial dentro del rango. No hay flags de anti-trampa. Recomiendo marcar como finalista con confidence alta.',
      rationale_factors: [
        { label: 'Técnica', weight: 0.25, signal: '87% (mínimo 60%) — fuerte' },
        { label: 'DISC similitud', weight: 0.25, signal: '78% (umbral ≥70%) — alineado' },
        { label: 'VELNA similitud', weight: 0.2, signal: '82% — sobre el ideal' },
        { label: 'Integridad', weight: 0.2, signal: 'Sin alertas en 15 dimensiones' },
        { label: 'Anti-trampa', weight: 0.1, signal: 'Cero eventos detectados' },
      ],
      rag_examples: [
        { application_id: 'app_42', candidate_name: 'María Vergara (puesto similar)', similarity_pct: 88, outcome: 'Cris aprobó como finalista, fue contratada' },
        { application_id: 'app_67', candidate_name: 'Pedro Aguilar (puesto similar)', similarity_pct: 82, outcome: 'Cris aprobó como finalista, declinó oferta' },
        { application_id: 'app_103', candidate_name: 'Sofía Reyes (puesto Fullstack)', similarity_pct: 79, outcome: 'Cris aprobó, contratada' },
      ],
      needs_review: false,
      auto_applied: true,
    },
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
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'duda_cv',
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
    tecnica: { pct: 93, estado: 'Aprobado', minimo_requerido_pct: 60 },
    anti_cheat_events: [
      { phase: 'conductual', type: 'cursor_out', question_id: 'DISC #5', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Espacial #2', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Numérico #1', duration_sec: 0 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'Numérico #6', duration_sec: 0 },
      { phase: 'conductual', type: 'window_blur', question_id: 'Abstracto #1', duration_sec: 3 },
      { phase: 'conductual', type: 'cursor_out', question_id: 'DISC #5', duration_sec: 0 },
    ],
    bot_confidence: 0.42,
    bot_recommendation: 'Necesito revisión humana',
    bot_decision: {
      id: 'bd_2',
      decided_at: '2026-04-21',
      stage: 'conductual',
      recommendation: 'Pausar y revisar CV — confianza insuficiente para avanzar solo',
      confidence: 0.42,
      threshold: 0.75,
      mode: 'warm',
      rationale_text:
        'Ariana presenta un patrón conflictivo que no puedo resolver sin tu input humano. Su técnica fue 93% (muy alta), pero su DISC similitud cayó a 35% (debajo del 70% mínimo) y detecté 6 eventos anti-trampa durante conductual (5 salidas de cursor + 1 ventana). Hipótesis: la diferencia entre técnica fuerte y conductual débil con tantas salidas sugiere posible asistencia externa en la técnica. No estoy seguro y prefiero que vos lo revises. Mi recomendación cautelosa: pedir CV detallado y entrevistar antes de avanzar a integridad. Si ves contexto que justifique el patrón (ej: ansiedad, distracción puntual), podés override.',
      rationale_factors: [
        { label: 'Técnica', weight: 0.25, signal: '93% — muy alta, sospechosa por contraste' },
        { label: 'DISC similitud', weight: 0.25, signal: '35% — debajo del umbral 70%' },
        { label: 'VELNA similitud', weight: 0.2, signal: '51% — bajo' },
        { label: 'Integridad', weight: 0.2, signal: 'No completada aún' },
        { label: 'Anti-trampa', weight: 0.1, signal: '6 eventos — flag alta' },
      ],
      rag_examples: [
        { application_id: 'app_88', candidate_name: 'Caso similar 1 (técnica alta + anti-trampa)', similarity_pct: 76, outcome: 'Cris pidió entrevista preliminar; resultó tener asistencia externa, rechazado' },
        { application_id: 'app_92', candidate_name: 'Caso similar 2 (DISC bajo pero CV fuerte)', similarity_pct: 71, outcome: 'Cris override y avanzó; ahora trabaja como senior dev' },
      ],
      needs_review: true,
      auto_applied: false,
    },
    ia_summary:
      'Ariana, 31 años. Técnica aprobada con 93% (excelente). Pasó a conductual donde DISC dio similitud 35% con perfil ideal y VELNA 51% (Verbal alto, Espacial/Lógica/Numérica bajos). Aspiración salarial $600/mes — debajo del rango. ⚠️ Anti-trampa: 6 salidas de pantalla durante conductual (5 cursor + 1 ventana). Patrón sospechoso: técnica fuerte pero conductual débil con muchas salidas → posible asistencia externa en técnica. Recomendación: revisar CV y entrevistar antes de avanzar a integridad.',
    timeline: [
      { at: '2026-04-19', actor: 'webhook', summary_text: 'Aplicó vía Recruit (hub gratis).', category: 'application' },
      { at: '2026-04-19', actor: 'system', summary_text: 'Prefiltro: salario aspirado $600 — debajo del rango sugerido para el puesto. Avanzó igual con flag.', category: 'alert' },
      { at: '2026-04-19', actor: 'system', summary_text: 'Email enviado: link a prueba técnica.', category: 'communication' },
      { at: '2026-04-20', actor: 'candidate', summary_text: 'Completó técnica: 93% (aprobada, mínimo 60%).', category: 'evaluation' },
      { at: '2026-04-20', actor: 'system', summary_text: 'Email enviado: link a evaluación conductual (DISC + VELNA + emoción).', category: 'communication' },
      { at: '2026-04-21', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 35%, VELNA 51%.', category: 'evaluation' },
      { at: '2026-04-21', actor: 'system', summary_text: 'Anti-trampa: 6 salidas de pantalla detectadas durante conductual. Flag levantado.', category: 'alert' },
      { at: '2026-04-21', actor: 'admin', summary_text: 'Cris marcó como "Duda — Revisar CV" antes de avanzar a integridad.', category: 'decision' },
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
    integridad: {
      dimensions: DEFAULT_INTEGRITY_DIMS.map((d) => ({ ...d, score_pct: d.score_pct ? Math.max(0, d.score_pct - 10) : null })),
      buena_impresion_alta: false,
      observations: [],
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
  {
    id: 'app_11',
    job_id: 'job_2',
    candidate_name: 'Patricia Núñez',
    candidate_email: 'pnunez@outlook.com',
    candidate_age: 42,
    candidate_phone: '+507 6333-4444',
    source: 'outbound_internal',
    state: 'finalist',
    applied_at: '2026-04-20',
    salary_aspiration_usd: 4200,
    disponibilidad: '15 días',
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'siguiente_etapa',
    integridad_state: 'llamar_entrevista',
    disc: {
      d: 55,
      i: 80,
      s: 45,
      c: 40,
      dominant_label: 'I — Influyente / Carismática',
      pk_profile_code: 'PK-04',
      pk_profile_name: 'Influyente — Carismático',
      similitud_pct: 86,
    },
    velna: {
      verbal: 92,
      espacial: 65,
      logica: 78,
      numerica: 85,
      abstracta: 72,
      similitud_pct: 84,
    },
    integridad: {
      dimensions: DEFAULT_INTEGRITY_DIMS.map((d) => ({ ...d, score_pct: d.score_pct ? Math.max(0, d.score_pct - 12) : null })),
      buena_impresion_alta: false,
      observations: [],
    },
    emocional: { value: 55, label: 'Mesura' },
    tecnica: { pct: 84, estado: 'Aprobado', minimo_requerido_pct: 70 },
    anti_cheat_events: [],
    bot_confidence: 0.86,
    bot_recommendation: 'Finalista fuerte — entrevistar',
    ia_summary:
      'Patricia, 42 años, I-Influyente carismática (similitud 86%). Cognitiva 84%, Verbal alto. Técnica 84%. Integridad limpia. Aspiración $4200 — en rango. 15 años experiencia banca. Bot: finalista (confidence 86%).',
    timeline: [
      { at: '2026-04-20', actor: 'webhook', summary_text: 'Llegó vía pool interno (sourcing).', category: 'application' },
      { at: '2026-04-21', actor: 'candidate', summary_text: 'Completó técnica: 84%.', category: 'evaluation' },
      { at: '2026-04-22', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 86%, VELNA 84%.', category: 'evaluation' },
      { at: '2026-04-23', actor: 'candidate', summary_text: 'Completó integridad: sin alertas.', category: 'evaluation' },
      { at: '2026-04-23', actor: 'bot', summary_text: 'Bot recomienda finalista (confidence 86%).', category: 'decision' },
    ],
  },
  {
    id: 'app_12',
    job_id: 'job_2',
    candidate_name: 'Alejandro Vega',
    candidate_email: 'alejov@gmail.com',
    candidate_age: 35,
    candidate_phone: '+507 6555-7777',
    source: 'recruit_free',
    state: 'finalist',
    applied_at: '2026-04-21',
    salary_aspiration_usd: 3200,
    disponibilidad: 'Totalmente disponible',
    tecnica_state: 'siguiente_etapa',
    conductual_state: 'siguiente_etapa',
    integridad_state: 'llamar_entrevista',
    disc: {
      d: 80,
      i: 50,
      s: 35,
      c: 60,
      dominant_label: 'D — Dominante / Calidad',
      pk_profile_code: 'PK-03',
      pk_profile_name: 'Líder — Persuasivo',
      similitud_pct: 81,
    },
    velna: {
      verbal: 78,
      espacial: 70,
      logica: 82,
      numerica: 88,
      abstracta: 75,
      similitud_pct: 79,
    },
    integridad: {
      dimensions: DEFAULT_INTEGRITY_DIMS.map((d) => ({ ...d, score_pct: d.score_pct ? Math.max(0, d.score_pct - 8) : null })),
      buena_impresion_alta: false,
      observations: [],
    },
    emocional: { value: 50, label: 'Mesura' },
    tecnica: { pct: 79, estado: 'Aprobado', minimo_requerido_pct: 70 },
    anti_cheat_events: [],
    bot_confidence: 0.81,
    bot_recommendation: 'Finalista — entrevistar',
    ia_summary:
      'Alejandro, 35 años, D-Dominante orientado a calidad (similitud 81%). Cognitiva 79%, Numérica fuerte. Técnica 79%. Integridad limpia. Aspiración $3200 — en rango. 8 años experiencia banca PyME. Bot: finalista (confidence 81%).',
    timeline: [
      { at: '2026-04-21', actor: 'webhook', summary_text: 'Aplicó vía Recruit (hub gratis).', category: 'application' },
      { at: '2026-04-22', actor: 'candidate', summary_text: 'Completó técnica: 79%.', category: 'evaluation' },
      { at: '2026-04-23', actor: 'candidate', summary_text: 'Completó conductual: DISC similitud 81%, VELNA 79%.', category: 'evaluation' },
      { at: '2026-04-24', actor: 'candidate', summary_text: 'Completó integridad: sin alertas.', category: 'evaluation' },
      { at: '2026-04-24', actor: 'bot', summary_text: 'Bot recomienda finalista (confidence 81%).', category: 'decision' },
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
