import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ALLOWED_EXTENSIONS, objectPath, validateUpload } from '../lib/upload'

/**
 * Request attachments: drag/drop + picker into the private `attachments`
 * bucket at {request_id}/{timestamp}-{filename}. Listing follows storage RLS
 * (request visibility, migration 00048); downloads use 60-second signed URLs.
 */

interface StoredFile {
  name: string
  path: string
  size: number | null
}

const fmtSize = (b: number | null) =>
  b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

/** display name: strip the {timestamp}- prefix objectPath adds */
const displayName = (name: string) => name.replace(/^\d{10,}-/, '')

export function FileUpload({ requestId, canUpload = true, compact = false, onChanged, onError }: {
  requestId: string
  canUpload?: boolean
  compact?: boolean
  onChanged?: (paths: string[]) => void
  onError?: (message: string) => void
}) {
  const [files, setFiles] = useState<StoredFile[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const report = useCallback((m: string) => onError?.(m), [onError])

  const load = useCallback(async () => {
    const { data, error } = await supabase.storage.from('attachments').list(requestId, {
      sortBy: { column: 'created_at', order: 'asc' },
    })
    if (error) { report(error.message); return }
    const rows = (data ?? [])
      .filter((f) => f.name !== '.emptyFolderPlaceholder')
      .map((f) => ({
        name: f.name,
        path: `${requestId}/${f.name}`,
        size: (f.metadata as { size?: number } | null)?.size ?? null,
      }))
    setFiles(rows)
    onChanged?.(rows.map((r) => r.path))
  }, [requestId, report, onChanged])

  useEffect(() => { void load() }, [load])

  const upload = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const check = validateUpload(file)
      if (!check.ok) { report(`${file.name}: ${check.reason}`); continue }
      setBusy(file.name)
      const { error } = await supabase.storage
        .from('attachments')
        .upload(objectPath(requestId, file.name), file, { upsert: false })
      if (error) report(`${file.name}: ${error.message}`)
    }
    setBusy(null)
    void load()
  }

  const download = async (f: StoredFile) => {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(f.path, 60, { download: displayName(f.name) })
    if (error || !data) { report(error?.message ?? 'could not sign URL'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const remove = async (f: StoredFile) => {
    const { error } = await supabase.storage.from('attachments').remove([f.path])
    if (error) report(error.message)
    void load()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (canUpload && e.dataTransfer.files.length > 0) void upload(e.dataTransfer.files)
  }

  return (
    <div>
      {files.map((f) => (
        <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--line)', fontSize: 12.5 }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(f.name)}</span>
          <span className="row-desc mono" style={{ fontSize: 10.5 }}>{fmtSize(f.size)}</span>
          <button className="card-link" onClick={() => void download(f)}>Download</button>
          {canUpload && (
            <button className="card-link" style={{ color: 'var(--red)' }} onClick={() => void remove(f)}>Remove</button>
          )}
        </div>
      ))}
      {files.length === 0 && !canUpload && <div className="row-desc" style={{ fontSize: 12 }}>No attachments.</div>}

      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            marginTop: 8, padding: compact ? '10px 12px' : '16px 12px', textAlign: 'center',
            border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--line)'}`,
            borderRadius: 10, cursor: 'pointer', fontSize: 12,
            color: dragOver ? 'var(--accent)' : 'var(--muted)',
            background: dragOver ? 'var(--accent-soft)' : 'transparent',
          }}
        >
          {busy ? `Uploading ${busy}…` : 'Drop files here or click to browse'}
          <div style={{ fontSize: 10.5, marginTop: 3 }}>
            up to 10 MB · {ALLOWED_EXTENSIONS.slice(0, 6).join(', ')}, …
          </div>
          <input
            ref={inputRef} type="file" multiple hidden
            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
            onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = '' }}
          />
        </div>
      )}
    </div>
  )
}
