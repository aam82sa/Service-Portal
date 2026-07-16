import { describe, expect, it } from 'vitest'
import { backoffMinutes, eventKey } from './outbox'

describe('eventKey', () => {
  it('maps lifecycle events to template keys', () => {
    expect(eventKey('created', {})).toBe('request_created')
    expect(eventKey('assigned', {})).toBe('assigned')
    expect(eventKey('status_changed', { to: 'pending_approval' })).toBe('pending_approval')
    expect(eventKey('status_changed', { to: 'resolved' })).toBe('resolved')
    expect(eventKey('approval_decided', { decision: 'approved' })).toBe('approved')
    expect(eventKey('approval_decided', { decision: 'rejected' })).toBe('rejected')
    expect(eventKey('sla_warning', {})).toBe('sla_warning')
  })

  it('returns null for events with no mail template', () => {
    expect(eventKey('status_changed', { to: 'in_progress' })).toBeNull()
    expect(eventKey('approval_decided', { decision: 'info_requested' })).toBeNull()
    expect(eventKey('reopened', {})).toBeNull()
    expect(eventKey('rated', {})).toBeNull()
  })
})

describe('backoffMinutes', () => {
  it('follows the 1/5/15/60/240 schedule and clamps at the tail', () => {
    expect(backoffMinutes(1)).toBe(1)
    expect(backoffMinutes(2)).toBe(5)
    expect(backoffMinutes(3)).toBe(15)
    expect(backoffMinutes(4)).toBe(60)
    expect(backoffMinutes(5)).toBe(240)
    expect(backoffMinutes(9)).toBe(240)
    expect(backoffMinutes(0)).toBe(1) // guards against a zero/negative attempt count
  })
})
