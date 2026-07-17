/**
 * read-letter — server-side AI reading for correspondence capture.
 *
 * The Anthropic API key previously lived in correspondence_settings and was
 * read by every staff browser, which called api.anthropic.com directly. Now
 * the key never reaches a client: this function
 *   1. authenticates the caller (platform-verified JWT) and requires an
 *      active profile,
 *   2. resolves the key server-side — the ANTHROPIC_API_KEY function secret
 *      first, falling back to correspondence_settings via the service role
 *      (that row is no longer client-readable, see migration 00063),
 *   3. runs the vision extraction with the tenant-configured model, and
 *   4. meters usage into ai_usage as the caller.
 *
 * Body: { media_type, data (base64), examples: [{field, extracted, corrected}] }
 * Returns: { fields: ExtractedLetter, usage: { input_tokens, output_tokens } }
 */
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPrompt, mediaBlock, parseExtraction, type FeedbackExample } from './extract.ts'

/** Browser calls require CORS: allow the app origin's preflight + headers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
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

  const { data: profile } = await admin
    .from('profiles').select('is_active').eq('id', user.id).maybeSingle()
  if (!profile?.is_active) return json({ error: 'no active profile' }, 403)

  let body: { media_type?: string; data?: string; examples?: FeedbackExample[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json body' }, 400)
  }
  const { media_type = '', data, examples = [] } = body
  if (!data) return json({ error: 'data (base64 document) is required' }, 400)
  // ~24MB base64 ≈ 18MB raw — well inside the API's request limit
  if (data.length > 24_000_000) return json({ error: 'document too large' }, 413)

  const { data: settings } = await admin
    .from('correspondence_settings').select('key, value')
    .in('key', ['anthropic_api_key', 'ai_model'])
  const conf: Record<string, string> = {}
  for (const r of settings ?? []) conf[r.key] = r.value ?? ''

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || conf['anthropic_api_key']
  if (!apiKey) {
    return json({ error: 'AI reading is not configured — set the ANTHROPIC_API_KEY function secret or the Settings key' }, 501)
  }
  const model = conf['ai_model'] || 'claude-sonnet-5'

  const anthropic = new Anthropic({ apiKey })
  let msg: Anthropic.Message
  try {
    msg = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          mediaBlock(media_type, data) as Anthropic.ContentBlockParam,
          { type: 'text', text: buildPrompt(examples.slice(0, 20)) },
        ],
      }],
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return json({ error: `AI reading failed: ${detail.slice(0, 300)}` }, 502)
  }

  const text = msg.content.find((c) => c.type === 'text')?.text ?? ''
  let fields
  try {
    fields = parseExtraction(text)
  } catch {
    return json({ error: 'the model did not return valid JSON — try again' }, 502)
  }

  await admin.from('ai_usage').insert({
    user_id: user.id,
    model,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
  })

  return json({
    fields,
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
  })
})
