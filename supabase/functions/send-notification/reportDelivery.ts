/**
 * Pure helpers for the report email-once path (mode:'report'). No DB/network so
 * vitest covers the two decisions that matter for PDPL + deliverability:
 *   1. attach the artifact vs. fall back to a portal deep-link (size cap), and
 *   2. which recipients may actually receive it — internal always, external
 *      only when the requester holds the capability AND the address is on the
 *      admin allowlist.
 */

/** Attach up to 8 MB; larger artifacts are delivered as a signed deep-link. */
export const MAX_ATTACH_BYTES = 8 * 1024 * 1024

export function deliveryMode(byteLength: number, maxBytes = MAX_ATTACH_BYTES): 'attach' | 'link' {
  return byteLength <= maxBytes ? 'attach' : 'link'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalize(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const e = String(raw ?? '').trim().toLowerCase()
    if (e && !seen.has(e)) { seen.add(e); out.push(e) }
  }
  return out
}

export interface RecipientPlan {
  accepted: string[]
  internal: string[]
  external: string[]
  refused: { address: string; reason: string }[]
}

/**
 * Split requested recipients into who gets the report and who is refused.
 * `internal` are addresses already resolved to an active profile (always
 * allowed). `external` are free-typed addresses: allowed only when the
 * requester has the report_external_delivery capability and the address is on
 * the admin allowlist; every rejection is captured with a reason for the audit.
 */
export function planRecipients(input: {
  internal: string[]
  external: string[]
  allowlist: string[]
  hasCapability: boolean
}): RecipientPlan {
  const internal = normalize(input.internal)
  const allowlist = new Set(normalize(input.allowlist))
  const refused: { address: string; reason: string }[] = []
  const external: string[] = []

  for (const addr of normalize(input.external)) {
    if (internal.includes(addr)) continue // already covered as internal
    if (!EMAIL_RE.test(addr)) { refused.push({ address: addr, reason: 'invalid email address' }); continue }
    if (!input.hasCapability) { refused.push({ address: addr, reason: 'external delivery capability required' }); continue }
    if (!allowlist.has(addr)) { refused.push({ address: addr, reason: 'not on the external delivery allowlist' }); continue }
    external.push(addr)
  }

  return { accepted: [...internal, ...external], internal, external, refused }
}

export interface ReportVars {
  report_name: string
  period?: string | null
  run_ref: string
  download_link?: string | null
}

/** Template variable bag for the report_delivery notification template. */
export function reportVars(v: ReportVars): Record<string, string> {
  return {
    report_name: v.report_name,
    period: v.period ?? 'the selected period',
    run_ref: v.run_ref,
    download_link: v.download_link ?? '',
  }
}
