import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { kindOf, sanitizeStamp, stampedRendition } from './watermark'

// 1×1 red pixel
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

async function makePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  return await doc.save()
}

describe('sanitizeStamp', () => {
  it('keeps the attributable Latin parts and drops non-WinAnsi glyphs', () => {
    const s = sanitizeStamp('سارة العمري · 4f9c2a1b · 2026-07-16 09:42 · ADM/2026/0142 · CONFIDENTIAL')
    expect(s).toContain('4f9c2a1b')
    expect(s).toContain('ADM/2026/0142')
    expect(s).toContain('CONFIDENTIAL')
    expect(/[؀-ۿ]/.test(s)).toBe(false)
  })

  it('falls back to a generic stamp when nothing printable survives', () => {
    expect(sanitizeStamp('سارة')).toBe('CONFIDENTIAL COPY')
  })
})

describe('kindOf', () => {
  it('detects by mime first, extension second', () => {
    expect(kindOf('scan.pdf', null)).toBe('pdf')
    expect(kindOf('scan.bin', 'application/pdf')).toBe('pdf')
    expect(kindOf('scan.PNG', null)).toBe('png')
    expect(kindOf('photo.jpeg', 'image/jpeg')).toBe('jpeg')
    expect(kindOf('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeNull()
  })
})

describe('stampedRendition', () => {
  it('stamps every page of a PDF and keeps the page count', async () => {
    const src = await makePdf(2)
    const out = await stampedRendition(src, 'pdf', 'Viewer Name · 4f9c2a1b · 2026-07-16 09:42 · IT/2026/0311 · RESTRICTED')
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    // stamped output must carry the extra text content
    expect(out.byteLength).toBeGreaterThan(src.byteLength)
  })

  it('wraps an image into a single stamped PDF page', async () => {
    const out = await stampedRendition(PNG_1PX, 'png', 'V · 4f9c2a1b · 2026-07-16 09:42 · REF · GENERAL')
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
  })
})
