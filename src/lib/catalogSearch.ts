/**
 * Ranked catalog search for the requester portal: exact code beats code
 * prefix beats a name-word prefix beats a name substring beats a
 * description substring. Case-insensitive; empty/1-char queries return
 * nothing (the drill-down stays in charge).
 */

export interface SearchableService {
  code: string
  name: string
  description: string | null
}

function rank(s: SearchableService, q: string): number {
  const code = s.code.toLowerCase()
  const name = s.name.toLowerCase()
  const desc = (s.description ?? '').toLowerCase()
  if (code === q) return 0
  if (code.startsWith(q)) return 1
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2
  if (name.includes(q)) return 3
  if (desc.includes(q)) return 4
  return -1
}

export function searchCatalog<T extends SearchableService>(
  services: T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  return services
    .map((s) => ({ s, r: rank(s, q) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || a.s.code.localeCompare(b.s.code))
    .slice(0, limit)
    .map(({ s }) => s)
}
