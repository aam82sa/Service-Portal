import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, PORTAL_DEPTS, type DeptCode } from '../../lib/types'
import { readLetter, type ExtractedLetter } from './aiReader'

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

const CONF_STYLE: Record<Confidentiality, { bg: string; fg: string; label: string }> = {
  general: { bg: 'var(--surface)', fg: 'var(--muted)', label: 'General' },
  restricted: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'Restricted' },
  confidential: { bg: 'var(--red-soft)', fg: 'var(--red)', label: 'Confidential' },
}
const label10: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)',
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

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

/**
 * Watermarked viewer. Every rendered copy identifies its viewer: name, id,
 * timestamp, reference and confidentiality tier tiled across the document.
 * Clear view (no overlay) is reserved for the letter owner when the tenant
 * allows it, and every open is written to the immutable audit log.
 */
function Viewer({ letter, file, clear, viewer, onClose }: {
  letter: Letter; file: LetterFile; clear: boolean
  viewer: { id: string; name: string }; onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.storage.from('letters').createSignedUrl(file.path, 60).then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setUrl(data?.signedUrl ?? null)
    })
    supabase.rpc('log_letter_event', {
      p_letter: letter.id,
      p_type: clear ? 'view_clear' : 'viewed',
      p_detail: { file: file.filename },
    })
  }, [letter.id, file.path, file.filename, clear])

  const stamp = `${viewer.name} · ${viewer.id.slice(0, 8)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${letter.ref_ours ?? letter.ref_theirs ?? letter.id.slice(0, 8)} · ${letter.confidentiality.toUpperCase()}`
  const isPdf = (file.mime ?? '').includes('pdf') || file.filename.toLowerCase().endsWith('.pdf')

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,25,46,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ position: 'relative', width: 'min(880px, 92vw)', height: '86vh', background: '#fff', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <span className="chip" style={{ background: CONF_STYLE[letter.confidentiality].bg, color: CONF_STYLE[letter.confidentiality].fg }}>
            {CONF_STYLE[letter.confidentiality].label}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {file.filename}{clear ? ' — clear copy (audited)' : ''}
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ position: 'relative', flex: 1, background: 'var(--surface)' }}>
          {error && <p className="error-note" style={{ padding: 16 }}>{error}</p>}
          {url && (isPdf
            ? <iframe title={file.filename} src={url} style={{ width: '100%', height: '100%', border: 'none' }} />
            : <img src={url} alt={file.filename} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto' }} />)}
          {!clear && (
            <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} style={{
                  position: 'absolute', top: `${i * 9 - 6}%`, left: '-20%', width: '140%',
                  transform: 'rotate(-27deg)', whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600,
                  color: 'rgba(16,25,46,.16)', letterSpacing: '1px',
                }}>
                  {`${stamp}   ${stamp}   ${stamp}`}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
  const [viewing, setViewing] = useState<{ file: LetterFile; clear: boolean } | null>(null)
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

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)' }}>{value ?? '—'}</div>
    </div>
  )
  const comments = events.filter((e) => e.event_type === 'comment')
  const c = DEPT_COLOR[letter.dept]

  return (
    <>
      <button className="btn" style={{ marginBottom: 12 }} onClick={onBack}>← Registry</button>
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span className="chip mono" style={{ background: 'var(--ink)', color: '#fff' }}>
                {letter.ref_ours ?? 'no ref'}
              </span>
              <span className="chip" style={{ background: letter.direction === 'incoming' ? 'var(--it-soft)' : 'var(--green-soft)', color: letter.direction === 'incoming' ? 'var(--it)' : 'var(--green)' }}>
                {letter.direction === 'incoming' ? 'Incoming — وارد' : 'Outgoing — صادر'}
              </span>
              <span className="chip" style={{ background: conf.bg, color: conf.fg }}>{conf.label}</span>
              <span className="chip" style={{ background: c.soft, color: c.rail }}>{c.label}</span>
            </div>
            <h2 style={{ fontSize: 17 }}>{letter.subject}</h2>
          </div>
          {!letter.ref_ours && <button className="btn primary" onClick={issueNumber}>Issue reference</button>}
          <button className="btn" onClick={qrLabel}>QR label</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
          {field('Their ref', letter.ref_theirs)}
          {field('Letter date', letter.letter_date)}
          {field('Received', letter.received_on)}
          {field('Sender', letter.sender)}
          {field('Addressee', letter.addressee)}
          {field('Owner', letter.owner?.display_name)}
          {field('Status', letter.status.replace('_', ' '))}
        </div>

        {(letter.brief_ar || letter.brief_en) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {letter.brief_en && (
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>
                <div style={label10}>Brief · EN</div>{letter.brief_en}
              </div>
            )}
            {letter.brief_ar && (
              <div dir="rtl" style={{ background: 'var(--surface)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>
                <div style={{ ...label10, textAlign: 'right' }}>الملخص</div>{letter.brief_ar}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {files.map((f) => (
            <span key={f.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 9, padding: '6px 10px', fontSize: 12 }}>
              <span className="mono" style={{ fontSize: 11 }}>{f.filename}</span>
              <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setViewing({ file: f, clear: false })}>View</button>
              {isOwner && allowOwnerClear && (
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent)' }} onClick={() => setViewing({ file: f, clear: true })}>Clear copy</button>
              )}
              {isOwner && letter.confidentiality !== 'confidential' && (
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => download(f)}>Download</button>
              )}
              {isOwner && (
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--red)' }} onClick={() => removeFile(f)}>×</button>
              )}
            </span>
          ))}
          {files.length === 0 && <span className="row-desc">No scanned copy yet — attach one:</span>}
          <label className="btn" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
            {uploading ? 'Uploading…' : '+ Attach scan'}
            <input
              type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = '' }}
            />
          </label>
        </div>

        {isOwner && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <div>
              <label className="field-label">Confidentiality (owner only)</label>
              <select className="input" style={{ width: 170 }} value={letter.confidentiality}
                onChange={(e) => run(supabase.from('letters').update({ confidentiality: e.target.value }).eq('id', letter.id))}>
                {(['general', 'restricted', 'confidential'] as const).map((v) => <option key={v} value={v}>{CONF_STYLE[v].label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Status</label>
              <select className="input" style={{ width: 150 }} value={letter.status}
                onChange={(e) => run(supabase.from('letters').update({ status: e.target.value }).eq('id', letter.id))}>
                {['registered', 'in_review', 'answered', 'closed'].map((v) => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Transfer ownership</label>
              <select className="input" style={{ width: 210 }} value=""
                onChange={(e) => { if (e.target.value) run(supabase.from('letters').update({ owner_id: e.target.value }).eq('id', letter.id)) }}>
                <option value="">Transfer to…</option>
                {people.filter((p) => p.id !== letter.owner_id).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, alignItems: 'start' }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ ...label10, marginBottom: 8 }}>Comments · {comments.length}</div>
          {comments.map((e) => (
            <div key={e.id} style={{ padding: '7px 0', borderTop: '1px solid #EDEFF4', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{e.actor?.display_name ?? 'Unknown'}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>{new Date(e.created_at).toLocaleString()}</span>
              <div style={{ marginTop: 2 }}>{str(e.detail.body)}</div>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <select className="input" value={shareUser} onChange={(e) => setShareUser(e.target.value)}>
                    <option value="">Share with person…</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                  <select className="input" style={{ width: 190 }} value={shareDept} onChange={(e) => setShareDept(e.target.value)}>
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

        <div className="card" style={{ padding: 16 }}>
          <div style={{ ...label10, marginBottom: 8 }}>Audit trail</div>
          {events.filter((e) => e.event_type !== 'comment').map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 11.5, borderTop: '1px solid #EDEFF4' }}>
              <span className="chip" style={{ background: e.event_type === 'view_clear' ? 'var(--red-soft)' : 'var(--surface)', color: e.event_type === 'view_clear' ? 'var(--red)' : 'var(--muted)', fontSize: 9.5 }}>
                {e.event_type.replace('_', ' ')}
              </span>
              <span style={{ flex: 1, color: 'var(--ink)' }}>{e.actor?.display_name ?? 'System'}</span>
              <span className="mono" style={{ color: 'var(--muted)', fontSize: 10 }}>{new Date(e.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}
      {viewing && (
        <Viewer letter={letter} file={viewing.file} clear={viewing.clear} viewer={viewer} onClose={() => setViewing(null)} />
      )}
    </>
  )
}

function Register({ people, selfId, settings, onDone }: {
  people: Person[]; selfId: string; settings: Record<string, string>; onDone: () => void
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
  const apiKey = settings['anthropic_api_key']

  const aiRead = async () => {
    if (!file || !apiKey) return
    setReading(true); setError(null)
    try {
      const { data: fb } = await supabase.from('extraction_feedback')
        .select('field, extracted, corrected').order('created_at', { ascending: false }).limit(12)
      const { fields, usage } = await readLetter(file, apiKey, settings['ai_model'] || 'claude-sonnet-5', fb ?? [])
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
      await supabase.from('ai_usage').insert({
        user_id: selfId, model: settings['ai_model'] || 'claude-sonnet-5',
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
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
        <button className="btn primary" disabled={!file || !apiKey || reading} onClick={aiRead}>
          {reading ? 'Reading…' : 'Read with AI'}
        </button>
        {!apiKey && <span className="row-desc">Set the Claude API key under Settings to enable AI reading.</span>}
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
          <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
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
            <label className="field-label">Claude API key (stored per tenant; usage is metered)</label>
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
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSys = hasRole('system_admin')

  const load = useCallback(() => {
    let q = supabase.from('letters')
      .select('*, owner:profiles!letters_owner_id_fkey(display_name)')
      .order('created_at', { ascending: false }).limit(200)
    if (query.trim()) q = q.textSearch('tsv', query.trim(), { type: 'websearch', config: 'simple' })
    if (direction) q = q.eq('direction', direction)
    if (conf) q = q.eq('confidentiality', conf)
    q.then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setLetters((data as unknown as Letter[]) ?? [])
      setLoaded(true)
    })
  }, [query, direction, conf])
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
      <h2 className="page-head">Correspondence — الصادر والوارد</h2>
      <p className="page-sub">
        Register, search and route official letters. Every view is watermarked and audited.
      </p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['registry', 'register', ...(isSys ? ['settings'] as const : [])] as const).map((t) => (
          <button key={t} className="chip" style={{
            border: 'none', cursor: 'pointer',
            background: tab === t ? 'var(--accent-soft)' : 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)', fontWeight: tab === t ? 600 : 500,
          }} onClick={() => setTab(t)}>
            {t === 'registry' ? `Registry · ${letters.length}` : t === 'register' ? 'Register letter' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'registry' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="input" style={{ maxWidth: 340 }} placeholder="Search subject, parties, text… (ar/en)"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="input" style={{ width: 150 }} value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">All directions</option>
              <option value="incoming">Incoming · {counts.incoming}</option>
              <option value="outgoing">Outgoing · {counts.outgoing}</option>
            </select>
            <select className="input" style={{ width: 160 }} value={conf} onChange={(e) => setConf(e.target.value)}>
              <option value="">Any confidentiality</option>
              {(['general', 'restricted', 'confidential'] as const).map((v) => <option key={v} value={v}>{CONF_STYLE[v].label}</option>)}
            </select>
          </div>
          <div className="card">
            {letters.map((l) => {
              const cs = CONF_STYLE[l.confidentiality]
              const dc = DEPT_COLOR[l.dept]
              return (
                <button key={l.id} className="pc-row" onClick={() => setSelectedId(l.id)}>
                  <span className="tile-code" style={{ background: l.direction === 'incoming' ? 'var(--it-soft)' : 'var(--green-soft)', color: l.direction === 'incoming' ? 'var(--it)' : 'var(--green)', fontSize: 10.5 }}>
                    {l.direction === 'incoming' ? 'وارد IN' : 'صادر OUT'}
                  </span>
                  <span className="pc-row-main">
                    <span className="pc-row-name">{l.subject}</span>
                    <span className="pc-row-desc">
                      {l.ref_ours ?? l.ref_theirs ?? 'no ref'} · {l.sender ?? '—'} → {l.addressee ?? '—'} · {l.letter_date ?? l.received_on}
                    </span>
                  </span>
                  <span className="chip" style={{ background: dc.soft, color: dc.rail, fontSize: 10 }}>{l.dept}</span>
                  <span className="chip" style={{ background: cs.bg, color: cs.fg, fontSize: 10 }}>{cs.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', width: 130, textAlign: 'right' }}>{l.owner?.display_name ?? ''}</span>
                </button>
              )
            })}
            {loaded && letters.length === 0 && (
              <div className="row-desc" style={{ padding: '14px 16px' }}>No letters match.</div>
            )}
          </div>
        </>
      )}

      {tab === 'register' && (
        <Register people={people} selfId={profile.id} settings={settings}
          onDone={() => { setTab('registry'); load() }} />
      )}
      {tab === 'settings' && isSys && <Settings settings={settings} onChanged={reloadSettings} />}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
