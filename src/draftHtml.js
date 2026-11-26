// The agreement HTML comes from an AI that read user text and account data,
// so it is never put on the page as-is: only plain document tags survive and
// every attribute is dropped (no scripts, handlers, links, images or styles).
const ALLOWED_TAGS = new Set([
  'H1', 'H2', 'H3', 'P', 'OL', 'UL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'BR',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'DIV', 'SPAN',
]);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE']);

function clean(node) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === 3) return; // text
    if (child.nodeType !== 1) {
      child.remove(); // comments and the like
      return;
    }
    if (DROP_WITH_CONTENT.has(child.tagName)) {
      child.remove();
      return;
    }
    clean(child);
    if (ALLOWED_TAGS.has(child.tagName)) {
      Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
    } else {
      child.replaceWith(...Array.from(child.childNodes)); // keep the text, lose the tag
    }
  });
}

// Half-written HTML is fine here: the parser closes open tags and drops a
// half-typed one, which is exactly what is needed while the text is typing.
export function sanitizeDraftHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

// Adds the blinking caret inside the last element, so it sits at the end of
// the line being typed instead of on a line of its own.
export function withCaret(safeHtml) {
  const doc = new DOMParser().parseFromString(`<body>${safeHtml || ''}</body>`, 'text/html');
  let target = doc.body;
  while (target.lastElementChild && target.lastElementChild.tagName !== 'BR') target = target.lastElementChild;
  const caret = doc.createElement('span');
  caret.className = 'draft__caret';
  target.appendChild(caret);
  return doc.body.innerHTML;
}

// The document as its top-level blocks (one HTML string each), which is how the
// agent addresses it when it edits. Loose text becomes a paragraph.
export function splitBlocks(safeHtml) {
  const doc = new DOMParser().parseFromString(`<body>${safeHtml || ''}</body>`, 'text/html');
  const blocks = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === 1) {
      blocks.push(node.outerHTML);
    } else if (node.nodeType === 3 && node.textContent.trim()) {
      const p = doc.createElement('p');
      p.textContent = node.textContent.trim();
      blocks.push(p.outerHTML);
    }
  });
  return blocks;
}

// Marks a block the agent just wrote so the page can highlight it for a moment.
export function markChanged(safeHtml) {
  const doc = new DOMParser().parseFromString(`<body>${safeHtml || ''}</body>`, 'text/html');
  const first = doc.body.firstElementChild;
  if (first) first.classList.add('draft__changed');
  return doc.body.innerHTML;
}

// Plain text of the document, one line per block (so "NDA" and the paragraph
// after it do not run together) - what the field-filling AI reads.
export function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const lines = [];
  doc.body.childNodes.forEach((node) => {
    const text = (node.textContent || '').replace(/[ \t]+/g, ' ').trim();
    if (text) lines.push(text);
  });
  return lines.join('\n');
}
