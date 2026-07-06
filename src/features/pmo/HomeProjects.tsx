import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip, SectionLabel } from '../../components/ui'
import { PROJECT_STATUS_META, type Project } from '../../lib/types'

/**
 * "My projects" section on the Overview page — shown only when the signed-in
 * user can see at least one open project. Time progress, activity completion
 * and status at a glance; click-through to the workspace.
 */

interface ActRow { project_id: string; status: string }

const OPEN = ['draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined', 'active', 'on_hold', 'closing']

export function HomeProjects({ onOpen }: { onOpen: (id: string) => void }) {
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
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <SectionLabel>My projects</SectionLabel>
      {projects.map((p) => {
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
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }}
            onClick={() => onOpen(p.id)}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', minWidth: 58 }}>{p.code}</span>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
              {p.project_type === 'personal' && <div className="row-desc">personal tracker</div>}
            </div>
            <div style={{ width: 170 }}>
              <div className="row-desc" style={{ fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>work {completion !== null ? `${completion}%` : '—'}</span>
                {timePct !== null && <span>time {timePct}%</span>}
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 3, height: 8, overflow: 'hidden', position: 'relative' }}>
                {completion !== null && (
                  <div style={{ width: `${Math.max(2, completion)}%`, height: '100%', background: behind ? 'var(--amber)' : 'var(--green)' }} />
                )}
                {timePct !== null && (
                  <div style={{ position: 'absolute', left: `${timePct}%`, top: 0, bottom: 0, width: 2, background: 'var(--red)' }} title="time elapsed" />
                )}
              </div>
            </div>
            {behind && <Chip tone="amber" style={{ fontSize: 10 }}>behind</Chip>}
            <Chip tone={meta.tone}>{meta.label}</Chip>
          </div>
        )
      })}
    </div>
  )
}
