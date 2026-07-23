/**
 * Tabular renderers for report artifacts. CSV is hand-rolled (RFC 4180 quoting);
 * XLSX is built with SheetJS. Both take the compiler's ordered `columns` as the
 * header and the row objects returned by report_fetch_rows. Kept free of any DB
 * or network side effects so they can be unit-tested directly.
 */

import * as XLSX from 'xlsx'

export type Row = Record<string, unknown>
export type Cell = string | number | boolean

/** Flatten one JSON value to a spreadsheet/CSV cell. */
function cell(v: unknown): Cell {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v
  return JSON.stringify(v)
}

/** header row + body as an array-of-arrays, the shared shape for CSV and XLSX. */
export function toAOA(columns: string[], rows: Row[]): Cell[][] {
  return [columns.slice(), ...rows.map((r) => columns.map((c) => cell(r[c])))]
}

/** RFC 4180 CSV: CRLF rows, fields quoted only when they contain "," CR or LF. */
export function toCSV(columns: string[], rows: Row[]): string {
  const esc = (v: Cell) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return toAOA(columns, rows).map((line) => line.map(esc).join(',')).join('\r\n')
}

/** column widths sized to content (clamped 8–40 chars) — Excel opens readable */
export function columnWidths(columns: string[], rows: Row[]): { wch: number }[] {
  return columns.map((c) => {
    let w = String(c).length
    for (const r of rows) w = Math.max(w, String(cell(r[c])).length)
    return { wch: Math.min(40, Math.max(8, w + 2)) }
  })
}

/**
 * XLSX workbook bytes with a single "Report" sheet: content-sized column
 * widths and an autofilter over the data range. (Header band colors / bold
 * need a styling build of SheetJS — pending the xlsx-js-style decision.)
 */
export function toXLSX(columns: string[], rows: Row[]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(toAOA(columns, rows))
  ws['!cols'] = columnWidths(columns, rows)
  if (columns.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }),
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

/** file extension + content type for a format (pdf handled by pdf.ts). */
export function artifactMeta(format: string): { ext: string; contentType: string } {
  switch (format) {
    case 'csv': return { ext: 'csv', contentType: 'text/csv; charset=utf-8' }
    case 'xlsx': return { ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    case 'pdf': return { ext: 'pdf', contentType: 'application/pdf' }
    default: return { ext: 'bin', contentType: 'application/octet-stream' }
  }
}
