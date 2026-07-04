import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { FeatureFlag } from '../../lib/types'
import { useAuth } from '../auth/AuthProvider'

const CATEGORY_CHIP: Record<string, { bg: string; fg: string }> = {
  channels: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  operations: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  experience: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  integrations: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  general: { bg: 'var(--surface)', fg: 'var(--muted)' },
}

export function FeatureToggles() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('system_admin')
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('feature_flags')
      .select('*')
      .order('category')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setFlags((data as FeatureFlag[]) ?? [])
      })
  }, [])

  const toggle = async (flag: FeatureFlag) => {
    const next = !flag.is_enabled
    setFlags((fs) => fs.map((f) => (f.key === flag.key ? { ...f, is_enabled: next } : f)))
    const { error: e } = await supabase
      .from('feature_flags')
      .update({ is_enabled: next })
      .eq('key', flag.key)
    if (e) {
      setFlags((fs) => fs.map((f) => (f.key === flag.key ? { ...f, is_enabled: !next } : f)))
      setError(e.message)
    }
  }

  return (
    <>
      <h2 className="page-head">Platform functions</h2>
      <p className="page-sub">
        Enable or disable any function. Changes apply platform-wide, are enforced in the
        database layer, and are written to the audit log.
      </p>
      <div className="card">
        {flags.map((f) => {
          const chip = CATEGORY_CHIP[f.category] ?? CATEGORY_CHIP.general
          return (
            <div className="row" key={f.key}>
              <div style={{ flex: 1 }}>
                <div className="row-title">{f.name}</div>
                <div className="row-desc">{f.description}</div>
              </div>
              <span className="chip" style={{ background: chip.bg, color: chip.fg }}>
                {f.category}
              </span>
              <button
                className={`toggle${f.is_enabled ? ' on' : ''}`}
                onClick={() => toggle(f)}
                disabled={!canEdit}
                aria-label={`${f.name}: ${f.is_enabled ? 'enabled' : 'disabled'}`}
              />
            </div>
          )
        })}
        {flags.length === 0 && !error && (
          <div className="row row-desc">Loading functions…</div>
        )}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
