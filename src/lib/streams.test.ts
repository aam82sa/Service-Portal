import { describe, expect, it } from 'vitest'
import { previewDeptCode } from './streams'

describe('previewDeptCode', () => {
  it('takes the first three uppercase alphanumerics', () => {
    expect(previewDeptCode('Facilities Management', [])).toBe('FAC')
    expect(previewDeptCode('logistics', [])).toBe('LOG')
  })

  it('appends a numeric suffix on collision', () => {
    expect(previewDeptCode('Facilities Trust', ['FAC'])).toBe('FAC2')
    expect(previewDeptCode('Facilities', ['FAC', 'FAC2'])).toBe('FAC3')
  })

  it('is case-insensitive about existing codes', () => {
    expect(previewDeptCode('Facilities', ['fac'])).toBe('FAC2')
  })

  it('pads short names and falls back for empty input', () => {
    expect(previewDeptCode('AB', [])).toBe('ABX')
    expect(previewDeptCode('  ', [])).toBe('DEP')
    expect(previewDeptCode('—', [])).toBe('DEP')
  })

  it('ignores punctuation and spaces when forming the base', () => {
    expect(previewDeptCode('R&D / Innovation', [])).toBe('RDI')
  })
})
