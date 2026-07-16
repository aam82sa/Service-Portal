/**
 * AI letter reading, via the read-letter edge function. The Anthropic API
 * key never reaches the browser: the function authenticates the caller,
 * resolves the key server-side (function secret, falling back to the
 * admin-only settings row), runs the vision extraction with the tenant's
 * configured model, and meters usage into ai_usage.
 */
import { supabase } from '../../lib/supabase'

export interface ExtractedLetter {
  ocr_text: string
  letter_date: string | null
  letter_number: string | null
  sender: string | null
  addressee: string | null
  subject: string | null
  brief_ar: string | null
  brief_en: string | null
}

export interface FeedbackExample {
  field: string
  extracted: string | null
  corrected: string | null
}

export interface AiUsage {
  input_tokens: number
  output_tokens: number
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })

export async function readLetter(
  file: File,
  examples: FeedbackExample[]
): Promise<{ fields: ExtractedLetter; usage: AiUsage }> {
  const data = await fileToBase64(file)
  const { data: res, error } = await supabase.functions.invoke('read-letter', {
    body: { media_type: file.type, data, examples },
  })
  if (error) throw new Error(`AI reading failed: ${error.message}`)
  const out = res as { fields?: ExtractedLetter; usage?: AiUsage; error?: string }
  if (out.error || !out.fields || !out.usage) throw new Error(out.error ?? 'AI reading failed')
  return { fields: out.fields, usage: out.usage }
}
