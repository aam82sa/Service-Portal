/** Mail provider abstraction — smtp (Mailtrap sandbox / any relay) or graph. */

export interface MailMessage {
  to: string[]
  subject: string
  html: string
}

export interface SendResult {
  ok: boolean
  provider: string
  detail?: string
}

export interface MailProvider {
  send(msg: MailMessage): Promise<SendResult>
}
