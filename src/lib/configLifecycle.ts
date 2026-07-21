/**
 * Config lifecycle (WORKFL1 Part 2, branch 9) — shared types and the pure
 * decision logic behind the impact dialog. The dialog resolves ONE admin
 * gesture ("Retire / Delete") into the right action from the live impact:
 * a clean hard delete when nothing ever referenced the config, otherwise a
 * retire with an explicit choice for the affected in-flight requests.
 *
 * The RPC contract mirrors preview_config_change / apply_config_change (00079).
 */

export type ConfigKind = 'service' | 'form' | 'sla'
export type Resolution = 'finish_old' | 'migrate' | 'close'

/** the snapshot preview_config_change returns */
export interface ConfigImpact {
  open_requests: number
  in_flight_by_status: Record<string, number>
  scheduled_items: number
  draft_submissions: number
  historical_requests: number
  affected_sla_clocks: number
  can_hard_delete: boolean
  sample_refs: string[]
}

export interface ResolutionOption {
  value: Resolution
  label: string
  desc: string
  enabled: boolean
  /** the destructive one — needs a typed confirmation */
  destructive?: boolean
}

/**
 * What the dialog actually is once the counts are known: a hard delete (zero
 * references) or a retire (history exists, in-flight requests must be resolved).
 */
export function isHardDelete(impact: ConfigImpact): boolean {
  return impact.can_hard_delete
}

/**
 * The resolution choices for a retire, in the brief's order. `finish_old` is
 * the safe default; `migrate` is only meaningful for a form version with a
 * target to move to; `close` is Ady's condition — destructive, never default.
 */
export function resolutionOptions(
  kind: ConfigKind,
  impact: ConfigImpact,
  hasMigrationTarget: boolean,
): ResolutionOption[] {
  const n = impact.open_requests
  return [
    {
      value: 'finish_old',
      label: 'Let them finish on the current version',
      desc: `The ${n} open request${n === 1 ? '' : 's'} keep the version they started on. Nothing closes.`,
      enabled: true,
    },
    {
      value: 'migrate',
      label: 'Migrate them to the new version',
      desc: kind === 'form'
        ? 'Re-point open requests to the new form version.'
        : 'Only available for form versions.',
      enabled: kind === 'form' && hasMigrationTarget,
    },
    {
      value: 'close',
      label: 'Close them (cancel as “config changed”)',
      desc: `Cancels all ${n} open request${n === 1 ? '' : 's'} with a mandatory note and notifies each requester. This cannot be undone.`,
      enabled: n > 0,
      destructive: true,
    },
  ]
}

/**
 * Whether the confirm button may fire. A note is always required. The typed
 * code must match for a hard delete or a mass-closure (the two irreversible
 * mass actions); other resolutions need only the note.
 */
export function canConfirm(args: {
  hardDelete: boolean
  resolution: Resolution
  note: string
  typedCode: string
  code: string
}): boolean {
  const noteOk = args.note.trim().length > 0
  if (!noteOk) return false
  const needsTypedCode = args.hardDelete || args.resolution === 'close'
  if (needsTypedCode) return args.typedCode.trim() === args.code.trim()
  return true
}

/** one-line summary of what the impact touches, for the dialog header */
export function impactHeadline(impact: ConfigImpact): string {
  if (impact.can_hard_delete) return 'Nothing references this — it can be deleted cleanly.'
  const open = impact.open_requests
  const hist = impact.historical_requests
  const openPart = open === 0
    ? 'no open requests'
    : `${open} open request${open === 1 ? '' : 's'}`
  return `${hist} request${hist === 1 ? '' : 's'} in history (${openPart}). Delete is disabled — retire instead.`
}
