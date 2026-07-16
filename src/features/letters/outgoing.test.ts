import { describe, expect, it } from 'vitest'
import { currentStep, stage, type InitialStep } from './outgoing'

const step = (n: number, decision: InitialStep['decision']): InitialStep => ({
  step_order: n, approver_role: 'team_lead', approver_dept: null, label: `s${n}`, decision, decided_by: null,
})

describe('currentStep', () => {
  it('returns the lowest-order pending step', () => {
    expect(currentStep([step(2, 'pending'), step(1, 'approved'), step(3, 'pending')])?.step_order).toBe(2)
  })
  it('returns null when nothing is pending', () => {
    expect(currentStep([step(1, 'approved'), step(2, 'approved')])).toBeNull()
    expect(currentStep([])).toBeNull()
  })
})

describe('stage', () => {
  it('maps draft/signed/dispatched directly', () => {
    expect(stage('draft', [])).toBe('draft')
    expect(stage('signed', [])).toBe('signed')
    expect(stage('dispatched', [])).toBe('dispatched')
  })
  it('is in_initials while any step is pending, ready_to_sign when all approved', () => {
    expect(stage('in_initials', [step(1, 'approved'), step(2, 'pending')])).toBe('in_initials')
    expect(stage('in_initials', [step(1, 'approved'), step(2, 'approved')])).toBe('ready_to_sign')
  })
  it('an empty chain in in_initials is not ready to sign', () => {
    expect(stage('in_initials', [])).toBe('in_initials')
  })
  it('unknown/incoming statuses fall through to other', () => {
    expect(stage('registered', [])).toBe('other')
  })
})
