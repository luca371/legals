import HTMLtoDOCX from 'npm:html-to-docx@1.8.0';
import JSZip from 'npm:jszip@3';
import { linkFileToRecord, sfQuery, sfRequest } from './salesforce.ts';

// Pushes one agreement attachment to Salesforce Files. The file lives on the
// agreement's Account and, when the agreement has a Salesforce Contract, is
// linked to the Contract too. The first push creates the file; later pushes add
// a new version of the same ContentDocument (no duplicates), and only when the
// document actually changed (SHA-256 fingerprint).

export const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const MAX_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html',
};

export type SfFileEntry = {
  contentDocumentId: string;
  contentVersionId: string;
  syncedAt: string;
  fingerprint?: string;
};

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Documents generated in the app are built with html-docx-js, which wraps the
// HTML in a Word "altChunk". Word renders that, but Salesforce's file preview
// (and most other viewers) show the raw MIME text instead. So when we still have
// the source HTML we rebuild a regular .docx from it for Salesforce. If the
// conversion fails for any reason, the original file is sent unchanged.
// Bump when the output format changes: it forces already-sent files to be
// re-sent once as a new version.
const CONVERTER_VERSION = 'docx-v5';
const DOC_FONT = 'Arial';

// The library leaves paragraphs glued together, ships no default paragraph
// style (Pages then ignores the spacing and theme fonts and falls back to
// Times), and keeps whatever tiny font-size the template author pasted in.
// Polish it so it reads the same in Word, Pages, Preview and Salesforce:
//   - a real "Normal" style carrying font, size, line and paragraph spacing
//   - the font set directly on every run
//   - paragraph spacing on every paragraph, including ones with no spacing tag
//   - run sizes under 8pt dropped (a 5pt paragraph is a pasting accident, not intent)
const MIN_RUN_HALF_POINTS = 16;

async function polishDocx(raw: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(raw);
  const fonts = `<w:rFonts w:ascii="${DOC_FONT}" w:hAnsi="${DOC_FONT}" w:eastAsia="${DOC_FONT}" w:cs="${DOC_FONT}"/>`;

  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    let styles = (await stylesFile.async('string')).replace(/<w:rFonts [^>]*\/>/g, fonts);
    if (!/<w:style [^>]*w:default="1"[^>]*w:type="paragraph"|<w:style [^>]*w:type="paragraph"[^>]*w:default="1"/.test(styles)) {
      const normal =
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:spacing w:after="160" w:line="312" w:lineRule="auto"/></w:pPr>' +
        `<w:rPr>${fonts}<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>`;
      styles = styles.includes('</w:docDefaults>')
        ? styles.replace('</w:docDefaults>', `</w:docDefaults>${normal}`)
        : styles.replace(/(<w:styles[^>]*>)/, `$1${normal}`);
    }
    zip.file('word/styles.xml', styles);
  }

  const docFile = zip.file('word/document.xml');
  if (docFile) {
    const doc = (await docFile.async('string'))
      .replace(/<w:spacing (?![^>]*w:after)([^>]*)\/>/g, '<w:spacing $1 w:after="160"/>')
      .replace(/<w:rPr\s*\/>/g, `<w:rPr>${fonts}</w:rPr>`)
      .replace(/<w:rPr>(?!\s*<w:rFonts)/g, `<w:rPr>${fonts}`)
      .replace(/<w:sz(?:Cs)? w:val="(\d+)"\s*\/>/g, (tag, size) => (Number(size) < MIN_RUN_HALF_POINTS ? '' : tag))
      // The library writes header/footer/gutter="undefined" (not a number) and puts the
      // section properties before the content. Word forgives both; strict readers
      // (DocuSign's PDF converter) reject the file.
      .replace(/w:(header|footer)="undefined"/g, 'w:$1="708"')
      .replace(/w:gutter="undefined"/g, 'w:gutter="0"');
    const sect = doc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    const fixed = sect && doc.indexOf(sect[0]) < doc.indexOf('<w:p')
      ? doc.replace(sect[0], '').replace('</w:body>', `${sect[0]}</w:body>`)
      : doc;
    zip.file('word/document.xml', fixed);
  }
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function htmlToRealDocx(html: string): Promise<Uint8Array | null> {
  try {
    // Line spacing is the one paragraph property the library reads from CSS.
    const spaced = html
      .replace(/<p(?![^>]*\bstyle=)([^>]*)>/gi, '<p$1 style="line-height: 1.3;">')
      .replace(/<li(?![^>]*\bstyle=)([^>]*)>/gi, '<li$1 style="line-height: 1.3;">');
    const doc = /<html[\s>]/i.test(spaced)
      ? spaced
      : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${spaced}</body></html>`;
    const out = await HTMLtoDOCX(doc, null, {
      font: DOC_FONT,
      fontSize: 21,
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      footer: false,
      header: false,
      pageNumber: false,
    });
    const raw = out instanceof Blob
      ? new Uint8Array(await out.arrayBuffer())
      : out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
    try {
      return await polishDocx(raw);
    } catch (err) {
      console.warn('DOCX polish failed, using the plain conversion:', err);
      return raw;
    }
  } catch (err) {
    console.warn('HTML to DOCX conversion failed, sending the original file:', err);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export async function attachmentToFile(attachment: any, fallbackTitle: string) {
  const encoder = new TextEncoder();

  if (attachment?.dataBase64) {
    const name: string = attachment.name || `${fallbackTitle}.docx`;
    const ext = (name.split('.').pop() || 'docx').toLowerCase();
    const original = base64ToBytes(attachment.dataBase64);
    if (ext === 'docx' && attachment.sourceHtml) {
      const converted = await htmlToRealDocx(attachment.sourceHtml);
      if (converted) {
        return {
          name,
          bytes: converted,
          mime: MIME_BY_EXT.docx,
          // Fingerprint the source, not the output: the converter stamps dates, so its bytes differ on every run.
          fingerprintSource: encoder.encode(`${CONVERTER_VERSION}\n${attachment.sourceHtml}`),
        };
      }
    }
    return { name, bytes: original, mime: attachment.mimeType || MIME_BY_EXT[ext] || 'application/octet-stream', fingerprintSource: original };
  }

  if (attachment?.sourceHtml) {
    const base = (attachment.name || fallbackTitle).replace(/\.[a-z0-9]+$/i, '');
    const converted = await htmlToRealDocx(attachment.sourceHtml);
    if (converted) {
      return {
        name: `${base}.docx`,
        bytes: converted,
        mime: MIME_BY_EXT.docx,
        fingerprintSource: encoder.encode(`${CONVERTER_VERSION}\n${attachment.sourceHtml}`),
      };
    }
    const bytes = encoder.encode(attachment.sourceHtml);
    return { name: `${base}.html`, bytes, mime: 'text/html', fingerprintSource: bytes };
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function pushAttachmentToSalesforce({
  tenantId,
  accountSfId,
  contractSfId,
  attachment,
  existing,
  fallbackTitle,
}: {
  tenantId: string;
  accountSfId: string;
  contractSfId?: string | null;
  // deno-lint-ignore no-explicit-any
  attachment: any;
  existing?: SfFileEntry;
  fallbackTitle: string;
}): Promise<{ entry: SfFileEntry; outcome: 'created' | 'new_version' | 'unchanged' }> {
  const file = await attachmentToFile(attachment, fallbackTitle);
  if (!file) throw new Error('This attachment has no document content.');
  if (file.bytes.length > MAX_BYTES) throw new Error(`"${file.name}" is larger than 25 MB.`);

  const hasExisting = !!(existing?.contentDocumentId && SF_ID.test(existing.contentDocumentId));
  const fingerprint = await sha256Hex(file.fingerprintSource);
  const withContractLink = async (contentDocumentId: string) => {
    if (contractSfId && SF_ID.test(contractSfId)) await linkFileToRecord(tenantId, contentDocumentId, contractSfId);
  };

  if (hasExisting && existing!.fingerprint === fingerprint) {
    await withContractLink(existing!.contentDocumentId);
    return { entry: existing!, outcome: 'unchanged' };
  }

  const entity: Record<string, string> = { Title: file.name.replace(/\.[a-z0-9]+$/i, ''), PathOnClient: file.name };
  if (hasExisting) entity.ContentDocumentId = existing!.contentDocumentId;
  else entity.FirstPublishLocationId = accountSfId;

  // Built by hand: Salesforce wants entity_content as a JSON part WITHOUT a
  // filename, and FormData would tag a Blob part with filename="blob", which
  // Salesforce then counts as a second binary part.
  const boundary = `----legals${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="entity_content"\r\nContent-Type: application/json\r\n\r\n` +
      `${JSON.stringify(entity)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="VersionData"; filename="upload"\r\nContent-Type: ${file.mime}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);

  const created = await sfRequest(tenantId, '/sobjects/ContentVersion', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (!created?.success || !SF_ID.test(created.id)) throw new Error('Salesforce did not confirm the file upload.');

  const lookup = await sfQuery(tenantId, `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${created.id}'`);
  const contentDocumentId: string | undefined = lookup.records?.[0]?.ContentDocumentId;
  if (!contentDocumentId) throw new Error('Could not resolve the Salesforce file id.');

  await withContractLink(contentDocumentId);

  return {
    entry: { contentDocumentId, contentVersionId: created.id, syncedAt: new Date().toISOString(), fingerprint },
    outcome: hasExisting ? 'new_version' : 'created',
  };
}
