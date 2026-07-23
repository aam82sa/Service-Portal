/**
 * Bidi run handling for the PDF fallback. fontkit shapes + visual-orders the
 * glyphs INSIDE an Arabic run (asserted in shaping test below); these tests
 * pin the run splitting and run ordering that artext adds on top.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fontkit from '@pdf-lib/fontkit'
import { hasArabic, visualRuns } from './artext.ts'

describe('hasArabic', () => {
  it('detects Arabic across the blocks and stays false for Latin', () => {
    expect(hasArabic('طلب جديد')).toBe(true)
    expect(hasArabic('REQ-1291')).toBe(false)
    expect(hasArabic('mixed طلب text')).toBe(true)
  })
})

describe('visualRuns', () => {
  it('a pure Arabic line is one RTL run', () => {
    expect(visualRuns('طلب جديد')).toEqual([{ text: 'طلب جديد', arabic: true }])
  })

  it('a pure Latin line is one LTR run', () => {
    expect(visualRuns('REQ-1291 open')).toEqual([{ text: 'REQ-1291 open', arabic: false }])
  })

  it('an RTL-base mixed line reverses run order (Latin drawn first = leftmost)', () => {
    // logical: [طلب جديد][ REQ-1291] → visual: Latin left, Arabic right
    const runs = visualRuns('طلب جديد REQ-1291')
    expect(runs.map((r) => r.arabic)).toEqual([false, true])
    expect(runs[1].text).toBe('طلب جديد')
    expect(runs[0].text.trim()).toBe('REQ-1291')
  })

  it('an LTR-base mixed line keeps logical order', () => {
    const runs = visualRuns('Dept: قسم تقنية المعلومات')
    expect(runs.map((r) => r.arabic)).toEqual([false, true])
    expect(runs[0].text).toBe('Dept: ')
  })

  it('digits and joining punctuation between Arabic segments stay in the Arabic run', () => {
    expect(visualRuns('آخر 30 يوماً')).toEqual([{ text: 'آخر 30 يوماً', arabic: true }])
  })

  it('uncovered neutrals (parens, %) fall to the Latin font', () => {
    const runs = visualRuns('نسبة (94%)')
    const latin = runs.filter((r) => !r.arabic).map((r) => r.text).join('')
    expect(latin).toContain('(')
    expect(latin).toContain('%')
  })
})

describe('fontkit shaping contract (what pdf-lib draws)', () => {
  it('shapes joining forms and returns Arabic glyphs in visual order', () => {
    const font = fontkit.create(
      readFileSync(fileURLToPath(new URL('./fonts/NotoSansArabic-Regular.ttf', import.meta.url))) as Buffer,
    )
    const run = font.layout('طلب')
    expect(run.direction).toBe('rtl')
    const names = run.glyphs.map((g: { name?: string }) => g.name ?? '')
    // Tah takes its INITIAL form (it is the logical first letter)…
    expect(names).toContain('uni0637.init')
    // …and sits LAST in the glyph array — i.e. the array is already visual
    // order, so drawing left-to-right renders correct Arabic.
    expect(names[names.length - 1]).toBe('uni0637.init')
    expect(run.glyphs.some((g: { id: number }) => g.id === 0)).toBe(false) // no .notdef
  })
})
