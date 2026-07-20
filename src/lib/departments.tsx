import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { DEPT_COLOR, type Department } from './types'

/**
 * Runtime department registry. Phase 1 turned departments into user-created
 * "service streams", so colours/labels can no longer come from a hardcoded
 * map — they are driven from the departments table. The four built-ins keep
 * their themed CSS-variable look (DEPT_COLOR); dynamic streams use the hex
 * colour stored on the row.
 */
export interface DeptStyle {
  rail: string
  soft: string
  label: string
}

function styleFromRow(d: Department): DeptStyle {
  const hex = d.rail_color || d.color || '#64748B'
  return { rail: hex, soft: `${hex}22`, label: d.name }
}

interface DeptCtx {
  departments: Department[]
  active: Department[]
  byCode: Record<string, Department>
  byId: Record<string, Department>
  /** style for a department code (built-ins keep their themed tokens) */
  styleForCode: (code: string | null | undefined) => DeptStyle
  loading: boolean
  reload: () => void
}

const FALLBACK: DeptStyle = { rail: 'var(--muted)', soft: 'var(--surface)', label: '—' }
const Ctx = createContext<DeptCtx | null>(null)

export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    supabase
      .from('departments')
      .select('id, code, name, name_ar, color, rail_color, icon, is_active, position')
      .order('position', { nullsFirst: false })
      .order('name')
      .then(({ data }) => {
        if (!live) return
        setDepartments((data as Department[]) ?? [])
        setLoading(false)
      })
    return () => { live = false }
  }, [nonce])

  const value = useMemo<DeptCtx>(() => {
    const byCode: Record<string, Department> = {}
    const byId: Record<string, Department> = {}
    for (const d of departments) { byCode[d.code] = d; byId[d.id] = d }
    return {
      departments,
      active: departments.filter((d) => d.is_active),
      byCode,
      byId,
      loading,
      reload: () => setNonce((n) => n + 1),
      styleForCode: (code) => {
        if (!code) return FALLBACK
        const builtIn = DEPT_COLOR[code as keyof typeof DEPT_COLOR]
        if (builtIn) return builtIn
        const d = byCode[code]
        return d ? styleFromRow(d) : { ...FALLBACK, label: code }
      },
    }
  }, [departments, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDepartments(): DeptCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDepartments must be used within DepartmentsProvider')
  return ctx
}

/** Resolve a department code to its display style (built-ins themed, streams from the table). */
export function useDeptStyle(): (code: string | null | undefined) => DeptStyle {
  return useDepartments().styleForCode
}
