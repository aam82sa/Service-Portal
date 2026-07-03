import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { FeatureToggles } from './FeatureToggles'
import { UsersRoles } from './UsersRoles'

type Section = 'functions' | 'users'

/**
 * Admin console. Sections render per role:
 * system_admin -> System console (functions, email studio, workflows ...)
 * user_admin   -> Users & Directory
 * The whole page is unreachable without one of the two (see App nav + RLS).
 */
export function AdminPage() {
  const { hasRole } = useAuth()
  const isSys = hasRole('system_admin')
  const isUsr = hasRole('user_admin')
  const [section, setSection] = useState<Section>(isSys ? 'functions' : 'users')

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <div style={{ width: 180, flexShrink: 0 }}>
        {isSys && (
          <>
            <div className="nav-group" style={{ color: 'var(--muted)', margin: '4px 0 6px' }}>
              System admin
            </div>
            <button
              className="btn"
              style={{
                width: '100%',
                textAlign: 'left',
                marginBottom: 6,
                background: section === 'functions' ? 'var(--accent-soft)' : undefined,
                borderColor: section === 'functions' ? 'var(--accent)' : undefined,
              }}
              onClick={() => setSection('functions')}
            >
              Functions
            </button>
          </>
        )}
        {isUsr && (
          <>
            <div className="nav-group" style={{ color: 'var(--muted)', margin: '12px 0 6px' }}>
              User admin
            </div>
            <button
              className="btn"
              style={{
                width: '100%',
                textAlign: 'left',
                background: section === 'users' ? 'var(--accent-soft)' : undefined,
                borderColor: section === 'users' ? 'var(--accent)' : undefined,
              }}
              onClick={() => setSection('users')}
            >
              Users and roles
            </button>
          </>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {section === 'functions' && isSys && <FeatureToggles />}
        {section === 'users' && isUsr && <UsersRoles />}
      </div>
    </div>
  )
}
