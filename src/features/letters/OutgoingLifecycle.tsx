import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { DeptCode, Role } from '../../lib/types'
import { currentStep, stage, type InitialStep } from './outgoing'

interface Props { letterId: string; status: string; refOurs: string | null; subject: string; onChanged: () => void }
interface Signatory { id: string; profile_id: string; title: string | null; profile: { display_name: string } | null }
interface PathRow { id: string; name: string }
interface OutRow {
  signatory_id: string | null; signed_at: string | null; signed_sha256: string | null
  dispatch_channel: string | null; dispatched_at: string | null; signatory: { profile_id: string } | { profile_id: string }[] | null
}

const DECISION_CLS: Record<string, string> = { approved: 't-green', rejected: 't-red', pending: 't-muted' }

export function OutgoingLifecycle({ letterId, status, refOurs, subject, onChanged }: Props) {
  const { profile, hasRole } = useAuth()
  const [out, setOut] = useState<OutRow | null>(null)
  const [initials, setInitials] = useState<InitialStep[]>([])
  const [paths, setPaths] = useState<PathRow[]>([])
  const [sigs, setSigs] = useState<Signatory[]>([])
  const [pathId, setPathId] = useState('')
  const [comment, setComment] = useState('')
  const [channel, setChannel] = useState('courier')
  const [dispRef, setDispRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase.from('letter_outgoing')
      .select('signatory_id, signed_at, signed_sha256, dispatch_channel, dispatched_at, signatory:signatories(profile_id)')
      .eq('letter_id', letterId).maybeSingle().then(({ data }) => setOut(data as OutRow | null))
    supabase.from('letter_initials')
      .select('step_order, approver_role, approver_dept, label, decision, decided_by')
      .eq('letter_id', letterId).order('step_order').then(({ data }) => setInitials((data ?? []) as InitialStep[]))
    supabase.from('initials_paths').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setPaths((data ?? []) as PathRow[]))
    supabase.from('signatories').select('id, profile_id, title, profile:profiles(display_name)').eq('is_active', true)
      .then(({ data }) => setSigs((data ?? []) as unknown as Signatory[]))
  }, [letterId])
  useEffect(load, [load])

  const after = () => { setBusy(false); setComment(''); load(); onChanged() }
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setErr(null); setNote(null)
    const { error } = await p
    if (error) { setErr(error.message); setBusy(false) } else after()
  }

  const st = stage(status, initials)
  const cur = currentStep(initials)
  const sigProfile = out?.signatory
    ? (Array.isArray(out.signatory) ? out.signatory[0]?.profile_id : out.signatory.profile_id)
    : null
  const isSignatory = !!sigProfile && sigProfile === profile?.id
  const canDecideCurrent = !!cur && (
    hasRole((cur.approver_role ?? 'system_admin') as Role, (cur.approver_dept ?? undefined) as DeptCode | undefined)
    || hasRole('system_admin'))

  const setSignatory = (id: string) =>
    run(supabase.from('letter_outgoing').update({ signatory_id: id || null }).eq('letter_id', letterId))
  const route = () => pathId && run(supabase.rpc('start_letter_initials', { p_letter: letterId, p_path: pathId }))
  const decide = (decision: 'approved' | 'rejected') =>
    run(supabase.rpc('decide_letter_initial', { p_letter: letterId, p_decision: decision, p_comment: comment || null }))
  const dispatch = () => run(supabase.rpc('dispatch_letter', { p_letter: letterId, p_channel: channel, p_ref: dispRef || null, p_note: null }))

  const sign = async () => {
    setBusy(true); setErr(null); setNote(null)
    const { data, error } = await supabase.functions.invoke('letter-sign', { body: { letter_id: letterId } })
    if (error) { setErr(error.message); setBusy(false); return }
    const res = data as { ok?: boolean; ref?: string; error?: string }
    if (res?.error) { setErr(res.error); setBusy(false); return }
    setNote(`Signed — reference ${res?.ref ?? ''}`); after()
  }

  const printQr = async () => {
    const ref = refOurs ?? letterId.slice(0, 8)
    const qr = await QRCode.toDataURL(`${window.location.origin}/letters/${letterId}`, { width: 220, margin: 1 })
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    w.document.write(`<html><head><title>${ref}</title></head><body style="font-family:system-ui;text-align:center;padding:24px">
      <div style="border:1.5px solid #10192E;border-radius:10px;padding:18px;display:inline-block">
      <img src="${qr}" width="200" /><div style="font-size:18px;font-weight:700;margin-top:6px">${ref}</div>
      <div style="font-size:11px;max-width:220px;margin:4px auto 0">${subject.replace(/</g, '&lt;')}</div>
      </div><script>window.print()</script></body></html>`)
  }

  const wrap: React.CSSProperties = { marginTop: 14, border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }

  return (
    <div style={wrap}>
      <div style={lbl}>Outgoing lifecycle</div>

      {/* signatory selection (needed before signing) */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Signatory</span>
        <select className="input" style={{ width: 220 }} aria-label="Signatory"
          value={out?.signatory_id ?? ''} disabled={busy || st !== 'draft'}
          onChange={(e) => setSignatory(e.target.value)}>
          <option value="">— choose —</option>
          {sigs.map((s) => <option key={s.id} value={s.id}>{s.profile?.display_name}{s.title ? ` · ${s.title}` : ''}</option>)}
        </select>
      </div>

      {/* the chain */}
      {initials.length > 0 && (
        <ol style={{ margin: '0 0 10px', paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {initials.map((s) => (
            <li key={s.step_order} style={{ fontSize: 12.5 }}>
              <span>{s.label ?? s.approver_role}</span>{' '}
              <span className={`chip ${DECISION_CLS[s.decision]}`} style={{ padding: '1px 7px', fontSize: 10.5 }}>{s.decision}</span>
            </li>
          ))}
        </ol>
      )}

      {/* stage-specific actions */}
      {st === 'draft' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 220 }} aria-label="Initials path" value={pathId} onChange={(e) => setPathId(e.target.value)}>
            <option value="">— pick an initials path —</option>
            {paths.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn primary" style={{ fontSize: 12 }} disabled={busy || !pathId} onClick={route}>Route for initials</button>
        </div>
      )}

      {st === 'in_initials' && cur && (
        canDecideCurrent ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => decide('approved')}>Approve step {cur.step_order}</button>
            <button className="btn" style={{ fontSize: 12 }} disabled={busy} onClick={() => decide('rejected')}>Reject</button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Awaiting {cur.label ?? cur.approver_role} sign-off.</div>
        )
      )}

      {st === 'ready_to_sign' && (
        isSignatory
          ? <button className="btn primary" style={{ fontSize: 12 }} disabled={busy} onClick={sign}>Sign letter</button>
          : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Initials complete — awaiting the signatory.</div>
      )}

      {(st === 'signed' || st === 'dispatched') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            Signed{out?.signed_at ? ` · ${new Date(out.signed_at).toLocaleString()}` : ''}
            {out?.signed_sha256 ? <> · <span className="mono" title={out.signed_sha256}>sha {out.signed_sha256.slice(0, 10)}…</span></> : null}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" style={{ fontSize: 12 }} onClick={printQr}>Print with QR</button>
            {st === 'signed' && (
              <>
                <select className="input" style={{ width: 120 }} aria-label="Dispatch channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="courier">Courier</option><option value="email">Email</option><option value="hand">By hand</option>
                </select>
                <input className="input" style={{ width: 140 }} placeholder="Tracking / ref" value={dispRef} onChange={(e) => setDispRef(e.target.value)} />
                <button className="btn primary" style={{ fontSize: 12 }} disabled={busy} onClick={dispatch}>Mark dispatched</button>
              </>
            )}
            {st === 'dispatched' && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Dispatched via {out?.dispatch_channel}{out?.dispatched_at ? ` · ${new Date(out.dispatched_at).toLocaleDateString()}` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {note && <div style={{ fontSize: 12, color: 'var(--green, #1a7f43)', marginTop: 8 }}>{note}</div>}
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
    </div>
  )
}
