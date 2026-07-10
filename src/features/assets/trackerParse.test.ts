import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { exDate, isPerson, parseTrackerWorkbook } from './trackerParse'

/** Builds an in-memory tracker workbook fixture with the real sheet layout. */
function fixture(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, data] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name)
  }
  return wb
}

const HW_HEADERS = [
  'Tag no', 'Model Name', 'Serial Number', 'Manufacturer',
  'Primary user Display Name', 'Primary user assignment date', 'PO', 'Vendor',
  'Cost SAR', 'Status', 'Warranty End Date', 'Location',
]

describe('parseTrackerWorkbook — valid workbook', () => {
  const wb = fixture({
    'Windows L': [
      HW_HEADERS,
      ['1001', 'ThinkPad T14', 'SN-AAA-111', 'Lenovo', 'Basma Bishr', '15/03/2026', 'PO-88', 'Jarir', '4,500', 'Assigned', '15/03/2029', 'HQ'],
      ['1002', 'ThinkPad T14', 'SN-BBB-222', 'Lenovo', 'In Stock', '', 'PO-88', 'Jarir', '4,500', '', '', ''],
    ],
    'Software ': [
      ['SoftwareName', 'Purchased Quantity', 'ExpirationDate', 'Subscription Status', 'PO', 'Owner Email'],
      ['Adobe CC', '12', '2027-01-31', 'Active', 'PO-90', 'it@abccorp.com'],
      ['Legacy AV', '5', '2025-01-31', 'Expired', '', ''],
    ],
    'Active License Users': [
      ['User principal name', 'Licenses'],
      ['basma@abccorp.com', 'Adobe CC'],
    ],
  })
  const parsed = parseTrackerWorkbook(wb)

  it('parses hardware rows with normalized tags and holder-driven status', () => {
    expect(parsed.assets).toHaveLength(2)
    const [a, b] = parsed.assets
    expect(a.tag).toBe('LT-01001')
    expect(a.status).toBe('assigned')
    expect(a.holder).toBe('Basma Bishr')
    expect(a.assigned_at).toBe('2026-03-15')
    expect(a.cost).toBe(4500)
    expect(a.warranty_end).toBe('2029-03-15')
    // "In Stock" is not a person; no holder → in_stock
    expect(b.holder).toBeNull()
    expect(b.status).toBe('in_stock')
  })

  it('parses licenses and seat assignments', () => {
    expect(parsed.licenses.map((l) => [l.name, l.seats, l.subscription_status])).toEqual([
      ['Adobe CC', 12, 'active'],
      ['Legacy AV', 5, 'expired'],
    ])
    expect(parsed.seats).toEqual([{ license: 'Adobe CC', upn: 'basma@abccorp.com', status: 'active' }])
  })

  it('warns about hardware sheets missing from the workbook', () => {
    expect(parsed.warnings.some((w) => w.includes('Monitors'))).toBe(true)
  })
})

describe('parseTrackerWorkbook — duplicate serials', () => {
  it('keeps both rows but disambiguates the generated tags', () => {
    const wb = fixture({
      Monitors: [
        ['Model Name', 'Serial Number', 'Primary user Display Name'],
        ['Dell U2723', 'DUP-123', 'Dana Dib'],
        ['Dell U2723', 'DUP-123', 'Faisal Farraj'],
      ],
    })
    const parsed = parseTrackerWorkbook(wb)
    expect(parsed.assets).toHaveLength(2)
    const tags = parsed.assets.map((a) => a.tag)
    expect(new Set(tags).size).toBe(2)
    expect(tags[1]).toBe(`${tags[0]}B`)
  })
})

describe('parseTrackerWorkbook — malformed rows', () => {
  it('skips rows without model and serial, tolerates junk cells', () => {
    const wb = fixture({
      'Windows L': [
        HW_HEADERS,
        ['', '', '', '', '', '', '', '', '', '', '', ''], // fully empty
        ['9001', 'ThinkPad X1', 'N/A', 'Lenovo', '-', 'not a date', '', '', 'abc', 'Repair', 'garbage', ''],
      ],
    })
    const parsed = parseTrackerWorkbook(wb)
    expect(parsed.assets).toHaveLength(1)
    const a = parsed.assets[0]
    expect(a.serial).toBeNull() // 'N/A' normalized away
    expect(a.holder).toBeNull() // '-' is not a person
    expect(a.assigned_at).toBeNull() // unparseable date
    expect(a.cost).toBe(0) // non-numeric cost collapses to 0 (documented parser behavior)
    expect(a.status).toBe('repair')
  })

  it('returns empty collections for an empty workbook, with warnings', () => {
    const parsed = parseTrackerWorkbook(fixture({ Notes: [['nothing']] }))
    expect(parsed.assets).toEqual([])
    expect(parsed.licenses).toEqual([])
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })
})

describe('cell helpers', () => {
  it('exDate handles Excel serials, dd/mm/yyyy and ISO strings', () => {
    expect(exDate(45000)).toBe('2023-03-15')
    expect(exDate('09/07/2026')).toBe('2026-07-09')
    expect(exDate('2026-07-09T10:00:00')).toBe('2026-07-09')
    expect(exDate('yesterday')).toBeNull()
    expect(exDate('')).toBeNull()
  })

  it('isPerson filters stock placeholders', () => {
    expect(isPerson('Basma Bishr')).toBe(true)
    expect(isPerson('In Stock')).toBe(false)
    expect(isPerson('shared printer')).toBe(false)
    expect(isPerson('')).toBe(false)
  })
})
