// Shared between server/index.js (local dev proxy) and api/ai-builder.js
// (Vercel serverless function). This is the ONLY place that ever sees the
// Anthropic API key — it must never be required from anything under src/,
// since that code ships to the browser.

const ANTHROPIC_MODEL = 'claude-sonnet-4-6'; // best speed/intelligence balance for this task
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are embedded in "Legal Space", a contract lifecycle management tool. You are given the plain text of a contract template and a list of available data fields (each with a human label and a placeholder code). Find every phrase or blank that should be replaced by one of these dynamic fields, and match each one to the best-fitting field.

Two kinds of matches:
1. REAL VALUES already in the text (a date, a name, an address) — "matchText" is that value, exactly as written.
2. BLANK fill-in fields — a label followed by underscores, dots, or empty brackets meant to be handwritten (e.g. "Address: __________"). For these, "matchText" is ONLY the blank run (never the label), and "contextText" is the label right before it, copied exactly — used purely to locate the right blank; it is never removed from the document.

Be GENEROUS with blank fill-in fields — always try to match them, even when the label repeats. Do not skip a field just because its label isn't unique on its own.

When the SAME label repeats under different named sections (e.g. "Name/Company:" appears once under "Disclosing Party:" and again under "Receiving Party:"), extend "contextText" to include that nearest heading so each occurrence is textually distinct, and output ONE suggestion PER occurrence — do not skip either one, and do not merge them. If you genuinely cannot tell which section a field belongs to, output both anyway (same field, different contextText) and let a human choose which to keep.

Example — the document contains:
"Disclosing Party:\\nName/Company: ____________\\n\\nReceiving Party:\\nName/Company: ____________"
The correct output includes BOTH of these (not just one):
{"matchText": "____________", "contextText": "Disclosing Party:\\nName/Company:", "placeholder": "builtin_account.name", "label": "Account Name", "reason": "Disclosing party's company blank"}
{"matchText": "____________", "contextText": "Receiving Party:\\nName/Company:", "placeholder": "builtin_account.name", "label": "Account Name", "reason": "Receiving party's company blank"}

Other rules:
- Never point two suggestions at the exact same span of text (identical matchText AND identical contextText).
- Keep "matchText" short and precise — just the value or blank itself, never a whole sentence around it.
- The document text may run separate paragraphs/headings together with no space between them, depending on how the original document's formatting blocks joined. Copy "matchText" and "contextText" EXACTLY as given, character-for-character — never add a space, newline, or punctuation that "should" be there but isn't actually present.
- Only skip a field when there is truly no reasonable match for it in the document — never skip just because a label repeats or a party's role is ambiguous.

Respond with ONLY a raw JSON array, no markdown code fences, no commentary before or after. Each element:
{"matchText": "<exact verbatim substring — a real value, or a blank underscore/dot run>", "contextText": "<optional, only for blank fill-in fields — the label immediately before the blank, extended with a heading above it if needed for uniqueness>", "placeholder": "<placeholder code from the provided field list>", "label": "<field label from the provided field list>", "reason": "<why, under 12 words>"}

"matchText" and "contextText" must be copied character-for-character from the document text provided — they will be used to locate and replace that exact text programmatically. If nothing in the document warrants a match, respond with an empty array: []`;

async function callClaude({ documentText, fields, apiKey }) {
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY on the server.');
  }

  const userMessage = `Available fields (JSON array of {label, placeholder}):\n${JSON.stringify(fields)}\n\nDocument text:\n"""\n${documentText}\n"""`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      // This is a structured extraction/matching task, not creative
      // writing — temperature 0 makes results far more consistent between
      // runs on the same document, instead of finding a different number
      // of fields each time.
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API error (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((c) => c.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude.');

  const suggestions = parseSuggestions(textBlock.text);
  if (!Array.isArray(suggestions)) {
    throw new Error('Unexpected AI response shape (expected a JSON array).');
  }
  return suggestions;
}

// Claude is instructed to return raw JSON only, but models occasionally add
// a stray sentence before/after it anyway. Strip code fences first, then
// fall back to pulling out the first [...] block if a straight parse fails,
// instead of giving up immediately.
function parseSuggestions(rawText) {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err2) {
        // fall through to the error below
      }
    }
    console.error('AI Builder: could not parse Claude response as JSON. Raw text was:\n', rawText);
    throw new Error('Could not parse the AI response as JSON.');
  }
}

module.exports = { callClaude };