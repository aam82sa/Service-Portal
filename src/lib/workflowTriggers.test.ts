import { describe, expect, it } from 'vitest'
import { TRIGGER_CATALOG, triggerAllowedOn, triggerBadge, triggerDef } from './workflowTriggers'

describe('workflow trigger catalog', () => {
  it('keeps the stored keys used by existing published graphs', () => {
    // these strings live in workflow_definitions JSONB — renaming any breaks
    // published graphs, so the catalog must always contain them verbatim
    for (const key of ['ack email', 'start SLA', 'pause SLA', 'auto-assign', 'DoA chain', 'notify team lead', 'CSAT survey']) {
      expect(triggerDef(key), key).toBeDefined()
    }
  })

  it('restricts spawn children to in_progress only', () => {
    expect(triggerAllowedOn('spawn children', 'in_progress')).toBe(true)
    expect(triggerAllowedOn('spawn children', 'pending_requester')).toBe(false)
    expect(triggerAllowedOn('spawn children', 'new')).toBe(false)
  })

  it('allows unrestricted triggers on any step', () => {
    expect(triggerAllowedOn('ack email', 'cancelled')).toBe(true)
    expect(triggerAllowedOn('pause SLA', 'pending_approval')).toBe(true)
  })

  it('allows unknown keys anywhere (forward-compat)', () => {
    expect(triggerAllowedOn('some future trigger', 'new')).toBe(true)
    expect(triggerBadge('some future trigger')).toEqual({ text: 'some future trigger' })
  })

  it('gives every catalog entry a badge and description', () => {
    for (const t of TRIGGER_CATALOG) {
      expect(t.badge.length).toBeGreaterThan(0)
      expect(t.sub.length).toBeGreaterThan(0)
    }
  })
})
