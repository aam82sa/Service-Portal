import { useState, type ReactNode } from 'react'

/**
 * Site passcode curtain. Active only when VITE_SITE_PASSCODE is set.
 * Keeps casual visitors out during testing; real security remains the
 * account login + RLS underneath.
 */
const PASSCODE = (import.meta.env.VITE_SITE_PASSCODE as string | undefined)?.trim()
const STORE_KEY = 'ABC-gate'

export function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => !PASSCODE || localStorage.getItem(STORE_KEY) === PASSCODE
  )
  const [value, setValue] = useState('')
  const [shake, setShake] = useState(false)

  if (unlocked) return <>{children}</>

  const tryUnlock = () => {
    if (value.trim() === PASSCODE) {
      localStorage.setItem(STORE_KEY, PASSCODE!)
      setUnlocked(true)
    } else {
      setShake(true)
      setTimeout(() => setShake(false), 400)
    }
  }

  return (
    <div className="signin-wrap">
      <div className="signin-card" style={{ width: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="brand-badge">ABC</span>
          <h2 style={{ fontSize: 17 }}>Services Hub</h2>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '0 0 18px' }}>
          This environment is private. Enter the access code you were given.
        </p>
        <input
          className="input"
          type="password"
          placeholder="Access code"
          value={value}
          autoFocus
          style={shake ? { borderColor: 'var(--red)', outline: '2px solid var(--red-soft)' } : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
        />
        <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={tryUnlock}>
          Enter
        </button>
      </div>
    </div>
  )
}
