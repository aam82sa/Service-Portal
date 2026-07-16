import { describe, expect, it } from 'vitest'
import { deliveryMode, MAX_ATTACH_BYTES, planRecipients, reportVars } from './reportDelivery'

describe('deliveryMode', () => {
  it('attaches at or below the cap and links above it', () => {
    expect(deliveryMode(1024)).toBe('attach')
    expect(deliveryMode(MAX_ATTACH_BYTES)).toBe('attach')
    expect(deliveryMode(MAX_ATTACH_BYTES + 1)).toBe('link')
  })
})

describe('planRecipients', () => {
  const internal = ['sara@abccorp.com']

  it('always accepts internal recipients', () => {
    const plan = planRecipients({ internal, external: [], allowlist: [], hasCapability: false })
    expect(plan.accepted).toEqual(['sara@abccorp.com'])
    expect(plan.refused).toEqual([])
  })

  it('refuses external addresses when the requester lacks the capability', () => {
    const plan = planRecipients({ internal, external: ['ext@vendor.com'], allowlist: ['ext@vendor.com'], hasCapability: false })
    expect(plan.accepted).toEqual(internal)
    expect(plan.refused).toEqual([{ address: 'ext@vendor.com', reason: 'external delivery capability required' }])
  })

  it('refuses external addresses not on the allowlist even with the capability', () => {
    const plan = planRecipients({ internal, external: ['ext@vendor.com'], allowlist: ['other@vendor.com'], hasCapability: true })
    expect(plan.external).toEqual([])
    expect(plan.refused[0].reason).toBe('not on the external delivery allowlist')
  })

  it('accepts an allowlisted external address when the requester has the capability', () => {
    const plan = planRecipients({ internal, external: ['Ext@Vendor.com'], allowlist: ['ext@vendor.com'], hasCapability: true })
    expect(plan.external).toEqual(['ext@vendor.com'])
    expect(plan.accepted).toContain('ext@vendor.com')
  })

  it('refuses a malformed external address', () => {
    const plan = planRecipients({ internal: [], external: ['not-an-email'], allowlist: [], hasCapability: true })
    expect(plan.refused[0].reason).toBe('invalid email address')
  })

  it('dedupes and does not double-count an external that is also internal', () => {
    const plan = planRecipients({ internal: ['a@abccorp.com', 'a@abccorp.com'], external: ['a@abccorp.com'], allowlist: [], hasCapability: true })
    expect(plan.accepted).toEqual(['a@abccorp.com'])
    expect(plan.refused).toEqual([])
  })
})

describe('reportVars', () => {
  it('fills defaults for missing period and link', () => {
    expect(reportVars({ report_name: 'SLA', run_ref: 'ab12' })).toEqual({
      report_name: 'SLA', period: 'the selected period', run_ref: 'ab12', download_link: '',
    })
  })
})
