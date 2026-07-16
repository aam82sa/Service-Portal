import { describe, expect, it } from 'vitest'
import { buildPrompt, mediaBlock, parseExtraction } from './extract'

describe('buildPrompt', () => {
  it('lists the required keys and appends tenant corrections', () => {
    const p = buildPrompt([{ field: 'sender', extracted: 'MOI', corrected: 'وزارة الداخلية' }])
    expect(p).toContain('"ocr_text"')
    expect(p).toContain('"brief_en"')
    expect(p).toContain('- sender: "MOI" → "وزارة الداخلية"')
  })

  it('has no corrections section when there are no examples', () => {
    expect(buildPrompt([])).not.toContain('Corrections previously made')
  })
})

describe('parseExtraction', () => {
  it('parses plain JSON and fenced JSON alike', () => {
    const obj = { ocr_text: 'x', letter_date: null, letter_number: '4471', sender: null, addressee: null, subject: 's', brief_ar: null, brief_en: null }
    expect(parseExtraction(JSON.stringify(obj)).letter_number).toBe('4471')
    expect(parseExtraction('```json\n' + JSON.stringify(obj) + '\n```').subject).toBe('s')
  })
})

describe('mediaBlock', () => {
  it('produces a document block for PDFs and an image block otherwise', () => {
    expect(mediaBlock('application/pdf', 'AAA').type).toBe('document')
    expect(mediaBlock('image/jpeg', 'AAA').type).toBe('image')
    const fallback = mediaBlock('', 'AAA') as { source: { media_type: string } }
    expect(fallback.source.media_type).toBe('image/png')
  })
})
