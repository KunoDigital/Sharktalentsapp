/**
 * Chequea si el bloque continuo Técnica del pipeline está completo.
 *
 * El "bloque continuo" son los tests que se corren dentro del mismo link:
 *   1. Prueba Técnica (siempre)
 *   2. Inglés (solo si `Job.english_required = true`)
 *   3. Mindset (solo si `Job.mindset_required = true`)
 *
 * La transición del pipeline (`prefilter_passed` → `tecnica_completed` o `duda_cv`)
 * NO se dispara hasta que los 3 aplicables terminen. Antes de este helper, el
 * technical submit disparaba `tecnica_completed` sin esperar a inglés/mindset —
 * dejaba candidatos colgados.
 *
 * Reglas de negocio (project_reglas_pipeline_candidato.md):
 *   - Técnica bajo umbral → auto_rejected_low_score (ya lo dispara publicTest.ts).
 *   - Inglés bajo → duda_cv (nunca rechaza).
 *   - Mindset → informativo, NUNCA rechaza ni va a duda.
 *
 * Uso desde englishTest / mindsetTest / publicTest después de persistir el score:
 *   const check = await checkTechnicalBlockComplete(ctx.req, resultId);
 *   if (check.allComplete) {
 *     await transitResult(ctx, result, check.englishFailed ? 'duda_cv' : 'tecnica_completed', 'webhook');
 *   }
 */

import type { IncomingMessage } from 'http';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';

const log = logger('TECHNICAL_BLOCK');

export type TechnicalBlockCheck = {
  /** Todos los tests aplicables terminaron. */
  allComplete: boolean;
  /** Inglés era requerido y el candidato lo reprobó — la transición debe ser a duda_cv. */
  englishFailed: boolean;
  /** Detalle por sub-test (útil para debug/log). */
  parts: {
    technical: 'done' | 'pending' | 'not_applicable';
    english: 'done_passed' | 'done_failed' | 'pending' | 'not_applicable';
    mindset: 'done' | 'pending' | 'not_applicable';
  };
};

export async function checkTechnicalBlockComplete(
  req: IncomingMessage,
  resultId: string,
): Promise<TechnicalBlockCheck> {
  const check: TechnicalBlockCheck = {
    allComplete: false,
    englishFailed: false,
    parts: { technical: 'pending', english: 'not_applicable', mindset: 'not_applicable' },
  };

  try {
    // Sacamos assessment_id, tec_completed_at, y flags english_required/mindset_required del Job.
    const meta = unwrapRows<{
      assessment_id: string;
      tec_completed_at: string | null;
      english_required: unknown;
      mindset_required: unknown;
    }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT R.assessment_id AS assessment_id, S.tec_completed_at AS tec_completed_at,
                J.english_required AS english_required, J.mindset_required AS mindset_required
         FROM Results R
         LEFT JOIN Jobs J ON J.ROWID = R.assessment_id
         LEFT JOIN Scores S ON S.result_id = R.ROWID
         WHERE R.ROWID = '${escapeSql(resultId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    )[0];

    if (!meta) {
      log.warn('resultId not found for technical block check', { resultId });
      return check;
    }

    check.parts.technical = meta.tec_completed_at ? 'done' : 'pending';

    const englishRequired = meta.english_required === true || String(meta.english_required) === 'true' || String(meta.english_required) === '1';
    const mindsetRequired = meta.mindset_required === true || String(meta.mindset_required) === 'true' || String(meta.mindset_required) === '1';

    if (englishRequired) {
      const englishRow = unwrapRows<{ passed: unknown }>(
        (await zcql(req).executeZCQLQuery(
          `SELECT passed FROM EnglishTestSessions WHERE result_id = '${escapeSql(resultId)}' ORDER BY CREATEDTIME DESC LIMIT 1`,
        )) as unknown[],
        'EnglishTestSessions',
      )[0];
      if (!englishRow) {
        check.parts.english = 'pending';
      } else {
        const passed = englishRow.passed === true || String(englishRow.passed) === 'true' || String(englishRow.passed) === '1';
        check.parts.english = passed ? 'done_passed' : 'done_failed';
        if (!passed) check.englishFailed = true;
      }
    }

    if (mindsetRequired) {
      const mindsetRow = unwrapRows<{ ROWID: string }>(
        (await zcql(req).executeZCQLQuery(
          `SELECT ROWID FROM MindsetScores WHERE result_id = '${escapeSql(resultId)}' LIMIT 1`,
        )) as unknown[],
        'MindsetScores',
      )[0];
      check.parts.mindset = mindsetRow ? 'done' : 'pending';
    }

    const technicalDone = check.parts.technical === 'done';
    const englishDone = check.parts.english === 'not_applicable' || check.parts.english === 'done_passed' || check.parts.english === 'done_failed';
    const mindsetDone = check.parts.mindset === 'not_applicable' || check.parts.mindset === 'done';
    check.allComplete = technicalDone && englishDone && mindsetDone;
  } catch (err) {
    log.warn('technical block completion check failed', { resultId, error: (err as Error).message });
  }

  return check;
}
