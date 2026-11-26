// Applying the agent's edits to the document on the page.
//
// The page sends the agent its document as numbered blocks (1, 2, 3 ...). The
// agent answers with edits that point at those numbers: replace a block, add
// blocks after one (0 = at the very start) or delete one. Nothing else in the
// document is touched. Edits arrive one at a time while the answer streams, so
// the plan below only grows; the visible document is rebuilt from it each time.
//
// A block is { key, html }. Blocks the agent wrote get a fresh key, which is
// how the screen knows which ones to type out and highlight.

export function newEditState(baseBlocks) {
  return {
    base: baseBlocks, // html of every original block, in order (ids are index + 1)
    replaced: new Map(), // id -> [{ key, html }]
    deleted: new Set(), // ids
    inserts: new Map(), // id -> [{ key, html }] added after that id (0 = start)
    typed: new Map(), // key -> how many characters have been typed so far
    counter: 0,
  };
}

// Returns false when the edit points at a block that does not exist or has an
// unknown op, so a confused answer cannot damage the document.
export function registerEdit(state, { op, id, blocks }) {
  if (!Number.isInteger(id) || id < 0 || id > state.base.length) return false;
  const fresh = blocks.map((html) => ({ key: `n${++state.counter}`, html }));

  if (op === 'delete') {
    if (id === 0) return false;
    state.deleted.add(id);
    return true;
  }
  if (op === 'replace') {
    if (id === 0) return false;
    state.replaced.set(id, fresh); // a second replace of the same block wins
    return true;
  }
  if (op === 'insert_after') {
    state.inserts.set(id, [...(state.inserts.get(id) || []), ...fresh]);
    return true;
  }
  return false;
}

// The document as a list of { key, html, isNew } in reading order.
export function buildBlocks(state) {
  const out = [];
  const pushNew = (list) => list.forEach((b) => out.push({ key: b.key, html: b.html, isNew: true }));

  pushNew(state.inserts.get(0) || []);
  state.base.forEach((html, index) => {
    const id = index + 1;
    if (state.deleted.has(id)) {
      // gone
    } else if (state.replaced.has(id)) {
      pushNew(state.replaced.get(id));
    } else {
      out.push({ key: `o${id}`, html, isNew: false });
    }
    pushNew(state.inserts.get(id) || []);
  });
  return out;
}

// The first new block that is not fully typed yet, or null.
export function nextToType(state, blocks = buildBlocks(state)) {
  return blocks.find((b) => b.isNew && (state.typed.get(b.key) ?? 0) < b.html.length) || null;
}

export function typeMore(state, block) {
  const typed = state.typed.get(block.key) ?? 0;
  const remaining = block.html.length - typed;
  state.typed.set(block.key, Math.min(block.html.length, typed + Math.max(2, Math.ceil(remaining / 35))));
}
