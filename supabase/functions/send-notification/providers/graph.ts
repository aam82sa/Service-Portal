import type { MailMessage, MailProvider, SendResult } from './types.ts'

/**
 * Microsoft Graph provider — client-credentials flow, sendMail as
 * GRAPH_SENDER. Compiles and keeps the test-auth diagnostic wired, but stays
 * untested until an Entra tenant exists (documented in the PR). Secrets:
 * GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER.
 */

export async function graphToken(env: (k: string) => string | undefined): Promise<{ ok: boolean; detail: string }> {
  const tenant = env('GRAPH_TENANT_ID')
  const id = env('GRAPH_CLIENT_ID')
  const secret = env('GRAPH_CLIENT_SECRET')
  if (!tenant || !id || !secret) {
    return { ok: false, detail: 'GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET not configured' }
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    return { ok: false, detail: `token request failed (${res.status}): ${body.error_description ?? 'no access_token'}` }
  }
  return { ok: true, detail: body.access_token as string }
}

export function graphProvider(env: (k: string) => string | undefined): MailProvider {
  return {
    async send(msg: MailMessage): Promise<SendResult> {
      const token = await graphToken(env)
      if (!token.ok) return { ok: false, provider: 'graph', detail: token.detail }
      const sender = env('GRAPH_SENDER')
      if (!sender) return { ok: false, provider: 'graph', detail: 'GRAPH_SENDER not configured' }
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token.detail}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: msg.subject,
            body: { contentType: 'HTML', content: msg.html },
            toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: false,
        }),
      })
      if (res.status === 202) return { ok: true, provider: 'graph' }
      return { ok: false, provider: 'graph', detail: `sendMail failed (${res.status}): ${await res.text()}` }
    },
  }
}
