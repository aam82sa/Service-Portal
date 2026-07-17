/**
 * letter-sign — the signatory signs an outgoing letter.
 *
 *   1. authenticate the caller (must be the letter's assigned signatory),
 *   2. take the draft PDF (an uploaded draft, or one composed from the letter
 *      body) and stamp it with the signatory's signature image + a QR code that
 *      points at the letter's registry URL + a signed-by footer,
 *   3. compute the SHA-256 of the final PDF (the tamper-evident record),
 *   4. upload the signed artifact, then call record_letter_signature() AS THE
 *      CALLER — that RPC verifies the initials chain is complete and the caller
 *      is the signatory, issues the reference number at signature time, and
 *      moves the letter to `signed`.
 *
 * The reference number is deliberately issued in the DB (number-at-signature),
 * not here; the QR encodes the stable registry URL by id, so there is no
 * ref/issuance ordering problem.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'npm:qrcode@1.5.4'
import { registryUrl, sha256Hex, signedArtifactPath } from './signMeta.ts'

const env = (k: string) => Deno.env.get(k)
/** Browser calls require CORS: allow the app origin's preflight + headers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

const BUCKET = 'letters'

function asciiSafe(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    out += c >= 0x20 && c <= 0x7e ? ch : ' '
  }
  return out
}

/** A minimal PDF from the letter body when no draft file was uploaded. */
async function composeFromBody(bodyHtml: string, subject: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const page = doc.addPage([595, 842]) // A4 portrait
  const margin = 56
  let y = 842 - margin
  page.drawText(asciiSafe(subject).slice(0, 90), { x: margin, y, size: 15, font: bold, color: rgb(0.1, 0.1, 0.12) })
  y -= 28
  const text = asciiSafe(bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  const width = 595 - margin * 2
  const size = 11
  let line = ''
  for (const word of text.split(' ')) {
    const trial = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) > width) {
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.12) })
      y -= 16
      line = word
      if (y < margin + 120) break
    } else line = trial
  }
  if (line && y >= margin + 120) page.drawText(line, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.12) })
  return await doc.save()
}

async function stamp(pdfBytes: Uint8Array, opts: {
  signaturePng?: Uint8Array; qrPng: Uint8Array; footer: string
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const page = pages[pages.length - 1]
  const { width } = page.getSize()
  const margin = 48

  const qr = await doc.embedPng(opts.qrPng)
  const qrSize = 78
  page.drawImage(qr, { x: margin, y: margin, width: qrSize, height: qrSize })

  if (opts.signaturePng) {
    try {
      const sig = await doc.embedPng(opts.signaturePng)
      const sw = 140
      const sh = (sig.height / sig.width) * sw
      page.drawImage(sig, { x: width - margin - sw, y: margin + 18, width: sw, height: Math.min(sh, 70) })
    } catch { /* non-PNG signature: skip the image, keep the footer */ }
  }

  page.drawText(asciiSafe(opts.footer).slice(0, 120), {
    x: margin + qrSize + 12, y: margin + 6, size: 8, font, color: rgb(0.4, 0.42, 0.48),
  })
  return await doc.save()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = env('SUPABASE_URL')!
  const anon = env('SUPABASE_ANON_KEY')!
  const service = env('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, service)

  const { data: userData } = await caller.auth.getUser()
  if (!userData?.user) return json({ error: 'not signed in' }, 401)
  const user = userData.user

  let body: { letter_id?: string; draft_path?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const letterId = body.letter_id
  if (!letterId) return json({ error: 'letter_id is required' }, 400)

  const { data: letter } = await admin.from('letters').select('id, subject, direction, status').eq('id', letterId).single()
  if (!letter || (letter as { direction: string }).direction !== 'outgoing') return json({ error: 'not an outgoing letter' }, 404)

  const { data: out } = await admin
    .from('letter_outgoing')
    .select('body_html, signatory_id, signatory:signatories(profile_id, signature_path)')
    .eq('letter_id', letterId).single()
  if (!out) return json({ error: 'no outgoing record' }, 404)
  const sig = (Array.isArray((out as { signatory: unknown }).signatory)
    ? (out as { signatory: { profile_id: string; signature_path: string | null }[] }).signatory[0]
    : (out as { signatory: { profile_id: string; signature_path: string | null } | null }).signatory) ?? null
  if (!sig || sig.profile_id !== user.id) return json({ error: 'only the assigned signatory may sign' }, 403)

  // source PDF: an uploaded draft, or one composed from the body
  let pdfBytes: Uint8Array
  if (body.draft_path) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(body.draft_path)
    if (error || !blob) return json({ error: `draft download failed: ${error?.message}` }, 500)
    pdfBytes = new Uint8Array(await blob.arrayBuffer())
  } else {
    pdfBytes = await composeFromBody((out as { body_html: string }).body_html ?? '', (letter as { subject: string }).subject)
  }

  // signature image (optional) + QR of the registry URL
  let signaturePng: Uint8Array | undefined
  if (sig.signature_path) {
    const { data: sigBlob } = await admin.storage.from(BUCKET).download(sig.signature_path)
    if (sigBlob) signaturePng = new Uint8Array(await sigBlob.arrayBuffer())
  }
  const appUrl = env('APP_URL') ?? 'https://services.abccorp.com'
  const qrDataUrl = await QRCode.toDataURL(registryUrl(appUrl, letterId), { margin: 1, width: 240 })
  const qrPng = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0))

  const footer = `Signed via Services Hub · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${letterId.slice(0, 8)}`
  const signed = await stamp(pdfBytes, { signaturePng, qrPng, footer })
  const sha = await sha256Hex(signed)
  const path = signedArtifactPath(letterId)

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, signed, { contentType: 'application/pdf', upsert: true })
  if (upErr) return json({ error: `upload failed: ${upErr.message}` }, 500)

  // issue the number + record the signature AS THE CALLER (RPC enforces the gates)
  const { data: ref, error: rpcErr } = await caller.rpc('record_letter_signature', {
    p_letter: letterId, p_sha256: sha, p_signed_path: path, p_qr_path: null,
  })
  if (rpcErr) return json({ error: `sign failed: ${rpcErr.message}` }, 400)

  return json({ ok: true, ref, signed_path: path, sha256: sha })
})
