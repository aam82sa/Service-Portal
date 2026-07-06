import * as XLSX from 'xlsx'

/**
 * Parser for the IT assets tracker workbook (Windows L / MacOs L / Monitors /
 * DS / K&M / Headset / Printers / Meeting Room Kit hardware sheets, Software +
 * license user sheets, Servers / VMs / Azure Resources / Azure Credit).
 * Pure functions — DB writes live in TrackerImport.tsx.
 */

export interface ParsedAsset {
  tag: string
  category: string
  model: string | null
  serial: string | null
  status: 'in_stock' | 'assigned' | 'repair' | 'retired'
  holder: string | null            // display name; matched to profiles at import
  assigned_at: string | null
  manufacturer: string | null
  vendor: string | null
  po_number: string | null
  cost: number | null
  delivery_date: string | null
  warranty_start: string | null
  warranty_end: string | null
  location: string | null
  owners: { name: string; assigned_at: string | null; returned_at: string | null }[]
}
export interface ParsedLicense {
  name: string
  seats: number
  expires_on: string | null
  subscription_status: 'active' | 'expired'
  po_number: string | null
  billing_profile: string | null
  purchase_date: string | null
  owner_email: string | null
}
export interface ParsedSeat { license: string; upn: string; status: 'active' | 'expired' }
export interface ParsedCloud {
  kind: 'server' | 'vm' | 'azure_resource'
  name: string
  os_or_type: string | null
  serial: string | null
  manufacturer: string | null
  environment: string | null
  priority: string | null
  status: string | null
  owner_name: string | null
  owner_email: string | null
  location: string | null
  resource_group: string | null
  subscription: string | null
}
export interface ParsedCredit {
  month: string
  starting_credit: number | null
  new_credit: number | null
  adjustments: number | null
  forecast_charges: number | null
  forecast_ending: number | null
  applied_charges: number | null
  ending_credit: number | null
}
export interface ParsedWorkbook {
  assets: ParsedAsset[]
  licenses: ParsedLicense[]
  seats: ParsedSeat[]
  cloud: ParsedCloud[]
  credit: ParsedCredit[]
  warnings: string[]
}

const HW_SHEETS: { sheet: string; category: string; code: string }[] = [
  { sheet: 'Windows L', category: 'laptop', code: 'LT' },
  { sheet: 'MacOs L', category: 'laptop', code: 'LT' },
  { sheet: 'Monitors', category: 'monitor', code: 'MN' },
  { sheet: 'DS', category: 'dock', code: 'DS' },
  { sheet: 'K&M', category: 'keyboard_mouse', code: 'KM' },
  { sheet: 'Headset', category: 'headset', code: 'HS' },
  { sheet: 'Printers', category: 'printer', code: 'PR' },
  { sheet: 'Meeting Room Kit', category: 'meeting_room', code: 'MR' },
]

const NON_PEOPLE = new Set([
  '', 'in stock', 'in store', 'n/a', 'na', 'shared printer', 'deallocated',
  'stock', 'store', 'spare', '-',
])

const norm = (s: unknown) => String(s ?? '').trim()
const normKey = (s: unknown) => norm(s).toLowerCase().replace(/\s+/g, ' ')

export const isPerson = (v: unknown) => {
  const s = normKey(v)
  return s.length > 1 && !NON_PEOPLE.has(s)
}

/** Excel serial or common string date -> ISO yyyy-mm-dd */
export const exDate = (v: unknown): string | null => {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400) * 1000).toISOString().slice(0, 10)
  }
  const s = norm(v)
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Header lookup tolerant of the sheets' inconsistent naming/whitespace. */
function findCol(headers: string[], ...candidates: string[]): number {
  const hs = headers.map(normKey)
  for (const c of candidates) {
    const i = hs.findIndex((h) => h === c)
    if (i !== -1) return i
  }
  for (const c of candidates) {
    const i = hs.findIndex((h) => h.startsWith(c) || h.includes(c))
    if (i !== -1) return i
  }
  return -1
}

const mapStatus = (raw: unknown, holder: string | null): ParsedAsset['status'] => {
  const s = normKey(raw)
  if (s.includes('repair')) return 'repair'
  if (s.includes('retire') || s.includes('dispose') || s.includes('damaged')) return 'retired'
  if (s === 'assigned' || s === 'in use') return 'assigned'
  if (holder) return 'assigned'
  return 'in_stock'
}

function rows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
}

export function parseTrackerWorkbook(wb: XLSX.WorkBook): ParsedWorkbook {
  const out: ParsedWorkbook = { assets: [], licenses: [], seats: [], cloud: [], credit: [], warnings: [] }
  const seenTags = new Set<string>()

  // ---- hardware sheets ----
  for (const cfg of HW_SHEETS) {
    const ws = wb.Sheets[cfg.sheet]
    if (!ws) { out.warnings.push(`sheet "${cfg.sheet}" not found — skipped`); continue }
    const data = rows(ws)
    if (data.length < 2) continue
    const h = data[0].map(String)
    const cTag = findCol(h, 'tag no', 'tag')
    const cModel = findCol(h, 'model name', 'device name', 'model')
    const cSerial = findCol(h, 'serial number', 'serial')
    const cManu = findCol(h, 'manufacturer')
    const cUser = findCol(h, 'primary user display name')
    const cUserDate = findCol(h, 'primary user assignment date')
    const cPo = findCol(h, 'po')
    const cDeliv = findCol(h, 'warehouse delivery', 'delivery')
    const cVendor = findCol(h, 'vendor')
    const cCost = findCol(h, 'cost sar', 'cost')
    const cStatus = findCol(h, 'status')
    const cWStart = findCol(h, 'warranty start date', 'warranty start')
    const cWEnd = findCol(h, 'warranty end date', 'warranty end', 'warrant')
    const cLoc = findCol(h, 'location')
    const cStore = findCol(h, 'tasama store')
    const cMoved = findCol(h, 'date moved to tasama store')
    const owners: [number, number, number][] = []
    const cP1 = findCol(h, 'previous owner')
    if (cP1 !== -1) owners.push([cP1, findCol(h, 'previous owner assignment date'), findCol(h, 'previous owner returned date')])
    const cP2 = findCol(h, 'previous owner 2')
    if (cP2 !== -1) owners.push([cP2, findCol(h, 'previous owner 2 assignment date'), findCol(h, 'previous owner 2 returned date')])
    const cPrevMr = findCol(h, 'previous user display name')
    if (cPrevMr !== -1) owners.push([cPrevMr, -1, -1])

    let n = 0
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const model = cModel !== -1 ? norm(r[cModel]) : ''
      const serial = cSerial !== -1 ? norm(r[cSerial]) : ''
      if (!model && !serial) continue
      n++
      const rawTag = cTag !== -1 ? norm(r[cTag]) : ''
      let tag = rawTag
        ? `${cfg.code}-${rawTag.replace(/^0+(?=\d{4})/, '').padStart(5, '0')}`
        : serial && normKey(serial) !== 'n/a'
          ? `${cfg.code}-${serial.replace(/\s+/g, '').slice(-10).toUpperCase()}`
          : `${cfg.code}-R${String(n).padStart(4, '0')}`
      while (seenTags.has(tag)) tag = tag + 'B'
      seenTags.add(tag)

      const holderRaw = cUser !== -1 ? norm(r[cUser]) : ''
      const holder = isPerson(holderRaw) ? holderRaw : null
      const ownerRows: ParsedAsset['owners'] = []
      for (const [cn, ca, cr] of owners) {
        const name = norm(r[cn])
        if (!isPerson(name)) continue
        ownerRows.push({
          name,
          assigned_at: ca !== -1 ? exDate(r[ca]) : null,
          returned_at: cr !== -1 ? exDate(r[cr]) : null,
        })
      }
      const stored = cStore !== -1 && normKey(r[cStore]) === 'checked'
      out.assets.push({
        tag,
        category: cfg.category,
        model: model || null,
        serial: serial && normKey(serial) !== 'n/a' ? serial : null,
        status: mapStatus(cStatus !== -1 ? r[cStatus] : '', holder),
        holder,
        assigned_at: cUserDate !== -1 ? exDate(r[cUserDate]) : null,
        manufacturer: cManu !== -1 ? norm(r[cManu]) || null : null,
        vendor: cVendor !== -1 ? norm(r[cVendor]) || null : null,
        po_number: cPo !== -1 ? norm(r[cPo]) || null : null,
        cost: cCost !== -1 ? num(r[cCost]) : null,
        delivery_date: cDeliv !== -1 ? exDate(r[cDeliv]) : null,
        warranty_start: cWStart !== -1 ? exDate(r[cWStart]) : null,
        warranty_end: cWEnd !== -1 && cWEnd !== cWStart ? exDate(r[cWEnd]) : null,
        location: cLoc !== -1 && norm(r[cLoc])
          ? norm(r[cLoc])
          : stored ? 'Tasama Store' : cMoved !== -1 && exDate(r[cMoved]) ? 'Tasama Store' : null,
        owners: ownerRows,
      })
    }
  }

  // ---- software / licenses ----
  const sw = wb.Sheets['Software '] ?? wb.Sheets['Software']
  if (sw) {
    const data = rows(sw)
    const h = (data[0] ?? []).map(String)
    const cName = findCol(h, 'softwarename', 'software name')
    const cQty = findCol(h, 'purchased quantity')
    const cExp = findCol(h, 'expirationdate', 'expiration date')
    const cStat = findCol(h, 'subscription status')
    const cPo = findCol(h, 'po')
    const cBill = findCol(h, 'billing profile')
    const cPur = findCol(h, 'purchase date')
    const cOwn = findCol(h, 'owneremail', 'owner email')
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const name = norm(r[cName])
      if (!name) continue
      out.licenses.push({
        name,
        seats: Math.max(1, num(r[cQty]) ?? 1),
        expires_on: exDate(r[cExp]),
        subscription_status: normKey(r[cStat]) === 'expired' ? 'expired' : 'active',
        po_number: cPo !== -1 ? norm(r[cPo]) || null : null,
        billing_profile: cBill !== -1 ? norm(r[cBill]) || null : null,
        purchase_date: cPur !== -1 ? exDate(r[cPur]) : null,
        owner_email: cOwn !== -1 ? norm(r[cOwn]) || null : null,
      })
    }
  }
  for (const [sheet, status] of [['Active License Users', 'active'], ['Expired License Users', 'expired']] as const) {
    const ws = wb.Sheets[sheet]
    if (!ws) continue
    const data = rows(ws)
    const h = (data[0] ?? []).map(String)
    const cUpn = findCol(h, 'user principal name')
    const cLic = findCol(h, 'licenses')
    for (let i = 1; i < data.length; i++) {
      const upn = normKey(data[i][cUpn])
      const lic = norm(data[i][cLic])
      if (upn && lic) out.seats.push({ license: lic, upn, status })
    }
  }

  // ---- cloud ----
  const srv = wb.Sheets['Servers']
  if (srv) {
    const data = rows(srv)
    const h = (data[0] ?? []).map(String)
    const c = (name: string) => findCol(h, name)
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const name = norm(r[c('device name')])
      if (!name) continue
      out.cloud.push({
        kind: 'server', name,
        os_or_type: norm(r[c('operating system')]) || null,
        serial: null, manufacturer: null,
        environment: norm(r[c('environment')]) || null,
        priority: norm(r[c('priority')]) || null,
        status: null,
        owner_name: norm(r[c('primary user display name')]) || null,
        owner_email: norm(r[c('primary user email address')]) || null,
        location: null, resource_group: null, subscription: null,
      })
    }
  }
  const vms = wb.Sheets['VMs']
  if (vms) {
    const data = rows(vms)
    const h = (data[0] ?? []).map(String)
    const c = (name: string) => findCol(h, name)
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const name = norm(r[c('device name')])
      if (!name) continue
      const holder = norm(r[c('primary user display name')])
      out.cloud.push({
        kind: 'vm', name,
        os_or_type: null,
        serial: norm(r[c('serial number')]) || null,
        manufacturer: norm(r[c('manufacturer')]) || null,
        environment: null, priority: null,
        status: norm(r[c('status')]) || null,
        owner_name: isPerson(holder) ? holder : norm(r[c('previous owner')]) || null,
        owner_email: null,
        location: null, resource_group: null, subscription: null,
      })
    }
  }
  const az = wb.Sheets['Azure Resources']
  if (az) {
    const data = rows(az)
    const h = (data[0] ?? []).map(String)
    const c = (name: string) => findCol(h, name)
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const name = norm(r[c('name')])
      if (!name) continue
      out.cloud.push({
        kind: 'azure_resource', name,
        os_or_type: norm(r[c('type')]) || null,
        serial: null, manufacturer: null, environment: null, priority: null, status: null,
        owner_name: null, owner_email: null,
        location: norm(r[c('location')]) || null,
        resource_group: norm(r[c('resource group')]) || null,
        subscription: norm(r[c('subscription')]) || null,
      })
    }
  }
  const cr = wb.Sheets['Azure Credit']
  if (cr) {
    const data = rows(cr)
    const h = (data[0] ?? []).map(String)
    const c = (name: string) => findCol(h, name)
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const month = exDate(r[c('month')])
      if (!month) continue
      out.credit.push({
        month: month.slice(0, 8) + '01',
        starting_credit: num(r[c('starting credit')]),
        new_credit: num(r[c('new credit')]),
        adjustments: num(r[c('adjustments')]),
        forecast_charges: num(r[c('forecasted charges until end of month')]),
        forecast_ending: num(r[c('forecasted ending credit')]),
        applied_charges: num(r[c('credit applied towards charges')]),
        ending_credit: num(r[c('ending credit')]),
      })
    }
  }

  return out
}
