import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { artifactMeta, columnWidths, sectionsToXLSX, toAOA, toCSV, toXLSX } from './render'

const columns = ['dept', 'total', 'sla_met']
const rows = [
  { dept: 'IT', total: 12, sla_met: true },
  { dept: 'ADMIN', total: 4, sla_met: false },
]

describe('toAOA', () => {
  it('puts the header first and maps null/undefined to empty cells', () => {
    const aoa = toAOA(['a', 'b'], [{ a: 1 }, { a: null, b: 'x' }])
    expect(aoa).toEqual([
      ['a', 'b'],
      [1, ''],
      ['', 'x'],
    ])
  })

  it('stringifies nested objects', () => {
    const aoa = toAOA(['j'], [{ j: { k: 1 } }])
    expect(aoa[1][0]).toBe('{"k":1}')
  })
})

describe('toCSV', () => {
  it('emits a header row and CRLF-separated data rows', () => {
    expect(toCSV(columns, rows)).toBe('dept,total,sla_met\r\nIT,12,true\r\nADMIN,4,false')
  })

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCSV(['subject'], [{ subject: 'Budget, Q1' }, { subject: 'He said "hi"' }, { subject: 'line1\nline2' }])
    expect(csv).toContain('"Budget, Q1"')
    expect(csv).toContain('"He said ""hi"""')
    expect(csv).toContain('"line1\nline2"')
  })
})

describe('toXLSX', () => {
  it('produces a workbook whose first sheet round-trips the data', () => {
    const bytes = toXLSX(columns, rows)
    expect(bytes.byteLength).toBeGreaterThan(0)
    const wb = XLSX.read(bytes, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const back = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]
    expect(back[0]).toEqual(['dept', 'total', 'sla_met'])
    expect(back[1]).toEqual(['IT', 12, true])
    expect(back[2]).toEqual(['ADMIN', 4, false])
  })
})

describe('artifactMeta', () => {
  it('maps formats to extension + content type', () => {
    expect(artifactMeta('csv')).toEqual({ ext: 'csv', contentType: 'text/csv; charset=utf-8' })
    expect(artifactMeta('xlsx').ext).toBe('xlsx')
    expect(artifactMeta('pdf').contentType).toBe('application/pdf')
  })
})

describe('XLSX polish (branch 6)', () => {
  it('sizes columns to content within the 8–40 clamp', () => {
    const widths = columnWidths(['ref', 'title'], [
      { ref: 'REQ-1291', title: 'a very long request title that should hit the upper clamp eventually yes' },
    ])
    expect(widths[0].wch).toBe(10) // 'REQ-1291' + 2
    expect(widths[1].wch).toBe(40) // clamped
    expect(columnWidths(['x'], [])[0].wch).toBe(8) // floor
  })

  it('writes widths and an autofilter into the sheet', () => {
    const bytes = toXLSX(['dept', 'total'], [{ dept: 'IT', total: 12 }])
    // cellStyles:true makes the reader parse <cols> back out of the file
    const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })
    const ws = wb.Sheets['Report']
    expect(ws['!autofilter']).toEqual({ ref: 'A1:B2' })
    // widths survive the write/read round-trip
    expect(ws['!cols']?.[0]?.wch ?? ws['!cols']?.[0]?.width).toBeTruthy()
  })
})

describe('sectionsToXLSX (dashboard document)', () => {
  it('writes one sheet per section with unique, sanitized names', () => {
    const bytes = sectionsToXLSX([
      { title: 'Volume by service', columns: ['service_code', 'value'], rows: [{ service_code: 'HW', value: 12 }] },
      { title: 'By priority', columns: ['priority', 'value'], rows: [{ priority: 'P1', value: 3 }] },
    ])
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Volume by service', 'By priority'])
    expect(XLSX.utils.sheet_to_json(wb.Sheets['By priority'])).toEqual([{ priority: 'P1', value: 3 }])
  })

  it('dedupes and clamps sheet names', () => {
    const long = 'A very long widget title that exceeds the excel limit for sure'
    const bytes = sectionsToXLSX([
      { title: long, columns: ['a'], rows: [] },
      { title: long, columns: ['a'], rows: [] },
    ])
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames[0]).toHaveLength(31)
    expect(wb.SheetNames[0]).not.toBe(wb.SheetNames[1])
  })
})
