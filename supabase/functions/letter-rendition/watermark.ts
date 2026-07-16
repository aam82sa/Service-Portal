import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

/**
 * WinAnsi-safe subset of the viewer stamp. Helvetica cannot encode Arabic
 * (or most non-Latin) glyphs, so those characters are dropped — the uid
 * fragment, timestamp, reference and tier always survive, which is what
 * makes a leaked copy attributable.
 */
export function sanitizeStamp(stamp: string): string {
  const cleaned = stamp
    .replace(/[^\x20-\x7E·]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned.length >= 8 ? cleaned : 'CONFIDENTIAL COPY'
}

export type SourceKind = 'pdf' | 'png' | 'jpeg'

export function kindOf(filename: string, mime: string | null): SourceKind | null {
  const f = filename.toLowerCase()
  const m = mime ?? ''
  if (m.includes('pdf') || f.endsWith('.pdf')) return 'pdf'
  if (m.includes('png') || f.endsWith('.png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg') || f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'jpeg'
  return null
}

/**
 * Produce a stamped PDF rendition of a letter scan. PDFs keep their pages;
 * images are embedded on a single page at native size. Diagonal rows of the
 * viewer stamp are burned into the page content itself, so unlike the old
 * client-side overlay there is no clean byte-stream underneath to save.
 */
export async function stampedRendition(
  bytes: Uint8Array, kind: SourceKind, stamp: string
): Promise<Uint8Array> {
  const text = sanitizeStamp(stamp)

  let doc: PDFDocument
  if (kind === 'pdf') {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } else {
    doc = await PDFDocument.create()
    const img = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    const page = doc.addPage([img.width, img.height])
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }

  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const unit = `${text}      `
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // scale the type and row pitch with the page so scans of any size read
    // the same as the reference mock (12px rows every 84px on ~600px pages)
    const size = Math.max(9, Math.min(16, width / 50))
    const pitch = size * 7
    const unitWidth = font.widthOfTextAtSize(unit, size)
    const row = unit.repeat(Math.max(2, Math.ceil(((width + height) * 1.6) / unitWidth)))
    for (let y = -Math.ceil(height * 0.6); y < width + height; y += pitch) {
      page.drawText(row, {
        x: -width * 0.3, y, size, font,
        color: rgb(0.06, 0.1, 0.18), opacity: 0.16,
        rotate: degrees(27),
      })
    }
  }
  return await doc.save()
}
