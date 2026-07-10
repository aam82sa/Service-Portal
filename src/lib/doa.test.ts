import { describe, expect, it } from 'vitest'
import { buildChain, resolveBand, substituteDelegate, type DoaRow } from './doa'

/** Mirrors the HW-01 seed rows from migration 00034: manager-only below
 *  25k, three-step chain at 25k and above, plus a platform-wide fallback
 *  and an executive tier above 100k for boundary testing. */
const HW = 'svc-hw-01'
const rows: DoaRow[] = [
  // service band — Tier 1 (< 25k): line manager only
  { dept: 'IT', service_id: HW, min_amount: 0, max_amount: 25000, step_order: 1, approver_hint: 'Line manager' },
  // service band — Tier 2 (25k …): full chain
  { dept: 'IT', service_id: HW, min_amount: 25000, max_amount: 100001, step_order: 1, approver_hint: 'Line manager' },
  { dept: 'IT', service_id: HW, min_amount: 25000, max_amount: 100001, step_order: 2, approver_hint: 'Department head' },
  // service band — Tier 3 (> 100k): executive joins
  { dept: 'IT', service_id: HW, min_amount: 100001, max_amount: null, step_order: 1, approver_hint: 'Line manager' },
  { dept: 'IT', service_id: HW, min_amount: 100001, max_amount: null, step_order: 2, approver_hint: 'Department head' },
  { dept: 'IT', service_id: HW, min_amount: 100001, max_amount: null, step_order: 3, approver_hint: 'Executive (Tier 1 DoA)' },
  // dept band — would collide with the service rows if specificity did not win
  { dept: 'IT', service_id: null, min_amount: 0, max_amount: null, step_order: 1, approver_hint: 'Dept fallback' },
  // platform band
  { dept: null, service_id: null, min_amount: 0, max_amount: null, step_order: 1, approver_hint: 'Platform fallback' },
]

const subject = (amount: number | null) => ({ dept: 'IT', serviceId: HW, amount })

describe('DoA band resolution', () => {
  it('routes 24,999 through the Tier 1 path (manager only)', () => {
    const chain = buildChain(rows, subject(24999))
    expect(chain.map((r) => r.approver_hint)).toEqual(['Line manager'])
  })

  it('routes 25,000 through the Tier 2 chain (min_amount is inclusive)', () => {
    const chain = buildChain(rows, subject(25000))
    expect(chain.map((r) => r.approver_hint)).toEqual(['Line manager', 'Department head'])
  })

  it('keeps 100,000 in Tier 2 (max_amount is exclusive)', () => {
    const chain = buildChain(rows, subject(100000))
    expect(chain.map((r) => r.approver_hint)).toEqual(['Line manager', 'Department head'])
  })

  it('escalates 100,001 to the Tier 3 chain with the executive step', () => {
    const chain = buildChain(rows, subject(100001))
    expect(chain.map((r) => r.approver_hint)).toEqual([
      'Line manager', 'Department head', 'Executive (Tier 1 DoA)',
    ])
  })

  it('creates no chain for zero or missing amounts', () => {
    expect(buildChain(rows, subject(0))).toEqual([])
    expect(buildChain(rows, subject(null))).toEqual([])
  })

  it('never mixes specificity levels — service rows exclude dept and platform fallbacks', () => {
    const chain = buildChain(rows, subject(30000))
    expect(chain.some((r) => r.approver_hint?.includes('fallback'))).toBe(false)
  })

  it('falls back to dept rows for a service without its own band', () => {
    const chain = buildChain(rows, { dept: 'IT', serviceId: 'svc-other', amount: 500 })
    expect(chain.map((r) => r.approver_hint)).toEqual(['Dept fallback'])
  })

  it('falls back to platform rows outside the dept', () => {
    const chain = buildChain(rows, { dept: 'PROC', serviceId: 'svc-other', amount: 500 })
    expect(chain.map((r) => r.approver_hint)).toEqual(['Platform fallback'])
  })

  it('returns steps ordered by step_order regardless of input order', () => {
    const shuffled = [...rows].reverse()
    const chain = buildChain(shuffled, subject(200000))
    expect(chain.map((r) => r.step_order)).toEqual([1, 2, 3])
  })

  it('resolveBand matches rows even at amount 0 (call sites gate on amount)', () => {
    expect(resolveBand(rows, subject(0)).length).toBeGreaterThan(0)
  })
})

describe('delegation substitution', () => {
  const delegations = [
    { delegator_id: 'boss', delegate_id: 'deputy', starts_on: '2026-07-01', ends_on: '2026-07-15', status: 'approved' },
    { delegator_id: 'boss', delegate_id: 'rejected-deputy', starts_on: '2026-07-01', ends_on: '2026-07-15', status: 'pending' },
  ]

  it('substitutes the delegate while the window is active', () => {
    expect(substituteDelegate('boss', delegations, new Date('2026-07-10T09:00:00Z'))).toBe('deputy')
  })

  it('keeps the approver outside the window', () => {
    expect(substituteDelegate('boss', delegations, new Date('2026-07-20T09:00:00Z'))).toBe('boss')
  })

  it('ignores unapproved delegations and other delegators', () => {
    expect(substituteDelegate('someone-else', delegations, new Date('2026-07-10T09:00:00Z'))).toBe('someone-else')
  })

  it('treats boundary days as active (inclusive dates)', () => {
    expect(substituteDelegate('boss', delegations, new Date('2026-07-01T00:30:00Z'))).toBe('deputy')
    expect(substituteDelegate('boss', delegations, new Date('2026-07-15T23:00:00Z'))).toBe('deputy')
  })
})
