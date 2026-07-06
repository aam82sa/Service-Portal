import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PROJECT_STATUS_META, type Project } from '../../lib/types'

/**
 * MY PROJECTS card on the Overview page (design 4a): capped at three rows,
 * work-vs-time progress bar with a time-elapsed tick, status chip.
 * Rendered only when the user can see at least one open project.
 */

interface ActRow { project_id: string; status: string }

const OPEN = ['draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined', 'active', 'on_hold', 'closing']

export function HomeProjects({ onOpen, onAll }: {
  onOpen: (id: string) => void
  onAll?: () => void
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [acts, setActs] = useState<ActRow[]>([])

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, code, name, status, project_type, department_scope, planned_start, planned_end, project_manager_id, created_by, origin_type, description, sponsor_id')
      .in('status', OPEN)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(async ({ data }) => {
        const rows = (data as unknown as Project[]) ?? []
        setProjects(rows)
        if (rows.length) {
          const { data: a } = await supabase
            .from('wbs_elements').select('project_id, status')
            .in('project_id', rows.map((p) => p.id))
          setActs((a as ActRow[]) ?? [])
        }
      })
  }, [])

  if (projects.length === 0) return null

  const today = Date.now()
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', color: 'var(--muted)' }}>
          MY PROJECTS · {projects.length}
        </span>
        <span style={{ flex: 1 }} />
        {onAll && (
          <button onClick={onAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
            All →
          </button>
        )}
      </div>
      {projects.slice(0, 3).map((p) => {
        const meta = PROJECT_STATUS_META[p.status]
        const mine = acts.filter((a) => a.project_id === p.id)
        const done = mine.filter((a) => a.status === 'done').length
        const completion = mine.length ? Math.round((done / mine.length) * 100) : null
        let timePct: number | null = null
        if (p.planned_start && p.planned_end) {
          const s = new Date(p.planned_start).getTime()
          const e = new Date(p.planned_end).getTime()
          if (e > s) timePct = Math.min(100, Math.max(0, Math.round(((today - s) / (e - s)) * 100)))
        }
        const behind = completion !== null && timePct !== null && completion + 10 < timePct
        return (
          <div key={p.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #EDEFF4', cursor: 'pointer' }}
            onClick={() => onOpen(p.id)}>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', width: 54, flexShrink: 0 }}>{p.code}</span>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.name}
            </span>
            <span style={{ width: 90, flexShrink: 0, background: 'var(--surface)', borderRadius: 3, height: 8, overflow: 'hidden', position: 'relative' }}>
              {completion !== null && (
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(3, completion)}%`, background: behind ? 'var(--amber)' : 'var(--green)' }} />
              )}
              {timePct !== null && (
                <span style={{ position: 'absolute', left: `${timePct}%`, top: 0, bottom: 0, width: 2, background: 'var(--red)' }} title="time elapsed" />
              )}
            </span>
            <span className="chip" style={{ fontSize: 10, background: 'var(--surface)', color: `var(--${meta.tone === 'ink' ? 'ink' : meta.tone})` }}>
              {meta.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
