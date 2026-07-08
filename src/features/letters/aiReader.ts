/**
 * One vision-LLM call per document (Claude API): returns OCR text (ar/en),
 * structured fields, and a short brief in both languages. Tenant corrections
 * (extraction_feedback) are replayed into the prompt as examples, so
 * accuracy improves with use. Runs in the agent's browser against the
 * tenant-configured API key.
 */

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
  apiKey: string,
  model: string,
  examples: FeedbackExample[]
): Promise<{ fields: ExtractedLetter; usage: AiUsage }> {
  const data = await fileToBase64(file)
  const media =
    file.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: file.type || 'image/png', data } }

  const corrections = examples.length
    ? '\n\nCorrections previously made by this organisation (extracted → correct). Learn from them:\n' +
      examples
        .map((e) => `- ${e.field}: "${e.extracted ?? ''}" → "${e.corrected ?? ''}"`)
        .join('\n')
    : ''

  const prompt =
    'You read official business letters in Arabic and English. From the attached letter return ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:\n' +
    '{"ocr_text": full transcription preserving the original language and line breaks,\n' +
    ' "letter_date": the date written on the letter as YYYY-MM-DD or null (convert Hijri dates to Gregorian when possible),\n' +
    ' "letter_number": the sender\'s reference number or null,\n' +
    ' "sender": issuing organisation/person or null,\n' +
    ' "addressee": who the letter is addressed to or null,\n' +
    ' "subject": one-line subject (in the letter\'s language) or null,\n' +
    ' "brief_ar": summary in Arabic, 2-3 sentences,\n' +
    ' "brief_en": summary in English, 2-3 sentences}' +
    corrections

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: [media, { type: 'text', text: prompt }] }],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`AI reading failed (${res.status}): ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as {
    content: { type: string; text?: string }[]
    usage: AiUsage
  }
  const text = json.content.find((c) => c.type === 'text')?.text ?? ''
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const fields = JSON.parse(cleaned) as ExtractedLetter
  return { fields, usage: json.usage }
}
