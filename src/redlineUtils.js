export function htmlToParagraphs(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const topLevel = Array.from(div.children).filter((el) =>
    /^(P|LI|H1|H2|H3|H4|H5|H6|DIV)$/.test(el.tagName)
  );
  const source = topLevel.length > 0 ? topLevel : Array.from(div.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, div'));
  if (source.length === 0) {
    const text = div.textContent.trim();
    return text ? [text] : [];
  }
  return source.map((el) => el.textContent.trim()).filter(Boolean);
}

export function paragraphsToText(paragraphs) {
  return paragraphs.join('\n\n');
}

function tokenize(text) {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

function diffTokens(a, b) {
  const n = a.length;
  const m = b.length;

  if (n > 3000 || m > 3000) {
    const result = [];
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      if (a[i] === b[i]) {
        result.push({ type: 'equal', text: a[i] });
      } else {
        if (a[i] !== undefined) result.push({ type: 'delete', text: a[i] });
        if (b[i] !== undefined) result.push({ type: 'insert', text: b[i] });
      }
    }
    return mergeTokens(result);
  }

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'delete', text: a[i] });
      i++;
    } else {
      result.push({ type: 'insert', text: b[j] });
      j++;
    }
  }
  while (i < n) { result.push({ type: 'delete', text: a[i] }); i++; }
  while (j < m) { result.push({ type: 'insert', text: b[j] }); j++; }

  return mergeTokens(result);
}

function mergeTokens(tokens) {
  const merged = [];
  for (const tok of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === tok.type) {
      last.text += tok.text;
    } else {
      merged.push({ ...tok });
    }
  }
  return merged;
}

export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeText(text) {
  return text
    .split('\n\n')
    .map((para) => para.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim())
    .join('\n\n');
}

// Computes the diff as a flat, ordered list of tokens — the single source
// of truth for a review's changes. Every non-equal token gets a stable id;
// nothing here touches the DOM, so it's safe to run anywhere (including
// once, up front, in the reviewer's browser at submit time) and to persist
// as plain JSON.
export function computeChangeTokens(originalHtml, editedHtml) {
  const originalText = normalizeText(paragraphsToText(htmlToParagraphs(originalHtml)));
  const editedText = normalizeText(paragraphsToText(htmlToParagraphs(editedHtml)));
  const tokens = diffTokens(tokenize(originalText), tokenize(editedText));

  let counter = 0;
  return tokens.map((tok) => {
    const clean = tok.text;
    if (tok.type === 'equal') return { type: 'equal', text: clean };
    counter += 1;
    return { type: tok.type, text: clean, id: `chg-${counter}` };
  });
}

export function listChangeIds(tokens) {
  return (tokens || []).filter((t) => t.type !== 'equal').map((t) => t.id);
}

// Walks tokens paragraph-by-paragraph (splitting on the \n\n paragraph
// markers preserved inside token text) and hands each piece to `emit`,
// which decides what HTML (if any) to contribute for it. Both the display
// renderer and the final-document builder are just different `emit`
// implementations over the exact same token stream, so they can never
// disagree with each other.
function buildParagraphs(tokens, emit) {
  const paragraphsHtml = [];
  let current = [];

  const flush = () => {
    paragraphsHtml.push(`<p>${current.join('')}</p>`);
    current = [];
  };

  tokens.forEach((tok) => {
    const parts = tok.text.split('\n\n');
    parts.forEach((part, idx) => {
      const html = emit(tok, part);
      if (html) current.push(html);
      if (idx < parts.length - 1) flush();
    });
  });
  flush();

  return paragraphsHtml.filter((p) => p !== '<p></p>').join('\n');
}

// Display HTML: every change is a <span data-change-id> wrapping an
// <ins>/<del> — styling is driven entirely by CSS classes derived from
// `decisions`, and there is no embedded button markup to keep in sync
// with anything.
export function renderChangeTokensToHtml(tokens, decisions = {}, currentId = null) {
  return buildParagraphs(tokens, (tok, part) => {
    if (tok.type === 'equal') {
      const text = part.replace(/\n/g, ' ');
      return text.trim() ? escapeHtml(text) : '';
    }
    const clean = part.replace(/\n/g, ' ').trim();
    if (!clean) return '';
    const decision = decisions[tok.id] || 'pending';
    const tag = tok.type === 'insert' ? 'ins' : 'del';
    const classes = [
      'redline-change',
      `redline-change--${tok.type}`,
      `redline-change--${decision}`,
      tok.id === currentId ? 'redline-change--current' : '',
    ].filter(Boolean).join(' ');
    return `<span class="${classes}" data-change-id="${tok.id}"><${tag}>${escapeHtml(clean)}</${tag}></span>`;
  });
}

// Final document HTML: accepted insertions and rejected deletions keep
// their text; everything else is dropped. Pure function of tokens +
// decisions — no DOM involved, so there's nothing to lose across renders.
export function buildFinalHtmlFromTokens(tokens, decisions = {}) {
  return buildParagraphs(tokens, (tok, part) => {
    if (tok.type === 'equal') {
      const text = part.replace(/\n/g, ' ');
      return text.trim() ? escapeHtml(text) : '';
    }
    const clean = part.replace(/\n/g, ' ').trim();
    if (!clean) return '';
    const decision = decisions[tok.id] || 'pending';
    const keep = tok.type === 'insert' ? decision === 'accepted' : decision !== 'accepted';
    return keep ? escapeHtml(clean) : '';
  });
}
