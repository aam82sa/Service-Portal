import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  fileExtension,
  objectPath,
  sanitizeFilename,
  validateUpload,
} from './upload'

describe('validateUpload', () => {
  it('accepts an ordinary document under the cap', () => {
    expect(validateUpload({ name: 'quote.pdf', size: 512_000 })).toEqual({ ok: true })
  })

  it('rejects disallowed extensions (and files without one)', () => {
    expect(validateUpload({ name: 'run.exe', size: 100 }).ok).toBe(false)
    expect(validateUpload({ name: 'script.sh', size: 100 }).ok).toBe(false)
    expect(validateUpload({ name: 'noext', size: 100 }).ok).toBe(false)
    expect(validateUpload({ name: 'trailingdot.', size: 100 }).ok).toBe(false)
  })

  it('is case-insensitive on the extension', () => {
    expect(validateUpload({ name: 'SCAN.PDF', size: 100 }).ok).toBe(true)
  })

  it('enforces the 10 MB cap inclusively', () => {
    expect(validateUpload({ name: 'big.zip', size: MAX_UPLOAD_BYTES }).ok).toBe(true)
    expect(validateUpload({ name: 'big.zip', size: MAX_UPLOAD_BYTES + 1 }).ok).toBe(false)
  })

  it('rejects empty files', () => {
    expect(validateUpload({ name: 'empty.txt', size: 0 }).ok).toBe(false)
  })
})

describe('sanitizeFilename', () => {
  it('strips path separators and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(sanitizeFilename('a\\b/c.txt')).toBe('a_b_c.txt')
    expect(sanitizeFilename('bad\x00name.pdf')).toBe('badname.pdf')
  })

  it('collapses whitespace and bounds length keeping the extension', () => {
    expect(sanitizeFilename('  my   report .pdf ')).toBe('my report .pdf')
    const long = 'x'.repeat(300) + '.docx'
    const out = sanitizeFilename(long)
    expect(out.length).toBeLessThanOrEqual(121)
    expect(out.endsWith('.docx')).toBe(true)
  })

  it('never returns an empty name', () => {
    expect(sanitizeFilename('///')).not.toBe('')
  })
})

describe('objectPath', () => {
  it('builds {request_id}/{timestamp}-{sanitized}', () => {
    const at = new Date('2026-07-12T10:00:00Z')
    expect(objectPath('req-1', 'my file.pdf', at)).toBe(`req-1/${at.getTime()}-my file.pdf`)
  })

  it('keeps traversal attempts inside the request folder', () => {
    const at = new Date(0)
    expect(objectPath('req-1', '../../other/secret.pdf', at)).toBe('req-1/0-.._.._other_secret.pdf')
  })
})

describe('fileExtension', () => {
  it('handles dots sensibly', () => {
    expect(fileExtension('a.b.C.PDF')).toBe('pdf')
    expect(fileExtension('none')).toBe('')
    expect(fileExtension('trailing.')).toBe('')
  })
})
