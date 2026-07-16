import { describe, expect, it } from 'vitest'
import { registryUrl, sha256Hex, signedArtifactPath } from './signMeta'

describe('sha256Hex', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    const h = await sha256Hex(new TextEncoder().encode('abc'))
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('is stable and 64 hex chars', async () => {
    const h = await sha256Hex(new Uint8Array([1, 2, 3, 4]))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('signedArtifactPath', () => {
  it('nests under the letter id with a filesystem-safe timestamp', () => {
    const p = signedArtifactPath('11111111-1111-1111-1111-111111111111', new Date('2026-07-16T20:32:10.500Z'))
    expect(p).toBe('11111111-1111-1111-1111-111111111111/signed-2026-07-16T20-32-10-500Z.pdf')
  })
})

describe('registryUrl', () => {
  it('joins base + letter id and trims trailing slashes', () => {
    expect(registryUrl('https://hub.abccorp.com/', 'abc')).toBe('https://hub.abccorp.com/letters/abc')
    expect(registryUrl('https://hub.abccorp.com', 'abc')).toBe('https://hub.abccorp.com/letters/abc')
  })
})
