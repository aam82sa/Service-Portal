import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)
export const authMode: 'dev' | 'sso' =
  (import.meta.env.VITE_AUTH_MODE as 'dev' | 'sso') ?? 'dev'

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key'
)
