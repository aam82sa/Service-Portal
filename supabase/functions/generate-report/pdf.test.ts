import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
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

/** every /BaseFont name in the parsed PDF (object streams are compressed,
 * so the names are only visible through pdf-lib's object graph) */
async function baseFonts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const names: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const bf = obj.get(PDFName.of('BaseFont'))
      if (bf instanceof PDFName) names.push(bf.decodeText())
    }
  }
  return names
}

describe('Arabic rendering (branch 6 acceptance)', () => {
  it('a PDF containing "طلب جديد" embeds Noto Sans Arabic — no ? degradation', async () => {
    const bytes = await fallbackPdf({
      ...input,
      title: 'طلب جديد',
      rows: [{ dept: 'الأمن السيبراني', pct: 91 }, { dept: 'IT', pct: 98 }],
    })
    expect(pdfHeader(bytes)).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    // the Arabic face is really embedded (as a subset: XXXXXX+NotoSansArabic)
    expect((await baseFonts(bytes)).some((n) => n.includes('NotoSansArabic'))).toBe(true)
  })

  it('a Latin-only report embeds no Arabic font payload', async () => {
    const bytes = await fallbackPdf(input)
    expect((await baseFonts(bytes)).some((n) => n.includes('NotoSansArabic'))).toBe(false)
  })

  it('mixed RTL/LTR lines (Arabic title with a Latin ref) still render', async () => {
    const bytes = await fallbackPdf({ ...input, title: 'طلب جديد REQ-1291', subtitle: 'قسم IT · آخر 30 يوماً' })
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })
})

describe('dashboard document mode (sections)', () => {
  it('renders a KPI band + titled bar/table sections into one PDF', async () => {
    const bytes = await fallbackPdf({
      title: 'IT Service Overview — export',
      subtitle: 'Last 30 days · IT',
      columns: [], rows: [],
      sections: [
        { title: 'Requests in period', kind: 'kpi', columns: ['value'], rows: [{ value: 128 }] },
        { title: 'Volume by service', kind: 'bar', columns: ['service_code', 'value'], rows: [
          { service_code: 'HW', value: 24 }, { service_code: 'AC', value: 19 },
        ] },
        { title: 'Underlying records', kind: 'table', columns: ['ref', 'dept', 'status'], rows: [
          { ref: 'REQ-1', dept: 'IT', status: 'new' },
        ] },
      ],
    })
    expect(pdfHeader(bytes)).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('renders an Arabic-titled section correctly', async () => {
    const bytes = await fallbackPdf({
      title: 'لوحة المعلومات',
      columns: [], rows: [],
      sections: [{ title: 'الحجم حسب الخدمة', kind: 'bar', columns: ['service_code', 'value'], rows: [{ service_code: 'HW', value: 5 }] }],
    })
    expect((await baseFonts(bytes)).some((n) => n.includes('NotoSansArabic'))).toBe(true)
  })
})
