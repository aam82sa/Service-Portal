import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { FeatureToggles } from './FeatureToggles'
import { UsersRoles } from './UsersRoles'
import { FormBuilder } from './FormBuilder'
import { WorkflowDesigner } from './WorkflowDesigner'

type Section = 'functions' | 'forms' | 'workflows' | 'users'

/**
 * Admin console. Sections render per role:
 * system_admin -> Functions, Form builder, Workflow designer
 * dept_admin   -> Form builder, Workflow designer (own department's services)
 * user_admin   -> Users & Directory
 */
export function AdminPage() {
  const { hasRole } = useAuth()
  const isSys = hasRole('system_admin')
  const isDept = hasRole('dept_admin')
  const isUsr = hasRole('user_admin')

  const sections: { id: Section; label: string; group: string }[] = []
  if (isSys) sections.push({ id: 'functions', label: 'Functions', group: 'System admin' })
  if (isSys || isDept) {
    const group = isSys ? 'System admin' : 'Department admin'
    sections.push({ id: 'forms', label: 'Form builder', group })
    sections.push({ id: 'workflows', label: 'Workflow designer', group })
  }
  if (isUsr) sections.push({ id: 'users', label: 'Users and roles', group: 'User admin' })

  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'functions')

  let lastGroup = ''
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <div style={{ width: 190, flexShrink: 0 }}>
        {sections.map((s) => {
          const header =
            s.group !== lastGroup ? (
              <div className="nav-group" style={{ color: 'var(--muted)', margin: '10px 0 6px' }}>
                {s.group}
              </div>
            ) : null
          lastGroup = s.group
          return (
            <div key={s.id}>
              {header}
              <button
                className="btn"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 6,
                  background: section === s.id ? 'var(--accent-soft)' : undefined,
                  borderColor: section === s.id ? 'var(--accent)' : undefined,
                }}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {section === 'functions' && isSys && <FeatureToggles />}
        {section === 'forms' && (isSys || isDept) && <FormBuilder />}
        {section === 'workflows' && (isSys || isDept) && <WorkflowDesigner />}
        {section === 'users' && isUsr && <UsersRoles />}
      </div>
    </div>
  )
}
