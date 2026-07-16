import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { artifactMeta, toAOA, toCSV, toXLSX } from './render'

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
