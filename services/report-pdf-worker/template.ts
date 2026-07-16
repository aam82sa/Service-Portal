/**
 * Report HTML template for the high-fidelity PDF worker. Pure and side-effect
 * free so it can be unit-tested without launching a browser: given the report's
 * columns + rows (the same shape generate-report renders to CSV/XLSX), it
 * returns a self-contained, print-ready HTML document that headless Chrome
 * turns into a PDF.
 *
 * Every value that comes from report data is HTML-escaped — the rows are the
 * requesting owner's real data and must never break the layout or inject markup
 * into the page Chrome renders.
 */

export interface ReportHtmlInput {
  title: string
  subtitle?: string
  columns: string[]
  rows: Record<string, unknown>[]
  generatedAt?: string // ISO timestamp; defaults to render time
  direction?: 'ltr' | 'rtl'
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return escapeHtml(JSON.stringify(v))
  return escapeHtml(v)
}

export function reportHtml(input: ReportHtmlInput): string {
  const dir = input.direction === 'rtl' ? 'rtl' : 'ltr'
  const align = dir === 'rtl' ? 'right' : 'left'
  const metaAlign = dir === 'rtl' ? 'left' : 'right'
  const cols = input.columns.length ? input.columns : ['(no columns)']
  const generatedAt = (input.generatedAt ?? new Date().toISOString()).replace('T', ' ').slice(0, 16)

  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const body = input.rows.length
    ? input.rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${cols.length}">No data for this report.</td></tr>`

  return `<!doctype html>
<html lang="en" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif; color: #1a1c22; margin: 0; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #c9a227; padding-bottom: 8px; margin-bottom: 12px; }
  .title { font-size: 18px; font-weight: 700; margin: 0; }
  .subtitle { color: #5b606b; font-size: 11px; margin-top: 2px; }
  .meta { text-align: ${metaAlign}; color: #7a7f8a; font-size: 10px; }
  .brand { font-weight: 700; color: #c9a227; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: ${align}; background: #f4f2ec; color: #3a3d45; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #ddd8cc; white-space: nowrap; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #eeeeee; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #faf9f6; }
  td.empty { text-align: center; color: #9aa0ab; padding: 24px; font-style: italic; }
  .foot { margin-top: 10px; color: #9aa0ab; font-size: 9px; text-align: ${align}; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1 class="title">${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="brand">ABC CORP · SERVICES HUB</div>
      <div>Generated ${escapeHtml(generatedAt)} · ${input.rows.length} rows</div>
    </div>
  </div>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">Confidential — generated under the requesting owner's data access. Do not distribute outside its intended recipients.</div>
</body>
</html>`
}
