import { supabase } from './supabase';

// supabase.functions.invoke() waits for the whole response, so the draft is
// read with fetch to get it piece by piece. messages: [{ role, content }].
export async function streamDraft({ messages, blocks, onText, signal }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/agent-draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ messages, blocks }),
    signal,
  });

  if (!response.ok) {
    let message = '';
    try {
      message = (await response.json())?.error || '';
    } catch {
      // body wasn't JSON
    }
    throw new Error(message || `The drafting request failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}

// The stream mixes three things, split by tags: free text (the chat reply),
// <document>...</document> (the agreement HTML) and <meta>...</meta> (JSON with
// title, type, parties, dates), plus <error>...</error> if it failed midway.
// Chunks can cut a tag in half, so a possible partial tag is held back until
// the next chunk shows what it is.
const TAGS = ['<document>', '</document>', '<meta>', '</meta>', '<error>', '</error>', '<sources>', '</sources>', '</edit>'];
const MODE_BY_TAG = {
  '<document>': 'doc',
  '<meta>': 'meta',
  '<error>': 'error',
  '<sources>': 'sources',
  '</document>': 'chat',
  '</meta>': 'chat',
  '</error>': 'chat',
  '</sources>': 'chat',
  '</edit>': 'chat',
};

// <sources> is added by the server, not the model: the agreements the agent
// looked at before writing, as JSON [{ id, title, status }].
// <edit op="replace|insert_after|delete" id="N">html</edit> is a change to ONE
// block of the document instead of a rewrite. Its attributes make it longer
// than the fixed tags, so it is recognised separately and reported whole, once
// its closing tag arrives: onEdit({ op, id, html }).
const EDIT_OPEN = /^<edit\s+([^>]*)>/;

function parseEditAttributes(raw) {
  const attrs = {};
  raw.replace(/(\w+)\s*=\s*"?([^"\s>]+)"?/g, (_, name, value) => {
    attrs[name] = value;
    return '';
  });
  return attrs;
}

export function createDraftParser({ onChat, onDocStart, onDocEnd, onDoc, onMeta, onError, onSources, onEdit }) {
  let buffer = '';
  let mode = 'chat';
  let meta = '';
  let error = '';
  let sources = '';
  let editHtml = '';
  let editAttrs = null;

  const emit = (text) => {
    if (!text) return;
    if (mode === 'chat') onChat(text);
    else if (mode === 'doc') onDoc(text);
    else if (mode === 'meta') meta += text;
    else if (mode === 'sources') sources += text;
    else if (mode === 'edit') editHtml += text;
    else error += text;
  };

  const apply = (tag) => {
    const next = MODE_BY_TAG[tag];
    if (tag === '<document>') onDocStart();
    if (tag === '</document>' && onDocEnd) onDocEnd();
    if (tag === '</meta>') {
      try {
        onMeta(JSON.parse(meta.replace(/```json|```/g, '').trim()));
      } catch {
        // an unreadable meta only means "Create agreement" has fewer details
      }
      meta = '';
    }
    if (tag === '</error>') {
      onError(error.trim());
      error = '';
    }
    if (tag === '</edit>') {
      if (editAttrs && onEdit) onEdit({ op: editAttrs.op, id: Number(editAttrs.id), html: editHtml });
      editAttrs = null;
      editHtml = '';
    }
    if (tag === '</sources>') {
      try {
        const parsed = JSON.parse(sources);
        if (Array.isArray(parsed) && onSources) onSources(parsed);
      } catch {
        // the list of sources is only a nicety
      }
      sources = '';
    }
    mode = next;
  };

  const drain = (final) => {
    for (;;) {
      const lt = buffer.indexOf('<');
      if (lt === -1) {
        emit(buffer);
        buffer = '';
        return;
      }
      emit(buffer.slice(0, lt));
      buffer = buffer.slice(lt);
      const tag = TAGS.find((t) => buffer.startsWith(t));
      if (tag) {
        apply(tag);
        buffer = buffer.slice(tag.length);
        continue;
      }
      const editOpen = buffer.match(EDIT_OPEN);
      if (editOpen) {
        editAttrs = parseEditAttributes(editOpen[1]);
        editHtml = '';
        mode = 'edit';
        buffer = buffer.slice(editOpen[0].length);
        continue;
      }
      if (!final && TAGS.some((t) => t.startsWith(buffer))) return; // maybe a tag still arriving
      // an <edit ...> whose attributes have not fully arrived yet
      if (!final && ('<edit'.startsWith(buffer) || (buffer.startsWith('<edit') && !buffer.includes('>') && buffer.length < 120))) return;
      emit('<');
      buffer = buffer.slice(1);
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      drain(false);
    },
    end() {
      drain(true);
      if (mode === 'error' && error.trim()) onError(error.trim());
    },
  };
}
