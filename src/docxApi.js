import htmlDocx from 'html-docx-js/dist/html-docx';
import { invokeFunction } from './functionsClient';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// Builds a .docx from HTML on the server (regular paragraphs that open
// everywhere). If the server is unreachable it falls back to the in-browser
// generator, whose files only render in Word, so a document is never lost.
export async function htmlToDocxBlob(html) {
  try {
    const { dataBase64 } = await invokeFunction('html-to-docx', { html });
    return base64ToBlob(dataBase64, DOCX_MIME);
  } catch (err) {
    console.warn('Server DOCX conversion failed, using the in-browser generator:', err);
    return htmlDocx.asBlob(html);
  }
}
