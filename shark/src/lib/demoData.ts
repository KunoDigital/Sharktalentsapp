/**
 * Generador de candidatos demo realistas para presentaciones a clientes.
 * Persiste en localStorage; los archivos mock los combinan al import.
 *
 * Distribuciones balanceadas (ponderadas, no random uniforme):
 * - 35% en evaluación (en_progreso o completado)
 * - 25% finalistas
 * - 15% auto-rechazados
 * - 10% rechazados por admin
 * - 10% prefilter pendiente
 * - 5% salario fuera de rango
 *
 * Cada candidato lleva timeline coherente con su estado actual.
 */

import type {
  Application,
  ApplicationState,
  ApplicationSource,
  TimelineEvent,
  BotDecisionDetail,
} from '../data/mockApplications';

const FIRST_NAMES = [
  'María', 'Carlos', 'Ana', 'Luis', 'Sofía', 'Diego', 'Camila', 'Roberto',
  'Patricia', 'Andrés', 'Valentina', 'Mateo', 'Daniela', 'Sebastián', 'Lucía',
  'Gabriel', 'Isabella', 'Nicolás', 'Catalina', 'Felipe', 'Florencia', 'Joaquín',
  'Martina', 'Tomás', 'Renata', 'Javier', 'Antonella', 'Cristian', 'Paula',
  'Maximiliano', 'Emilia', 'Rodrigo', 'Constanza', 'Hugo', 'Agustina', 'Iván',
  'Camilo', 'Gabriela', 'Manuel', 'Adriana', 'Pedro', 'Jimena', 'Esteban',
];

const LAST_NAMES = [
  'García', 'Rodríguez', 'González', 'Pérez', 'Martínez', 'López', 'Sánchez',
  'Ramírez', 'Cruz', 'Flores', 'Vargas', 'Castro', 'Ortiz', 'Romero', 'Torres',
  'Núñez', 'Reyes', 'Aguilar', 'Mendoza', 'Salazar', 'Herrera', 'Medina',
  'Rojas', 'Vega', 'Quintero', 'Díaz', 'Morales', 'Suárez', 'Ríos', 'Ortega',
  'Acosta', 'Luna', 'Silva', 'Méndez', 'Cabrera', 'Padilla', 'Espinoza',
];

// Distribución ponderada de estados (suma 100)
const STATE_WEIGHTS: { state: ApplicationState; weight: number }[] = [
  { state: 'finalist', weight: 18 },
  { state: 'integridad_completed', weight: 12 },
  { state: 'conductual_completed', weight: 15 },
  { state: 'tecnica_completed', weight: 15 },
  { state: 'prefilter_passed', weight: 10 },
  { state: 'prefilter_pending', weight: 8 },
  { state: 'auto_rejected_low_score', weight: 12 },
  { state: 'rejected_by_admin', weight: 5 },
  { state: 'salary_out_of_range', weight: 5 },
];

const SOURCE_WEIGHTS: { source: ApplicationSource; weight: number }[] = [
  { source: 'recruit_free', weight: 35 },
  { source: 'linkedin_paid', weight: 25 },
  { source: 'outbound_heyreach', weight: 20 },
  { source: 'outbound_internal', weight: 12 },
  { source: 'direct', weight: 8 },
];

const DISC_TEMPLATES = [
  { d: 80, i: 30, s: 25, c: 50, label: 'D — Dominante / Líder', pk: 'PK-03', pkName: 'Líder — Persuasivo' },
  { d: 35, i: 80, s: 50, c: 30, label: 'I — Influyente / Carismático', pk: 'PK-04', pkName: 'Influyente — Carismático' },
  { d: 25, i: 40, s: 80, c: 50, label: 'S — Sólido / Estable', pk: 'PK-09', pkName: 'Estable — Servicial' },
  { d: 30, i: 25, s: 40, c: 85, label: 'C — Cumplidor / Analítico', pk: 'PK-08', pkName: 'Preciso/a — Analítico/a — Calidad' },
  { d: 65, i: 60, s: 35, c: 50, label: 'D-I — Híbrido líder/influyente', pk: 'PK-05', pkName: 'Persuasivo — Energético' },
  { d: 30, i: 70, s: 60, c: 40, label: 'I-S — Carismático estable', pk: 'PK-06', pkName: 'Diplomático — Influyente' },
];

const DISPONIBILIDAD = ['Totalmente disponible', '7 días', '15 días', '30 días', '60 días'];

function pickWeighted<T>(items: { weight: number }[] & T[]): T {
  const total = items.reduce((s, i) => s + (i as { weight: number }).weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= (it as { weight: number }).weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgoMin: number, daysAgoMax: number): string {
  const today = new Date('2026-04-30');
  const daysAgo = randInt(daysAgoMin, daysAgoMax);
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function buildTimeline(
  state: ApplicationState,
  source: ApplicationSource,
  appliedAt: string,
  hasAntiCheat: boolean,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const sourceLabel: Record<ApplicationSource, string> = {
    recruit_free: 'Recruit (hub gratis)',
    linkedin_paid: 'LinkedIn (Apply pago)',
    outbound_heyreach: 'HeyReach outbound',
    outbound_internal: 'pool interno',
    direct: 'web directa',
  };
  events.push({ at: appliedAt, actor: 'webhook', summary_text: `Aplicó vía ${sourceLabel[source]}.`, category: 'application' });

  if (state === 'salary_out_of_range') {
    events.push({ at: appliedAt, actor: 'system', summary_text: 'Prefiltro: salario aspirado fuera de rango. Pausado.', category: 'alert' });
    return events;
  }
  if (state === 'prefilter_pending') return events;

  events.push({ at: appliedAt, actor: 'system', summary_text: 'Prefiltro OK. Email con link a técnica enviado.', category: 'communication' });

  if (state === 'prefilter_passed') return events;

  // Avanzaron a técnica
  events.push({ at: appliedAt, actor: 'candidate', summary_text: 'Completó prueba técnica.', category: 'evaluation' });

  if (state === 'auto_rejected_low_score') {
    events.push({ at: appliedAt, actor: 'bot', summary_text: 'Bot auto-rechazó: técnica debajo del mínimo.', category: 'decision' });
    events.push({ at: appliedAt, actor: 'system', summary_text: 'Email de rechazo cordial enviado.', category: 'communication' });
    return events;
  }

  if (state === 'tecnica_completed') return events;

  events.push({ at: appliedAt, actor: 'candidate', summary_text: 'Completó evaluación conductual (DISC + VELNA + emoción).', category: 'evaluation' });
  if (hasAntiCheat) {
    events.push({ at: appliedAt, actor: 'system', summary_text: 'Anti-trampa: salidas de pantalla detectadas. Flag levantado.', category: 'alert' });
  }

  if (state === 'conductual_completed') return events;

  events.push({ at: appliedAt, actor: 'candidate', summary_text: 'Completó prueba de integridad.', category: 'evaluation' });

  if (state === 'integridad_completed') return events;

  if (state === 'finalist') {
    events.push({ at: appliedAt, actor: 'bot', summary_text: 'Bot recomienda avanzar a finalista (confidence alta).', category: 'decision' });
    events.push({ at: appliedAt, actor: 'admin', summary_text: 'Cris confirmó como finalista. Pendiente entrevista.', category: 'decision' });
    return events;
  }

  if (state === 'rejected_by_admin') {
    events.push({ at: appliedAt, actor: 'admin', summary_text: 'Cris rechazó manualmente — no calza con el perfil.', category: 'decision' });
    return events;
  }

  return events;
}

function buildBotDecision(
  state: ApplicationState,
  candidateName: string,
  techPct: number,
  discSim: number,
  hasAntiCheat: boolean,
): BotDecisionDetail | undefined {
  if (!['finalist', 'integridad_completed', 'auto_rejected_low_score', 'rejected_by_admin'].includes(state)) {
    return undefined;
  }

  if (state === 'auto_rejected_low_score') {
    return {
      id: `bd_demo_${Math.random().toString(36).slice(2, 8)}`,
      decided_at: '2026-04-20',
      stage: 'tecnica',
      recommendation: 'Auto-rechazar — técnica debajo del mínimo',
      confidence: 0.88 + Math.random() * 0.1,
      threshold: 0.75,
      mode: 'warm',
      rationale_text: `${candidateName} obtuvo ${techPct}% en técnica, debajo del mínimo requerido. Auto-rechazado con alta confianza.`,
      rationale_factors: [
        { label: 'Técnica', weight: 0.6, signal: `${techPct}% (debajo del mínimo)` },
        { label: 'Histórico de casos similares', weight: 0.4, signal: 'Outcome consistente: no avanzan' },
      ],
      rag_examples: [],
      needs_review: false,
      auto_applied: true,
    };
  }

  if (state === 'finalist') {
    return {
      id: `bd_demo_${Math.random().toString(36).slice(2, 8)}`,
      decided_at: '2026-04-22',
      stage: 'finalist',
      recommendation: 'Avanzar a finalista',
      confidence: 0.78 + Math.random() * 0.18,
      threshold: 0.75,
      mode: 'warm',
      rationale_text: `${candidateName} cumple criterios principales: técnica ${techPct}% (sobre mínimo), DISC similitud ${discSim}% con perfil ideal, integridad sin alertas. Recomiendo avanzar a finalista.`,
      rationale_factors: [
        { label: 'Técnica', weight: 0.25, signal: `${techPct}% — sólida` },
        { label: 'DISC similitud', weight: 0.25, signal: `${discSim}% — alineado` },
        { label: 'Integridad', weight: 0.2, signal: 'Sin alertas' },
        { label: 'Anti-trampa', weight: 0.1, signal: hasAntiCheat ? 'Eventos detectados' : 'Sin eventos' },
      ],
      rag_examples: [
        { application_id: 'app_42', candidate_name: 'Caso similar (mismo puesto)', similarity_pct: 80 + randInt(0, 15), outcome: 'Cris aprobó, fue contratado/a' },
      ],
      needs_review: hasAntiCheat,
      auto_applied: !hasAntiCheat,
    };
  }

  return undefined;
}

function generateApplication(idx: number, jobIds: string[]): Application {
  const firstName = pickRandom(FIRST_NAMES);
  const lastName1 = pickRandom(LAST_NAMES);
  const lastName2 = pickRandom(LAST_NAMES);
  const fullName = `${firstName} ${lastName1} ${lastName2}`;
  const email = `${firstName.toLowerCase()}.${lastName1.toLowerCase()}${idx}@gmail.com`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const jobId = pickRandom(jobIds);
  const stateEntry = pickWeighted(STATE_WEIGHTS as never);
  const state = (stateEntry as { state: ApplicationState }).state;
  const sourceEntry = pickWeighted(SOURCE_WEIGHTS as never);
  const source = (sourceEntry as { source: ApplicationSource }).source;
  const age = randInt(22, 50);
  const salary = state === 'salary_out_of_range' ? randInt(400, 900) : randInt(1100, 5500);
  const discTemplate = pickRandom(DISC_TEMPLATES);
  const noiseDisc = () => Math.round(Math.random() * 20 - 10);

  const tecnicaState =
    state === 'prefilter_pending' ? ('registrado' as const) :
    state === 'prefilter_passed' ? ('en_progreso' as const) :
    state === 'salary_out_of_range' ? ('salario_fuera_rango' as const) :
    state === 'auto_rejected_low_score' ? ('rechazado' as const) :
    ('siguiente_etapa' as const);

  const tecnicaPct = state === 'auto_rejected_low_score' ? randInt(25, 55) :
                     state === 'finalist' ? randInt(78, 96) :
                     state === 'tecnica_completed' || state === 'conductual_completed' || state === 'integridad_completed' ? randInt(60, 92) :
                     state === 'prefilter_passed' ? 0 : 0;

  const discSimilitud = state === 'finalist' ? randInt(72, 94) : randInt(38, 88);
  const velnaPct = state === 'finalist' ? randInt(70, 92) : randInt(45, 88);

  const hasFullScores = ['conductual_completed', 'integridad_completed', 'finalist', 'rejected_by_admin'].includes(state);
  const hasIntegridad = ['integridad_completed', 'finalist'].includes(state);
  const hasAntiCheat = Math.random() < (state === 'finalist' ? 0.05 : 0.18);
  const appliedAt = randomDate(state === 'finalist' ? 8 : state === 'prefilter_pending' ? 0 : 4, 25);

  const conductualState = hasFullScores
    ? (hasAntiCheat && state !== 'finalist' ? 'duda_cv' as const : 'siguiente_etapa' as const)
    : 'registrado' as const;
  const integridadState = hasIntegridad
    ? (state === 'finalist' ? 'llamar_entrevista' as const : 'completado' as const)
    : 'registrado' as const;

  const antiCheatEvents = hasAntiCheat ? [
    { phase: pickRandom(['tecnica', 'conductual'] as const), type: pickRandom(['cursor_out', 'window_blur', 'paste'] as const), question_id: `q-${randInt(1, 20)}`, duration_sec: randInt(0, 5) },
    ...(Math.random() < 0.4 ? [{ phase: 'conductual' as const, type: 'cursor_out' as const, question_id: `q-${randInt(1, 20)}`, duration_sec: 0 }] : []),
  ] : [];

  const botDecision = buildBotDecision(state, fullName, tecnicaPct, discSimilitud, hasAntiCheat);

  return {
    id: `demo_${idx}`,
    job_id: jobId,
    candidate_name: fullName,
    candidate_email: email,
    candidate_age: age,
    candidate_phone: `+507 6${randInt(100, 999)}-${randInt(1000, 9999)}`,
    source,
    state,
    applied_at: appliedAt,
    salary_aspiration_usd: salary,
    disponibilidad: pickRandom(DISPONIBILIDAD),
    tecnica_state: tecnicaState,
    conductual_state: conductualState,
    integridad_state: integridadState,
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
    tecnica: tecnicaState !== 'registrado' && tecnicaState !== 'en_progreso' && tecnicaState !== 'salario_fuera_rango' ? {
      pct: tecnicaPct,
      estado: tecnicaPct >= 60 ? 'Aprobado' : tecnicaPct >= 40 ? 'Pendiente' : 'No aprobado',
      minimo_requerido_pct: 60,
    } : undefined,
    anti_cheat_events: antiCheatEvents,
    bot_confidence: botDecision?.confidence,
    bot_recommendation: botDecision?.recommendation,
    bot_decision: botDecision,
    ia_summary: buildIaSummary(firstName, age, discTemplate.label, salary, state, tecnicaPct),
    timeline: buildTimeline(state, source, appliedAt, hasAntiCheat),
  };
}

function buildIaSummary(
  firstName: string,
  age: number,
  discLabel: string,
  salary: number,
  state: ApplicationState,
  techPct: number,
): string {
  const discAxis = discLabel.split('—')[0].trim();
  const stateText: Record<string, string> = {
    finalist: 'Pasó todas las pruebas, listo para entrevista 1:1.',
    integridad_completed: 'Pasó integridad. Pendiente decisión final.',
    conductual_completed: 'Pasó conductual. Pendiente integridad.',
    tecnica_completed: `Técnica aprobada (${techPct}%). Pendiente conductual.`,
    prefilter_passed: 'Prefiltro pasado. Pendiente comenzar técnica.',
    prefilter_pending: 'Recién aplicó. Prefiltro pendiente.',
    auto_rejected_low_score: `Auto-rechazado por bot — técnica ${techPct}% < mínimo.`,
    rejected_by_admin: 'Rechazado manualmente por Cris.',
    salary_out_of_range: `Aspiración $${salary} fuera de rango sugerido.`,
  };
  return `${firstName}, ${age} años. ${discAxis}. Aspiración salarial $${salary}/mes. ${stateText[state] ?? 'En proceso.'}`;
}

const STORAGE_KEY = 'demo_applications';

export type DemoPreset = 'small' | 'medium' | 'large' | 'showcase';

const PRESET_COUNTS: Record<DemoPreset, number> = {
  small: 15,
  medium: 40,
  large: 100,
  showcase: 60,
};

export const PRESET_LABELS: Record<DemoPreset, { title: string; desc: string }> = {
  small: {
    title: 'Dataset chico (15)',
    desc: 'Para probar UI sin saturar. 15 candidatos distribuidos entre los 4 puestos.',
  },
  medium: {
    title: 'Dataset mediano (40)',
    desc: 'Volumen razonable para mostrar charts con data significativa.',
  },
  large: {
    title: 'Dataset grande (100)',
    desc: 'Stress test visual: filtros, paginación, charts densos.',
  },
  showcase: {
    title: '🎯 Showcase para demo cliente (60)',
    desc: 'Distribución calibrada para impresionar: ~10 finalistas, charts equilibrados, casos de bot review variados.',
  },
};

export function generateDemoApplications(count: number, jobIds: string[]): void {
  const apps = Array.from({ length: count }, (_, i) => generateApplication(i + 1, jobIds));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

export function generatePreset(preset: DemoPreset, jobIds: string[]): void {
  generateDemoApplications(PRESET_COUNTS[preset], jobIds);
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
