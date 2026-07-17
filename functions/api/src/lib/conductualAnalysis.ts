/**
 * Capa 4 — Análisis IA contextual del Conductual.
 *
 * Reemplaza el análisis manual que hoy hace Cris al mirar los scores del candidato
 * (DISC + VELNA + Emoción) contra el perfil ideal del puesto. La IA recibe el
 * contexto específico del puesto (`context_summary` + competencias + boss_profile)
 * y devuelve un veredicto honesto y razonado.
 *
 * Regla CORE confirmada por Cris 2026-06-12 (ver memoria
 * `project_reglas_pipeline_candidato.md`):
 *
 *   Conductual NO auto-rechaza por umbrales binarios. Es análisis IA contextual.
 *   Mismo título de puesto, perfiles ideales opuestos según contexto:
 *     - Vendedor de Apple → C alto, técnico, no necesita labia
 *     - Vendedor de productos femeninos → S/I empático, escucha
 *
 * El output es informativo. El recruiter SIEMPRE decide al final.
 *
 * Uso:
 *   const analysis = await analyzeConductual({
 *     candidate_name, scores, ideal, context_summary, competencias, boss,
 *     anti_cheat_events,
 *   });
 *   // analysis.veredicto, analysis.razones_a_favor, etc.
 *
 * Cache: in-memory Map con hash de inputs. TTL 1h. Cuando exista tabla
 * ConductualAnalysisCache (Block 2), reemplazar por persistencia.
 */
import { createHash } from 'crypto';
import { anthropicMessage, extractToolUse, type AnthropicTool } from './anthropic';
import { logger } from './logger';
import type { Competencia, BossProfile, DiscIdeal, VelnaIdeal } from '../features/jobs';

const log = logger('CONDUCTUAL_ANALYSIS');

// ===== Types =====

export type ConductualInput = {
  candidate_name: string;
  /** Scores del candidato (DISC normalizado 0-100, VELNA 0-100, Emoción 0-100). */
  scores: {
    disc_norm_d?: number;
    disc_norm_i?: number;
    disc_norm_s?: number;
    disc_norm_c?: number;
    disc_similarity_pct?: number;
    velna_verbal?: number;
    velna_espacial?: number;
    velna_logica?: number;
    velna_numerica?: number;
    velna_abstracta?: number;
    velna_indice?: number;
    velna_similarity_pct?: number;
    emo_score?: number;
    emo_perfil?: string;
    /** % del test técnico (informativo para el análisis Conductual). */
    tec_score_pct?: number;
    /** Estilo situacional 0-100 (autonomía vs consulta). */
    tec_style_autonomy_consult?: number;
    /** Match estilo con jefe %. */
    tec_style_match_with_boss_pct?: number;
  };
  /** Perfil ideal del puesto (de IdealProfile). */
  ideal: {
    disc?: DiscIdeal;
    velna?: VelnaIdeal;
    competencias?: Competencia[];
    boss?: BossProfile;
    context_summary?: string;
  };
  /** Eventos de anti-cheat detectados (salidas de pantalla, tiempo fuera, etc). */
  anti_cheat_events?: Array<{ type: string; count?: number; total_seconds?: number }>;
};

export type ConductualAnalysis = {
  /** Veredicto principal del análisis. */
  veredicto: 'encaja' | 'encaja_con_reservas' | 'no_encaja';
  /** 3-5 razones a favor del candidato (referenciando datos concretos y el contexto del puesto). */
  razones_a_favor: string[];
  /** 2-4 razones en contra del candidato (señales reales, sin inventar problemas). */
  razones_en_contra: string[];
  /** Recomendación accionable al recruiter. */
  recomendacion: 'avanzar_a_entrevista' | 'duda_cv_revisar_manual' | 'considerar_perfil_alternativo' | 'no_avanzar';
  /** Alertas específicas que el recruiter debe mirar (anti-cheat, mismatch con boss, etc). Opcional, puede ir vacío. */
  alertas_especificas: string[];
  /** Resumen ejecutivo de 1-2 frases para mostrar en card / vista rápida. */
  resumen_ejecutivo: string;
};

// ===== Cache in-memory =====

type CacheEntry = { value: ConductualAnalysis; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

function hashInput(input: ConductualInput): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({
    s: input.scores,
    i: input.ideal,
    a: input.anti_cheat_events ?? [],
  }));
  return h.digest('hex').slice(0, 16);
}

function getCached(key: string): ConductualAnalysis | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: ConductualAnalysis): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Limpieza simple: si el cache crece a >500 entries, vaciar las más viejas.
  if (cache.size > 500) {
    const entries = Array.from(cache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [k] of entries.slice(0, 100)) cache.delete(k);
  }
}

// ===== Prompt + Tool schema =====

const SYSTEM_PROMPT = `Eres un consultor senior de reclutamiento ejecutivo con 20 años de experiencia evaluando candidatos en LATAM.

Tu tarea: analizar UN candidato contra el contexto específico de UN puesto y dar un veredicto honesto y razonado.

PRINCIPIO CORE: no existe "perfil ideal universal". Mismo título de puesto, contexto distinto → perfil ideal opuesto.

Ejemplo: vendedor de Apple vs vendedor de productos femeninos. Ambos venden, ambos pueden tener "Persuasión y negociación" como competencia requerida — pero el de Apple necesita C alto (técnico, preciso, cliente busca specs) y el de productos femeninos necesita S/I (empático, escucha, cliente busca conexión).

REGLAS ESTRICTAS:
- Usa el contexto del puesto (context_summary, competencias requeridas, boss_profile) como base. NO uses umbrales generales por tipo de puesto.
- Sé HONESTO y CRUDO. Sin sesgo de elogio. Si el candidato no encaja, dilo. Si es excelente, dilo. Si tiene reservas reales, listarlas.
- No inventes datos. Solo usa los scores y contexto provistos.
- Cada razón (a favor o en contra) debe REFERENCIAR datos concretos del candidato y del contexto del puesto. Genéricos no sirven.
- Si hay anti-cheat events sospechosos (más de 3 salidas o más de 60s acumulados fuera de pantalla), agregarlo a alertas_especificas.
- Si el candidato matchea con un perfil DISC distinto al ideal pero el contexto del puesto sugiere flexibilidad, considéralo como "perfil alternativo posible" en lugar de descartar.
- El recruiter humano decide al final. Tu rol es darle el insight que un humano experimentado tendría al mirar todos los datos juntos.
- Español neutro LatAm (Panamá target). Usa "tú/tienes/puedes". PROHIBIDO voseo argentino.
- Output ESTRICTAMENTE vía la tool call. Nada fuera del tool input.`;

const TOOL_SCHEMA: AnthropicTool = {
  name: 'submit_conductual_analysis',
  description: 'Envía el análisis conductual del candidato con veredicto, razones y recomendación.',
  input_schema: {
    type: 'object',
    properties: {
      veredicto: {
        type: 'string',
        enum: ['encaja', 'encaja_con_reservas', 'no_encaja'],
        description: 'Veredicto principal. "encaja" cuando hay match claro. "encaja_con_reservas" cuando hay señales mixtas que requieren entrevista. "no_encaja" cuando el contexto del puesto requiere otro perfil.',
      },
      razones_a_favor: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 razones concretas a favor del candidato. Cada una debe referenciar datos del candidato Y el contexto del puesto. Sin genéricos.',
        minItems: 0,
        maxItems: 5,
      },
      razones_en_contra: {
        type: 'array',
        items: { type: 'string' },
        description: '2-4 razones concretas en contra o de cuidado. Honestas, sin inventar problemas. Sin genéricos.',
        minItems: 0,
        maxItems: 4,
      },
      recomendacion: {
        type: 'string',
        enum: ['avanzar_a_entrevista', 'duda_cv_revisar_manual', 'considerar_perfil_alternativo', 'no_avanzar'],
        description: 'Acción concreta para el recruiter. "considerar_perfil_alternativo" si el candidato matchea con otro perfil DISC pero el puesto tiene flexibilidad.',
      },
      alertas_especificas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Alertas operativas que el recruiter debe mirar (anti-cheat sospechoso, mismatch fuerte con boss_profile, score cerca del umbral técnico). Puede ir vacío.',
        maxItems: 5,
      },
      resumen_ejecutivo: {
        type: 'string',
        description: '1-2 frases concisas con la esencia del veredicto, para mostrar en card / vista rápida. Máximo 200 caracteres.',
        maxLength: 250,
      },
    },
    required: ['veredicto', 'razones_a_favor', 'razones_en_contra', 'recomendacion', 'alertas_especificas', 'resumen_ejecutivo'],
  },
};

function buildUserMessage(input: ConductualInput): string {
  const parts: string[] = [];

  parts.push(`# Candidato\nNombre: ${input.candidate_name}`);

  // Scores del candidato
  parts.push(`\n# Scores del candidato (0-100)`);
  const s = input.scores;
  if (s.disc_norm_d != null || s.disc_norm_i != null) {
    parts.push(`DISC normalizado: D=${s.disc_norm_d ?? '?'} · I=${s.disc_norm_i ?? '?'} · S=${s.disc_norm_s ?? '?'} · C=${s.disc_norm_c ?? '?'}`);
    if (s.disc_similarity_pct != null) parts.push(`Similitud DISC vs ideal: ${s.disc_similarity_pct}%`);
  }
  if (s.velna_indice != null || s.velna_verbal != null) {
    parts.push(`VELNA: verbal=${s.velna_verbal ?? '?'} · espacial=${s.velna_espacial ?? '?'} · lógica=${s.velna_logica ?? '?'} · numérica=${s.velna_numerica ?? '?'} · abstracta=${s.velna_abstracta ?? '?'} · índice=${s.velna_indice ?? '?'}`);
    if (s.velna_similarity_pct != null) parts.push(`Similitud VELNA vs ideal: ${s.velna_similarity_pct}%`);
  }
  if (s.emo_score != null) {
    parts.push(`Emocional: score=${s.emo_score}${s.emo_perfil ? ` · perfil=${s.emo_perfil}` : ''}`);
  }
  if (s.tec_score_pct != null) {
    parts.push(`Técnico: ${s.tec_score_pct}%`);
  }
  if (s.tec_style_autonomy_consult != null) {
    const styleLabel = s.tec_style_autonomy_consult >= 65 ? 'autónomo' : s.tec_style_autonomy_consult <= 35 ? 'consultivo' : 'balanceado';
    parts.push(`Estilo de trabajo: ${styleLabel} (${s.tec_style_autonomy_consult}/100)`);
  }
  if (s.tec_style_match_with_boss_pct != null) {
    parts.push(`Match de estilo con el jefe: ${s.tec_style_match_with_boss_pct}%`);
  }

  // Contexto del puesto
  parts.push(`\n# Contexto del puesto`);
  if (input.ideal.context_summary) {
    parts.push(input.ideal.context_summary);
  } else {
    parts.push('(sin contexto narrativo cargado)');
  }

  // Perfil ideal DISC + VELNA
  if (input.ideal.disc) {
    const d = input.ideal.disc;
    parts.push(`\n# Perfil DISC ideal del puesto\nD=${d.d} · I=${d.i} · S=${d.s} · C=${d.c}`);
  }
  if (input.ideal.velna) {
    const v = input.ideal.velna;
    parts.push(`\n# Perfil VELNA ideal del puesto\nverbal=${v.verbal} · espacial=${v.espacial} · lógica=${v.logica} · numérica=${v.numerica} · abstracta=${v.abstracta}`);
  }

  // Competencias requeridas
  if (input.ideal.competencias && input.ideal.competencias.length > 0) {
    parts.push(`\n# Competencias requeridas para este puesto`);
    parts.push(input.ideal.competencias.map((c) => `- ${c.name} (mínimo ${c.required_pct}%)`).join('\n'));
  }

  // Boss profile
  if (input.ideal.boss) {
    const b = input.ideal.boss;
    const styleLabel = b.style_autonomy_consult >= 0.65 ? 'autónomo' : b.style_autonomy_consult <= 0.35 ? 'consultivo' : 'balanceado';
    parts.push(`\n# Perfil del jefe (a quien reportará el candidato)\n${b.name} · ${b.role} · estilo ${styleLabel}`);
    if (b.evidence_quote) parts.push(`Cita: "${b.evidence_quote}"`);
  }

  // Anti-cheat
  if (input.anti_cheat_events && input.anti_cheat_events.length > 0) {
    const totalSec = input.anti_cheat_events.reduce((acc, e) => acc + (e.total_seconds ?? 0), 0);
    const exits = input.anti_cheat_events.filter((e) => e.type === 'page_exit' || e.type === 'tab_blur').reduce((acc, e) => acc + (e.count ?? 1), 0);
    parts.push(`\n# Señales de anti-cheat\nSalidas de pantalla: ${exits}. Tiempo fuera acumulado: ${totalSec}s.`);
  }

  parts.push(`\n# Tu tarea\nAnaliza al candidato contra el contexto específico de este puesto. Envía tu análisis vía la tool 'submit_conductual_analysis'.`);

  return parts.join('\n');
}

// ===== Función principal =====

export async function analyzeConductual(
  input: ConductualInput,
  opts?: { skipCache?: boolean; traceId?: string },
): Promise<ConductualAnalysis> {
  const cacheKey = hashInput(input);

  if (!opts?.skipCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      log.info('cache hit', { candidate: input.candidate_name, key: cacheKey });
      return cached;
    }
  }

  log.info('generating conductual analysis', { candidate: input.candidate_name });

  const userMessage = buildUserMessage(input);

  const response = await anthropicMessage({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1500,
    temperature: 0.3, // bajo para coherencia, no creatividad
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_conductual_analysis' },
  });

  const analysis = extractToolUse<ConductualAnalysis>(response, 'submit_conductual_analysis');

  // Validación defensiva del schema
  if (!analysis || !analysis.veredicto || !Array.isArray(analysis.razones_a_favor)) {
    throw new Error('IA devolvió análisis incompleto o inválido');
  }

  setCached(cacheKey, analysis);
  log.info('analysis cached', { candidate: input.candidate_name, veredicto: analysis.veredicto });

  return analysis;
}

// ===== Re-exports para tests =====
export { hashInput, buildUserMessage, TOOL_SCHEMA, SYSTEM_PROMPT };
