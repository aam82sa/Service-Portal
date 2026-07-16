import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { fallbackPdf, renderReportPdf } from './pdf'

const input = {
  title: 'SLA compliance',
  subtitle: 'Jan–Jun 2026',
  columns: ['dept', 'pct'],
  rows: [{ dept: 'IT', pct: 98 }, { dept: 'ADMIN', pct: 87 }],
}

function pdfHeader(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 5))
}

describe('fallbackPdf', () => {
  it('returns a loadable single-page PDF for a small report', async () => {
    const bytes = await fallbackPdf(input)
    expect(pdfHeader(bytes)).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('paginates when the rows exceed one page', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ dept: 'IT', pct: i }))
    const doc = await PDFDocument.load(await fallbackPdf({ ...input, rows }))
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('does not throw on non-Latin cell content', async () => {
    const bytes = await fallbackPdf({ ...input, rows: [{ dept: 'الأمن السيبراني', pct: 91 }] })
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })
})

describe('renderReportPdf', () => {
  it('falls back to pdf-lib when no worker is configured', async () => {
    const bytes = await renderReportPdf(() => undefined, input)
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })
})
