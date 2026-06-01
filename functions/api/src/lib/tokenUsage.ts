/**
 * TokenUsage — tracking de tokens consumidos por cada llamada Anthropic.
 *
 * Por cada respuesta de Claude, se registra: input_tokens, output_tokens,
 * cached_input_tokens (si aplica), modelo usado, traceId, tenantId, feature
 * (ej "writing_analysis", "tech_questions_gen", "report_narratives", etc.).
 *
 * Sirve para:
 *   - Cris ve cuánto está costando cada feature (cost attribution)
 *   - Detectar prompt caching: si cached_input_tokens > 0, prompt cache funciona
 *   - Alertar si un tenant específico está consumiendo demasiado
 *   - Rate limiting si un loop infinito gasta tokens (futuro)
 *
 * Tabla `TokenUsage` (deferred Block 2):
 *   ROWID, tenant_id?, feature, model, input_tokens, cached_input_tokens,
 *   output_tokens, latency_ms, traceId, cost_usd_estimated, occurred_at
 *
 * Si la tabla no existe, simplemente no se trackea — la function sigue funcionando.
 * El logger de anthropic.ts también deja info en logs aunque la tabla no exista.
 */

import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { logger } from './logger';

const log = logger('TOKEN_USAGE');
const TABLE = 'TokenUsage';

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

export function _resetTokenUsageCache() {
  tableReady = null;
}

/**
 * Costos públicos de Claude Haiku 4.5 (USD por 1M tokens).
 * Source: https://www.anthropic.com/pricing (al 2026-05-07).
 *
 * Si los precios cambian, actualizar acá.
 */
export const HAIKU_4_5_COSTS = {
  input_per_1m: 1.0,         // $1/1M input tokens
  output_per_1m: 5.0,        // $5/1M output tokens
  cached_input_per_1m: 0.10, // $0.10/1M cached input tokens (10% del normal)
} as const;

/** Calcula costo USD aproximado de una llamada Anthropic. */
export function estimateCostUsd(input: {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
}): number {
  const inputCost = (input.input_tokens / 1_000_000) * HAIKU_4_5_COSTS.input_per_1m;
  const outputCost = (input.output_tokens / 1_000_000) * HAIKU_4_5_COSTS.output_per_1m;
  const cachedCost = ((input.cached_input_tokens ?? 0) / 1_000_000) * HAIKU_4_5_COSTS.cached_input_per_1m;
  return inputCost + outputCost + cachedCost;
}

export type TokenUsageRecord = {
  /** ID del tenant si la llamada fue tenant-scoped (puede ser null para admin/jobs sin tenant). */
  tenantId: string | null;
  /** Identificador del feature: "writing_analysis", "tech_questions", "report_narratives", etc. */
  feature: string;
  /** Modelo usado, ej "claude-haiku-4-5-20251001". */
  model: string;
  /** Tokens de input. */
  inputTokens: number;
  /** Tokens leídos del cache (prompt caching activo). */
  cachedInputTokens?: number;
  /** Tokens de output generados por Claude. */
  outputTokens: number;
  /** Latencia de la llamada en ms. */
  latencyMs: number;
  /** Trace ID para correlacionar con logs. */
  traceId?: string;
};

/**
 * Registra un uso de tokens en la tabla. Best-effort — si la tabla no existe o falla
 * el insert, no rompe el flow del caller. Solo se loggea warning.
 */
export async function recordTokenUsage(
  req: IncomingMessage,
  record: TokenUsageRecord,
): Promise<void> {
  if (!(await isTableReady(req))) return;

  const costUsd = estimateCostUsd({
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    cached_input_tokens: record.cachedInputTokens,
  });

  try {
    await datastore(req).table(TABLE).insertRow({
      tenant_id: record.tenantId,
      feature: record.feature,
      model: record.model,
      input_tokens: record.inputTokens,
      cached_input_tokens: record.cachedInputTokens ?? 0,
      output_tokens: record.outputTokens,
      latency_ms: record.latencyMs,
      trace_id: record.traceId ?? null,
      cost_usd_estimated: Math.round(costUsd * 100000) / 100000, // 5 decimales
      occurred_at: now(),
    });
  } catch (err) {
    log.warn('recordTokenUsage failed', {
      feature: record.feature,
      error: (err as Error).message,
    });
  }
}

/**
 * Lista uso de tokens para un tenant en un período. Para reportes admin.
 *
 * @returns Array de records ordenados por más reciente primero.
 */
export async function listTokenUsageByTenant(
  req: IncomingMessage,
  tenantId: string,
  hoursBack = 24,
  limit = 100,
): Promise<unknown[]> {
  if (!(await isTableReady(req))) return [];

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const escTenant = tenantId.replace(/'/g, "''");
  const q = `
    SELECT * FROM ${TABLE}
    WHERE tenant_id = '${escTenant}'
      AND occurred_at >= '${cutoff.replace(/'/g, "''")}'
    ORDER BY CREATEDTIME DESC
    LIMIT ${Math.max(1, Math.min(500, limit))}
  `.replace(/\s+/g, ' ');

  try {
    return (await zcql(req).executeZCQLQuery(q)) as unknown[];
  } catch (err) {
    log.warn('listTokenUsageByTenant failed', { tenantId, error: (err as Error).message });
    return [];
  }
}
