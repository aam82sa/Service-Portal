import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { DeptCode, Profile, Role, RoleAssignment } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  roles: RoleAssignment[]
  loading: boolean
  hasRole: (role: Role, dept?: DeptCode) => boolean
  /** Page access from the admin panel; null while unknown (fall back to role checks). */
  canSee: (page: string) => boolean | null
  isAdmin: boolean
  signInDev: (email: string, password: string) => Promise<string | null>
  signInSso: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<RoleAssignment[]>([])
  const [pageAccess, setPageAccess] = useState<Record<string, string[]> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
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
    ;(async () => {
      const [{ data: prof }, { data: ras }, { data: pa }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('role_assignments')
          .select('role, dept, source_ad_group')
          .eq('profile_id', session.user.id),
        supabase.from('page_access').select('page, allowed'),
      ])
      if (cancelled) return
      setProfile((prof as Profile) ?? null)
      setRoles((ras as RoleAssignment[]) ?? [])
      if (pa && pa.length > 0) {
        const map: Record<string, string[]> = {}
        for (const row of pa as { page: string; allowed: string[] }[]) map[row.page] = row.allowed
        setPageAccess(map)
      }
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

  const canSee = useCallback(
    (page: string): boolean | null => {
      if (!pageAccess) return null
      const allowed = pageAccess[page]
      if (!allowed) return null
      const mine = new Set<string>(roles.map((r) => r.role))
      mine.add('requester') // every signed-in user is implicitly a requester
      return allowed.some((a) => mine.has(a))
    },
    [pageAccess, roles]
  )

  const isAdmin = hasRole('user_admin') || hasRole('system_admin')

  return (
    <AuthContext.Provider
      value={{ session, profile, roles, loading, hasRole, canSee, isAdmin, signInDev, signInSso, signOut }}
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
