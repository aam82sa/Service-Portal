import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { parseTrackerWorkbook, type ParsedWorkbook } from './trackerParse'

/**
 * Import the IT assets tracker workbook: hardware sheets, software licenses,
 * per-user seats, servers/VMs/Azure resources and monthly Azure credit.
 * Idempotent — re-importing updates in place (assets by tag, licenses by
 * name, cloud by kind+name, credit by month).
 */

interface Person { id: string; display_name: string; upn: string }

interface Summary {
  assets: number
  history: number
  licenses: number
  seats: number
  seatsSkipped: number
  cloud: number
  credit: number
  holdersUnmatched: number
}

const nk = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function runImport(parsed: ParsedWorkbook, people: Person[]): Promise<Summary> {
  const byName = new Map(people.map((p) => [nk(p.display_name), p.id]))
  const byUpn = new Map(people.map((p) => [nk(p.upn), p.id]))
  const sum: Summary = { assets: 0, history: 0, licenses: 0, seats: 0, seatsSkipped: 0, cloud: 0, credit: 0, holdersUnmatched: 0 }

  // ---- hardware ----
  const rows = parsed.assets.map((a) => {
    const pid = a.holder ? byName.get(nk(a.holder)) ?? null : null
    if (a.holder && !pid) sum.holdersUnmatched++
    return {
      tag: a.tag, category: a.category, model: a.model, serial: a.serial,
      status: a.status, assigned_to: pid, assigned_name: pid ? null : a.holder,
      assigned_at: a.assigned_at, manufacturer: a.manufacturer, vendor: a.vendor,
      po_number: a.po_number, cost: a.cost, delivery_date: a.delivery_date,
      warranty_start: a.warranty_start, warranty_end: a.warranty_end,
      location: a.location, purchased_on: a.delivery_date,
    }
  })
  for (const part of chunk(rows, 100)) {
    const { error } = await supabase.from('assets').upsert(part, { onConflict: 'tag' })
    if (error) throw new Error(`assets: ${error.message}`)
    sum.assets += part.length
  }
  // ownership history: replace for the imported tags that carry history
  const withOwners = parsed.assets.filter((a) => a.owners.length > 0)
  if (withOwners.length) {
    const { data: ids, error } = await supabase
      .from('assets').select('id, tag').in('tag', withOwners.map((a) => a.tag))
    if (error) throw new Error(`ownership: ${error.message}`)
    const idByTag = new Map((ids ?? []).map((r) => [r.tag, r.id]))
    const assetIds = [...idByTag.values()]
    await supabase.from('asset_ownership').delete().in('asset_id', assetIds)
    const hist = withOwners.flatMap((a) => {
      const assetId = idByTag.get(a.tag)
      if (!assetId) return []
      return a.owners.map((o) => ({
        asset_id: assetId,
        profile_id: byName.get(nk(o.name)) ?? null,
        owner_name: o.name,
        assigned_at: o.assigned_at,
        returned_at: o.returned_at,
      }))
    })
    for (const part of chunk(hist, 200)) {
      const { error: e } = await supabase.from('asset_ownership').insert(part)
      if (e) throw new Error(`ownership: ${e.message}`)
      sum.history += part.length
    }
  }

  // ---- licenses ----
  const { data: existing } = await supabase.from('licenses').select('id, name')
  const licByName = new Map((existing ?? []).map((l) => [nk(l.name), l.id]))
  // license names that only appear in the user sheets still need a record
  const fromSeats = new Map<string, 'active' | 'expired'>()
  for (const s of parsed.seats) {
    const k = nk(s.license)
    if (!parsed.licenses.some((l) => nk(l.name) === k) && !fromSeats.has(k)) fromSeats.set(k, s.status)
  }
  const allLicenses = [
    ...parsed.licenses,
    ...[...fromSeats.entries()].map(([k, status]) => ({
      name: parsed.seats.find((s) => nk(s.license) === k)!.license,
      seats: Math.max(1, parsed.seats.filter((s) => nk(s.license) === k).length),
      expires_on: null, subscription_status: status,
      po_number: null, billing_profile: null, purchase_date: null, owner_email: null,
    })),
  ]
  for (const l of allLicenses) {
    const fields = {
      name: l.name, seats: l.seats, expires_on: l.expires_on,
      subscription_status: l.subscription_status, po_number: l.po_number,
      billing_profile: l.billing_profile, purchase_date: l.purchase_date,
      owner_email: l.owner_email, status: 'active',
    }
    const id = licByName.get(nk(l.name))
    const { data, error } = id
      ? await supabase.from('licenses').update(fields).eq('id', id).select('id').single()
      : await supabase.from('licenses').insert(fields).select('id').single()
    if (error) throw new Error(`licenses: ${error.message}`)
    if (data && !id) licByName.set(nk(l.name), data.id)
    sum.licenses++
  }
  // ---- seats ----
  const seatRows = parsed.seats.flatMap((s) => {
    const lid = licByName.get(nk(s.license))
    const pid = byUpn.get(nk(s.upn))
    if (!lid || !pid) { sum.seatsSkipped++; return [] }
    return [{ license_id: lid, profile_id: pid }]
  })
  for (const part of chunk(seatRows, 200)) {
    const { error } = await supabase
      .from('license_assignments')
      .upsert(part, { onConflict: 'license_id,profile_id', ignoreDuplicates: true })
    if (error) throw new Error(`seats: ${error.message}`)
    sum.seats += part.length
  }

  // ---- cloud + credit ----
  for (const part of chunk(parsed.cloud, 100)) {
    const { error } = await supabase.from('cloud_resources').upsert(part, { onConflict: 'kind,name' })
    if (error) throw new Error(`cloud: ${error.message}`)
    sum.cloud += part.length
  }
  if (parsed.credit.length) {
    const { error } = await supabase.from('azure_credit').upsert(parsed.credit, { onConflict: 'month' })
    if (error) throw new Error(`credit: ${error.message}`)
    sum.credit = parsed.credit.length
  }
  return sum
}

export function TrackerImportPanel({ people, onDone }: {
  people: Person[]
  onDone: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const parsed = parseTrackerWorkbook(wb)
      if (parsed.assets.length + parsed.licenses.length + parsed.cloud.length === 0) {
        throw new Error('No recognizable tracker sheets found in this workbook.')
      }
      const s = await runImport(parsed, people)
      setResult(
        `${s.assets} assets (${s.history} ownership records, ${s.holdersUnmatched} holders kept by name only) · ` +
        `${s.licenses} licenses, ${s.seats} seats (${s.seatsSkipped} skipped — user or license not found) · ` +
        `${s.cloud} cloud resources · ${s.credit} credit months`
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <>
      <input
        ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }}
      />
      <button
        className="btn"
        style={{ background: 'var(--admin-soft)', borderColor: 'var(--admin)', color: 'var(--admin)', fontWeight: 500 }}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? 'Importing…' : 'Import tracker workbook'}
      </button>
      {result && (
        <span style={{ fontSize: 11.5, color: 'var(--green)', width: '100%' }}>✓ {result}</span>
      )}
      {error && <span className="error-note" style={{ width: '100%' }}>{error}</span>}
    </>
  )
}
