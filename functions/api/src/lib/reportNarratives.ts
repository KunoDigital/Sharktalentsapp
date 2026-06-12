/**
 * Generación de narrativas IA del reporte multi-candidato.
 *
 * Funciones:
 *   - generateCandidateNarrative(): paragraph_intro + fortalezas + a_tomar_en_cuenta + estilos
 *   - generateConclusion(): los 5 textos de conclusión + recomendación final
 *   - buildNarrativesForReport(): orquesta paralelo + cache + fallback
 *
 * Cache: in-memory Map keyed by hash de (job_id + sorted result_ids + ideal_profile_hash).
 * TTL = 1 hora. La cache es por instancia (no compartida entre cold-starts de Catalyst).
 *
 * Cuando exista la tabla ClientReports (Block 2), reemplazar este Map por persistencia.
 */
import { createHash } from 'crypto';
import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';
import { env } from './env';
import type { IdealProfile } from '../features/jobs';

const log = logger('REPORT_NARRATIVES');

export type CandidateNarrativeInput = {
  application_id: string;
  candidate_name: string;
  candidate_age: number | null;
  scores: Record<string, unknown> | null;
  integrity_dimensions: Array<{ dimension: string; nivel: string; pct: number }>;
  summary_score: number | null;
};

export type CandidateNarrative = {
  paragraph_intro: string;
  fortalezas: string[];
  a_tomar_en_cuenta: string[];
  estilo_decisiones: string;
  estilo_equipo: string;
  estilo_presion: string;
  estilo_comunicacion: string;
  perfil_emocional_text: string;
};

export type ReportConclusion = {
  si_priorizas_autonomia: string;
  si_priorizas_crecimiento: string;
  menor_riesgo: string;
  mayor_potencial: string;
  recomendacion_final: string;
};

export type NarrativesBundle = {
  candidates: Record<string, CandidateNarrative>; // by application_id
  conclusion: ReportConclusion;
  generated_at: string;
  status: 'ok' | 'partial' | 'failed';
};

// ===== System prompts (cacheables — Anthropic prompt caching reduce costo en repeticiones) =====

const SYSTEM_CANDIDATE_ES = `Sos un psicólogo organizacional experto en evaluación de talento.
Recibís el contexto de un puesto y los scores de UN candidato.
Tu tarea: generar un análisis estructurado en español neutro (Argentina/Panamá), profesional y accesible.

REGLAS ESTRICTAS:
- NO inventar datos. Solo usar la información dada.
- Cada texto entre 80-150 palabras.
- Tono profesional pero claro: el lector es el cliente que contrata, no un psicólogo.
- 3-5 fortalezas concretas (no genéricas).
- 2-4 puntos "a tomar en cuenta" honestos (no inventar problemas, pero tampoco ocultar señales reales).
- Estilo de cada uno (decisiones/equipo/presión/comunicación): UNA frase concisa.
- Salida ESTRICTAMENTE como JSON con el schema dado. NADA fuera del JSON.
- TODO el contenido textual debe estar en ESPAÑOL. Las claves del JSON quedan en español tal como el schema indica.`;

const SYSTEM_CANDIDATE_EN = `You are an organizational psychologist expert in talent assessment.
You receive the context of a job opening and the scores of ONE candidate.
Your task: generate a structured analysis in clear, professional English accessible to a hiring client (not a psychologist).

STRICT RULES:
- DO NOT invent data. Only use the information given.
- Each text between 80-150 words.
- Professional but clear tone: the reader is the hiring client.
- 3-5 concrete strengths (not generic).
- 2-4 honest "things to consider" points (don't invent problems, but don't hide real signals either).
- Style fields (decisions/team/pressure/communication): ONE concise sentence each.
- Output STRICTLY as JSON with the given schema. NOTHING outside the JSON.
- All textual content MUST be in ENGLISH. JSON keys remain in Spanish as per the schema.`;

const SYSTEM_CONCLUSION_ES = `Sos un consultor senior de reclutamiento ejecutivo.
Recibís 2-4 candidatos finalistas con sus scores. Tu tarea: ayudar al cliente a decidir.

Generá 5 textos en español neutro:
- si_priorizas_autonomia: a quién elegir si quiere a alguien que opere solo desde día 1.
- si_priorizas_crecimiento: a quién elegir si quiere alguien que escale el negocio rápido.
- menor_riesgo: el candidato más estable / con mejor relación costo-resultado.
- mayor_potencial: el candidato con más techo a mediano plazo.
- recomendacion_final: 2-3 frases con tu recomendación principal y por qué.

REGLAS:
- NO inventar datos.
- Mencionar a los candidatos por su NOMBRE en cada texto.
- Si solo hay 1 candidato, decirlo en la recomendación; los otros 4 textos los podés colapsar en "no aplica con un único finalista".
- Salida ESTRICTAMENTE JSON. NADA fuera del JSON.
- TODO el contenido textual debe estar en ESPAÑOL.`;

const SYSTEM_CONCLUSION_EN = `You are a senior executive recruiting consultant.
You receive 2-4 finalist candidates with their scores. Your task: help the client decide.

Generate 5 texts in clear professional English (JSON keys remain in Spanish as per the schema):
- si_priorizas_autonomia: who to pick if the client wants someone operating solo from day 1.
- si_priorizas_crecimiento: who to pick if the client wants someone scaling the business fast.
- menor_riesgo: the most stable candidate / best cost-to-result ratio.
- mayor_potencial: the candidate with the most ceiling mid-term.
- recomendacion_final: 2-3 sentences with your main recommendation and why.

RULES:
- DO NOT invent data.
- Mention candidates by NAME in each text.
- If there is only 1 candidate, say so in the recommendation; the other 4 texts can collapse to "not applicable with a single finalist".
- Output STRICTLY as JSON. NOTHING outside the JSON.
- All textual content MUST be in ENGLISH.`;

function pickSystemCandidate(lang: 'es' | 'en'): string {
  return lang === 'en' ? SYSTEM_CANDIDATE_EN : SYSTEM_CANDIDATE_ES;
}

function pickSystemConclusion(lang: 'es' | 'en'): string {
  return lang === 'en' ? SYSTEM_CONCLUSION_EN : SYSTEM_CONCLUSION_ES;
}

// ===== Builders =====

function describeIdealProfile(ip: IdealProfile | null): string {
  if (!ip) return 'No hay perfil ideal definido para este puesto.';
  const lines: string[] = [];
  if (ip.disc) {
    lines.push(`DISC ideal: D=${ip.disc.d} I=${ip.disc.i} S=${ip.disc.s} C=${ip.disc.c}` +
      (ip.disc.pk_name ? ` (perfil ${ip.disc.pk_name})` : ''));
  }
  if (ip.velna) {
    lines.push(`VELNA ideal: verbal=${ip.velna.verbal} espacial=${ip.velna.espacial} ` +
      `lógica=${ip.velna.logica} numérica=${ip.velna.numerica} abstracta=${ip.velna.abstracta}`);
  }
  if (ip.competencias && ip.competencias.length > 0) {
    lines.push(`Competencias requeridas: ${ip.competencias.map((c) => `${c.name} (${c.required_pct}%)`).join(', ')}`);
  }
  if (ip.tecnica_minimo_pct != null) {
    lines.push(`Mínimo técnica: ${ip.tecnica_minimo_pct}%`);
  }
  if (ip.context_summary) {
    lines.push(`Contexto: ${ip.context_summary}`);
  }
  return lines.join('\n');
}

function describeCandidate(c: CandidateNarrativeInput): string {
  const s = c.scores ?? {};
  const lines: string[] = [`CANDIDATO: ${c.candidate_name}, ${c.candidate_age ?? 'edad N/A'} años`];

  if (s.disc_norm_d != null) {
    lines.push(`DISC norm: D=${s.disc_norm_d} I=${s.disc_norm_i} S=${s.disc_norm_s} C=${s.disc_norm_c}` +
      (s.disc_perfil_dominante ? ` (dominante: ${s.disc_perfil_dominante})` : ''));
  }
  if (s.velna_indice != null) {
    lines.push(`Cognitiva (VELNA) índice ${s.velna_indice}/100. ` +
      `verbal=${s.velna_verbal} espacial=${s.velna_espacial} ` +
      `lógica=${s.velna_logica} numérica=${s.velna_numerica} abstracta=${s.velna_abstracta}`);
  }
  if (s.tec_score_pct != null) {
    lines.push(`Técnica: ${s.tec_score_pct}%${s.tec_passed === false ? ' (NO pasó mínimo)' : ''}`);
  }
  if (s.emo_score != null) {
    lines.push(`Emocional: ${s.emo_score}/100${s.emo_perfil ? ` perfil=${s.emo_perfil}` : ''}`);
  }
  if (s.int_overall != null) {
    lines.push(`Integridad overall: ${s.int_overall} (${s.int_overall_pct ?? 0}% de riesgo)`);
  }
  if (c.integrity_dimensions.length > 0) {
    const obs = c.integrity_dimensions.filter((d) => d.nivel === 'medio' || d.nivel === 'alto');
    if (obs.length > 0) {
      lines.push(`Dimensiones integridad con observaciones: ${obs.map((d) => `${d.dimension}=${d.nivel} (${d.pct}%)`).join(', ')}`);
    }
  }
  if (c.summary_score != null) {
    lines.push(`Score de resumen (no afinidad ideal): ${c.summary_score}/100`);
  }
  return lines.join('\n');
}

function buildCandidatePrompt(jobTitle: string, jobCompany: string, ip: IdealProfile | null, c: CandidateNarrativeInput): string {
  return `PUESTO: ${jobTitle} en ${jobCompany}
${describeIdealProfile(ip)}

${describeCandidate(c)}

Devolvé JSON con este schema:
{
  "paragraph_intro": "string (80-150 palabras)",
  "fortalezas": ["string", "string", "string"],
  "a_tomar_en_cuenta": ["string", "string"],
  "estilo_decisiones": "string (1 frase)",
  "estilo_equipo": "string (1 frase)",
  "estilo_presion": "string (1 frase)",
  "estilo_comunicacion": "string (1 frase)",
  "perfil_emocional_text": "string (1-2 frases)"
}`;
}

function buildConclusionPrompt(jobTitle: string, jobCompany: string, ip: IdealProfile | null, candidates: CandidateNarrativeInput[]): string {
  const lines = candidates.map((c, idx) => `--- Candidato ${idx + 1} ---\n${describeCandidate(c)}`);
  return `PUESTO: ${jobTitle} en ${jobCompany}
${describeIdealProfile(ip)}

${lines.join('\n\n')}

Devolvé JSON con este schema:
{
  "si_priorizas_autonomia": "string",
  "si_priorizas_crecimiento": "string",
  "menor_riesgo": "string",
  "mayor_potencial": "string",
  "recomendacion_final": "string (2-3 frases)"
}`;
}

// ===== IA calls =====

async function generateCandidateNarrative(
  jobTitle: string,
  jobCompany: string,
  idealProfile: IdealProfile | null,
  candidate: CandidateNarrativeInput,
  traceId: string,
  lang: 'es' | 'en',
): Promise<CandidateNarrative | null> {
  try {
    const response = await anthropicMessage({
      system: [{ type: 'text', text: pickSystemCandidate(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildCandidatePrompt(jobTitle, jobCompany, idealProfile, candidate) }],
      maxTokens: 1500,
      temperature: 0.6,
    }, traceId);
    return extractJson<CandidateNarrative>(response);
  } catch (err) {
    log.warn('candidate narrative failed', {
      traceId,
      application_id: candidate.application_id,
      error: (err as Error).message,
    });
    return null;
  }
}

async function generateConclusion(
  jobTitle: string,
  jobCompany: string,
  idealProfile: IdealProfile | null,
  candidates: CandidateNarrativeInput[],
  traceId: string,
  lang: 'es' | 'en',
): Promise<ReportConclusion | null> {
  try {
    const response = await anthropicMessage({
      system: [{ type: 'text', text: pickSystemConclusion(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildConclusionPrompt(jobTitle, jobCompany, idealProfile, candidates) }],
      maxTokens: 1500,
      temperature: 0.6,
    }, traceId);
    return extractJson<ReportConclusion>(response);
  } catch (err) {
    log.warn('conclusion failed', { traceId, error: (err as Error).message });
    return null;
  }
}

// ===== Cache =====

type CacheEntry = { bundle: NarrativesBundle; expires_at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

function buildCacheKey(jobId: string, resultIds: string[], idealProfileSerialized: string | null): string {
  const sorted = [...resultIds].sort();
  const payload = JSON.stringify({ jobId, resultIds: sorted, ip: idealProfileSerialized ?? '' });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function evictExpired() {
  const nowMs = Date.now();
  for (const [k, v] of cache.entries()) {
    if (v.expires_at < nowMs) cache.delete(k);
  }
  // LRU-ish: si excede máximo, borrar la mitad más vieja.
  if (cache.size > CACHE_MAX_ENTRIES) {
    const entries = [...cache.entries()].sort((a, b) => a[1].expires_at - b[1].expires_at);
    for (let i = 0; i < entries.length / 2; i++) cache.delete(entries[i][0]);
  }
}

export function clearNarrativesCache() {
  cache.clear();
}

// ===== Traducción de narrativas (es ↔ en) =====

const SYSTEM_TRANSLATE = `You are a precise translator for HR reports.
You translate JSON narrative bundles between Spanish (es) and English (en).

Rules:
- PRESERVE the JSON structure 100% — same keys, same shape.
- Translate ONLY string values (textual content).
- Keep candidate names, numbers, dates, and proper nouns unchanged.
- Maintain the professional but accessible tone of the original.
- Output STRICTLY the translated JSON. NOTHING outside the JSON.`;

/**
 * Traduce un NarrativesBundle al idioma destino (es↔en) llamando a Anthropic.
 * Si el bundle ya está vacío (status=failed) o la API key no está, devuelve el original.
 *
 * Se llama desde el outbox dispatcher cuando llega `report.translate_en` o
 * `report.translate_es`. También puede usarse directo desde un endpoint sync.
 */
export async function translateNarrativeBundle(
  bundle: NarrativesBundle,
  targetLang: 'es' | 'en',
  traceId: string,
): Promise<NarrativesBundle> {
  if (bundle.status === 'failed' || Object.keys(bundle.candidates).length === 0) {
    return bundle;
  }
  if (!env().ANTHROPIC_API_KEY) {
    log.warn('translateNarrativeBundle: ANTHROPIC_API_KEY missing, returning original', { traceId });
    return bundle;
  }

  const prompt = `Target language: ${targetLang}

Translate the following JSON to ${targetLang === 'en' ? 'English' : 'Spanish'}, preserving structure exactly:

${JSON.stringify({ candidates: bundle.candidates, conclusion: bundle.conclusion }, null, 2)}`;

  try {
    const response = await anthropicMessage({
      system: [{ type: 'text', text: SYSTEM_TRANSLATE, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.2,
    }, traceId);

    const translated = extractJson<{ candidates: Record<string, CandidateNarrative>; conclusion: ReportConclusion }>(response);
    if (!translated || !translated.candidates || !translated.conclusion) {
      log.warn('translateNarrativeBundle: invalid response from Anthropic', { traceId });
      return bundle;
    }

    return {
      candidates: translated.candidates,
      conclusion: translated.conclusion,
      generated_at: new Date().toISOString(),
      status: 'ok',
    };
  } catch (err) {
    log.warn('translateNarrativeBundle failed', { traceId, error: (err as Error).message });
    return bundle;
  }
}

// ===== Orquestación =====

export async function buildNarrativesForReport(args: {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  idealProfile: IdealProfile | null;
  idealProfileSerialized: string | null;
  candidates: CandidateNarrativeInput[];
  traceId: string;
  ttlMs?: number;
}): Promise<NarrativesBundle> {
  const { jobId, jobTitle, jobCompany, idealProfile, idealProfileSerialized, candidates, traceId } = args;
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS;
  const lang: 'es' | 'en' = idealProfile?.report_lang === 'en' ? 'en' : 'es';

  if (candidates.length === 0) {
    return {
      candidates: {},
      conclusion: emptyConclusion(),
      generated_at: new Date().toISOString(),
      status: 'ok',
    };
  }

  const key = buildCacheKey(jobId, candidates.map((c) => c.application_id), `${lang}:${idealProfileSerialized ?? ''}`);
  const cached = cache.get(key);
  if (cached && cached.expires_at > Date.now()) {
    log.debug('narratives cache hit', { traceId, key });
    return cached.bundle;
  }

  // Si la API key Anthropic no está configurada, devolver fallback estructurado sin llamar.
  if (!env().ANTHROPIC_API_KEY) {
    log.warn('ANTHROPIC_API_KEY not set; returning empty narratives', { traceId });
    return {
      candidates: {},
      conclusion: emptyConclusion(),
      generated_at: new Date().toISOString(),
      status: 'failed',
    };
  }

  // 2026-06-04 (audit fix #18): cap de concurrencia 3 sobre las narrativas. Antes era
  // Promise.all sin límite → con 10 finalistas disparaba 10 calls Anthropic simultáneas
  // = costo concentrado + presión sobre el circuit breaker. 3 balanced entre velocidad
  // (10 cands ≈ 3 rondas) y carga.
  const candidateResults: Array<Awaited<ReturnType<typeof generateCandidateNarrative>>> = new Array(candidates.length);
  const CONCURRENCY = 3;
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= candidates.length) return;
      candidateResults[i] = await generateCandidateNarrative(
        jobTitle, jobCompany, idealProfile, candidates[i], traceId, lang,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()));
  const conclusion = await generateConclusion(jobTitle, jobCompany, idealProfile, candidates, traceId, lang);

  const candidatesMap: Record<string, CandidateNarrative> = {};
  let okCount = 0;
  candidateResults.forEach((narrative, idx) => {
    if (narrative) {
      candidatesMap[candidates[idx].application_id] = narrative;
      okCount++;
    }
  });

  const totalExpected = candidates.length + 1; // candidates + conclusion
  const totalOk = okCount + (conclusion ? 1 : 0);
  const status: NarrativesBundle['status'] =
    totalOk === totalExpected ? 'ok' :
    totalOk === 0 ? 'failed' : 'partial';

  const bundle: NarrativesBundle = {
    candidates: candidatesMap,
    conclusion: conclusion ?? emptyConclusion(),
    generated_at: new Date().toISOString(),
    status,
  };

  if (status !== 'failed') {
    cache.set(key, { bundle, expires_at: Date.now() + ttlMs });
    evictExpired();
  }

  log.info('narratives built', {
    traceId,
    jobId,
    candidates: candidates.length,
    ok_narratives: okCount,
    has_conclusion: conclusion != null,
    status,
  });

  return bundle;
}

function emptyConclusion(): ReportConclusion {
  return {
    si_priorizas_autonomia: '',
    si_priorizas_crecimiento: '',
    menor_riesgo: '',
    mayor_potencial: '',
    recomendacion_final: '',
  };
}

// Exports para tests
export const _internal = {
  buildCacheKey,
  buildCandidatePrompt,
  buildConclusionPrompt,
  describeIdealProfile,
  describeCandidate,
};
