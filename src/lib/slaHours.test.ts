import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOURS,
  addBusinessMinutes,
  businessMinutesBetween,
  shiftDue,
} from './slaHours'

// 2026-07-09 is a Thursday; the working week is Sun–Thu 08:00–17:00
const THU_1600 = new Date('2026-07-09T16:00:00')

describe('addBusinessMinutes', () => {
  it('rolls a Thursday-16:00 4h SLA over the Fri–Sat weekend to Sunday 11:00', () => {
    const due = addBusinessMinutes(THU_1600, 4 * 60, DEFAULT_HOURS)
    expect(due.getDay()).toBe(0) // Sunday
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-12')
    expect(due.getHours()).toBe(11)
    expect(due.getMinutes()).toBe(0)
  })

  it('skips holidays that span the landing day', () => {
    const due = addBusinessMinutes(THU_1600, 4 * 60, DEFAULT_HOURS, ['2026-07-12'])
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-13') // Monday
    expect(due.getHours()).toBe(11)
  })

  it('fast-forwards a start outside business hours to the next opening bell', () => {
    // Friday is off; a request logged Friday noon starts its clock Sunday 08:00
    const due = addBusinessMinutes(new Date('2026-07-10T12:00:00'), 60, DEFAULT_HOURS)
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-12')
    expect(due.getHours()).toBe(9)
  })

  it('stays same-day when the window has room', () => {
    const due = addBusinessMinutes(new Date('2026-07-09T09:00:00'), 120, DEFAULT_HOURS)
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-09')
    expect(due.getHours()).toBe(11)
  })

  it('spans multiple days for long SLAs (9h/day capacity)', () => {
    // 20h from Sunday 08:00: Sun 9h + Mon 9h + Tue 2h → Tuesday 10:00
    const due = addBusinessMinutes(new Date('2026-07-12T08:00:00'), 20 * 60, DEFAULT_HOURS)
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-14')
    expect(due.getHours()).toBe(10)
  })
})

describe('businessMinutesBetween (pause accounting)', () => {
  it('counts only business minutes across a weekend pause', () => {
    // paused Thursday 16:30 → resumed Sunday 08:30: 30m Thu + 30m Sun
    const paused = businessMinutesBetween(
      new Date('2026-07-09T16:30:00'),
      new Date('2026-07-12T08:30:00'),
      DEFAULT_HOURS,
    )
    expect(paused).toBe(60)
  })

  it('returns 0 for reversed or equal instants', () => {
    expect(businessMinutesBetween(THU_1600, THU_1600, DEFAULT_HOURS)).toBe(0)
  })

  it('ignores time entirely outside windows', () => {
    // Friday 10:00 → Saturday 15:00 is all weekend
    expect(
      businessMinutesBetween(
        new Date('2026-07-10T10:00:00'),
        new Date('2026-07-11T15:00:00'),
        DEFAULT_HOURS,
      ),
    ).toBe(0)
  })
})

describe('pause/resume round trip', () => {
  it('shifting the due date by the paused minutes lands where the clock would have', () => {
    // due Sunday 11:00; paused for 60 business minutes → new due Sunday 12:00
    const due = addBusinessMinutes(THU_1600, 4 * 60, DEFAULT_HOURS)
    const shifted = shiftDue(due, 60, DEFAULT_HOURS)
    expect(shifted.toISOString().slice(0, 10)).toBe('2026-07-12')
    expect(shifted.getHours()).toBe(12)
  })

  it('a pause near closing time rolls the shifted due into the next workday', () => {
    // due Thursday 16:45, paused 30 business minutes → 15m Thu + 15m Sun = Sunday 08:15
    const shifted = shiftDue(new Date('2026-07-09T16:45:00'), 30, DEFAULT_HOURS)
    expect(shifted.toISOString().slice(0, 10)).toBe('2026-07-12')
    expect(shifted.getHours()).toBe(8)
    expect(shifted.getMinutes()).toBe(15)
  })
})
