import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRow } from './dbHelpers';

const TABLE = 'ProcessedEvents';

export type ProcessedEvent = {
  ROWID: string;
  event_id: string;
  source: string;
  processed_at: string;
};

export async function markProcessed(
  req: IncomingMessage,
  eventId: string,
  source: string,
): Promise<{ isNew: boolean }> {
  const existing = await find(req, eventId, source);
  if (existing) return { isNew: false };

  try {
    await datastore(req).table(TABLE).insertRow({
      event_id: eventId,
      source,
      processed_at: now(),
    });
    return { isNew: true };
  } catch (err) {
    const dup = await find(req, eventId, source);
    if (dup) return { isNew: false };
    throw err;
  }
}

async function find(req: IncomingMessage, eventId: string, source: string): Promise<ProcessedEvent | null> {
  const query = `SELECT * FROM ${TABLE} WHERE event_id = '${escapeSql(eventId)}' AND source = '${escapeSql(source)}' LIMIT 1`;
  const result = (await zcql(req).executeZCQLQuery(query)) as unknown[];
  return unwrapRow<ProcessedEvent>(result[0], TABLE);
}
