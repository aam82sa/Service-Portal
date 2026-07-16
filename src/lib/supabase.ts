import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)
// Fail closed: password sign-in against seeded accounts is opt-in for local
// stacks only (VITE_AUTH_MODE=dev). Any other value — including unset, as on
// production builds — lands on Entra ID SSO.
export const authMode: 'dev' | 'sso' =
  import.meta.env.VITE_AUTH_MODE === 'dev' ? 'dev' : 'sso'

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key'
)
