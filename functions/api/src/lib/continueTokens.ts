/**
 * ContinueTokens — persistencia para "Save & Continue" del candidato.
 *
 * El candidato puede pausar el test, recibir un email/WhatsApp con un token,
 * y retomar más tarde sin perder progreso. Cada token referencia un Result en curso
 * + el último bloque completado.
 *
 * Tabla `ContinueTokens` (deferred Block 2):
 *   ROWID, result_id, token_hash (sha256 del token, no el raw), last_block_completed,
 *   reminder_sent_at, expires_at, created_at, used_at
 *
 * Casos de uso:
 *   1. Candidato cierra el browser después de DISC → backend genera token + manda email
 *   2. Candidato vuelve 1-2 días después con el link → token verifica, retoma desde last_block
 *   3. Email reminder cron job (24h sin uso, 48h sin uso, 7 días → expirar)
 *
 * Si la tabla no existe, el flow del candidato sigue funcionando pero sin save & continue
 * (el candidato debe completar todo en una sesión, igual que la v1 actual).
 */

import type { IncomingMessage } from 'http';
import { datastore, zcql, now } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { logger } from './logger';
import { createHash, randomBytes } from 'crypto';

const log = logger('CONTINUE_TOKENS');
const TABLE = 'ContinueTokens';

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

export function _resetContinueTokensCache() {
  tableReady = null;
}

/** Hash sha256 del token (truncado a 32 chars) — guardamos esto en DB, no el raw. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/** Genera un token raw (32 hex chars). Devuelve solo una vez — guardar el hash. */
export function generateToken(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export type ContinueTokenInput = {
  resultId: string;
  lastBlockCompleted: string; // ej: 'disc' | 'mindset' | 'velna' | 'integrity' | 'emotional' | 'tech'
  ttlDays?: number; // default 7
};

export type ContinueTokenRow = {
  ROWID: string;
  result_id: string;
  token_hash: string;
  last_block_completed: string;
  reminder_sent_at: string | null;
  expires_at: string;
  created_at: string;
  used_at: string | null;
};

/**
 * Genera + persiste un token para que el candidato retome el test después.
 *
 * @returns El token RAW (mandar al candidato por email/whatsapp), o null si la tabla
 *          no existe o falló el insert. El hash queda en DB.
 */
export async function createContinueToken(
  req: IncomingMessage,
  input: ContinueTokenInput,
): Promise<string | null> {
  if (!(await isTableReady(req))) return null;

  const token = generateToken();
  const hash = hashToken(token);
  const ttlDays = input.ttlDays ?? 7;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    await datastore(req).table(TABLE).insertRow({
      result_id: input.resultId,
      token_hash: hash,
      last_block_completed: input.lastBlockCompleted,
      reminder_sent_at: null,
      expires_at: expiresAt,
      created_at: now(),
      used_at: null,
    });
    log.info('continue token created', {
      resultId: input.resultId,
      lastBlock: input.lastBlockCompleted,
      ttlDays,
    });
    return token;
  } catch (err) {
    log.warn('createContinueToken failed', {
      resultId: input.resultId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Verifica un token recibido del candidato. Si es válido, devuelve el row.
 * Marca `used_at = now` (idempotente — un mismo token puede usarse varias veces hasta expirar).
 */
export async function verifyContinueToken(
  req: IncomingMessage,
  token: string,
): Promise<ContinueTokenRow | null> {
  if (!(await isTableReady(req))) return null;

  const hash = hashToken(token);
  const q = `SELECT * FROM ${TABLE} WHERE token_hash = '${escapeSql(hash)}' LIMIT 1`;
  const rows = unwrapRows<ContinueTokenRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    TABLE,
  );
  const row = rows[0];
  if (!row) return null;

  // Verificar expiración
  if (new Date(row.expires_at) < new Date()) {
    log.info('continue token expired', { rowId: row.ROWID });
    return null;
  }

  // Marcar usado (best-effort)
  try {
    await datastore(req).table(TABLE).updateRow({
      ROWID: row.ROWID,
      used_at: now(),
    });
  } catch (err) {
    log.warn('mark used failed', { rowId: row.ROWID, error: (err as Error).message });
  }

  return row;
}

/**
 * Helper para cron de reminders: lista tokens que NO fueron usados en N horas y nunca
 * tuvieron reminder enviado. El cron job los procesa y publica `email.send_pending`.
 */
export async function listPendingReminders(
  req: IncomingMessage,
  hoursIdle = 24,
  limit = 50,
): Promise<ContinueTokenRow[]> {
  if (!(await isTableReady(req))) return [];

  const cutoff = new Date(Date.now() - hoursIdle * 60 * 60 * 1000).toISOString();
  const q = `
    SELECT * FROM ${TABLE}
    WHERE used_at IS NULL
      AND reminder_sent_at IS NULL
      AND created_at <= '${escapeSql(cutoff)}'
      AND expires_at > '${escapeSql(now())}'
    LIMIT ${Math.max(1, Math.min(200, limit))}
  `.replace(/\s+/g, ' ');

  return unwrapRows<ContinueTokenRow>(
    (await zcql(req).executeZCQLQuery(q)) as unknown[],
    TABLE,
  );
}

/** Marca reminder_sent_at = now en un token. */
export async function markReminderSent(
  req: IncomingMessage,
  rowId: string,
): Promise<void> {
  if (!(await isTableReady(req))) return;
  try {
    await datastore(req).table(TABLE).updateRow({
      ROWID: rowId,
      reminder_sent_at: now(),
    });
  } catch (err) {
    log.warn('markReminderSent failed', { rowId, error: (err as Error).message });
  }
}
