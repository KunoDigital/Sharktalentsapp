/**
 * Wrapper que llama a Claude para analizar el writing del candidato (test de inglés).
 *
 * Uso:
 *   const result = await analyzeWriting({ text: candidateWriting, level: 'B2', traceId });
 *   // result.score_pct, result.dimensions, result.suspicious_patterns, etc.
 *
 * Reusa la infra de anthropic.ts (timeout + retry + circuit breaker).
 *
 * Costo aproximado: ~$0.03-0.05 USD por análisis (Haiku 4.5, ~500 input + 400 output tokens).
 */

import { anthropicMessage, extractJson } from './anthropic';
import { logger } from './logger';
import { WRITING_PROMPTS, type WritingAnalysisResult } from './englishWritingPrompts';
import type { CefrLevel } from './englishScoring';

const log = logger('ENGLISH_WRITING_ANALYZER');

export type AnalyzeWritingInput = {
  text: string;
  level: CefrLevel;
  traceId?: string;
};

/**
 * Analiza el writing del candidato contra el rubric CEFR del nivel solicitado.
 *
 * @throws Error si Claude responde con un formato no parseable, o si el text está vacío.
 */
export async function analyzeWriting(input: AnalyzeWritingInput): Promise<WritingAnalysisResult> {
  if (!input.text || input.text.trim().length === 0) {
    throw new Error('analyzeWriting: text is empty');
  }
  if (!(input.level in WRITING_PROMPTS)) {
    throw new Error(`analyzeWriting: unsupported level "${input.level}"`);
  }

  const prompt = WRITING_PROMPTS[input.level].replace('{{TEXT}}', input.text);

  log.info('analyzing writing', {
    traceId: input.traceId,
    level: input.level,
    text_length: input.text.length,
  });

  const response = await anthropicMessage(
    {
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    },
    input.traceId ?? '',
  );

  let parsed: WritingAnalysisResult;
  try {
    parsed = extractJson<WritingAnalysisResult>(response);
  } catch (err) {
    log.warn('failed to parse Claude response', {
      traceId: input.traceId,
      error: (err as Error).message,
    });
    throw new Error(`analyzeWriting: Claude returned invalid JSON — ${(err as Error).message}`);
  }

  if (
    typeof parsed.score_pct !== 'number' ||
    parsed.score_pct < 0 ||
    parsed.score_pct > 100
  ) {
    throw new Error(`analyzeWriting: Claude returned invalid score_pct=${parsed.score_pct}`);
  }

  log.info('writing analyzed', {
    traceId: input.traceId,
    level: input.level,
    score_pct: parsed.score_pct,
    level_achieved: parsed.level_achieved,
    suspicious: parsed.suspicious_patterns.quality_too_high_for_declared_level || parsed.suspicious_patterns.sounds_ai_generated,
  });

  return parsed;
}
