import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { FeatureToggles } from './FeatureToggles'
import { UsersRoles } from './UsersRoles'
import { FormBuilder } from './FormBuilder'
import { WorkflowDesigner } from './WorkflowDesigner'
import { TeamsAssignment } from './TeamsAssignment'
import { EmailStudio } from './EmailStudio'
import { SlaCalendar } from './SlaCalendar'
import { DoaMatrix } from './DoaMatrix'
import { AuditLog } from './AuditLog'
import { Delegations } from './Delegations'
import { Announcements } from './Announcements'
import { ServiceBuilder } from './ServiceBuilder'
import { PageAccess } from './PageAccess'
import { getAdminSections, SCOPE_META, type AdminScope, type AdminSection } from './sections'

/**
 * Admin console shell (matches prototype/admin-console-reference.html):
 * breadcrumb, an in-page sub-nav grouped by role scope with a
 * find-a-setting filter, and a scope badge over the section content.
 */
export function AdminPage({ section }: { section: AdminSection }) {
  const { hasRole, roles } = useAuth()
  const nav = useNavigate()
  const [find, setFind] = useState('')
  const sections = getAdminSections(hasRole)
  const active = sections.find((s) => s.id === section)

  if (!active) return <p className="page-sub">This section is not available for your role.</p>

  const needle = find.trim().toLowerCase()
  const shown = needle
    ? sections.filter((s) => s.label.toLowerCase().includes(needle))
    : sections
  const scopes = (['system', 'department', 'user'] as AdminScope[])
    .filter((sc) => shown.some((s) => s.scope === sc))

  // badge text: sysadmin acts platform-wide; dept admins/heads act on their depts
  const isSys = hasRole('system_admin')
  const myDepts = [...new Set(
    roles.filter((r) => (r.role === 'dept_admin' || r.role === 'dept_head') && r.dept)
      .map((r) => r.dept as string),
  )]
  const meta = SCOPE_META[active.scope]
  const badgeText =
    active.scope === 'system' ? 'System admin · all departments'
    : active.scope === 'department'
      ? `Department admin · ${isSys ? 'all departments' : myDepts.join(', ') || '—'}`
    : 'User admin'

  const content = (() => {
    switch (section) {
      case 'functions': return <FeatureToggles />
      case 'access': return <PageAccess />
      case 'email': return <EmailStudio />
      case 'sla': return <SlaCalendar />
      case 'doa': return <DoaMatrix />
      case 'audit': return <AuditLog />
      case 'announcements': return <Announcements />
      case 'services': return <ServiceBuilder />
      case 'forms': return <FormBuilder />
      case 'workflows': return <WorkflowDesigner />
      case 'teams': return <TeamsAssignment />
      case 'users': return <UsersRoles />
      case 'delegation': return <Delegations />
      default: return null
    }
  })()

  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb">
        <button className="crumb-link" onClick={() => nav(`/admin/${sections[0].id}`)}>
          Admin console
        </button>
        <span className="crumb-sep">/</span>
        <span style={{ color: 'var(--muted)' }}>{meta.label}</span>
        <span className="crumb-sep">/</span>
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{active.label}</span>
      </nav>

      <div className="console">
        <aside className="subnav" aria-label="Admin sections">
          <div className="subnav-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              placeholder="Find a setting…" aria-label="Find a setting"
              value={find} onChange={(e) => setFind(e.target.value)}
            />
          </div>
          {scopes.map((sc) => (
            <div key={sc}>
              <div className="sn-group">
                <span className="scope-dot" style={{ background: SCOPE_META[sc].dot }} />
                {SCOPE_META[sc].label}
              </div>
              {shown.filter((s) => s.scope === sc).map((s) => (
                <button
                  key={s.id}
                  className={`sn-item${s.id === section ? ' active' : ''}`}
                  onClick={() => nav(`/admin/${s.id}`)}
                >
                  <span className="sn-ico">{s.ico}</span>
                  {s.label}
                </button>
              ))}
            </div>
          ))}
          {shown.length === 0 && (
            <p className="page-sub" style={{ padding: '6px 8px', fontSize: 12 }}>No setting matches.</p>
          )}
        </aside>

        <section style={{ minWidth: 0 }}>
          <div className="chead" style={{ justifyContent: 'flex-end' }}>
            <span className={`scope-badge ${meta.badge}`} title="Section scope">{badgeText}</span>
          </div>
          {content}
        </section>
      </div>
    </>
  )
}
