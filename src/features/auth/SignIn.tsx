import { useState } from 'react'
import { authMode, isConfigured } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

const DEV_USERS = [
  { email: 'requester@dev.abccorp.com', label: 'Rana Requester — requester' },
  { email: 'agent.it@dev.abccorp.com', label: 'Ahmed Agent — agent, IT' },
  { email: 'lead.it@dev.abccorp.com', label: 'Latifa Lead — team lead, IT' },
  { email: 'approver@dev.abccorp.com', label: 'Aziz Approver — dept head' },
  { email: 'deptadmin.it@dev.abccorp.com', label: 'Dana DeptAdmin — dept head, IT' },
  { email: 'useradmin@dev.abccorp.com', label: 'Umar UserAdmin — user admin' },
  { email: 'sysadmin@dev.abccorp.com', label: 'Sara SysAdmin — system admin' },
  { email: 'tester1@dev.abccorp.com', label: 'Tester One — requester' },
  { email: 'tester2@dev.abccorp.com', label: 'Tester Two — requester' },
  { email: 'tester3@dev.abccorp.com', label: 'Tester Three — requester' },
]

const passwordFor = (email: string) =>
  email.startsWith('tester') ? 'RlcTest!2026' : 'RlcDev!2026'

export function SignIn() {
  const { signInDev, signInSso } = useAuth()
  const [email, setEmailRaw] = useState(DEV_USERS[6].email)
  const [password, setPassword] = useState(passwordFor(DEV_USERS[6].email))
  const setEmail = (e: string) => {
    setEmailRaw(e)
    setPassword(passwordFor(e))
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const err = await signInDev(email, password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="brand-badge">ABC</span>
          <h2 style={{ fontSize: 18 }}>Services Hub</h2>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 22px' }}>
          IT Services · Administration · Logistics
        </p>

        {!isConfigured && (
          <p className="error-note">
            Supabase is not configured yet. Copy .env.example to .env.local and fill in the
            project URL and anon key.
          </p>
        )}

        {authMode === 'dev' ? (
          <>
            <label className="field-label">Sign in as (dev mode)</label>
            <select className="input" value={email} onChange={(e) => setEmail(e.target.value)}>
              {DEV_USERS.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.label}
                </option>
              ))}
            </select>
            <div style={{ height: 12 }} />
            <label className="field-label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div style={{ height: 18 }} />
            <button className="btn primary" style={{ width: '100%' }} onClick={submit} disabled={busy || !isConfigured}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 14 }}>
              Dev mode uses seeded test accounts. Entra ID SSO replaces this screen when
              VITE_AUTH_MODE=sso.
            </p>
          </>
        ) : (
          <button className="btn primary" style={{ width: '100%' }} onClick={signInSso}>
            Sign in with Microsoft
          </button>
        )}
        {error && <p className="error-note">{error}</p>}
      </div>
    </div>
  )
}
