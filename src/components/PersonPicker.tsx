import { useEffect, useMemo, useRef, useState } from 'react'

export interface PickerPerson {
  id: string
  display_name: string
  upn?: string
}

/**
 * Searchable person field, used wherever a name list appears: focusing shows
 * the first four people, and typing filters the list live to names matching
 * the entered letters (name or email).
 */
export function PersonPicker<T extends PickerPerson>({
  people, value = null, onPick, placeholder = 'Search people…',
  width, flex, dropUp = false, small = false,
}: {
  people: T[]
  value?: string | null
  onPick: (p: T) => void
  placeholder?: string
  width?: number | string
  flex?: number
  dropUp?: boolean
  small?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [typing, setTyping] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = value ? people.find((p) => p.id === value) ?? null : null

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setTyping(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people.slice(0, 4)
    return people
      .filter((p) => `${p.display_name} ${p.upn ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [people, query])

  const pick = (p: T) => {
    onPick(p)
    setOpen(false); setTyping(false); setQuery('')
  }

  return (
    <div ref={ref} style={{ position: 'relative', width, flex, minWidth: 0 }}>
      <input
        className="input"
        style={small ? { padding: '7px 10px', fontSize: 12 } : undefined}
        placeholder={selected ? selected.display_name : placeholder}
        value={typing ? query : selected?.display_name ?? ''}
        onFocus={() => { setOpen(true); setTyping(true); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setTyping(true) }}
      />
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', left: 0, right: 0, zIndex: 50,
            ...(dropUp ? { bottom: '108%' } : { top: '106%' }),
            maxHeight: 230, overflowY: 'auto',
            boxShadow: '0 10px 26px rgba(16,25,46,.14)',
          }}
        >
          {list.map((p) => (
            <button
              key={p.id} type="button" className="pp-item"
              onMouseDown={(e) => { e.preventDefault(); pick(p) }}
            >
              <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>
                {p.display_name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()}
              </span>
              <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {p.display_name}
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="row-desc" style={{ padding: '8px 12px' }}>No names match.</div>
          )}
        </div>
      )}
    </div>
  )
}
