/**
 * Auto-populate del CandidatePool cuando un candidato completa pruebas.
 *
 * Triggered desde:
 *   - publicTest.transitResult cuando stage llega a `integridad_completed` o `videos_completed`
 *   - applications.transitionApplication cuando admin lo manda a `finalist` o estados post-tests
 *
 * Si la tabla `CandidatePool` no existe (deferred Block 2), no-op silencioso.
 * Si el candidate ya está en el pool, hace UPSERT (actualiza snapshot de scores + last_active).
 */
import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRow, unwrapRows } from './dbHelpers';
import { stringifyAndTruncate, FIELD_LIMITS } from './dbLimits';
import { logger } from './logger';

const log = logger('POOL_AUTO_POPULATE');
const TABLE = 'CandidatePool';

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

type ResultPick = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
};
type JobPick = {
  ROWID: string;
  tenant_id: string;
  cognitive_level: 'basic' | 'mid' | 'senior';
  ideal_profile: string | null;
};
type ScoresPick = {
  disc_norm_d?: number; disc_norm_i?: number; disc_norm_s?: number; disc_norm_c?: number;
  velna_indice?: number;
};
type ExistingPoolEntry = {
  ROWID: string;
  tags: string;
};

/**
 * Inserta o actualiza la entrada del candidato en el pool. Best-effort, fire-and-forget.
 */
export async function upsertPoolFromApplication(
  req: IncomingMessage,
  applicationId: string,
  extraTags: string[] = [],
): Promise<void> {
  if (!(await isTableReady(req))) return;
  try {
    // Cargar context: Result + Job + Scores
    const result = unwrapRows<ResultPick>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, assessment_id, candidate_id FROM Results WHERE ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    )[0];
    if (!result) {
      log.warn('result not found for pool upsert', { applicationId });
      return;
    }

    const [job, scores] = await Promise.all([
      unwrapRows<JobPick>(
        (await zcql(req).executeZCQLQuery(
          `SELECT ROWID, tenant_id, cognitive_level, ideal_profile FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
        )) as unknown[],
        'Jobs',
      )[0],
      unwrapRows<ScoresPick>(
        (await zcql(req).executeZCQLQuery(
          `SELECT disc_norm_d, disc_norm_i, disc_norm_s, disc_norm_c, velna_indice FROM Scores WHERE result_id = '${escapeSql(applicationId)}' LIMIT 1`,
        )) as unknown[],
        'Scores',
      )[0],
    ]);

    if (!job) {
      log.warn('job not found for pool upsert', { applicationId, jobId: result.assessment_id });
      return;
    }

    // Tags derivados: cognitive_level + extraTags pasados por caller
    const baseTags = [job.cognitive_level, ...extraTags].filter(Boolean);

    // ¿Existe ya en el pool?
    const existing = unwrapRows<ExistingPoolEntry>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, tags FROM ${TABLE} WHERE candidate_id = '${escapeSql(result.candidate_id)}' AND tenant_id = '${escapeSql(job.tenant_id)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];

    if (existing) {
      // UPSERT: merge tags, refresh snapshot + last_active
      const existingTags = parseTagsSafe(existing.tags);
      const mergedTags = Array.from(new Set([...existingTags, ...baseTags]));

      await datastore(req).table(TABLE).updateRow({
        ROWID: existing.ROWID,
        tags: stringifyAndTruncate(mergedTags, FIELD_LIMITS.POOL_TAGS, 'CandidatePool.tags'),
        last_active: now(),
        disc_d: scores?.disc_norm_d ?? null,
        disc_i: scores?.disc_norm_i ?? null,
        disc_s: scores?.disc_norm_s ?? null,
        disc_c: scores?.disc_norm_c ?? null,
        velna_indice: scores?.velna_indice ?? null,
        cognitive_level: job.cognitive_level,
        updated_at: now(),
      });

      log.info('pool entry updated from application', {
        applicationId,
        poolEntryId: existing.ROWID,
        merged_tags: mergedTags.length,
      });
    } else {
      // INSERT
      const inserted = await datastore(req).table(TABLE).insertRow({
        tenant_id: job.tenant_id,
        candidate_id: result.candidate_id,
        tags: stringifyAndTruncate(baseTags, FIELD_LIMITS.POOL_TAGS, 'CandidatePool.tags'),
        disponible_para_outreach: true,
        last_active: now(),
        contact_preference: 'email',
        times_contacted: 0,
        last_contacted_at: null,
        notes_internal: null,
        disc_d: scores?.disc_norm_d ?? null,
        disc_i: scores?.disc_norm_i ?? null,
        disc_s: scores?.disc_norm_s ?? null,
        disc_c: scores?.disc_norm_c ?? null,
        velna_indice: scores?.velna_indice ?? null,
        cognitive_level: job.cognitive_level,
        languages: stringifyAndTruncate([], FIELD_LIMITS.POOL_LANGUAGES, 'CandidatePool.languages'),
        added_at: now(),
        updated_at: now(),
      });
      const row = unwrapRow<{ ROWID: string }>(inserted, TABLE);
      log.info('pool entry created from application', {
        applicationId,
        poolEntryId: row?.ROWID,
        tags_count: baseTags.length,
      });
    }
  } catch (err) {
    log.warn('upsertPoolFromApplication failed', {
      applicationId,
      error: (err as Error).message,
    });
  }
}

function parseTagsSafe(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function _resetTableReadyForTests() {
  tableReady = null;
}
