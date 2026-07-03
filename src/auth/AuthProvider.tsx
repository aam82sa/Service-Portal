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
      const [{ data: prof }, { data: ras }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('role_assignments')
          .select('role, dept, source_ad_group')
          .eq('profile_id', session.user.id),
      ])
      if (cancelled) return
      setProfile((prof as Profile) ?? null)
      setRoles((ras as RoleAssignment[]) ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  const hasRole = useCallback(
    (role: Role, dept?: DeptCode) =>
      roles.some((r) => r.role === role && (!dept || !r.dept || r.dept === dept)),
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

  const isAdmin = hasRole('user_admin') || hasRole('system_admin')

  return (
    <AuthContext.Provider
      value={{ session, profile, roles, loading, hasRole, isAdmin, signInDev, signInSso, signOut }}
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
