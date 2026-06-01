/**
 * RAG (retrieval-augmented generation) para el bot decisor.
 *
 * Busca en `BotTrainingExamples` casos pasados similares al actual y los inyecta como
 * few-shot en el prompt del bot. Mejora confidence al incorporar el criterio histórico
 * de Cris.
 *
 * Algoritmo de similitud (sin embeddings vectoriales en v1):
 *   - Mismo tenant_id (decisiones del mismo equipo) — REQUIRED
 *   - Mismo from_stage — bonus +30
 *   - Mismo job_cognitive_level — bonus +30
 *   - DISC similarity (suma |diff| invertida) — bonus hasta +30
 *   - Technical pct rango ±15 — bonus +20
 *   - quality='high' — bonus +20; quality='noise' — DESCARTAR
 */
import type { IncomingMessage } from 'http';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
const TABLE = 'BotTrainingExamples';

export type TrainingExampleRow = {
  ROWID: string;
  tenant_id: string;
  application_id: string;
  job_id: string;
  job_cognitive_level: string;
  candidate_disc_d: number | null;
  candidate_disc_i: number | null;
  candidate_disc_s: number | null;
  candidate_disc_c: number | null;
  candidate_cognitive_indice: number | null;
  candidate_technical_pct: number | null;
  candidate_integrity_overall: string | null;
  from_stage: string;
  to_stage_chosen: string;
  rationale_human: string;
  bot_had_suggested: string | null;
  bot_confidence: number | null;
  was_override: boolean;
  quality: 'standard' | 'high' | 'noise';
  created_at: string;
};

export type SimilarCase = {
  example: TrainingExampleRow;
  similarity: number;
};

let tableReady: boolean | null = null;

async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

export type CurrentCase = {
  tenantId: string;
  fromStage: string;
  jobCognitiveLevel: string;
  candidateDiscD?: number | null;
  candidateDiscI?: number | null;
  candidateDiscS?: number | null;
  candidateDiscC?: number | null;
  candidateTechnicalPct?: number | null;
};

/**
 * Devuelve hasta `limit` casos similares ordenados por score de similitud descendente.
 * Filtra automáticamente quality='noise'. Si la tabla no existe, devuelve [].
 */
export async function findSimilarCases(
  req: IncomingMessage,
  current: CurrentCase,
  limit = 5,
): Promise<SimilarCase[]> {
  if (!(await isTableReady(req))) return [];

  // Pull TODOS los examples del tenant (no muchos en práctica). Filtrado fino en JS.
  const q = `
    SELECT * FROM ${TABLE}
    WHERE tenant_id = '${escapeSql(current.tenantId)}'
      AND quality != 'noise'
    ORDER BY CREATEDTIME DESC
    LIMIT 200
  `.replace(/\s+/g, ' ');

  const rows = unwrapRows<TrainingExampleRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    TABLE,
  );

  if (rows.length === 0) return [];

  const scored = rows.map((ex) => ({ example: ex, similarity: calculateSimilarity(current, ex) }));
  scored.sort((a, b) => b.similarity - a.similarity);
  // Solo devolver casos con similitud mínima >= 30 (evita ruido)
  return scored.filter((s) => s.similarity >= 30).slice(0, limit);
}

function calculateSimilarity(current: CurrentCase, ex: TrainingExampleRow): number {
  let score = 0;

  // Mismo from_stage = +30
  if (ex.from_stage === current.fromStage) score += 30;

  // Mismo cognitive level = +30
  if (ex.job_cognitive_level === current.jobCognitiveLevel) score += 30;

  // DISC similarity hasta +30
  const cd = current.candidateDiscD;
  const ci = current.candidateDiscI;
  const cs = current.candidateDiscS;
  const cc = current.candidateDiscC;
  if (cd != null && ci != null && cs != null && cc != null
    && ex.candidate_disc_d != null && ex.candidate_disc_i != null
    && ex.candidate_disc_s != null && ex.candidate_disc_c != null) {
    const diff = Math.abs(cd - ex.candidate_disc_d)
      + Math.abs(ci - ex.candidate_disc_i)
      + Math.abs(cs - ex.candidate_disc_s)
      + Math.abs(cc - ex.candidate_disc_c);
    score += Math.max(0, 30 - Math.floor(diff / 13.3));
  }

  // Technical pct similar (±15) = +20
  if (current.candidateTechnicalPct != null && ex.candidate_technical_pct != null) {
    if (Math.abs(current.candidateTechnicalPct - ex.candidate_technical_pct) < 15) {
      score += 20;
    }
  }

  // Quality boost
  if (ex.quality === 'high') score += 20;

  return score;
}

/**
 * Construye un texto formateado para inyectar en el system/user prompt del bot,
 * con los casos similares como referencia. Cada caso incluye scores resumidos +
 * la decisión humana + rationale.
 */
export function buildFewShotBlock(cases: SimilarCase[]): string {
  if (cases.length === 0) return '';
  const lines = cases.map(({ example, similarity }, idx) => {
    const disc = example.candidate_disc_d != null
      ? `DISC=${example.candidate_disc_d}/${example.candidate_disc_i}/${example.candidate_disc_s}/${example.candidate_disc_c}`
      : 'DISC=N/A';
    const tec = example.candidate_technical_pct != null ? ` técnica=${example.candidate_technical_pct}%` : '';
    const cog = example.candidate_cognitive_indice != null ? ` VELNA=${example.candidate_cognitive_indice}` : '';
    const overrideTag = example.was_override ? ' [override del bot]' : '';
    return `Caso ${idx + 1} (similaridad ${similarity}, calidad ${example.quality}${overrideTag}):
- Job nivel: ${example.job_cognitive_level}; ${disc}${tec}${cog}
- Stage origen: ${example.from_stage}
- Decisión humana: ${example.to_stage_chosen}
- Razón: ${example.rationale_human.slice(0, 200)}`;
  });

  return [
    '=== CASOS SIMILARES PASADOS (referencia, no copiar literal) ===',
    'Decisiones humanas en situaciones parecidas. Usá esto para calibrar tu confidence,',
    'no para copiar literal. La situación actual puede ser distinta en detalles importantes.',
    '',
    ...lines,
    '',
    '=== FIN CASOS SIMILARES ===',
  ].join('\n');
}

export function _resetTableReadyForTests() {
  tableReady = null;
}
