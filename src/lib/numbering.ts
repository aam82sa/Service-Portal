/**
 * Correspondence reference-number rendering — the TypeScript mirror of
 * `render_letter_number` in migration 00039. Format tokens:
 *
 *   {seq}     raw sequence value          {seq:4} zero-padded to 4 digits
 *   {yyyy}    4-digit year                {yy}    2-digit year
 *   {mm}      2-digit month               {dd}    2-digit day
 *   {dept}    department code             {doctype} document type
 *
 * Sequence scoping/reset live in the database (numbering_counters with an
 * advisory lock); this module only covers the deterministic rendering half.
 */

export interface NumberingParts {
  dept?: string | null
  doctype?: string | null
  on?: Date
}

export function renderNumber(format: string, seq: number, parts: NumberingParts = {}): string {
  const on = parts.on ?? new Date()
  const yyyy = String(on.getFullYear())
  const mm = String(on.getMonth() + 1).padStart(2, '0')
  const dd = String(on.getDate()).padStart(2, '0')

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
  return out
}
