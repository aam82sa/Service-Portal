/**
 * Arabic text handling for the pdf-lib fallback renderer.
 *
 * What the experiment established (and pdf.test.ts re-asserts): fontkit —
 * which pdf-lib uses to lay out custom fonts — applies full OpenType Arabic
 * shaping (init/medi/fina forms, lam-alef) AND returns the glyphs of an
 * Arabic run in VISUAL order, so drawing a single-script run left-to-right
 * is already correct. What fontkit does NOT do is bidi: a mixed line
 * ("طلب جديد REQ-123") must be split into script runs and the runs placed
 * in visual order ourselves. Noto Sans Arabic also carries no Latin letters
 * (A → .notdef), so Latin runs keep the existing Helvetica path.
 */

const AR_RANGES: [number, number][] = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb50, 0xfdff], // Presentation Forms-A
  [0xfe70, 0xfeff], // Presentation Forms-B
]

const isArabicCp = (cp: number) => AR_RANGES.some(([a, b]) => cp >= a && cp <= b)

export const hasArabic = (s: string): boolean => [...s].some((ch) => isArabicCp(ch.codePointAt(0)!))

/**
 * Neutrals that may join an Arabic run — verified present in Noto Sans
 * Arabic's cmap (space, ASCII + Arabic-Indic digits, . , - :). Anything
 * else non-Arabic (Latin letters, parens, %) is drawn with the Latin font.
 */
const isNeutral = (cp: number) =>
  cp === 0x20 || (cp >= 0x30 && cp <= 0x39) || (cp >= 0x660 && cp <= 0x669) ||
  cp === 0x2e || cp === 0x2c || cp === 0x2d || cp === 0x3a

export interface TextRun {
  text: string
  arabic: boolean
}

/**
 * Split a line into script runs and return them in VISUAL order (left to
 * right, ready to draw sequentially). Neutrals between two Arabic segments
 * stay Arabic; otherwise they attach to the Latin side. If the first strong
 * character is Arabic the line's base direction is RTL and the run order is
 * reversed — each Arabic run's inner order is fontkit's job, and each Latin
 * run keeps LTR.
 */
export function visualRuns(s: string): TextRun[] {
  type Cls = 'ar' | 'lat' | 'neu'
  const chars = [...s]
  if (chars.length === 0) return []
  const cls: Cls[] = chars.map((ch) => {
    const cp = ch.codePointAt(0)!
    return isArabicCp(cp) ? 'ar' : isNeutral(cp) ? 'neu' : 'lat'
  })

  // resolve neutrals: between two Arabic neighbours → ar, else → lat
  const strongBefore: (Cls | null)[] = []
  let lastStrong: Cls | null = null
  for (let i = 0; i < cls.length; i++) {
    strongBefore.push(lastStrong)
    if (cls[i] !== 'neu') lastStrong = cls[i]
  }
  const strongAfter: (Cls | null)[] = new Array(cls.length).fill(null)
  let nextStrong: Cls | null = null
  for (let i = cls.length - 1; i >= 0; i--) {
    strongAfter[i] = nextStrong
    if (cls[i] !== 'neu') nextStrong = cls[i]
  }
  const resolved: ('ar' | 'lat')[] = cls.map((c, i) => {
    if (c !== 'neu') return c
    return strongBefore[i] === 'ar' && strongAfter[i] === 'ar' ? 'ar' : 'lat'
  })

  // group into runs (logical order)
  const runs: TextRun[] = []
  for (let i = 0; i < chars.length; i++) {
    const arabic = resolved[i] === 'ar'
    const last = runs[runs.length - 1]
    if (last && last.arabic === arabic) last.text += chars[i]
    else runs.push({ text: chars[i], arabic })
  }

  // base direction from the first strong character
  const firstStrong = cls.find((c) => c !== 'neu')
  const baseRtl = firstStrong === 'ar'
  return baseRtl ? runs.slice().reverse() : runs
}
