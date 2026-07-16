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

/**
 * One vision-LLM prompt per document: OCR text (ar/en), structured fields,
 * and a short brief in both languages. Tenant corrections are replayed as
 * examples so accuracy improves with use. (Ported unchanged from the old
 * browser-side reader — only the execution venue moved server-side.)
 */
export function buildPrompt(examples: FeedbackExample[]): string {
  const corrections = examples.length
    ? '\n\nCorrections previously made by this organisation (extracted → correct). Learn from them:\n' +
      examples
        .map((e) => `- ${e.field}: "${e.extracted ?? ''}" → "${e.corrected ?? ''}"`)
        .join('\n')
    : ''

  return (
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
  )
}

/** The model is told not to fence the JSON, but strip fences defensively. */
export function parseExtraction(text: string): ExtractedLetter {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as ExtractedLetter
}

/** Anthropic content block for the scanned document (PDF or image). */
export function mediaBlock(mediaType: string, data: string): Record<string, unknown> {
  return mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data } }
}
