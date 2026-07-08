import { useState } from 'react'
import { authMode, isConfigured } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

const DEV_USERS = [
  { email: 'sysadmin@dev.abccorp.com', label: 'Sami SysAdmin — system admin' },
  { email: 'head.it@dev.abccorp.com', label: 'Huda IT Head — dept head, IT' },
  { email: 'head.admin@dev.abccorp.com', label: 'Hatem Admin Head — dept head, Administration' },
  { email: 'head.proc@dev.abccorp.com', label: 'Hala Procurement Head — dept head, Procurement' },
  { email: 'head.pmo@dev.abccorp.com', label: 'Hani PMO Head — PMO console + committee' },
  { email: 'lead.it@dev.abccorp.com', label: 'Layla IT Lead — team lead, IT' },
  { email: 'lead.admin@dev.abccorp.com', label: 'Lama Admin Lead — team lead, Administration' },
  { email: 'lead.proc@dev.abccorp.com', label: 'Loay Procurement Lead — team lead, Procurement' },
  { email: 'lead.pmo@dev.abccorp.com', label: 'Lina PMO Lead — project manager' },
  { email: 'agent.it@dev.abccorp.com', label: 'Adel IT Agent — agent, IT' },
  { email: 'agent.admin@dev.abccorp.com', label: 'Afnan Admin Officer — agent, Administration' },
  { email: 'agent.proc@dev.abccorp.com', label: 'Amjad Procurement Officer — agent, Procurement' },
  { email: 'agent.pmo@dev.abccorp.com', label: 'Areej PMO Officer — project manager' },
  { email: 'biz1@dev.abccorp.com', label: 'Basma Business — requester' },
  { email: 'biz2@dev.abccorp.com', label: 'Bandar Business — requester' },
  { email: 'biz3@dev.abccorp.com', label: 'Dana Business — requester' },
  { email: 'biz4@dev.abccorp.com', label: 'Faisal Business — requester' },
]

const passwordFor = () => 'AbcHub!2026'

export function SignIn() {
  const { signInDev, signInSso } = useAuth()
  const [email, setEmailRaw] = useState(DEV_USERS[0].email)
  const [password, setPassword] = useState(passwordFor())
  const setEmail = (e: string) => {
    setEmailRaw(e)
    setPassword(passwordFor())
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
