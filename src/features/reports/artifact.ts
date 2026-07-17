/**
 * Helpers for report artifact URLs. Pure — unit-tested in artifact.test.ts.
 *
 * Supabase Storage signed URLs accept a `download` query parameter that adds a
 * Content-Disposition: attachment header, which makes the browser SAVE the file
 * instead of navigating to it. Appending it client-side lets one signed URL
 * serve both the inline preview (without) and the download (with).
 */

/** The artifact's filename (last path segment). */
export function artifactFilename(path: string): string {
  const seg = path.split('/').filter(Boolean)
  return seg[seg.length - 1] ?? 'report'
}

/** Add the `download=<filename>` param so the browser saves instead of opens. */
export function withDownloadParam(url: string, filename: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}download=${encodeURIComponent(filename)}`
}

/** Can the browser render this format inline in an iframe? */
export function previewable(format: string): boolean {
  return format === 'pdf' || format === 'csv'
}

/**
 * Trigger a download without window.open — a programmatic anchor click is not
 * subject to popup blocking, which silently swallows window.open calls that
 * happen after an await (i.e. after the user-gesture context is gone).
 */
export function saveUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = withDownloadParam(url, filename)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
