import { ANTHROPIC_MODEL, callAnthropic } from './anthropic.ts';

// Claude reads PDFs natively (text and scanned pages), so there is no PDF
// parsing library here - the PDF is sent as a document block and Claude
// returns its text. Costs tokens per call, so callers cap how many PDFs they
// transcribe and skip big ones.

export const MAX_PDF_BYTES_FOR_TEXT = 8 * 1024 * 1024;

// deno-lint-ignore no-explicit-any
type Attachment = Record<string, any>;

export function isPdfAttachment(attachment: Attachment) {
  return attachment?.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment?.name || '');
}

export function pdfDocumentBlock(base64: string) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
}

export async function pdfToText(apiKey: string, base64: string): Promise<string> {
  const data = await callAnthropic(apiKey, {
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    system:
      'You transcribe documents. Return ONLY the full text of the PDF, in reading order, exactly as written. Keep headings and clause numbers. No commentary, no summary, no markdown formatting. If a page is unreadable, skip it.',
    messages: [
      {
        role: 'user',
        content: [pdfDocumentBlock(base64), { type: 'text', text: 'Transcribe this document.' }],
      },
    ],
  });
  const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text');
  return (textBlock?.text || '').replace(/\s+/g, ' ').trim();
}
