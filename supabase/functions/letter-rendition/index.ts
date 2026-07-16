/**
 * letter-rendition — server-side DLP for correspondence scans.
 *
 * The browser never receives the raw object unless the caller is the letter
 * owner: the storage read policy (00062) is owner-only, and everyone else
 * gets the document through this function, which
 *   1. authenticates the caller (platform-verified JWT),
 *   2. checks can_access_letter() as the caller (RLS-aware),
 *   3. fetches the raw scan with the service role,
 *   4. burns the per-viewer stamp into a PDF rendition (pdf-lib) — unlike
 *      the old client overlay there is no clean byte stream underneath, and
 *   5. writes the viewed/view_clear audit event as the caller.
 *
 * Clear (unstamped) copies are produced only for the letter owner and only
 * while correspondence_settings.allow_owner_clear_view = 'true'.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { kindOf, stampedRendition } from './watermark.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, service)

  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'not signed in' }, 401)
  const user = userData.user

  let body: { letter_id?: string; path?: string; clear?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json body' }, 400)
  }
  const { letter_id, path, clear = false } = body
  if (!letter_id || !path) return json({ error: 'letter_id and path are required' }, 400)
  if (!path.startsWith(`${letter_id}/`)) return json({ error: 'path does not belong to the letter' }, 400)

  const { data: canAccess, error: accessErr } = await caller.rpc('can_access_letter', { l: letter_id })
  if (accessErr || !canAccess) return json({ error: 'no access to this letter' }, 403)

  const { data: letter, error: letterErr } = await caller
    .from('letters')
    .select('id, ref_ours, ref_theirs, confidentiality, owner_id')
    .eq('id', letter_id)
    .single()
  if (letterErr || !letter) return json({ error: 'letter not found' }, 404)

  if (clear) {
    if (letter.owner_id !== user.id) return json({ error: 'clear copies are owner-only' }, 403)
    const { data: s } = await admin
      .from('correspondence_settings')
      .select('value')
      .eq('key', 'allow_owner_clear_view')
      .maybeSingle()
    if (s?.value !== 'true') return json({ error: 'clear view is disabled for this tenant' }, 403)
  }

  const { data: fileRow } = await admin
    .from('letter_files')
    .select('filename, mime')
    .eq('letter_id', letter_id)
    .eq('path', path)
    .maybeSingle()
  if (!fileRow) return json({ error: 'file is not registered on this letter' }, 404)

  const kind = kindOf(fileRow.filename, fileRow.mime)
  if (!kind) return json({ error: 'unsupported file type for rendition' }, 415)

  const { data: blob, error: dlErr } = await admin.storage.from('letters').download(path)
  if (dlErr || !blob) return json({ error: dlErr?.message ?? 'download failed' }, 500)
  const bytes = new Uint8Array(await blob.arrayBuffer())

  const name = (user.user_metadata?.full_name as string | undefined) || user.email || user.id
  const ref = letter.ref_ours ?? letter.ref_theirs ?? String(letter.id).slice(0, 8)
  const stamp = `${name} · ${user.id.slice(0, 8)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${ref} · ${String(letter.confidentiality).toUpperCase()}`

  let out: Uint8Array
  let type: string
  if (clear) {
    out = bytes
    type = blob.type || 'application/octet-stream'
  } else {
    out = await stampedRendition(bytes, kind, stamp)
    type = 'application/pdf'
  }

  await caller.rpc('log_letter_event', {
    p_letter: letter_id,
    p_type: clear ? 'view_clear' : 'viewed',
    p_detail: { file: fileRow.filename, rendition: clear ? 'clear' : 'stamped' },
  })

  return new Response(out, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'no-store' },
  })
})
