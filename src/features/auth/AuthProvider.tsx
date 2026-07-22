import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { DeptCode, Profile, Role, RoleAssignment } from '../../lib/types'
import {
  relevantGroupIds,
  resolveVisibility,
  type GroupDef,
  type PageDef,
  type PageGrant,
} from '../../lib/pageVisibility'

interface AccessModel {
  pages: PageDef[]
  groups: GroupDef[]
  grants: PageGrant[]
  memberGroupIds: string[]
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  roles: RoleAssignment[]
  loading: boolean
  hasRole: (role: Role, dept?: DeptCode) => boolean
  /** Group-model page visibility (ACCESS1 branch 5). One page id, one lookup,
   *  no hardcoded fallbacks — an unknown id is false, and the parity gate
   *  makes an unknown id a CI failure. */
  canSee: (page: string) => boolean
  /** Re-read the access model (called after admin edits groups/pages). */
  refreshAccess: () => Promise<void>
  isAdmin: boolean
  signInDev: (email: string, password: string) => Promise<string | null>
  signInSso: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadAccessModel(userId: string): Promise<AccessModel> {
  const [{ data: pages }, { data: groups }, { data: grants }, { data: memberships }] =
    await Promise.all([
      supabase.from('app_pages').select('key, parent_key, backed_by_role'),
      supabase.from('role_groups').select('id, key, role_group_roles(role)'),
      supabase.from('role_group_pages').select('group_id, page_key, visibility'),
      supabase.from('profile_role_groups').select('group_id').eq('profile_id', userId),
    ])
  return {
    pages: (pages as PageDef[]) ?? [],
    groups: ((groups as { id: string; key: string; role_group_roles: { role: string }[] }[]) ?? [])
      .map((g) => ({ id: g.id, key: g.key, roles: (g.role_group_roles ?? []).map((r) => r.role) })),
    grants: (grants as PageGrant[]) ?? [],
    memberGroupIds: ((memberships as { group_id: string }[]) ?? []).map((m) => m.group_id),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<RoleAssignment[]>([])
  const [access, setAccess] = useState<AccessModel | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // supabase-js re-emits on every tab focus with a fresh object;
      // only propagate real session changes or the app remounts in a loop.
      setSession((prev) =>
        prev && s && prev.access_token === s.access_token ? prev : s
      )
      if (!s) {
        setProfile(null)
        setRoles([])
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true) // landing decisions must wait until roles + access are known
    ;(async () => {
      const [{ data: prof }, { data: ras }, model] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('role_assignments')
          .select('role, dept, source_ad_group')
          .eq('profile_id', session.user.id),
        loadAccessModel(session.user.id),
      ])
      if (cancelled) return
      setProfile((prof as Profile) ?? null)
      setRoles((ras as RoleAssignment[]) ?? [])
      setAccess(model)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  const hasRole = useCallback(
    (role: Role, dept?: DeptCode) =>
      roles.some(
        (r) =>
          (r.role === role ||
            (r.role === 'dept_head' && (role === 'approver' || role === 'dept_admin'))) &&
          (!dept || !r.dept || r.dept === dept)
      ),
    [roles]
  )

  const signInDev = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  }, [])

  const signInSso = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'openid profile email', redirectTo: window.location.origin },
    })
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshAccess = useCallback(async () => {
    if (!session) return
    setAccess(await loadAccessModel(session.user.id))
  }, [session])

  useEffect(() => {
    const onFocus = () => {
      if (session) refreshAccess()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [session, refreshAccess])

  const canSee = useCallback(
    (page: string): boolean => {
      if (!access) return false // resolved only after loading completes; App waits on `loading`
      const relevant = relevantGroupIds(
        access.groups,
        access.memberGroupIds,
        roles.map((r) => r.role),
      )
      return resolveVisibility(page, access.pages, access.grants, relevant)
    },
    [access, roles]
  )

  const isAdmin = hasRole('user_admin') || hasRole('system_admin')

  return (
    <AuthContext.Provider
      value={{ session, profile, roles, loading, hasRole, canSee, refreshAccess, isAdmin, signInDev, signInSso, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
