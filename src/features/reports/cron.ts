/**
 * Cadence helpers for the schedule dialog. The scheduler (00069) understands a
 * standard 5-field cron string; the UI only exposes daily / weekly / monthly,
 * so these translate between the friendly form and the cron the DB stores, and
 * describe an existing cron back to the user. Pure — unit-tested in cron.test.ts.
 */

export type Preset = 'daily' | 'weekly' | 'monthly'

export interface CadenceParts {
  preset: Preset
  time: string // 'HH:MM'
  weekday: number // 0=Sun .. 6=Sat (weekly)
  dom: number // 1..28 (monthly)
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function hm(time: string): [number, number] {
  const [h, m] = time.split(':')
  const hr = Math.min(23, Math.max(0, parseInt(h, 10) || 0))
  const min = Math.min(59, Math.max(0, parseInt(m, 10) || 0))
  return [hr, min]
}

/** Friendly cadence → cron string the scheduler stores. */
export function cadenceToCron(p: CadenceParts): string {
  const [hr, min] = hm(p.time)
  switch (p.preset) {
    case 'daily': return `${min} ${hr} * * *`
    case 'weekly': return `${min} ${hr} * * ${((p.weekday % 7) + 7) % 7}`
    case 'monthly': return `${min} ${hr} ${Math.min(28, Math.max(1, p.dom))} * *`
  }
}

/** cron string → a human sentence (falls back to the raw cron if non-standard). */
export function describeCadence(cron: string): string {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return cron
  const [min, hr, dom, , dow] = f
  if (![min, hr].every((x) => /^\d+$/.test(x))) return cron
  const time = `${String(+hr).padStart(2, '0')}:${String(+min).padStart(2, '0')}`
  if (dom === '*' && dow === '*') return `Daily at ${time}`
  if (dom === '*' && /^\d+$/.test(dow)) return `Weekly on ${WEEKDAYS[+dow % 7]} at ${time}`
  if (/^\d+$/.test(dom) && dow === '*') return `Monthly on day ${dom} at ${time}`
  return cron
}
