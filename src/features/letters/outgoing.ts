/**
 * Pure helpers for the outgoing-letter lifecycle panel. The DB state machine
 * (00071) is authoritative; these just derive what the UI should show from the
 * letter status + the initials chain. Unit-tested in outgoing.test.ts.
 */

export interface InitialStep {
  step_order: number
  approver_role: string | null
  approver_dept: string | null
  label: string | null
  decision: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
}

export type Stage = 'draft' | 'in_initials' | 'ready_to_sign' | 'signed' | 'dispatched' | 'other'

/** The lowest-order step still awaiting a decision, or null if none pending. */
export function currentStep(initials: InitialStep[]): InitialStep | null {
  return [...initials].filter((s) => s.decision === 'pending').sort((a, b) => a.step_order - b.step_order)[0] ?? null
}

/** Map letter status + chain into the UI stage. */
export function stage(status: string, initials: InitialStep[]): Stage {
  switch (status) {
    case 'draft': return 'draft'
    case 'signed': return 'signed'
    case 'dispatched': return 'dispatched'
    case 'in_initials':
      return initials.length > 0 && initials.every((s) => s.decision === 'approved') ? 'ready_to_sign' : 'in_initials'
    default: return 'other'
  }
}
