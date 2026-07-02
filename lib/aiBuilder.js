// Shared between server/index.js (local dev proxy) and api/ai-builder.js
// (Vercel serverless function). This is the ONLY place that ever sees the
// Anthropic API key — it must never be required from anything under src/,
// since that code ships to the browser.

const ANTHROPIC_MODEL = 'claude-sonnet-4-6'; // best speed/intelligence balance for this task
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are embedded in "Legal Space", a contract lifecycle management tool. You are given the plain text of a contract template and a list of available data fields (each with a human label and a placeholder code). Your job: find phrases in the document that look like they should be replaced by one of these dynamic fields (e.g. a company name, an address, a date, a contract title), and match each one to the single best-fitting field from the list.

Only suggest a match when you are reasonably confident. Skip anything with no good match — do not force matches.

IMPORTANT: never point two different suggestions at the exact same span of text. Each "matchText" value must be used in at most ONE suggestion. If the same value legitimately appears more than once in the document (e.g. a date used in two places), and it should map to two different fields, choose two DIFFERENT, non-overlapping occurrences — include enough surrounding context in "matchText" to make each occurrence unique (e.g. "Effective Date: 01.01.2026" vs "valid until 01.01.2026") rather than reusing the bare value for both.

Respond with ONLY a raw JSON array, no markdown code fences, no commentary before or after. Each element:
{"matchText": "<exact verbatim substring copied from the document>", "placeholder": "<placeholder code from the provided field list>", "label": "<field label from the provided field list>", "reason": "<why, under 12 words>"}

"matchText" MUST be copied character-for-character from the document text provided — it will be used to locate and replace that exact text programmatically, so do not paraphrase, truncate misleadingly, or alter capitalization/punctuation. If nothing in the document warrants a match, respond with an empty array: []`;

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