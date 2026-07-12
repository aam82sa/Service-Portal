import { describe, expect, it } from 'vitest'
import { csvField, toCsv } from './csv'

describe('csvField', () => {
  it('passes plain values through', () => {
    expect(csvField('hello')).toBe('hello')
    expect(csvField(42)).toBe('42')
    expect(csvField(true)).toBe('true')
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('quotes commas, quotes, and newlines per RFC 4180', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('JSON-encodes objects (jsonb detail columns)', () => {
    expect(csvField({ from: 'new', to: 'triaged' })).toBe('"{""from"":""new"",""to"":""triaged""}"')
    expect(csvField(['a', 'b'])).toBe('"[""a"",""b""]"')
  })
})

describe('toCsv', () => {
  it('emits a header row and one CRLF-terminated line per row', () => {
    const csv = toCsv(
      [
        { ref: 'REQ-2501', action: 'created', detail: { steps: 2 } },
        { ref: 'REQ-2502', action: 'status_changed', detail: null },
      ],
      [
        { key: 'ref', header: 'Ref' },
        { key: 'action', header: 'Action' },
        { key: 'detail', header: 'Detail' },
      ],
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Ref,Action,Detail')
    expect(lines[1]).toBe('REQ-2501,created,"{""steps"":2}"')
    expect(lines[2]).toBe('REQ-2502,status_changed,')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
