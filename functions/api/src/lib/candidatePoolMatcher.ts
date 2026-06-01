/**
 * Algoritmo de matching candidato↔puesto para sourcing interno (doc 22).
 *
 * Input: perfil del candidato del pool (DISC, cognitive, tags, last_active) + perfil ideal del Job.
 * Output: score 0-100 + breakdown explicando por qué.
 *
 * NO consulta BD — funciones puras. La capa que llama (features/candidatePool.ts) hace los queries.
 */

import type { IdealProfile } from '../features/jobs';

export type PoolCandidateInput = {
  candidate_id: string;
  /** Snapshot del último DISC (de su última aplicación). Null si nunca lo hizo. */
  disc?: { d: number; i: number; s: number; c: number } | null;
  /** Nivel cognitivo del puesto al que aplicó. */
  cognitive_level?: 'basic' | 'mid' | 'senior' | null;
  /** VELNA índice del último puesto. */
  velna_indice?: number | null;
  /** Tags JSON-decoded: ej ['react', 'typescript', 'spanish'] */
  tags: string[];
  /** Última vez que aplicó/respondió. */
  last_active?: string | null;
  /** Idiomas. */
  languages?: string[];
  /** Disponible para outreach. */
  disponible_para_outreach?: boolean;
  /** Veces contactado. Penaliza si está alto (no spamear). */
  times_contacted?: number;
};

export type MatchBreakdown = {
  disc: number;
  cognitive: number;
  area: number;
  english: number;
  recency: number;
  contact_history: number;
};

export type MatchResult = {
  candidate_id: string;
  match_score: number; // 0-100
  breakdown: MatchBreakdown;
  reasoning: string[];
  available: boolean;
};

const WEIGHTS = {
  disc: 30,        // similitud DISC con el ideal
  cognitive: 20,   // mismo cognitive_level
  area: 25,        // tag de área matchea ideal
  english: 10,     // si requires_english y candidato tiene 'en' en languages
  recency: 15,     // last_active < 6m = full, < 12m = half
};
// Penalización: si fue contactado > 3 veces, restar
const OVERCONTACT_PENALTY = 10;

/**
 * Compara DISC del candidato vs DISC ideal del puesto. Devuelve 0-30.
 * Distancia euclidiana invertida + normalizada al peso.
 */
function scoreDisc(candidate: PoolCandidateInput['disc'], ideal: IdealProfile['disc']): number {
  if (!candidate || !ideal) return 0;
  const diff = Math.abs(candidate.d - ideal.d)
    + Math.abs(candidate.i - ideal.i)
    + Math.abs(candidate.s - ideal.s)
    + Math.abs(candidate.c - ideal.c);
  // diff máximo teórico ≈ 400 (cada eje 0-100). Normalizamos.
  return Math.max(0, Math.round(WEIGHTS.disc - diff / 13.3));
}

function scoreCognitive(candidateLevel: string | null | undefined, jobLevel: string | undefined): number {
  if (!candidateLevel || !jobLevel) return 0;
  return candidateLevel === jobLevel ? WEIGHTS.cognitive : 0;
}

/**
 * Match por área: si el candidato tiene un tag que aparece en `area_tags` del job
 * (que pasamos como segundo argumento), full peso. Si no, 0.
 */
function scoreArea(tags: string[], areaTags: string[]): number {
  if (!areaTags.length) return 0;
  const tagsLower = tags.map((t) => t.toLowerCase());
  const match = areaTags.some((a) => tagsLower.includes(a.toLowerCase()));
  return match ? WEIGHTS.area : 0;
}

function scoreEnglish(languages: string[] | undefined, requiresEnglish: boolean): number {
  if (!requiresEnglish) return WEIGHTS.english; // no requiere → todos suman este peso
  if (!languages?.length) return 0;
  const has = languages.some((l) => l.toLowerCase().startsWith('en'));
  return has ? WEIGHTS.english : 0;
}

function scoreRecency(lastActive: string | null | undefined): number {
  if (!lastActive) return 0;
  const months = monthsBetween(new Date(lastActive), new Date());
  if (months < 6) return WEIGHTS.recency;
  if (months < 12) return Math.round(WEIGHTS.recency / 2);
  return 0;
}

function monthsBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.abs(ms / (1000 * 60 * 60 * 24 * 30));
}

function scoreContactHistory(times: number): number {
  if (times <= 0) return 0;
  // Cada contacto previo resta 2.5 puntos hasta -10 max
  const penalty = Math.min(OVERCONTACT_PENALTY, times * 2.5);
  return -Math.round(penalty);
}

/**
 * Calcula score 0-100 + breakdown por dimensión.
 *
 * @param candidate snapshot del candidato del pool
 * @param ideal perfil ideal del job (job.ideal_profile parsed)
 * @param opts modificadores: areaTags = lista de tags del área del puesto, requiresEnglish flag
 */
export function calculateMatch(
  candidate: PoolCandidateInput,
  ideal: IdealProfile | null,
  opts: { areaTags?: string[]; requiresEnglish?: boolean } = {},
): MatchResult {
  const breakdown: MatchBreakdown = {
    disc: scoreDisc(candidate.disc, ideal?.disc),
    cognitive: scoreCognitive(candidate.cognitive_level, undefined),
    area: scoreArea(candidate.tags, opts.areaTags ?? []),
    english: scoreEnglish(candidate.languages, opts.requiresEnglish === true),
    recency: scoreRecency(candidate.last_active),
    contact_history: scoreContactHistory(candidate.times_contacted ?? 0),
  };

  const totalRaw = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const matchScore = Math.max(0, Math.min(100, totalRaw));

  return {
    candidate_id: candidate.candidate_id,
    match_score: matchScore,
    breakdown,
    reasoning: explainMatch(breakdown, candidate),
    available: candidate.disponible_para_outreach !== false,
  };
}

function explainMatch(breakdown: MatchBreakdown, candidate: PoolCandidateInput): string[] {
  const reasons: string[] = [];
  if (breakdown.disc >= 20) reasons.push('DISC altamente compatible con el perfil ideal');
  else if (breakdown.disc >= 10) reasons.push('DISC parcialmente compatible');

  if (breakdown.cognitive === WEIGHTS.cognitive) reasons.push('Mismo nivel cognitivo del puesto');
  if (breakdown.area === WEIGHTS.area) reasons.push('Tags de área matchean (skills relevantes)');
  if (breakdown.english === WEIGHTS.english) reasons.push('Idiomas alineados con el puesto');
  if (breakdown.recency === WEIGHTS.recency) reasons.push('Activo recientemente (<6 meses)');
  else if (breakdown.recency > 0) reasons.push('Activo en el último año');

  if (breakdown.contact_history < 0) {
    reasons.push(`Contactado ${candidate.times_contacted} veces previamente — cuidar frecuencia`);
  }

  return reasons;
}

// Modificar opts para incluir cognitive level del job
export function calculateMatchWithJobLevel(
  candidate: PoolCandidateInput,
  ideal: IdealProfile | null,
  jobCognitiveLevel: 'basic' | 'mid' | 'senior',
  opts: { areaTags?: string[]; requiresEnglish?: boolean } = {},
): MatchResult {
  const result = calculateMatch(candidate, ideal, opts);
  // Recalcular cognitive con el level real
  const cog = scoreCognitive(candidate.cognitive_level, jobCognitiveLevel);
  const delta = cog - result.breakdown.cognitive;
  result.breakdown.cognitive = cog;
  result.match_score = Math.max(0, Math.min(100, result.match_score + delta));
  result.reasoning = explainMatch(result.breakdown, candidate);
  return result;
}

// Exports para tests
export const _internal = { scoreDisc, scoreCognitive, scoreArea, scoreEnglish, scoreRecency, scoreContactHistory, WEIGHTS };
