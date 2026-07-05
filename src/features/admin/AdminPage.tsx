import { useAuth } from '../auth/AuthProvider'
import { AdminOverview } from './AdminOverview'
import { FeatureToggles } from './FeatureToggles'
import { UsersRoles } from './UsersRoles'
import { FormBuilder } from './FormBuilder'
import { WorkflowDesigner } from './WorkflowDesigner'
import { EmailStudio } from './EmailStudio'
import { SlaCalendar } from './SlaCalendar'
import { Delegations } from './Delegations'
import { Announcements } from './Announcements'
import { ServiceBuilder } from './ServiceBuilder'
import { PageAccess } from './PageAccess'
import { getAdminSections, type AdminSection } from './sections'

/**
 * Admin console content. Section navigation lives in the main sidebar
 * (App.tsx renders getAdminSections under the Admin console entry).
 */
export function AdminPage({ section }: { section: AdminSection }) {
  const { hasRole } = useAuth()
  const allowed = getAdminSections(hasRole).some((s) => s.id === section)
  if (!allowed) return <p className="page-sub">This section is not available for your role.</p>

  switch (section) {
    case 'overview': return <AdminOverview />
    case 'functions': return <FeatureToggles />
    case 'access': return <PageAccess />
    case 'email': return <EmailStudio />
    case 'sla': return <SlaCalendar />
    case 'announcements': return <Announcements />
    case 'services': return <ServiceBuilder />
    case 'forms': return <FormBuilder />
    case 'workflows': return <WorkflowDesigner />
    case 'users': return <UsersRoles />
    case 'delegation': return <Delegations />
    default: return null
  }
}
