/**
 * Correspondence reference-number rendering — the TypeScript mirror of
 * `render_letter_number` in migration 00039. Format tokens:
 *
 *   {seq}     raw sequence value          {seq:4} zero-padded to 4 digits
 *   {yyyy}    4-digit year                {yy}    2-digit year
 *   {mm}      2-digit month               {dd}    2-digit day
 *   {dept}    department code             {doctype} document type
 *   {hyyyy}   Hijri year (Umm al-Qura)    {hyy}   2-digit Hijri year
 *
 * Sequence scoping/reset live in the database (numbering_counters with an
 * advisory lock); this module only covers the deterministic rendering half.
 * The Hijri tokens mirror render_letter_number's arithmetic conversion — they
 * can differ by a day around a Hijri new year, which is fine for a year token.
 */

export interface NumberingParts {
  dept?: string | null
  doctype?: string | null
  on?: Date
}

function hijriYear(on: Date): string {
  try {
    const s = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric' }).format(on)
    const m = s.match(/\d+/)
    return m ? m[0] : ''
  } catch {
    return ''
  }
}

export function renderNumber(format: string, seq: number, parts: NumberingParts = {}): string {
  const on = parts.on ?? new Date()
  const yyyy = String(on.getFullYear())
  const mm = String(on.getMonth() + 1).padStart(2, '0')
  const dd = String(on.getDate()).padStart(2, '0')
  const hy = hijriYear(on)

  const all = (s: string, token: string, value: string) => s.split(token).join(value)
  let out = format.replace(/\{seq:(\d+)\}/g, (_, pad: string) =>
    String(seq).padStart(Number(pad), '0'),
  )
  out = all(out, '{seq}', String(seq))
  out = all(out, '{yyyy}', yyyy)
  out = all(out, '{yy}', yyyy.slice(-2))
  out = all(out, '{mm}', mm)
  out = all(out, '{dd}', dd)
  out = all(out, '{dept}', parts.dept ?? '')
  out = all(out, '{doctype}', parts.doctype ?? '')
  out = all(out, '{hyyyy}', hy)
  out = all(out, '{hyy}', hy.slice(-2))
  return out
}
