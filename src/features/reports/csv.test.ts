import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses a simple header + rows with CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
  it('handles quoted fields with commas, escaped quotes, and a BOM', () => {
    expect(parseCsv('﻿name,note\r\n"Budget, Q1","he said ""hi"""')).toEqual([
      ['name', 'note'],
      ['Budget, Q1', 'he said "hi"'],
    ])
  })
  it('keeps embedded newlines inside quoted fields', () => {
    expect(parseCsv('a\r\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']])
  })
})
