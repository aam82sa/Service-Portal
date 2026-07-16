/** Mail provider abstraction — smtp (Mailtrap sandbox / any relay) or graph. */

export interface MailAttachment {
  filename: string
  content: Uint8Array
  contentType: string
}

export interface MailMessage {
  to: string[]
  subject: string
  html: string
  attachments?: MailAttachment[]
}

export interface SendResult {
  ok: boolean
  provider: string
  detail?: string
}

export interface MailProvider {
  send(msg: MailMessage): Promise<SendResult>
}
