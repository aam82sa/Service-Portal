/**
 * Minimal CSV writer for exports (RFC 4180 quoting): fields containing
 * commas, quotes, or newlines are quoted; quotes are doubled; objects and
 * arrays are JSON-encoded so jsonb detail columns survive the trip.
 */

export type CsvValue = string | number | boolean | null | undefined | object

export function csvField(v: CsvValue): string {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends object>(
  rows: T[],
  columns: { key: keyof T & string; header: string }[],
): string {
  const head = columns.map((c) => csvField(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => csvField(r[c.key] as CsvValue)).join(','))
  return [head, ...body].join('\r\n') + '\r\n'
}
