import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/types'

interface PageRow {
  page: string
  name: string
  allowed: Role[]
}

const ROLES: { id: Role; label: string }[] = [
  { id: 'requester', label: 'Requester' },
  { id: 'agent', label: 'Agent' },
  { id: 'team_lead', label: 'Team lead' },
  { id: 'dept_head', label: 'Dept head' },
  { id: 'user_admin', label: 'User admin' },
  { id: 'system_admin', label: 'Sys admin' },
]

export function PageAccess() {
  const [rows, setRows] = useState<PageRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = () =>
    supabase
      .from('page_access')
      .select('page, name, allowed')
      .order('page')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as PageRow[]) ?? [])
      })
  useEffect(() => { load() }, [])

  const toggle = async (row: PageRow, role: Role) => {
    setError(null)
    setNote(null)
    const next = row.allowed.includes(role)
      ? row.allowed.filter((r) => r !== role)
      : [...row.allowed, role]
    if (row.page === 'admin' && !next.includes('system_admin')) {
      setError('The admin console must stay accessible to system admins — otherwise nobody could undo this.')
      return
    }
    setRows((rs) => rs.map((r) => (r.page === row.page ? { ...r, allowed: next } : r)))
    const { error: e } = await supabase
      .from('page_access')
      .update({ allowed: next })
      .eq('page', row.page)
    if (e) {
      setError(e.message)
      load()
    } else {
      setNote(`Saved — ${row.name} updated. Users see the change on their next page load.`)
    }
  }

  return (
    <>
      <h2 className="page-head">Page access</h2>
      <p className="page-sub">
        Which role groups can open which pages. Requester means every signed-in user. Changes
        are audit-logged and enforced in navigation and page rendering; data access is
        additionally protected by database policies. Legacy roles (approver, dept admin,
        executive) are absorbed by Dept head and keep working in the background.
      </p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--ink)' }}>
              <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 600, color: '#fff', textAlign: 'left' }}>Page</th>
              {ROLES.map((r) => (
                <th key={r.id} style={{ padding: '10px 8px', fontSize: 10, fontWeight: 600, color: '#8FA0BE', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.page} style={{ borderTop: '1px solid var(--line)', background: i % 2 === 1 ? 'var(--surface)' : undefined }}>
                <td style={{ padding: '9px 14px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{row.name}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{row.page}</div>
                </td>
                {ROLES.map((r) => {
                  const on = row.allowed.includes(r.id)
                  return (
                    <td key={r.id} style={{ padding: '9px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => toggle(row, r.id)}
                        aria-label={`${row.name} for ${r.label}: ${on ? 'allowed' : 'blocked'}`}
                        style={{
                          width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                          border: `1.5px solid ${on ? 'var(--green)' : 'var(--line)'}`,
                          background: on ? 'var(--green)' : 'var(--card)',
                          color: '#fff', fontSize: 12, lineHeight: 1,
                        }}
                      >
                        {on ? '✓' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={9} style={{ padding: 16, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                Loading… (if this persists, run migration 00013 on the database)
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {note && <p style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 8 }}>{note}</p>}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
