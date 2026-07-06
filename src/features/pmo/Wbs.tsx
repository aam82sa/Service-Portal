import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip, SectionLabel } from '../../components/ui'

export interface Activity {
  id: string
  parent_wbs_id: string | null
  code: string
  title: string
  level: number
  sequence: number
  planned_start: string | null
  planned_end: string | null
  status: 'todo' | 'in_progress' | 'done'
  is_milestone: boolean
}
export interface WbsAssignment { id: string; wbs_element_id: string; user_id: string }
export interface WbsDependency { id: string; predecessor_id: string; successor_id: string }
export interface TeamPerson { id: string; display_name: string }

export const STATUS_META = {
  todo: { label: 'to do', tone: 'muted' as const, pct: 0 },
  in_progress: { label: 'in progress', tone: 'amber' as const, pct: 50 },
  done: { label: 'done', tone: 'green' as const, pct: 100 },
}

const codeKey = (c: string) => c.split('.').map((n) => n.padStart(6, '0')).join('.')

export function buildTree(activities: Activity[]) {
  const children = new Map<string | null, Activity[]>()
  for (const a of [...activities].sort((x, y) => codeKey(x.code).localeCompare(codeKey(y.code)))) {
    const list = children.get(a.parent_wbs_id) ?? []
    list.push(a)
    children.set(a.parent_wbs_id, list)
  }
  return children
}

export function WbsTree({ projectId, activities, assignments, dependencies, team, people, canManage, myId, focusId, onChanged, onError }: {
  projectId: string
  activities: Activity[]
  assignments: WbsAssignment[]
  dependencies: WbsDependency[]
  team: TeamPerson[]
  people: Map<string, string>
  canManage: boolean
  myId: string | null
  focusId?: string | null
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const focusRef = useRef<HTMLDivElement | null>(null)
  const children = useMemo(() => buildTree(activities), [activities])

  // Arriving from a timeline bar: expand ancestors, open the editor, scroll to it
  useEffect(() => {
    if (!focusId) return
    setCollapsed(new Set())
    if (canManage) setEditing(focusId)
    const t = setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    return () => clearTimeout(t)
  }, [focusId, canManage])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) onError(error.message)
    onChanged()
  }

  const addChild = (parent: Activity | null) => {
    const siblings = children.get(parent?.id ?? null) ?? []
    const code = parent ? `${parent.code}.${siblings.length + 1}` : `${siblings.length + 1}`
    const title = window.prompt(`Title for WBS ${code}`)
    if (!title?.trim()) return
    run(supabase.from('wbs_elements').insert({
      project_id: projectId, parent_wbs_id: parent?.id ?? null, code,
      title: title.trim(), level: parent ? parent.level + 1 : 1, sequence: siblings.length + 1,
    }))
  }

  const rename = (a: Activity) => {
    const title = window.prompt('Rename activity', a.title)
    if (!title?.trim()) return
    run(supabase.from('wbs_elements').update({ title: title.trim() }).eq('id', a.id))
  }

  const remove = (a: Activity) => {
    if (!window.confirm(`Delete ${a.code} "${a.title}" and everything under it?`)) return
    run(supabase.from('wbs_elements').delete().eq('id', a.id))
  }

  const cycleStatus = (a: Activity) => {
    const next = a.status === 'todo' ? 'in_progress' : a.status === 'in_progress' ? 'done' : 'todo'
    run(supabase.from('wbs_elements').update({ status: next }).eq('id', a.id))
  }

  const renderNode = (a: Activity): JSX.Element => {
    const kids = children.get(a.id) ?? []
    const isCollapsed = collapsed.has(a.id)
    const asg = assignments.filter((x) => x.wbs_element_id === a.id)
    const preds = dependencies.filter((d) => d.successor_id === a.id)
    const isMine = asg.some((x) => x.user_id === myId)
    const meta = STATUS_META[a.status]
    const isFocus = a.id === focusId
    return (
      <div key={a.id} ref={isFocus ? focusRef : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', paddingLeft: (a.level - 1) * 22, borderTop: '1px solid var(--line)', background: isFocus ? 'var(--accent-soft)' : undefined, borderRadius: isFocus ? 6 : undefined }}>
          <button
            className="btn" style={{ padding: '0 6px', fontSize: 11, visibility: kids.length ? 'visible' : 'hidden', minWidth: 24 }}
            onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', minWidth: 42 }}>{a.code}</span>
          {a.is_milestone && <span title="milestone" style={{ color: 'var(--amber)' }}>◆</span>}
          <span style={{ flex: 1, fontSize: 13 }}>
            {a.title}
            {kids.length > 0 && <span className="row-desc"> · {kids.length}</span>}
          </span>
          {asg.map((x) => (
            <Chip key={x.id} tone="ink" style={{ fontSize: 10 }}>{people.get(x.user_id) ?? '—'}</Chip>
          ))}
          {(a.planned_start || a.planned_end) && (
            <span className="mono row-desc" style={{ fontSize: 10.5 }}>
              {a.planned_start ?? '…'} → {a.planned_end ?? '…'}
            </span>
          )}
          {preds.length > 0 && <span className="row-desc" title="has predecessors">⇠{preds.length}</span>}
          <Chip
            tone={meta.tone}
            onClick={canManage || isMine ? () => cycleStatus(a) : undefined}
            style={{ minWidth: 74, justifyContent: 'center' }}
          >
            {meta.label}
          </Chip>
          {canManage && (
            <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setEditing(editing === a.id ? null : a.id)}>
              {editing === a.id ? 'close' : 'edit'}
            </button>
          )}
        </div>
        {editing === a.id && canManage && (
          <ActivityEditor
            activity={a} activities={activities} assignments={asg} dependencies={preds}
            team={team} onChanged={onChanged} onError={onError}
            onRename={() => rename(a)} onDelete={() => remove(a)} onAddChild={() => addChild(a)}
          />
        )}
        {!isCollapsed && kids.map(renderNode)}
      </div>
    )
  }

  const roots = children.get(null) ?? []
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <SectionLabel>Work Breakdown Structure — activities</SectionLabel>
        <span style={{ flex: 1 }} />
        {canManage && <button className="btn" onClick={() => addChild(null)}>+ Top-level element</button>}
      </div>
      {roots.map(renderNode)}
      {activities.length === 0 && <div className="row-desc">No WBS elements yet.</div>}
    </div>
  )
}

function ActivityEditor({ activity, activities, assignments, dependencies, team, onChanged, onError, onRename, onDelete, onAddChild }: {
  activity: Activity
  activities: Activity[]
  assignments: WbsAssignment[]
  dependencies: WbsDependency[]
  team: TeamPerson[]
  onChanged: () => void
  onError: (m: string) => void
  onRename: () => void
  onDelete: () => void
  onAddChild: () => void
}) {
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) onError(error.message)
    onChanged()
  }
  const patch = (fields: Partial<Activity>) =>
    run(supabase.from('wbs_elements').update(fields).eq('id', activity.id))

  const toggleAssignee = (userId: string) => {
    const existing = assignments.find((a) => a.user_id === userId)
    run(existing
      ? supabase.from('wbs_assignments').delete().eq('id', existing.id)
      : supabase.from('wbs_assignments').insert({ wbs_element_id: activity.id, user_id: userId }))
  }

  const togglePred = (predId: string) => {
    const existing = dependencies.find((d) => d.predecessor_id === predId)
    run(existing
      ? supabase.from('wbs_dependencies').delete().eq('id', existing.id)
      : supabase.from('wbs_dependencies').insert({ predecessor_id: predId, successor_id: activity.id }))
  }

  const candidates = activities.filter((x) => x.id !== activity.id)

  return (
    <div style={{ margin: '4px 0 10px', marginLeft: (activity.level - 1) * 22 + 30, padding: 12, background: 'var(--surface)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="row-desc">Dates</span>
        <input className="input" type="date" style={{ width: 150 }} value={activity.planned_start ?? ''}
          onChange={(e) => patch({ planned_start: e.target.value || null })} />
        <span className="row-desc">→</span>
        <input className="input" type="date" style={{ width: 150 }} value={activity.planned_end ?? ''}
          onChange={(e) => patch({ planned_end: e.target.value || null })} />
        <Chip tone={activity.is_milestone ? 'amber' : 'muted'} onClick={() => patch({ is_milestone: !activity.is_milestone })}>
          ◆ milestone
        </Chip>
        <span style={{ flex: 1 }} />
        <button className="btn" style={{ fontSize: 11 }} onClick={onAddChild}>+ child</button>
        <button className="btn" style={{ fontSize: 11 }} onClick={onRename}>rename</button>
        <button className="btn" style={{ fontSize: 11, color: 'var(--red)' }} onClick={onDelete}>delete</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="row-desc">Assignees</span>
        {team.length === 0 && <span className="row-desc">add people on the Team tab first</span>}
        {team.map((p) => (
          <Chip key={p.id} tone={assignments.some((a) => a.user_id === p.id) ? 'accent' : 'muted'} onClick={() => toggleAssignee(p.id)}>
            {p.display_name}
          </Chip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="row-desc">Predecessors (finish → start)</span>
        {candidates.map((x) => (
          <Chip key={x.id} mono tone={dependencies.some((d) => d.predecessor_id === x.id) ? 'accent' : 'muted'} onClick={() => togglePred(x.id)} style={{ fontSize: 10 }}>
            {x.code}
          </Chip>
        ))}
      </div>
    </div>
  )
}
