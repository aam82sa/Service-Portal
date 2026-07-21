import { describe, expect, it } from 'vitest'
import {
  canConfirm,
  impactHeadline,
  isHardDelete,
  resolutionOptions,
  type ConfigImpact,
} from './configLifecycle'

const impact = (over: Partial<ConfigImpact> = {}): ConfigImpact => ({
  open_requests: 3,
  in_flight_by_status: { new: 1, triaged: 1, in_progress: 1 },
  scheduled_items: 0,
  draft_submissions: 0,
  historical_requests: 4,
  affected_sla_clocks: 0,
  can_hard_delete: false,
  sample_refs: ['REQ-1', 'REQ-2', 'REQ-3'],
  ...over,
})

describe('isHardDelete', () => {
  it('is true only when nothing ever referenced the config', () => {
    expect(isHardDelete(impact({ can_hard_delete: true, historical_requests: 0 }))).toBe(true)
    expect(isHardDelete(impact())).toBe(false)
  })
})

describe('resolutionOptions', () => {
  it('always offers finish_old; close only when there are open requests', () => {
    const opts = resolutionOptions('service', impact(), false)
    expect(opts.find((o) => o.value === 'finish_old')?.enabled).toBe(true)
    expect(opts.find((o) => o.value === 'close')?.enabled).toBe(true)
    expect(opts.find((o) => o.value === 'close')?.destructive).toBe(true)
  })

  it('enables migrate only for a form version with a target', () => {
    expect(resolutionOptions('form', impact(), true).find((o) => o.value === 'migrate')?.enabled).toBe(true)
    expect(resolutionOptions('form', impact(), false).find((o) => o.value === 'migrate')?.enabled).toBe(false)
    expect(resolutionOptions('service', impact(), true).find((o) => o.value === 'migrate')?.enabled).toBe(false)
  })

  it('disables close when there are no open requests', () => {
    expect(resolutionOptions('service', impact({ open_requests: 0 }), false)
      .find((o) => o.value === 'close')?.enabled).toBe(false)
  })
})

describe('canConfirm', () => {
  const base = { hardDelete: false, resolution: 'finish_old' as const, note: 'n', typedCode: '', code: 'HW' }

  it('requires a note', () => {
    expect(canConfirm({ ...base, note: '  ' })).toBe(false)
    expect(canConfirm({ ...base, note: 'because' })).toBe(true)
  })

  it('requires the typed code for a hard delete', () => {
    expect(canConfirm({ ...base, hardDelete: true, typedCode: '' })).toBe(false)
    expect(canConfirm({ ...base, hardDelete: true, typedCode: 'HW' })).toBe(true)
  })

  it('requires the typed code for a mass close', () => {
    expect(canConfirm({ ...base, resolution: 'close', typedCode: 'wrong' })).toBe(false)
    expect(canConfirm({ ...base, resolution: 'close', typedCode: 'HW' })).toBe(true)
  })

  it('does not require a code for finish_old / migrate', () => {
    expect(canConfirm({ ...base, resolution: 'migrate', typedCode: '' })).toBe(true)
  })
})

describe('impactHeadline', () => {
  it('says it is clean when deletable', () => {
    expect(impactHeadline(impact({ can_hard_delete: true, historical_requests: 0, open_requests: 0 })))
      .toContain('deleted cleanly')
  })
  it('reports history + open counts and steers to retire otherwise', () => {
    const line = impactHeadline(impact())
    expect(line).toContain('4 requests in history')
    expect(line).toContain('3 open requests')
    expect(line).toContain('retire instead')
  })
})
