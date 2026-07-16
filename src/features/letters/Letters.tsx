import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PersonPicker } from '../../components/PersonPicker'
import { DEPT_COLOR, PORTAL_DEPTS, type DeptCode } from '../../lib/types'
import { readLetter, type ExtractedLetter } from './aiReader'
import { OutgoingLifecycle } from './OutgoingLifecycle'

type Direction = 'incoming' | 'outgoing'
type Confidentiality = 'general' | 'restricted' | 'confidential'

interface Letter {
  id: string
  direction: Direction
  doctype: string
  ref_ours: string | null
  ref_theirs: string | null
  letter_date: string | null
  received_on: string
  sender: string | null
  addressee: string | null
  subject: string
  brief_ar: string | null
  brief_en: string | null
  ocr_text: string | null
  confidentiality: Confidentiality
  dept: DeptCode
  owner_id: string
  status: string
  created_by: string | null
  created_at: string
  owner: { display_name: string } | null
}
interface LetterFile { id: string; path: string; filename: string; mime: string | null }
interface Share { id: string; user_id: string | null; dept: DeptCode | null; user: { display_name: string } | null }
interface Ev { id: number; event_type: string; detail: Record<string, unknown>; created_at: string; actor: { display_name: string } | null }
interface Person { id: string; display_name: string }
interface Scheme { id: string; name: string; format: string; seq_scope: string; reset_policy: string; is_default: boolean }

const CONF_STYLE: Record<Confidentiality, { cls: string; lock: boolean; label: string }> = {
  general: { cls: 't-muted', lock: false, label: 'General' },
  restricted: { cls: 't-amber', lock: true, label: 'Restricted' },
  confidential: { cls: 't-red', lock: true, label: 'Confidential' },
}
const STATUS_CLS: Record<string, string> = {
  registered: 't-it', in_review: 't-amber', answered: 't-green', closed: 't-muted',
  draft: 't-muted', in_initials: 't-amber', signed: 't-accent', dispatched: 't-green', voided: 't-red',
}
const ETAG_CLS: Record<string, string> = {
  view_clear: 't-red', viewed: 't-muted', downloaded: 't-amber', printed: 't-muted',
  shared: 't-it', number_issued: 't-accent', registered: 't-muted',
  confidentiality_changed: 't-red', transferred: 't-it',
}
const ETAG_LABEL: Record<string, string> = {
  view_clear: 'view clear', number_issued: 'ref issued', confidentiality_changed: 'confidentiality',
}
const label10: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)',
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const isArabic = (s: string | null | undefined) => !!s && /[؀-ۿ]/.test(s)

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function ConfChip({ c }: { c: Confidentiality }) {
  const s = CONF_STYLE[c]
  return (
    <span className={`chip ${s.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {s.lock && <LockIcon />}{s.label}
    </span>
  )
}

function DirChip({ d, tag }: { d: Direction; tag?: boolean }) {
  return (
    <span className={`${tag ? 'dir-tag' : 'chip'} ${d === 'incoming' ? 't-it' : 't-green'}`}
      style={tag ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className="ar">{d === 'incoming' ? 'وارد' : 'صادر'}</span>
      {tag ? (d === 'incoming' ? 'IN' : 'OUT') : (d === 'incoming' ? 'Incoming' : 'Outgoing')}
    </span>
  )
}

/** Client-side twin of render_letter_number for the live preview. */
export function previewNumber(format: string, seq = 142, dept = 'ADM', doctype = 'LTR') {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  let out = format
  const pad = out.match(/\{seq:(\d+)\}/)
  if (pad) out = out.replace(/\{seq:\d+\}/, String(seq).padStart(Number(pad[1]), '0'))
  return out
    .replace('{seq}', String(seq))
    .replace('{yyyy}', String(d.getFullYear()))
    .replace('{yy}', String(d.getFullYear()).slice(-2))
    .replace('{mm}', p2(d.getMonth() + 1))
    .replace('{dd}', p2(d.getDate()))
    .replace('{dept}', dept)
    .replace('{doctype}', doctype)
}

function Watermark({ stamp }: { stamp: string }) {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: 60 }, (_, i) => (
        <div key={i} style={{
          position: 'absolute', top: i * 84 - 40, left: '-20%', width: '140%',
          transform: 'rotate(-27deg)', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600,
          color: 'rgba(16,25,46,.16)', letterSpacing: '1px',
        }}>
          {`${stamp}   ${stamp}   ${stamp}`}
        </div>
      ))}
    </div>
  )
}

/**
 * Inline watermarked viewer. Documents are served by the letter-rendition
 * edge function, which verifies letter access, burns the per-viewer stamp
 * (name, id fragment, timestamp, reference, tier) into a PDF rendition
 * server-side, and writes the viewed/view_clear audit event — the raw
 * object itself is only readable by the letter owner (storage policy 00062),
 * so lifting the network request never yields a clean copy.
 *
 * Local stacks that haven't deployed the function fall back to the owner's
 * raw signed URL with the client overlay (non-owners are blocked by the
 * storage policy either way).
 */
function DocViewer({ letter, file, clear, stamp, onLogged }: {
  letter: Letter; file: LetterFile; clear: boolean; stamp: string; onLogged: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(true)
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setError(null)
    setFallback(false)

    supabase.functions
      .invoke('letter-rendition', { body: { letter_id: letter.id, path: file.path, clear } })
      .then(async ({ data, error: e }) => {
        if (cancelled) return
        if (!e && data instanceof Blob) {
          objectUrl = URL.createObjectURL(data)
          setIsPdf(data.type.includes('pdf'))
          setUrl(objectUrl)
          onLogged() // the function wrote the audit event; refresh the trail
          return
        }
        // function unavailable (e.g. local stack) — owner-only raw fallback
        const { data: s, error: e2 } = await supabase.storage.from('letters').createSignedUrl(file.path, 300)
        if (cancelled) return
        if (e2 || !s) {
          setError(e2?.message ?? e?.message ?? 'preview failed')
          return
        }
        setFallback(true)
        setIsPdf((file.mime ?? '').includes('pdf') || file.filename.toLowerCase().endsWith('.pdf'))
        setUrl(s.signedUrl)
        supabase.rpc('log_letter_event', {
          p_letter: letter.id,
          p_type: clear ? 'view_clear' : 'viewed',
          p_detail: { file: file.filename, rendition: 'client-fallback' },
        }).then(() => onLogged())
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [letter.id, file.path, file.filename, file.mime, clear, onLogged])

  return (
    <div className="lt-viewer" style={{ overflowY: isPdf ? 'hidden' : 'auto', borderTop: '1px solid var(--line)' }}>
      {error && <p className="error-note" style={{ padding: 16 }}>{error}</p>}
      {isPdf ? (
        <>
          {url && <iframe title={file.filename} src={url} style={{ width: '100%', height: '100%', border: 'none' }} />}
          {fallback && !clear && <Watermark stamp={stamp} />}
        </>
      ) : (
        // tall scans scroll; the fallback watermark wrapper spans the full
        // scrolled length so no part of the document renders clean
        <div style={{ position: 'relative', minHeight: '100%' }}>
          {url && <img src={url} alt={file.filename} style={{ width: '100%', display: 'block' }} />}
          {fallback && !clear && <Watermark stamp={stamp} />}
        </div>
      )}
    </div>
  )
}

function Detail({ letter, people, viewer, allowOwnerClear, onBack, onChanged }: {
  letter: Letter; people: Person[]; viewer: { id: string; name: string }
  allowOwnerClear: boolean; onBack: () => void; onChanged: () => void
}) {
  const [files, setFiles] = useState<LetterFile[]>([])
  const [shares, setShares] = useState<Share[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [comment, setComment] = useState('')
  const [shareUser, setShareUser] = useState('')
  const [shareDept, setShareDept] = useState('')
  const [activePath, setActivePath] = useState<string | null>(null)
  const [clear, setClear] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOwner = letter.owner_id === viewer.id
  const conf = CONF_STYLE[letter.confidentiality]

  const load = useCallback(() => {
    supabase.from('letter_files').select('id, path, filename, mime').eq('letter_id', letter.id)
      .then(({ data }) => setFiles((data as LetterFile[]) ?? []))
    supabase.from('letter_shares')
      .select('id, user_id, dept, user:profiles!letter_shares_user_id_fkey(display_name)')
      .eq('letter_id', letter.id)
      .then(({ data }) => setShares((data as unknown as Share[]) ?? []))
    supabase.from('letter_events')
      .select('id, event_type, detail, created_at, actor:profiles!letter_events_actor_id_fkey(display_name)')
      .eq('letter_id', letter.id).order('id', { ascending: false }).limit(60)
      .then(({ data }) => setEvents((data as unknown as Ev[]) ?? []))
  }, [letter.id])
  useEffect(load, [load])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null)
    const { error: e } = await q
    if (e) setError(e.message)
    else { load(); onChanged() }
  }

  const issueNumber = async () => {
    setError(null)
    const { error: e } = await supabase.rpc('issue_letter_number', { p_letter: letter.id })
    if (e) setError(e.message)
    else { load(); onChanged() }
  }

  const download = async (f: LetterFile) => {
    setError(null)
    const { data, error: e } = await supabase.storage.from('letters').createSignedUrl(f.path, 60, { download: f.filename })
    if (e) { setError(e.message); return }
    await supabase.rpc('log_letter_event', { p_letter: letter.id, p_type: 'downloaded', p_detail: { file: f.filename } })
    window.open(data.signedUrl, '_blank')
    load()
  }

  const attach = async (file: File) => {
    setError(null)
    setUploading(true)
    const path = `${letter.id}/${file.name}`
    const { error: e1 } = await supabase.storage.from('letters').upload(path, file, { upsert: true })
    if (e1) { setError(e1.message); setUploading(false); return }
    // upsert keeps one row per path when the same scan is re-uploaded
    const { error: e2 } = await supabase.from('letter_files')
      .delete().eq('letter_id', letter.id).eq('path', path)
      .then(() => supabase.from('letter_files').insert({
        letter_id: letter.id, path, filename: file.name, mime: file.type || null, size_bytes: file.size,
      }))
    if (e2) setError(e2.message)
    setUploading(false)
    load()
  }

  const removeFile = async (f: LetterFile) => {
    if (!window.confirm(`Remove ${f.filename} from this letter?`)) return
    setError(null)
    await supabase.storage.from('letters').remove([f.path])
    await run(supabase.from('letter_files').delete().eq('id', f.id))
  }

  const qrLabel = async () => {
    const ref = letter.ref_ours ?? letter.ref_theirs ?? letter.id.slice(0, 8)
    const qr = await QRCode.toDataURL(`${window.location.origin}/?letter=${letter.id}`, { width: 220, margin: 1 })
    const w = window.open('', '_blank', 'width=420,height=520')
    if (!w) return
    w.document.write(`<html><head><title>${ref}</title></head>
      <body style="font-family:monospace;text-align:center;padding:24px">
      <div style="border:1.5px solid #10192E;border-radius:10px;padding:18px;display:inline-block">
      <img src="${qr}" width="200" /><div style="font-size:18px;font-weight:700;margin-top:6px">${ref}</div>
      <div style="font-size:11px;max-width:220px;margin:4px auto 0">${letter.subject.replace(/</g, '&lt;')}</div>
      <div style="font-size:10px;margin-top:5px;letter-spacing:1px">${conf.label.toUpperCase()}</div>
      </div><script>window.print()</script></body></html>`)
    await supabase.rpc('log_letter_event', { p_letter: letter.id, p_type: 'printed', p_detail: { ref } })
    load()
  }

  const comments = events.filter((e) => e.event_type === 'comment')
  const trail = events.filter((e) => e.event_type !== 'comment')
  const c = DEPT_COLOR[letter.dept]
  const activeFile = files.find((f) => f.path === activePath) ?? files[0] ?? null
  const stamp = `${viewer.name} · ${viewer.id.slice(0, 8)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${letter.ref_ours ?? letter.ref_theirs ?? letter.id.slice(0, 8)} · ${letter.confidentiality.toUpperCase()}`

  const evWho = (e: Ev) => {
    const who = e.actor?.display_name ?? 'System'
    switch (e.event_type) {
      case 'viewed': return `${who} (watermarked)`
      case 'view_clear': return `${who} opened a clear copy`
      case 'downloaded': return `${who} downloaded ${str(e.detail.file)}`
      case 'printed': return `${who} printed a QR label`
      case 'shared': return `${who} added a named viewer`
      case 'number_issued': return `${str(e.detail.ref) || 'reference'} assigned`
      case 'registered': return `${who} registered the letter`
      case 'transferred': return `${who} transferred ownership`
      case 'confidentiality_changed': return `${who}: ${str(e.detail.from)} → ${str(e.detail.to)}`
      default: return who
    }
  }

  const attachLabel = (
    <label className="btn" style={{ cursor: uploading ? 'wait' : 'pointer', padding: '3px 9px', fontSize: 11 }}>
      {uploading ? 'Uploading…' : '+ Attach scan'}
      <input
        type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={uploading}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = '' }}
      />
    </label>
  )

  return (
    <>
      <button className="btn" style={{ marginBottom: 12, padding: '3px 9px', fontSize: 11 }} onClick={onBack}>← Back to register</button>
      <div className="detail-grid">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="dhead">
            <div className="chips">
              <span className="chip t-ink mono">{letter.ref_ours ?? 'no ref'}</span>
              <DirChip d={letter.direction} />
              <ConfChip c={letter.confidentiality} />
              <span className="chip" style={{ background: c.soft, color: c.rail }}>{c.label}</span>
              <span className={`chip ${STATUS_CLS[letter.status] ?? 't-muted'}`}>{letter.status.replace('_', ' ')}</span>
            </div>
            {isArabic(letter.subject) ? (
              <>
                <h2 className="ar" dir="rtl">{letter.subject}</h2>
                {letter.brief_en && <div className="subj-en">{letter.brief_en}</div>}
              </>
            ) : (
              <h2 style={{ fontSize: 17 }}>{letter.subject}</h2>
            )}
          </div>

          {letter.confidentiality === 'confidential' && (
            <div className="conf-banner">
              <svg className="shield" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.6C8 22.4 5 18.4 5 14V6z" /><path d="M9.5 12l1.8 1.8L15 10" />
              </svg>
              <div className="txt">
                <b>Confidential — access restricted to owner and named viewers.</b>{' '}
                Sharing is disabled; downloads are blocked. Every copy is stamped with the viewer's identity and logged.
              </div>
            </div>
          )}

          {activeFile ? (
            <>
              <DocViewer letter={letter} file={activeFile} clear={clear} stamp={stamp} onLogged={load} />
              <div className={`wm-note${clear ? ' clear' : ''}`}>
                <svg className="eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                </svg>
                {clear ? (
                  <span>You are viewing a <b>clear copy</b> — owner-only. This open was logged to the audit trail.</span>
                ) : (
                  <span>You are viewing a <b>watermarked copy</b> stamped <span className="mono">{stamp}</span>. This open was logged.</span>
                )}
              </div>
              <div className="viewer-bar">
                <span className="fname">{activeFile.filename}</span>
                {files.length > 1 && (
                  <select className="input" style={{ width: 180 }} aria-label="Attached file"
                    value={activeFile.path} onChange={(e) => { setActivePath(e.target.value); setClear(false) }}>
                    {files.map((f) => <option key={f.id} value={f.path}>{f.filename}</option>)}
                  </select>
                )}
                {isOwner && allowOwnerClear && (
                  <button className="btn" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    onClick={() => setClear((v) => !v)}>
                    {clear ? 'Back to watermarked' : 'View clear copy'}
                  </button>
                )}
                {isOwner && letter.confidentiality !== 'confidential' && (
                  <button className="btn" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => download(activeFile)}>Download</button>
                )}
                {isOwner && (
                  <button className="btn" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--red)' }} onClick={() => removeFile(activeFile)}>Remove</button>
                )}
                {attachLabel}
                <span className="owner-note">{isOwner && allowOwnerClear ? 'Owner-only · audited' : 'Every open is audited'}</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
              <span className="row-desc">No scanned copy yet — attach one:</span>
              {attachLabel}
            </div>
          )}

          <div className="meta-row">
            <div><div className="f-lbl">Our reference</div><div className="f-val mono">{letter.ref_ours ?? '—'}</div></div>
            <div><div className="f-lbl">Their reference</div><div className="f-val mono">{letter.ref_theirs ?? '—'}</div></div>
            <div><div className="f-lbl">Received</div><div className="f-val mono">{letter.received_on}</div></div>
            <div><div className="f-lbl">Owner</div><div className="f-val">{letter.owner?.display_name ?? '—'}</div></div>
          </div>

          <div className="actions-bar">
            {!letter.ref_ours && (
              <button className="btn primary" style={{ padding: '3px 9px', fontSize: 11 }} onClick={issueNumber}>Issue reference</button>
            )}
            <button className="btn" style={{ padding: '3px 9px', fontSize: 11 }} onClick={qrLabel}>QR label</button>
            {isOwner && (
              <>
                <select className="input" style={{ width: 130 }} aria-label="Status" value={letter.status}
                  onChange={(e) => run(supabase.from('letters').update({ status: e.target.value }).eq('id', letter.id))}>
                  {['registered', 'in_review', 'answered', 'closed'].map((v) => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                </select>
                <select className="input" style={{ width: 150 }} aria-label="Confidentiality (owner only)" value={letter.confidentiality}
                  onChange={(e) => run(supabase.from('letters').update({ confidentiality: e.target.value }).eq('id', letter.id))}>
                  {(['general', 'restricted', 'confidential'] as const).map((v) => <option key={v} value={v}>{CONF_STYLE[v].label}</option>)}
                </select>
                <PersonPicker small width={170} people={people.filter((p) => p.id !== letter.owner_id)}
                  placeholder="Transfer to…"
                  onPick={(p) => run(supabase.from('letters').update({ owner_id: p.id }).eq('id', letter.id))} />
              </>
            )}
            {letter.confidentiality === 'confidential' && (
              <span className="disabled-note owner-note">Download &amp; share disabled — confidential</span>
            )}
          </div>

          {letter.direction === 'outgoing' && (
            <OutgoingLifecycle
              letterId={letter.id}
              status={letter.status}
              refOurs={letter.ref_ours}
              subject={letter.subject}
              onChanged={() => { load(); onChanged() }}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={label10}>Extracted fields</span>
              <span className="ai-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18" />
                </svg>
                Read by Claude · confirm to correct
              </span>
            </div>
            <div className="lt-fgrid">
              <div>
                <div className="f-lbl">Sender · المُرسِل</div>
                <div className={isArabic(letter.sender) ? 'f-val ar' : 'f-val'} dir={isArabic(letter.sender) ? 'rtl' : undefined}>
                  {letter.sender ?? '—'}
                </div>
              </div>
              <div>
                <div className="f-lbl">Addressee · المُرسَل إليه</div>
                <div className={isArabic(letter.addressee) ? 'f-val ar' : 'f-val'} dir={isArabic(letter.addressee) ? 'rtl' : undefined}>
                  {letter.addressee ?? '—'}
                </div>
              </div>
              <div><div className="f-lbl">Letter number</div><div className="f-val mono">{letter.ref_theirs ?? '—'}</div></div>
              <div><div className="f-lbl">Letter date</div><div className="f-val mono">{letter.letter_date ?? '—'}</div></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="f-lbl">Subject · الموضوع</div>
                <div className={isArabic(letter.subject) ? 'f-val ar' : 'f-val'} dir={isArabic(letter.subject) ? 'rtl' : undefined}>
                  {letter.subject}
                </div>
              </div>
            </div>
            {letter.brief_ar && (
              <div className="brief ar" dir="rtl">
                <div className="f-lbl" style={{ marginBottom: 4 }}>الملخص · عربي</div>
                {letter.brief_ar}
              </div>
            )}
            {letter.brief_en && (
              <div className="brief">
                <div className="f-lbl" style={{ marginBottom: 4 }}>Brief · English</div>
                {letter.brief_en}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ ...label10, marginBottom: 10 }}>Audit trail</div>
            {trail.map((e) => (
              <div key={e.id} className="ev">
                <span className={`etag ${ETAG_CLS[e.event_type] ?? 't-muted'}`}>
                  {ETAG_LABEL[e.event_type] ?? e.event_type.replace(/_/g, ' ')}
                </span>
                <span className="who" title={evWho(e)}>{evWho(e)}</span>
                <span className="ts">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
            {trail.length === 0 && <div className="row-desc">No events yet.</div>}
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ ...label10, marginBottom: 8 }}>Comments · {comments.length}</div>
            {comments.map((e) => (
              <div key={e.id} style={{ padding: '7px 0', borderTop: '1px solid #EDEFF4', fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{e.actor?.display_name ?? 'Unknown'}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11, marginInlineStart: 8 }}>{new Date(e.created_at).toLocaleString()}</span>
                <div style={{ marginTop: 2 }} dir={isArabic(str(e.detail.body)) ? 'rtl' : undefined} className={isArabic(str(e.detail.body)) ? 'ar' : undefined}>
                  {str(e.detail.body)}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="input" placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="btn primary" disabled={!comment.trim()}
                onClick={() => { run(supabase.rpc('add_letter_comment', { p_letter: letter.id, p_body: comment })); setComment('') }}>
                Post
              </button>
            </div>

            {letter.confidentiality !== 'confidential' ? (
              <>
                <div style={{ ...label10, margin: '18px 0 8px' }}>Shared with</div>
                {shares.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, borderTop: '1px solid #EDEFF4' }}>
                    <span style={{ flex: 1 }}>{s.user?.display_name ?? (s.dept ? `${DEPT_COLOR[s.dept].label} (department)` : '—')}</span>
                    {isOwner && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => run(supabase.from('letter_shares').delete().eq('id', s.id))}>Remove</button>}
                  </div>
                ))}
                {isOwner && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <PersonPicker people={people} value={shareUser || null} flex={1}
                      placeholder="Share with person…" onPick={(p) => setShareUser(p.id)} />
                    <select className="input" style={{ width: 170 }} value={shareDept} onChange={(e) => setShareDept(e.target.value)}>
                      <option value="">…or department</option>
                      {PORTAL_DEPTS.map((d) => <option key={d} value={d}>{DEPT_COLOR[d].label}</option>)}
                    </select>
                    <button className="btn" disabled={!shareUser && !shareDept} onClick={() => {
                      run(supabase.from('letter_shares').insert(shareUser ? { letter_id: letter.id, user_id: shareUser } : { letter_id: letter.id, dept: shareDept }))
                      setShareUser(''); setShareDept('')
                    }}>Share</button>
                  </div>
                )}
              </>
            ) : (
              <p className="row-desc" style={{ marginTop: 16 }}>Confidential — sharing disabled; transfer ownership instead.</p>
            )}
          </div>
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}
    </>
  )
}

function Register({ people, selfId, onDone }: {
  people: Person[]; selfId: string; onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [direction, setDirection] = useState<Direction>('incoming')
  const [dept, setDept] = useState<DeptCode>('ADMIN')
  const [conf, setConf] = useState<Confidentiality>('general')
  const [owner, setOwner] = useState(selfId)
  const [f, setF] = useState({ ref_theirs: '', letter_date: '', sender: '', addressee: '', subject: '', brief_ar: '', brief_en: '', ocr_text: '' })
  const [aiExtract, setAiExtract] = useState<ExtractedLetter | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const aiRead = async () => {
    if (!file) return
    setReading(true); setError(null)
    try {
      const { data: fb } = await supabase.from('extraction_feedback')
        .select('field, extracted, corrected').order('created_at', { ascending: false }).limit(12)
      // the read-letter edge function holds the API key — it never reaches the browser
      const { fields } = await readLetter(file, fb ?? [])
      setAiExtract(fields)
      setF({
        ref_theirs: fields.letter_number ?? '',
        letter_date: fields.letter_date ?? '',
        sender: fields.sender ?? '',
        addressee: fields.addressee ?? '',
        subject: fields.subject ?? '',
        brief_ar: fields.brief_ar ?? '',
        brief_en: fields.brief_en ?? '',
        ocr_text: fields.ocr_text ?? '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setReading(false)
  }

  const save = async () => {
    if (!f.subject.trim()) { setError('Subject is required.'); return }
    setSaving(true); setError(null)
    const { data: row, error: e1 } = await supabase.from('letters').insert({
      direction, dept, confidentiality: conf, owner_id: owner, created_by: selfId,
      ref_theirs: f.ref_theirs || null, letter_date: f.letter_date || null,
      sender: f.sender || null, addressee: f.addressee || null, subject: f.subject.trim(),
      brief_ar: f.brief_ar || null, brief_en: f.brief_en || null, ocr_text: f.ocr_text || null,
    }).select('id').single()
    if (e1 || !row) { setError(e1?.message ?? 'insert failed'); setSaving(false); return }

    if (file) {
      const path = `${row.id}/${file.name}`
      const { error: e2 } = await supabase.storage.from('letters').upload(path, file, { upsert: true })
      if (e2) setError(`Letter saved, but the file upload failed: ${e2.message}`)
      else await supabase.from('letter_files').insert({
        letter_id: row.id, path, filename: file.name, mime: file.type || null, size_bytes: file.size,
      })
    }
    // every correction teaches the reader
    if (aiExtract) {
      const pairs: [string, string | null, string][] = [
        ['letter_number', aiExtract.letter_number, f.ref_theirs],
        ['letter_date', aiExtract.letter_date, f.letter_date],
        ['sender', aiExtract.sender, f.sender],
        ['addressee', aiExtract.addressee, f.addressee],
        ['subject', aiExtract.subject, f.subject],
      ]
      const changed = pairs.filter(([, ex, cor]) => (ex ?? '') !== (cor ?? ''))
        .map(([field, ex, cor]) => ({ letter_id: row.id, field, extracted: ex, corrected: cor }))
      if (changed.length) await supabase.from('extraction_feedback').insert(changed)
    }
    setSaving(false)
    if (!error) onDone()
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }))

  return (
    <div className="card" style={{ padding: 18, maxWidth: 820 }}>
      <div style={{ ...label10, marginBottom: 10 }}>Capture</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn primary" disabled={!file || reading} onClick={aiRead}>
          {reading ? 'Reading…' : 'Read with AI'}
        </button>
        <span className="row-desc">Reading runs server-side; the API key never reaches the browser.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="field-label">Direction</label>
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="incoming">Incoming — وارد</option>
            <option value="outgoing">Outgoing — صادر</option>
          </select>
        </div>
        <div>
          <label className="field-label">Department</label>
          <select className="input" value={dept} onChange={(e) => setDept(e.target.value as DeptCode)}>
            {PORTAL_DEPTS.map((d) => <option key={d} value={d}>{DEPT_COLOR[d].label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Confidentiality</label>
          <select className="input" value={conf} onChange={(e) => setConf(e.target.value as Confidentiality)}>
            {(['general', 'restricted', 'confidential'] as const).map((v) => <option key={v} value={v}>{CONF_STYLE[v].label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Owner</label>
          <PersonPicker people={people} value={owner} placeholder="Owner…"
            onPick={(p) => setOwner(p.id)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label className="field-label">Their reference</label><input className="input" value={f.ref_theirs} onChange={set('ref_theirs')} /></div>
        <div><label className="field-label">Letter date</label><input className="input" type="date" value={f.letter_date} onChange={set('letter_date')} /></div>
        <div><label className="field-label">Sender</label><input className="input" value={f.sender} onChange={set('sender')} /></div>
        <div><label className="field-label">Addressee</label><input className="input" value={f.addressee} onChange={set('addressee')} /></div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="field-label">Subject *</label>
        <input className="input" value={f.subject} onChange={set('subject')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label className="field-label">Brief (English)</label><textarea className="input" rows={3} value={f.brief_en} onChange={set('brief_en')} /></div>
        <div><label className="field-label">الملخص (عربي)</label><textarea dir="rtl" className="input" rows={3} value={f.brief_ar} onChange={set('brief_ar')} /></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="field-label">Full text (searchable)</label>
        <textarea className="input" rows={5} value={f.ocr_text} onChange={set('ocr_text')} />
      </div>
      <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Register letter'}</button>
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}

function Settings({ settings, onChanged }: { settings: Record<string, string>; onChanged: () => void }) {
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [draft, setDraft] = useState({ name: '', format: '{dept}/{yyyy}/{seq:4}', seq_scope: 'dept', reset_policy: 'yearly' })
  const [apiKey, setApiKey] = useState(settings['anthropic_api_key'] ?? '')
  const [model, setModel] = useState(settings['ai_model'] ?? 'claude-sonnet-5')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase.from('numbering_schemes').select('*').order('created_at')
      .then(({ data }) => setSchemes((data as Scheme[]) ?? []))
  }, [])
  useEffect(load, [load])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null)
    const { error: e } = await q
    if (e) setError(e.message)
    else { load(); onChanged() }
  }
  const saveSetting = (key: string, value: string) =>
    run(supabase.from('correspondence_settings').upsert({ key, value }))

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ ...label10, marginBottom: 4 }}>Numbering schemes</div>
        <p className="row-desc" style={{ marginBottom: 10 }}>
          Tokens: {'{seq} {seq:4} {yy} {yyyy} {mm} {dd} {dept} {doctype}'} — numbers are issued at
          registration on demand, are concurrency-safe, and are never reused.
        </p>
        {schemes.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #EDEFF4', fontSize: 12.5 }}>
            <span style={{ fontWeight: 600, width: 120 }}>{s.name}</span>
            <span className="mono" style={{ fontSize: 11.5 }}>{s.format}</span>
            <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>
              seq: {s.seq_scope} · reset: {s.reset_policy}
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--green)' }}>{previewNumber(s.format)}</span>
            {s.is_default
              ? <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)', fontSize: 10 }}>default</span>
              : <button className="btn" style={{ padding: '3px 9px', fontSize: 11 }}
                  onClick={async () => {
                    await supabase.from('numbering_schemes').update({ is_default: false }).eq('is_default', true)
                    run(supabase.from('numbering_schemes').update({ is_default: true }).eq('id', s.id))
                  }}>Make default</button>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 140 }}><label className="field-label">Name</label>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div style={{ width: 190 }}><label className="field-label">Format</label>
            <input className="input mono" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })} /></div>
          <div><label className="field-label">Sequence</label>
            <select className="input" value={draft.seq_scope} onChange={(e) => setDraft({ ...draft, seq_scope: e.target.value })}>
              {['global', 'dept', 'doctype'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select></div>
          <div><label className="field-label">Reset</label>
            <select className="input" value={draft.reset_policy} onChange={(e) => setDraft({ ...draft, reset_policy: e.target.value })}>
              {['never', 'yearly', 'monthly'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select></div>
          <button className="btn primary" disabled={!draft.name.trim()}
            onClick={() => { run(supabase.from('numbering_schemes').insert(draft)); setDraft({ ...draft, name: '' }) }}>
            Add scheme
          </button>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', paddingBottom: 8 }}>
            preview: {previewNumber(draft.format)}
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ ...label10, marginBottom: 10 }}>AI reading</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label className="field-label">Claude API key (held server-side; used only by the read-letter function)</label>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" />
          </div>
          <div style={{ width: 200 }}>
            <label className="field-label">Model</label>
            <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <button className="btn primary" onClick={async () => { await saveSetting('anthropic_api_key', apiKey); await saveSetting('ai_model', model) }}>Save</button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <button
            className={`toggle${settings['allow_owner_clear_view'] === 'true' ? ' on' : ''}`}
            onClick={() => saveSetting('allow_owner_clear_view', settings['allow_owner_clear_view'] === 'true' ? 'false' : 'true')}
            aria-label="Allow letter owners to open a clear copy"
          />
          <span style={{ fontSize: 12.5 }}>Letter owners may open a clear (unwatermarked) copy — always audited</span>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}

export function Letters() {
  const { profile, hasRole } = useAuth()
  const [tab, setTab] = useState<'registry' | 'register' | 'settings'>('registry')
  const [letters, setLetters] = useState<Letter[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState('')
  const [conf, setConf] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSys = hasRole('system_admin')

  // direction filters client-side so the segmented counts stay stable
  const load = useCallback(() => {
    let q = supabase.from('letters')
      .select('*, owner:profiles!letters_owner_id_fkey(display_name)')
      .order('created_at', { ascending: sortAsc }).limit(200)
    if (query.trim()) q = q.textSearch('tsv', query.trim(), { type: 'websearch', config: 'simple' })
    if (conf) q = q.eq('confidentiality', conf)
    q.then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setLetters((data as unknown as Letter[]) ?? [])
      setLoaded(true)
    })
  }, [query, conf, sortAsc])
  useEffect(load, [load])

  useEffect(() => {
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
    supabase.from('correspondence_settings').select('key, value').then(({ data }) => {
      const m: Record<string, string> = {}
      for (const r of (data as { key: string; value: string }[]) ?? []) m[r.key] = r.value ?? ''
      setSettings(m)
    })
  }, [])

  const reloadSettings = () =>
    supabase.from('correspondence_settings').select('key, value').then(({ data }) => {
      const m: Record<string, string> = {}
      for (const r of (data as { key: string; value: string }[]) ?? []) m[r.key] = r.value ?? ''
      setSettings(m)
    })

  const selected = useMemo(() => letters.find((l) => l.id === selectedId) ?? null, [letters, selectedId])
  const counts = useMemo(() => ({
    incoming: letters.filter((l) => l.direction === 'incoming').length,
    outgoing: letters.filter((l) => l.direction === 'outgoing').length,
  }), [letters])
  const shown = useMemo(
    () => (direction ? letters.filter((l) => l.direction === direction) : letters),
    [letters, direction]
  )

  if (!profile) return null
  const viewer = { id: profile.id, name: profile.display_name }

  if (selected) {
    return (
      <Detail
        letter={selected} people={people} viewer={viewer}
        allowOwnerClear={settings['allow_owner_clear_view'] === 'true'}
        onBack={() => setSelectedId(null)} onChanged={load}
      />
    )
  }

  return (
    <>
      <h2 className="page-head">Correspondence <span className="ar">الصادر والوارد</span></h2>
      <p className="page-sub">
        Register, search and route official letters. Every open is per-viewer watermarked and written
        to an immutable audit log.
      </p>

      {tab === 'registry' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="seg" style={{ marginBottom: 0 }}>
              <button className={direction === '' ? 'active' : ''} onClick={() => setDirection('')}>
                <span>All</span><span className="cnt">{letters.length}</span>
              </button>
              <button className={direction === 'incoming' ? 'active' : ''} onClick={() => setDirection('incoming')}>
                <span className="ar">وارد</span><span>Incoming</span><span className="cnt">{counts.incoming}</span>
              </button>
              <button className={direction === 'outgoing' ? 'active' : ''} onClick={() => setDirection('outgoing')}>
                <span className="ar">صادر</span><span>Outgoing</span><span className="cnt">{counts.outgoing}</span>
              </button>
            </div>
            <span style={{ flex: 1 }} />
            <input className="input" style={{ maxWidth: 300 }} placeholder="Search subject, parties, full text… (ar / en)"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="input" style={{ width: 160 }} aria-label="Confidentiality" value={conf} onChange={(e) => setConf(e.target.value)}>
              <option value="">Any confidentiality</option>
              {(['general', 'restricted', 'confidential'] as const).map((v) => <option key={v} value={v}>{CONF_STYLE[v].label}</option>)}
            </select>
            <button className="btn primary" onClick={() => setTab('register')}>+ Register letter</button>
            {isSys && <button className="btn" onClick={() => setTab('settings')}>Settings</button>}
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Register</span>
              <span className="chip t-muted mono">{shown.length} records</span>
              <span style={{ flex: 1 }} />
              <button className="btn" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => setSortAsc((a) => !a)}>
                Sort: Date {sortAsc ? '↑' : '↓'}
              </button>
            </div>
            <div className="lt-scroll">
              <div className="lt-head">
                <span /><span>Reference</span><span>Direction</span><span>Subject</span>
                <span>From → To</span><span>Date</span><span>Confidentiality</span><span>Status</span>
              </div>
              {shown.map((l) => {
                const dc = DEPT_COLOR[l.dept]
                const ar = isArabic(l.subject)
                return (
                  <button key={l.id} className="lrow" onClick={() => setSelectedId(l.id)}>
                    <span className="rail-bar" style={{ background: dc.rail }} />
                    <span>
                      <span className="r-ref">{l.ref_ours ?? '—'}</span>
                      <span className="r-ref2">their: {l.ref_theirs ?? '—'}</span>
                    </span>
                    <span><DirChip d={l.direction} tag /></span>
                    <span style={{ minWidth: 0 }}>
                      <span className={ar ? 'r-subj ar' : 'r-subj'} dir={ar ? 'rtl' : undefined} style={{ display: 'block' }}>
                        {l.subject}
                      </span>
                    </span>
                    <span className="parties">{l.sender ?? '—'} → {l.addressee ?? '—'}</span>
                    <span className="r-date">{l.letter_date ?? l.received_on}</span>
                    <span><ConfChip c={l.confidentiality} /></span>
                    <span>
                      <span className={`chip ${STATUS_CLS[l.status] ?? 't-muted'}`}>{l.status.replace('_', ' ')}</span>
                    </span>
                  </button>
                )
              })}
              {loaded && shown.length === 0 && (
                <div className="row-desc" style={{ padding: '14px 16px' }}>No letters match.</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <button className="btn" style={{ marginBottom: 12, padding: '3px 9px', fontSize: 11 }} onClick={() => setTab('registry')}>
            ← Back to register
          </button>
          {tab === 'register' && (
            <Register people={people} selfId={profile.id}
              onDone={() => { setTab('registry'); load() }} />
          )}
          {tab === 'settings' && isSys && <Settings settings={settings} onChanged={reloadSettings} />}
        </>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
