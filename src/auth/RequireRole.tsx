import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import type { Role } from '../lib/types'

/**
 * Renders children only when the signed-in user holds one of the given roles.
 * UI-level gate only — data access is enforced separately by Postgres RLS.
 */
export function RequireRole({ anyOf, children }: { anyOf: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth()
  if (!anyOf.some((r) => hasRole(r))) return null
  return <>{children}</>
}
