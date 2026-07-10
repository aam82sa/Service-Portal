/**
 * Business-minutes arithmetic for SLA due dates — Sun–Thu working week driven
 * by `business_hours` rows and the `holidays` list. This is the TypeScript
 * mirror of `compute_sla_due` in the SLA-engine migration: the SQL and this
 * module must give the same answers, and this one is what the unit tests pin.
 *
 * SLA clocks only tick inside business windows; entering `pending_requester`
 * pauses the clock (accounted as `sla_paused_minutes` and re-added by
 * `shiftDue`). All date-only values are ISO `YYYY-MM-DD` strings and the
 * arithmetic is done in the runtime's local timezone (the platform runs the
 * database in the tenant's timezone).
 */

export interface BusinessHoursRow {
  dow: number // 0 = Sunday … 6 = Saturday
  opens: string // 'HH:MM' or 'HH:MM:SS'
  closes: string
  is_workday: boolean
}

const DAY_MS = 86400000

const dateKey = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

const startOfDay = (d: Date): Date => {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

interface Window { open: Date; close: Date }

/** The business window for a calendar day, or null on Fridays/Saturdays/holidays. */
function windowFor(day: Date, hours: BusinessHoursRow[], holidays: string[]): Window | null {
  const row = hours.find((h) => h.dow === day.getDay())
  if (!row || !row.is_workday) return null
  if (holidays.includes(dateKey(day))) return null
  const open = new Date(day)
  open.setHours(0, minutesOf(row.opens), 0, 0)
  const close = new Date(day)
  close.setHours(0, minutesOf(row.closes), 0, 0)
  if (close <= open) return null
  return { open, close }
}

/**
 * The moment `minutes` of business time after `start` elapse — the SLA due
 * timestamp. Time outside business windows does not count; a start outside a
 * window fast-forwards to the next opening bell.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  hours: BusinessHoursRow[],
  holidays: string[] = [],
): Date {
  if (!hours.some((h) => h.is_workday)) throw new Error('no workdays configured')
  let remaining = Math.max(0, minutes)
  let cursor = new Date(start)
  // hard stop: ten years of days means the calendar is misconfigured
  for (let hop = 0; hop < 3660; hop++) {
    const win = windowFor(startOfDay(cursor), hours, holidays)
    if (win && cursor < win.close) {
      const from = cursor > win.open ? cursor : win.open
      const available = (win.close.getTime() - from.getTime()) / 60000
      if (remaining <= available) {
        return new Date(from.getTime() + remaining * 60000)
      }
      remaining -= available
    }
    cursor = startOfDay(new Date(startOfDay(cursor).getTime() + DAY_MS + DAY_MS / 2))
  }
  throw new Error('SLA window not found within 10 years — check the business calendar')
}

/** Business minutes elapsed between two instants (0 when b <= a). */
export function businessMinutesBetween(
  a: Date,
  b: Date,
  hours: BusinessHoursRow[],
  holidays: string[] = [],
): number {
  if (b <= a) return 0
  let total = 0
  let day = startOfDay(a)
  const lastDay = startOfDay(b)
  for (let hop = 0; hop < 3660 && day <= lastDay; hop++) {
    const win = windowFor(day, hours, holidays)
    if (win) {
      const from = a > win.open ? a : win.open
      const to = b < win.close ? b : win.close
      if (to > from) total += (to.getTime() - from.getTime()) / 60000
    }
    day = startOfDay(new Date(day.getTime() + DAY_MS + DAY_MS / 2))
  }
  return total
}

/**
 * Pause accounting: a due timestamp shifted by the business minutes spent
 * paused (in `pending_requester`). Recomputed from the original due instant so
 * repeated pauses accumulate exactly once each.
 */
export function shiftDue(
  due: Date,
  pausedMinutes: number,
  hours: BusinessHoursRow[],
  holidays: string[] = [],
): Date {
  return addBusinessMinutes(due, pausedMinutes, hours, holidays)
}

/** Standard Sun–Thu 08:00–17:00 calendar, matching the seeded business_hours rows. */
export const DEFAULT_HOURS: BusinessHoursRow[] = [0, 1, 2, 3, 4].map((dow) => ({
  dow, opens: '08:00', closes: '17:00', is_workday: true,
})).concat([5, 6].map((dow) => ({ dow, opens: '08:00', closes: '17:00', is_workday: false })))
