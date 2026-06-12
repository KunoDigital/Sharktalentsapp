/**
 * Helper para operaciones fire-and-forget: el caller no espera el resultado,
 * pero queremos garantizar que cualquier error NO se propague como
 * unhandled-promise-rejection (que en Node 20 con `--unhandled-rejections=strict`
 * tumba el worker).
 *
 * 2026-06-04 (audit fix #16): unificamos el patrón. Antes había `void (async () => {...})()`
 * sueltos sin try/catch en al menos 6 lugares.
 *
 * Uso:
 *   fireAndForget('publish_recruit_sync', async () => {
 *     const { publishRecruitSync } = await import('../lib/recruitSyncPublisher.js');
 *     await publishRecruitSync(...);
 *   });
 *
 * Si la operación tira, se logguea como `warn` con el label + error, pero el
 * proceso sigue.
 */

import { logger } from './logger';

const log = logger('FIRE_AND_FORGET');

export function fireAndForget(label: string, fn: () => Promise<unknown>): void {
  fn().catch((err) => {
    const msg = (err as Error)?.message ?? String(err);
    log.warn(`unhandled in ${label}`, { error: msg });
  });
}
