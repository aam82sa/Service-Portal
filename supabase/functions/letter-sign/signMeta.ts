/**
 * Pure helpers for the letter-signing flow — the tamper hash and the storage /
 * registry paths. Kept free of pdf-lib / QR / DB so they can be unit-tested.
 * The SHA-256 of the final signed PDF is the tamper-evident record stored on
 * the letter (letter_outgoing.signed_sha256).
 */

/** Hex SHA-256 of the signed PDF bytes (Web Crypto — available in Deno + Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Storage path for the signed artifact: {letter}/signed-<timestamp>.pdf */
export function signedArtifactPath(letterId: string, at: Date = new Date()): string {
  return `${letterId}/signed-${at.toISOString().replace(/[:.]/g, '-')}.pdf`
}

/** The registry URL a letter's QR points to (stable by id — no ref needed). */
export function registryUrl(baseUrl: string, letterId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/letters/${letterId}`
}
