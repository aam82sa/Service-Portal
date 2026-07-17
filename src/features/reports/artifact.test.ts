import { describe, expect, it } from 'vitest'
import { artifactFilename, previewable, withDownloadParam } from './artifact'

describe('artifactFilename', () => {
  it('returns the last path segment', () => {
    expect(artifactFilename('owner-uuid/run-uuid/sla-compliance.pdf')).toBe('sla-compliance.pdf')
    expect(artifactFilename('a.csv')).toBe('a.csv')
  })
  it('falls back for empty paths', () => {
    expect(artifactFilename('')).toBe('report')
  })
})

describe('withDownloadParam', () => {
  it('appends with ? when the url has no query', () => {
    expect(withDownloadParam('https://x/y.pdf', 'y.pdf')).toBe('https://x/y.pdf?download=y.pdf')
  })
  it('appends with & when the url already has a query (signed urls do)', () => {
    expect(withDownloadParam('https://x/y.pdf?token=abc', 'y.pdf')).toBe('https://x/y.pdf?token=abc&download=y.pdf')
  })
  it('url-encodes the filename', () => {
    expect(withDownloadParam('https://x/y?t=1', 'my report.pdf')).toBe('https://x/y?t=1&download=my%20report.pdf')
  })
})

describe('previewable', () => {
  it('pdf and csv render inline; xlsx does not', () => {
    expect(previewable('pdf')).toBe(true)
    expect(previewable('csv')).toBe(true)
    expect(previewable('xlsx')).toBe(false)
  })
})
