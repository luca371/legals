import DOMPurify from 'dompurify';

// Contract HTML can come from outside the app (an uploaded .docx, a reviewer's
// edits, an AI), so it is cleaned before it is put on any page. Formatting
// survives (tables, inline styles, classes, embedded images); scripts, event
// handlers, forms, frames and javascript: links do not.
const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base'],
  ALLOW_DATA_ATTR: true,
};

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  // Links inside a contract open in a new tab and cannot reach back to the app.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function sanitizeDocumentHtml(html) {
  if (!html) return '';
  ensureHooks();
  return DOMPurify.sanitize(String(html), CONFIG);
}
