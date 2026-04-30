/**
 * Generador de candidatos random para mostrar la app con volumen real.
 * Persiste en localStorage; los archivos mock los combinan al import.
 */

import type { Application, ApplicationState, ApplicationSource } from '../data/mockApplications';

const FIRST_NAMES = [
  'María', 'Carlos', 'Ana', 'Luis', 'Sofía', 'Diego', 'Camila', 'Roberto',
  'Patricia', 'Andrés', 'Valentina', 'Mateo', 'Daniela', 'Sebastián', 'Lucía',
  'Gabriel', 'Isabella', 'Nicolás', 'Catalina', 'Felipe', 'Florencia', 'Joaquín',
  'Martina', 'Tomás', 'Renata', 'Javier', 'Antonella', 'Cristian', 'Paula',
  'Maximiliano', 'Emilia', 'Rodrigo', 'Constanza', 'Hugo', 'Agustina', 'Iván',
];

const LAST_NAMES = [
  'García', 'Rodríguez', 'González', 'Pérez', 'Martínez', 'López', 'Sánchez',
  'Ramírez', 'Cruz', 'Flores', 'Vargas', 'Castro', 'Ortiz', 'Romero', 'Torres',
  'Núñez', 'Reyes', 'Aguilar', 'Mendoza', 'Salazar', 'Herrera', 'Medina',
  'Rojas', 'Vega', 'Quintero', 'Díaz', 'Morales', 'Suárez', 'Ríos', 'Ortega',
  'Acosta', 'Luna', 'Silva', 'Méndez', 'Cabrera',
];

const STATES: ApplicationState[] = [
  'prefilter_pending', 'prefilter_passed', 'tecnica_completed',
  'conductual_completed', 'integridad_completed', 'finalist',
  'auto_rejected_low_score', 'rejected_by_admin', 'salary_out_of_range',
];

const SOURCES: ApplicationSource[] = [
  'recruit_free', 'linkedin_paid', 'outbound_heyreach', 'outbound_internal', 'direct',
];

const DISC_LABELS = [
  { d: 80, i: 30, s: 25, c: 50, label: 'D — Dominante / Líder', pk: 'PK-03', pkName: 'Líder — Persuasivo' },
  { d: 35, i: 80, s: 50, c: 30, label: 'I — Influyente / Carismático', pk: 'PK-04', pkName: 'Influyente — Carismático' },
  { d: 25, i: 40, s: 80, c: 50, label: 'S — Sólido / Estable', pk: 'PK-09', pkName: 'Estable — Servicial' },
  { d: 30, i: 25, s: 40, c: 85, label: 'C — Cumplidor / Analítico', pk: 'PK-08', pkName: 'Preciso/a — Analítico/a — Calidad' },
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateApplication(idx: number, jobIds: string[]): Application {
  const firstName = pickRandom(FIRST_NAMES);
  const lastName1 = pickRandom(LAST_NAMES);
  const lastName2 = pickRandom(LAST_NAMES);
  const fullName = `${firstName} ${lastName1} ${lastName2}`;
  const email = `${firstName.toLowerCase()}.${lastName1.toLowerCase()}${idx}@gmail.com`.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const jobId = pickRandom(jobIds);
  const state = pickRandom(STATES);
  const source = pickRandom(SOURCES);
  const age = randInt(22, 50);
  const salary = randInt(800, 5500);
  const discTemplate = pickRandom(DISC_LABELS);
  const noiseDisc = () => Math.max(0, Math.min(100, Math.round(Math.random() * 20 - 10)));

  // Estado phase derivado
  const tecnicaState = state === 'prefilter_pending' || state === 'prefilter_passed'
    ? 'registrado' as const
    : state === 'salary_out_of_range'
    ? 'salario_fuera_rango' as const
    : state === 'auto_rejected_low_score'
    ? 'rechazado' as const
    : 'siguiente_etapa' as const;

  const tecnicaPct = state === 'auto_rejected_low_score' ? randInt(30, 55) : randInt(60, 95);
  const discSimilitud = randInt(35, 90);
  const velnaPct = randInt(45, 92);

  const hasFullScores = ['conductual_completed', 'integridad_completed', 'finalist', 'rejected_by_admin'].includes(state);
  const hasIntegridad = ['integridad_completed', 'finalist'].includes(state);

  return {
    id: `demo_${idx}`,
    job_id: jobId,
    candidate_name: fullName,
    candidate_email: email,
    candidate_age: age,
    candidate_phone: `+507 6${randInt(100, 999)}-${randInt(1000, 9999)}`,
    source,
    state,
    applied_at: `2026-${String(randInt(2, 4)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
    salary_aspiration_usd: salary,
    disponibilidad: pickRandom(['Totalmente disponible', '7 días', '15 días', '30 días']),
    tecnica_state: tecnicaState,
    conductual_state: hasFullScores ? 'siguiente_etapa' : 'registrado',
    integridad_state: hasIntegridad ? (state === 'finalist' ? 'llamar_entrevista' : 'completado') : 'registrado',
    disc: hasFullScores ? {
      d: Math.max(0, Math.min(100, discTemplate.d + noiseDisc())),
      i: Math.max(0, Math.min(100, discTemplate.i + noiseDisc())),
      s: Math.max(0, Math.min(100, discTemplate.s + noiseDisc())),
      c: Math.max(0, Math.min(100, discTemplate.c + noiseDisc())),
      dominant_label: discTemplate.label,
      pk_profile_code: discTemplate.pk,
      pk_profile_name: discTemplate.pkName,
      similitud_pct: discSimilitud,
    } : undefined,
    velna: hasFullScores ? {
      verbal: randInt(40, 95),
      espacial: randInt(40, 90),
      logica: randInt(45, 92),
      numerica: randInt(35, 90),
      abstracta: randInt(40, 88),
      similitud_pct: velnaPct,
    } : undefined,
    emocional: hasFullScores ? {
      value: randInt(20, 85),
      label: pickRandom(['Espontáneo', 'Mesura', 'Reflexivo']),
    } : undefined,
    tecnica: state !== 'prefilter_pending' && state !== 'prefilter_passed' ? {
      pct: tecnicaPct,
      estado: tecnicaPct >= 60 ? 'Aprobado' : tecnicaPct >= 40 ? 'Pendiente' : 'No aprobado',
      minimo_requerido_pct: 60,
    } : undefined,
    anti_cheat_events: Math.random() < 0.15 ? [
      { phase: pickRandom(['tecnica', 'conductual'] as const), type: 'cursor_out', question_id: 'q-rand', duration_sec: 0 },
    ] : [],
    bot_confidence: hasFullScores ? Math.round((0.4 + Math.random() * 0.55) * 100) / 100 : undefined,
    bot_recommendation: hasFullScores ? (state === 'finalist' ? 'Top finalista' : 'Esperar más data') : undefined,
    ia_summary: `${firstName}, ${age} años. ${discTemplate.label.split('—')[0].trim()}. Aspiración salarial $${salary}/mes. ${state === 'finalist' ? 'Pasó todas las pruebas, listo para entrevista.' : state === 'auto_rejected_low_score' ? 'Auto-rechazado por bot.' : 'En proceso de evaluación.'}`,
    timeline: [
      { at: `2026-04-${String(randInt(1, 28)).padStart(2, '0')}`, actor: 'webhook', summary_text: `Aplicó vía ${SOURCES.includes(source) ? source : 'web'}.`, category: 'application' },
    ],
  };
}

const STORAGE_KEY = 'demo_applications';

export function generateDemoApplications(count: number, jobIds: string[]): void {
  const apps = Array.from({ length: count }, (_, i) => generateApplication(i + 1, jobIds));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

export function clearDemoApplications(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getDemoApplications(): Application[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Application[];
  } catch {
    return [];
  }
}

export function getDemoCount(): number {
  return getDemoApplications().length;
}
