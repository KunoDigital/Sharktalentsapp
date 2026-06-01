import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRow } from './dbHelpers';
import { logger } from './logger';

const log = logger('PROCESSED_EVENTS');
const TABLE = 'ProcessedEvents';

export type ProcessedEvent = {
  ROWID: string;
  event_id: string;
  provider: string;
  received_at: string;
};

export async function markProcessed(
  req: IncomingMessage,
  eventId: string,
  provider: string,
): Promise<{ isNew: boolean }> {
  const existing = await find(req, eventId, provider);
  if (existing) return { isNew: false };

  try {
    await datastore(req).table(TABLE).insertRow({
      event_id: eventId,
      provider,
      received_at: now(),
    });
    return { isNew: true };
  } catch (err) {
    // Race condition: otra request insertó al mismo tiempo. Re-lookup.
    let dup: ProcessedEvent | null = null;
    try {
      dup = await find(req, eventId, provider);
    } catch (refetchErr) {
      log.warn('refetch after insert failure also failed', {
        eventId, provider,
        original: (err as Error).message,
        refetch: (refetchErr as Error).message,
      });
      throw err;
    }
    if (dup) return { isNew: false };
    throw err;
  }
}

async function find(req: IncomingMessage, eventId: string, provider: string): Promise<ProcessedEvent | null> {
  const query = `SELECT * FROM ${TABLE} WHERE event_id = '${escapeSql(eventId)}' AND provider = '${escapeSql(provider)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRow<ProcessedEvent>(result[0], TABLE);
}
