import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

interface Delegation {
  id: string
  starts_on: string
  ends_on: string
  reason: string | null
  delegator: { display_name: string } | null
  delegate: { display_name: string } | null
}

interface Person {
  id: string
  display_name: string
}

export function Delegations() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Delegation[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [form, setForm] = useState({ delegator: '', delegate: '', starts: '', ends: '', reason: '' })
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    supabase
      .from('approval_delegations')
      .select(
        'id, starts_on, ends_on, reason, delegator:profiles!approval_delegations_delegator_id_fkey(display_name), delegate:profiles!approval_delegations_delegate_id_fkey(display_name)'
      )
      .order('starts_on', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as unknown as Delegation[]) ?? [])
      })
    supabase
      .from('profiles')
      .select('id, display_name')
      .eq('is_active', true)
      .order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
  }
  useEffect(load, [])

  const add = async () => {
    setError(null)
    const { error: e } = await supabase.from('approval_delegations').insert({
      delegator_id: form.delegator,
      delegate_id: form.delegate,
      starts_on: form.starts,
      ends_on: form.ends,
      reason: form.reason || null,
      created_by: session!.user.id,
    })
    if (e) setError(e.message)
    else {
      setForm({ delegator: '', delegate: '', starts: '', ends: '', reason: '' })
      load()
    }
  }

  const remove = async (id: string) => {
    const { error: e } = await supabase.from('approval_delegations').delete().eq('id', id)
    if (e) setError(e.message)
    load()
  }

  const today = new Date().toISOString().slice(0, 10)
  const chip = (d: Delegation) =>
    d.ends_on < today
      ? { label: 'expired', bg: 'var(--surface)', fg: 'var(--muted)' }
      : d.starts_on > today
        ? { label: 'upcoming', bg: 'var(--it-soft)', fg: 'var(--it)' }
        : { label: 'active', bg: 'var(--amber-soft)', fg: 'var(--amber)' }

  const valid = form.delegator && form.delegate && form.delegator !== form.delegate && form.starts && form.ends && form.ends >= form.starts

  return (
    <>
      <h2 className="page-head">Approval delegation</h2>
      <p className="page-sub">
        Out-of-office cover: a delegate decides approvals on the delegator's behalf for a date
        range, so chains never stall.
      </p>
      <div className="card">
        {rows.map((d) => {
          const c = chip(d)
          return (
            <div className="row" key={d.id}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{d.delegator?.display_name ?? '—'}</span>
              <span style={{ color: 'var(--muted)' }}>→</span>
              <span style={{ fontSize: 13, flex: 1 }}>{d.delegate?.display_name ?? '—'}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {d.starts_on} – {d.ends_on}
              </span>
              <span className="chip" style={{ background: c.bg, color: c.fg }}>{c.label}</span>
              <button
                className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                onClick={() => remove(d.id)} aria-label="Remove delegation"
              >
                ×
              </button>
            </div>
          )
        })}
        {rows.length === 0 && <div className="row row-desc">No delegations.</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="input" style={{ width: 160 }} value={form.delegator} onChange={(e) => setForm({ ...form, delegator: e.target.value })}>
            <option value="">Delegator…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
          <span style={{ color: 'var(--muted)' }}>→</span>
          <select className="input" style={{ width: 160 }} value={form.delegate} onChange={(e) => setForm({ ...form, delegate: e.target.value })}>
            <option value="">Delegate…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
          <input className="input" type="date" style={{ width: 140 }} value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />
          <input className="input" type="date" style={{ width: 140 }} value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} />
          <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button className="btn primary" onClick={add} disabled={!valid}>Add</button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        Enforcement in the approvals engine (delegate allowed to decide during the window)
        arrives with the next approvals iteration.
      </p>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
