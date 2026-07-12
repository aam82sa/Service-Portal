/**
 * Upload validation + path building for request attachments — pure, so the
 * caps the FileUpload component enforces are unit-tested. The 10 MB limit is
 * mirrored server-side on the `attachments` bucket (migration 00048).
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'md', 'zip', 'msg', 'eml',
] as const

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Filesystem-safe object name: no separators, no control chars, bounded length. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= 120) return cleaned || 'file'
  const ext = fileExtension(cleaned)
  const stem = cleaned.slice(0, 120 - (ext ? ext.length + 1 : 0))
  return ext ? `${stem}.${ext}` : stem
}

export type UploadCheck = { ok: true } | { ok: false; reason: string }

export function validateUpload(file: { name: string; size: number }): UploadCheck {
  const ext = fileExtension(file.name)
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `File type .${ext || '?'} is not allowed` }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit` }
  }
  if (file.size === 0) {
    return { ok: false, reason: 'File is empty' }
  }
  return { ok: true }
}

/** attachments/{request_id}/{timestamp}-{filename} (bucket-relative). */
export function objectPath(requestId: string, filename: string, now: Date = new Date()): string {
  return `${requestId}/${now.getTime()}-${sanitizeFilename(filename)}`
}
