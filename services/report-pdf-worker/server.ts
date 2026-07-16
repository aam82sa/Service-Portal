/**
 * report-pdf-worker — a small containerized HTTP service that renders a report
 * to a print-quality PDF with headless Chromium (Playwright).
 *
 * generate-report (the Supabase Edge Function) POSTs the report's title,
 * columns and rows here with a shared secret; the worker builds the HTML
 * (template.ts) and returns application/pdf. When the worker URL/secret are not
 * configured, generate-report falls back to a programmatic pdf-lib table, so
 * this service is an enhancement, not a hard dependency.
 *
 * Endpoints:
 *   GET  /health  -> 200 "ok"
 *   POST /        -> requires header `x-worker-secret`; body { title, subtitle?,
 *                    columns[], rows[], generatedAt?, direction? }; -> PDF bytes
 *
 * Env: PORT (default 8080), REPORT_PDF_WORKER_SECRET (required to serve).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { type Browser, chromium } from 'playwright'
import { reportHtml, type ReportHtmlInput } from './template.js'

const PORT = Number(process.env.PORT ?? 8080)
const SECRET = process.env.REPORT_PDF_WORKER_SECRET ?? ''
const MAX_BODY = 8 * 1024 * 1024 // 8 MB of JSON is plenty for 5000 rows

// One shared browser, launched lazily and reused across requests. The image's
// bundled Chromium is used by default; PLAYWRIGHT_CHROMIUM_PATH overrides it
// (handy when the host ships a browser at a non-default path).
let browserPromise: Promise<Browser> | null = null
function browser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
    browserPromise = chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  }
  return browserPromise
}

async function renderPdf(input: ReportHtmlInput): Promise<Buffer> {
  const page = await (await browser()).newPage()
  try {
    await page.setContent(reportHtml(input), { waitUntil: 'networkidle' })
    return await page.pdf({ printBackground: true, preferCSSPageSize: true })
  } finally {
    await page.close()
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function isValid(input: unknown): input is ReportHtmlInput {
  const i = input as ReportHtmlInput
  return !!i && typeof i.title === 'string' && Array.isArray(i.columns) && Array.isArray(i.rows)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain' }).end('POST only')
    return
  }
  if (!SECRET || req.headers['x-worker-secret'] !== SECRET) {
    res.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized')
    return
  }
  try {
    const input = JSON.parse(await readBody(req))
    if (!isValid(input)) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid body')
      return
    }
    const pdf = await renderPdf(input)
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) }).end(pdf)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`render failed: ${msg}`)
  }
})

server.listen(PORT, () => console.log(`report-pdf-worker listening on :${PORT}`))
