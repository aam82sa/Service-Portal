import nodemailer from 'npm:nodemailer@6.9.14'
import { Buffer } from 'node:buffer'
import type { MailMessage, MailProvider, SendResult } from './types.ts'

/**
 * SMTP provider — nodemailer, STARTTLS on 587. Point the five secrets at the
 * Mailtrap sandbox inbox for all testing (SMTP_HOST=sandbox.smtp.mailtrap.io,
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
      const transporter = nodemailer.createTransport({
        host,
        port: Number(env('SMTP_PORT') ?? '587'),
        secure: false, // 587: plain connect, upgraded via STARTTLS
        requireTLS: true,
        auth: { user, pass },
      })
      try {
        await transporter.sendMail({
          from,
          to: msg.to.join(', '),
          subject: msg.subject,
          html: msg.html,
          attachments: msg.attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content),
            contentType: a.contentType,
          })),
        })
        return { ok: true, provider: 'smtp' }
      } catch (e) {
        return { ok: false, provider: 'smtp', detail: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
