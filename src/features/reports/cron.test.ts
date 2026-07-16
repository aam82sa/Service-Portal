import { describe, expect, it } from 'vitest'
import { cadenceToCron, describeCadence } from './cron'

describe('cadenceToCron', () => {
  it('builds daily/weekly/monthly cron strings', () => {
    expect(cadenceToCron({ preset: 'daily', time: '08:30', weekday: 0, dom: 1 })).toBe('30 8 * * *')
    expect(cadenceToCron({ preset: 'weekly', time: '06:00', weekday: 1, dom: 1 })).toBe('0 6 * * 1')
    expect(cadenceToCron({ preset: 'monthly', time: '00:00', weekday: 0, dom: 15 })).toBe('0 0 15 * *')
  })

  it('clamps out-of-range time and day values', () => {
    expect(cadenceToCron({ preset: 'daily', time: '31:99', weekday: 0, dom: 1 })).toBe('59 23 * * *')
    expect(cadenceToCron({ preset: 'monthly', time: '09:05', weekday: 0, dom: 40 })).toBe('5 9 28 * *')
    expect(cadenceToCron({ preset: 'weekly', time: '09:05', weekday: 8, dom: 1 })).toBe('5 9 * * 1')
  })
})

describe('describeCadence', () => {
  it('describes the standard shapes', () => {
    expect(describeCadence('30 8 * * *')).toBe('Daily at 08:30')
    expect(describeCadence('0 6 * * 1')).toBe('Weekly on Monday at 06:00')
    expect(describeCadence('0 0 15 * *')).toBe('Monthly on day 15 at 00:00')
  })
  it('falls back to the raw cron for non-standard expressions', () => {
    expect(describeCadence('*/5 * * * *')).toBe('*/5 * * * *')
    expect(describeCadence('bad')).toBe('bad')
  })
})
