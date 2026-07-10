import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.1/mod.ts'
import type { MailMessage, MailProvider, SendResult } from './types.ts'

/**
 * SMTP provider — STARTTLS on 587. Point the five secrets at the Mailtrap
 * sandbox inbox for all testing (SMTP_HOST=sandbox.smtp.mailtrap.io,
 * SMTP_PORT=587, SMTP_USER/SMTP_PASS from the inbox settings, SMTP_FROM any
 * address). No card required on the free tier.
 */
export function smtpProvider(env: (k: string) => string | undefined): MailProvider {
  return {
    async send(msg: MailMessage): Promise<SendResult> {
      const host = env('SMTP_HOST')
      const user = env('SMTP_USER')
      const pass = env('SMTP_PASS')
      const from = env('SMTP_FROM')
      if (!host || !user || !pass || !from) {
        return { ok: false, provider: 'smtp', detail: 'SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM not configured' }
      }
      const client = new SMTPClient({
        connection: {
          hostname: host,
          port: Number(env('SMTP_PORT') ?? '587'),
          tls: false, // 587 = plain connect, denomailer upgrades via STARTTLS
          auth: { username: user, password: pass },
        },
      })
      try {
        await client.send({
          from,
          to: msg.to,
          subject: msg.subject,
          content: 'auto',
          html: msg.html,
        })
        return { ok: true, provider: 'smtp' }
      } catch (e) {
        return { ok: false, provider: 'smtp', detail: e instanceof Error ? e.message : String(e) }
      } finally {
        try { await client.close() } catch { /* already closed */ }
      }
    },
  }
}
