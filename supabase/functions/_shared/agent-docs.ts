import mammoth from 'npm:mammoth@1.8.0';
import { MAX_PDF_BYTES_FOR_TEXT, isPdfAttachment, pdfToText } from './pdf.ts';

// Helpers shared by the agents that read agreement documents. The account
// brief agent still carries its own copy of these - it was left as-is.

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export const MAX_PDFS_PER_AGREEMENT = 3;

export function stripHtml(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Generated contracts keep their text in attachment.sourceHtml; uploaded Word
// files are base64 (mammoth); PDFs are transcribed by Claude, which costs
// tokens, so callers decide with allowPdf.
export async function attachmentText(attachment: Row, allowPdf: boolean): Promise<string> {
  if (!attachment) return '';
  if (attachment.sourceHtml) return stripHtml(String(attachment.sourceHtml));
  if (attachment.dataBase64 && isPdfAttachment(attachment)) {
    if (!allowPdf || (attachment.size ?? 0) > MAX_PDF_BYTES_FOR_TEXT) return '';
    try {
      return await pdfToText(Deno.env.get('ANTHROPIC_API_KEY') ?? '', attachment.dataBase64);
    } catch (err) {
      console.error('PDF transcription failed:', err);
      return '';
    }
  }
  if (attachment.dataBase64) {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: base64ToArrayBuffer(attachment.dataBase64) });
      return (result.value || '').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
  return '';
}

// All the readable text of one agreement row (body plus attachments), with
// the character budget shared between documents.
export async function readAgreementDocuments(
  data: Row,
  maxChars: number,
  allowPdf = true
): Promise<{ documents: { name: string; text: string; truncated: boolean }[]; unreadable: number }> {
  const documents: { name: string; text: string }[] = [];
  const bodyText = stripHtml(data.content_html || '');
  if (bodyText) documents.push({ name: 'Agreement body', text: bodyText });

  let pdfsRead = 0;
  for (const att of data.attachments || []) {
    const isPdf = isPdfAttachment(att);
    const text = await attachmentText(att, !isPdf || (allowPdf && pdfsRead < MAX_PDFS_PER_AGREEMENT));
    if (isPdf && text) pdfsRead++;
    if (text) documents.push({ name: String(att.name || 'Attachment'), text });
  }

  const perDoc = Math.floor(maxChars / Math.max(1, documents.length));
  return {
    documents: documents.map((d) => ({ name: d.name, text: d.text.slice(0, perDoc), truncated: d.text.length > perDoc })),
    unreadable: Math.max(0, (data.attachments || []).length - (documents.length - (bodyText ? 1 : 0))),
  };
}

export function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function parseAnswerJson(rawText: string, label: string): Row {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const cleaned = (answerMatch ? answerMatch[1] : rawText).replace(/```json|```/g, '').trim();

  let parsed: Row | undefined;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    console.error(`${label}: could not parse Claude response. Raw text was:\n`, rawText);
    throw new Error('Could not parse the AI response as JSON.');
  }
  return parsed;
}
