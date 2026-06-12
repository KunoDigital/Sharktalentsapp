/**
 * Helper para exportar arrays de objetos a CSV.
 * Sin dependencias externas — escape de comillas/comas/newlines hecho a mano.
 */

function escapeCell(value: unknown): string {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : Array.isArray(value) ? value.join(';') : String(value);
  // CSV escape: si contiene coma, comilla o newline → wrap en comillas + duplicar comillas internas
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvColumn<T> = {
  key: keyof T | string;
  label: string;
  /** Custom getter para campos derivados. */
  get?: (row: T) => unknown;
};

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => {
      const v = c.get ? c.get(row) : (row as Record<string, unknown>)[c.key as string];
      return escapeCell(v);
    }).join(','),
  );
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
