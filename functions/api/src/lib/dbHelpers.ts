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
