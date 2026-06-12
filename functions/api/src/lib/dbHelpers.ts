export function escapeSql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export function quoteSql(value: string | null | undefined): string {
  if (value == null) return 'NULL';
  return `'${escapeSql(value)}'`;
}

export type Row = Record<string, unknown>;

export function unwrapRow<T extends Row>(raw: unknown, table: string): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const inner = (obj[table] ?? obj) as T;
  return inner;
}

export function unwrapRows<T extends Row>(raws: unknown[], table: string): T[] {
  return raws.map((r) => unwrapRow<T>(r, table)).filter((r): r is T => r !== null);
}

/**
 * Formato datetime aceptado por Catalyst ZCQL: `YYYY-MM-DD HH:MM:SS`.
 *
 * 2026-06-04: Catalyst dejó de aceptar ISO 8601 con `T`, milisegundos y `Z` en queries.
 * Errores típicos: "Invalid input value for CREATEDTIME. datetime value expected".
 *
 * Uso:
 *   const cutoff = formatCatalystDateTime(new Date(Date.now() - 86400_000));
 *   await zcql.executeZCQLQuery(`SELECT * FROM X WHERE CREATEDTIME >= '${cutoff}'`);
 */
export function formatCatalystDateTime(d: Date): string {
  // toISOString → "2026-03-06T01:23:45.678Z" → slice(0,19) → "2026-03-06T01:23:45" → replace → "2026-03-06 01:23:45"
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Catalyst ZCQL tiene un LIMIT máximo de 300 filas por query. Si pasamos más, devuelve
 * "ZCQL CANNOT HAVE MORE THAN 300 ROWS in LIMIT". Helper que recorta cualquier limit
 * pedido al máximo permitido.
 */
export const CATALYST_MAX_LIMIT = 300;
export function safeLimit(n: number | undefined, fallback = 100): number {
  return Math.max(1, Math.min(CATALYST_MAX_LIMIT, Number.isFinite(n) ? Number(n) : fallback));
}

/**
 * Construye un IN-clause para columnas BIGINT (típicamente ROWID, candidate_id,
 * assessment_id, etc.). Catalyst rechaza las quotes alrededor de valores BIGINT con
 * "Invalid input value for BIGINT column 'X'". Esta función emite los valores sin quotes
 * pero valida que cada uno sea un dígito puro para evitar inyección.
 */
export function bigintInClause(ids: Array<string | number>): string {
  return ids
    .map((id) => String(id).trim())
    .filter((s) => /^\d+$/.test(s)) // solo dígitos puros — protege contra inyección
    .join(',');
}
