/**
 * Client-side mirror of the server's generate_dept_code (migration 00076), so
 * the admin can see a stream's auto-generated code before saving. The server
 * is authoritative — this only previews. Uppercase alphanumerics, first three
 * characters (padded to three), with a numeric suffix on collision.
 *   "Facilities Management" → FAC, then FAC2, FAC3, …
 */
export function previewDeptCode(name: string, existingCodes: string[]): string {
  let base = (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
  if (base.length === 0) base = 'DEP'
  while (base.length < 3) base += 'X'
  const taken = new Set(existingCodes.map((c) => c.toUpperCase()))
  let candidate = base
  let n = 1
  while (taken.has(candidate)) {
    n += 1
    candidate = `${base}${n}`
  }
  return candidate
}
