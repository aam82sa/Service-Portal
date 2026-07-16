import { describe, expect, it } from 'vitest'
import { renderNumber } from './numbering'

const JUL_2026 = new Date('2026-07-09T12:00:00Z')

describe('renderNumber', () => {
  it('renders the default letter scheme {dept}/{yyyy}/{seq:4}', () => {
    expect(renderNumber('{dept}/{yyyy}/{seq:4}', 7, { dept: 'ADMIN', on: JUL_2026 }))
      .toBe('ADMIN/2026/0007')
  })

  it('combines every token', () => {
    expect(
      renderNumber('{doctype}-{dept}-{yy}{mm}{dd}-{seq:3}', 42, {
        dept: 'IT', doctype: 'MEMO', on: JUL_2026,
      }),
    ).toBe('MEMO-IT-260709-042')
  })

  it('pads to the requested width and overflows gracefully', () => {
    expect(renderNumber('{seq:4}', 12345, { on: JUL_2026 })).toBe('12345')
    expect(renderNumber('{seq:6}', 9, { on: JUL_2026 })).toBe('000009')
  })

  it('renders bare {seq} without padding', () => {
    expect(renderNumber('L{seq}', 305, { on: JUL_2026 })).toBe('L305')
  })

  it('handles year rollover values', () => {
    const nye = new Date('2027-01-01T08:00:00Z')
    expect(renderNumber('{yyyy}/{yy}/{mm}', 1, { on: nye })).toBe('2027/27/01')
  })

  it('renders missing dept/doctype as empty strings', () => {
    expect(renderNumber('{dept}{doctype}#{seq}', 5, { on: JUL_2026 })).toBe('#5')
  })

  it('repeats tokens consistently', () => {
    expect(renderNumber('{yy}-{yy}-{seq:2}-{seq:2}', 3, { on: JUL_2026 })).toBe('26-26-03-03')
  })

  it('renders the Hijri year token where the runtime has the Umm al-Qura calendar', () => {
    // 2026 falls in Hijri 1447/1448; ICU-less builds render the tokens empty.
    const out = renderNumber('{hyyyy}/{hyy}', 1, { on: JUL_2026 })
    if (out !== '/') expect(out).toMatch(/^14\d\d\/\d\d$/)
  })
})
