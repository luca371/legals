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

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeText(text) {
  return text
    .split('\n\n')
    .map((para) => para.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim())
    .join('\n\n');
}

export function computeRedlineHtml(originalHtml, editedHtml) {
  const originalText = normalizeText(paragraphsToText(htmlToParagraphs(originalHtml)));
  const editedText = normalizeText(paragraphsToText(htmlToParagraphs(editedHtml)));
  const tokens = diffTokens(tokenize(originalText), tokenize(editedText));

  let changeCounter = 0;
  const paragraphsHtml = [];
  let currentParagraph = [];

  const flushParagraph = () => {
    paragraphsHtml.push(`<p>${currentParagraph.join('')}</p>`);
    currentParagraph = [];
  };

  const pushEqualText = (text) => {
    const parts = text.split('\n\n');
    parts.forEach((part, idx) => {
      if (part.trim()) currentParagraph.push(escapeHtml(part.replace(/\n/g, ' ')));
      if (idx < parts.length - 1) flushParagraph();
    });
  };

  const pushChange = (type, text) => {
    const clean = text.replace(/\n\n/g, ' ').replace(/\n/g, ' ').trim();
    if (!clean) return;
    changeCounter++;
    const id = `chg-${changeCounter}`;
    const safe = escapeHtml(clean);
    const tag = type === 'insert' ? 'ins' : 'del';
    const tagStyle =
      type === 'insert'
        ? 'text-decoration: underline; background: #e3f6ea; color: #1a7a41;'
        : 'text-decoration: line-through; background: #fde8e8; color: #b42318;';
    currentParagraph.push(
      `<span class="redline-change" data-change-id="${id}" data-type="${type === 'insert' ? 'ins' : 'del'}" data-decision="pending" style="display:inline;">` +
        `<${tag} style="${tagStyle}">${safe}</${tag}>` +
        `<span contenteditable="false" style="display:inline-flex;gap:2px;margin:0 2px;vertical-align:middle;">` +
        `<button type="button" class="redline-btn redline-accept" data-change-id="${id}" style="cursor:pointer;border:1px solid #1a7a41;background:#fff;color:#1a7a41;border-radius:4px;font-size:10px;line-height:1;padding:1px 4px;">✓</button>` +
        `<button type="button" class="redline-btn redline-reject" data-change-id="${id}" style="cursor:pointer;border:1px solid #b42318;background:#fff;color:#b42318;border-radius:4px;font-size:10px;line-height:1;padding:1px 4px;">✕</button>` +
        `</span></span>`
    );
  };

  tokens.forEach((tok) => {
    if (tok.type === 'equal') pushEqualText(tok.text);
    else if (tok.type === 'insert') pushChange('insert', tok.text);
    else if (tok.type === 'delete') pushChange('delete', tok.text);
  });
  flushParagraph();

  return paragraphsHtml.filter((p) => p !== '<p></p>').join('\n');
}

export function finalizeRedlineHtml(containerEl) {
  const clone = containerEl.cloneNode(true);
  clone.querySelectorAll('.redline-change').forEach((el) => {
    const type = el.getAttribute('data-type');
    const decision = el.getAttribute('data-decision') || 'pending';
    const textEl = el.querySelector('ins, del');
    const text = textEl ? textEl.textContent : '';
    let keepText = '';
    if (type === 'ins') {
      keepText = decision === 'accepted' ? text : '';
    } else {
      keepText = decision === 'accepted' ? '' : text;
    }
    el.replaceWith(document.createTextNode(keepText));
  });
  return clone.innerHTML;
}

export function countPendingChanges(containerEl) {
  if (!containerEl) return 0;
  const all = containerEl.querySelectorAll('.redline-change');
  let pending = 0;
  all.forEach((el) => {
    if ((el.getAttribute('data-decision') || 'pending') === 'pending') pending++;
  });
  return pending;
}