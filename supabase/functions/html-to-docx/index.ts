import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { htmlToRealDocx } from '../_shared/sf-files.ts';

// Turns agreement HTML into a regular .docx. The in-browser generator
// (html-docx-js) wraps the HTML in a Word "altChunk" that Word renders but
// Pages, Google Docs, Preview and Salesforce show as an empty/garbled file.
const MAX_HTML_CHARS = 3_000_000;

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireUser(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);

  try {
    const { html } = await req.json();
    if (typeof html !== 'string' || !html.trim()) return jsonResponse({ error: 'html is required.' }, 400);
    if (html.length > MAX_HTML_CHARS) return jsonResponse({ error: 'Document is too large to convert.' }, 413);

    const bytes = await htmlToRealDocx(html);
    if (!bytes) return jsonResponse({ error: 'Could not convert the document.' }, 500);
    return jsonResponse({ dataBase64: toBase64(bytes) });
  } catch (err) {
    console.error('HTML to DOCX error:', err);
    return jsonResponse({ error: 'Conversion failed.' }, 500);
  }
});
