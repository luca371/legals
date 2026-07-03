// Shared between server/index.js (local dev proxy) and api/ai-builder.js
// (Vercel serverless function). This is the ONLY place that ever sees the
// Anthropic API key — it must never be required from anything under src/,
// since that code ships to the browser.

const ANTHROPIC_MODEL = 'claude-sonnet-4-6'; // best speed/intelligence balance for this task
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are embedded in "Legal Space", a contract lifecycle management tool. You are given the plain text of a contract template and a list of available data fields (each with a human label and a placeholder code).

Work in two steps, and show your work for both before giving the final answer.

STEP 1 — Enumerate. Read the ENTIRE document text carefully, start to finish, and list out in plain text EVERY single thing that looks like it should be a dynamic value:
- Every blank fill-in field: a label followed by underscores, dots, or empty brackets meant to be handwritten (e.g. "Address: __________", "Name: ......", "Date: [   ]").
- Every real value already written in the text that looks like a placeholder (a bracketed hint like "[Date]", an example name, an example date, an amount, a duration, a governing-law blank, etc.).
Do not skip anything at this stage — not because a label repeats (e.g. the same "Name/Company:" label appearing once under "Disclosing Party:" and again under "Receiving Party:"), and not because you're unsure yet which field it maps to. Go through the whole document top to bottom; a typical contract has many of these, not just one or two.

STEP 2 — Match. For each item from your list, decide if one of the available fields is a good fit. If a label repeats under different named sections, keep BOTH occurrences as separate items in your final answer — extend "contextText" (see format below) to include the nearest heading above each one so they're distinguishable from each other. Never merge them into one, and never drop one just because the other exists.

Then give your final answer as a JSON array, wrapped exactly like this, on its own at the end: <answer>[...]</answer>

Each element of that array:
{"matchText": "<exact verbatim substring — a real value, or a blank underscore/dot run>", "contextText": "<optional, ONLY for blank fill-in fields — the label immediately before the blank, extended with a heading above it if that label alone repeats elsewhere in the document>", "placeholder": "<placeholder code from the provided field list>", "label": "<field label from the provided field list>", "reason": "<why, under 12 words>"}

Rules for the final answer:
- "matchText" is ONLY the blank run itself for fill-in fields (never the label text) — "contextText" holds the label, and it is only used to locate the right blank; it is never removed from the document.
- "matchText" and "contextText" must be copied character-for-character from the document text given, including any missing spaces or line breaks where the original document's separate formatting blocks were joined together in the text you were given. Do not paraphrase or "fix" spacing that looks off.
- Never point two suggestions at the exact same span (identical matchText AND identical contextText).
- Keep "matchText" short — just the value or blank itself, never a surrounding sentence or clause.
- Only leave an item out of the final answer if there is truly no reasonable field for it — never because a label repeats or because you're unsure which named party it belongs to (include both in that case, per STEP 2).

SIGNATURE BLOCKS are a special case. Some of the available fields are e-signature placement tags (their placeholder starts with "docusign."), one set per signer — e.g. docusign.sig1/name1/title1/date1 for the first signer, docusign.sig2/name2/title2/date2 for a second signer if the document has one. When you see a signature block — typically a cluster of blanks labeled things like "Signature:", "Name:", "Title:", "Date:" grouped together for one party — match each blank to the matching docusign.* field for that signer:
- "Signature: ____" -> docusign.sig{n}
- "Name: ____" -> docusign.name{n}
- "Title: ____" -> docusign.title{n}
- "Date: ____" -> docusign.date{n}
If the document has two separate signature blocks (e.g. one per party), use signer 1 for whichever appears FIRST in the document and signer 2 for the second — never mix them up or reuse signer 1's tags for both blocks. If there's only one signature block, only use the signer-1 tags; don't invent a second signer that doesn't exist in the document. These blanks follow the exact same matchText/contextText rules as any other blank field above.

If nothing in the document warrants a match, the final answer is <answer>[]</answer>.`;

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
      // Generous headroom: the STEP 1/STEP 2 reasoning before the final
      // <answer> tag costs tokens, especially on longer contracts with
      // many fields — cutting this too close truncates mid-JSON.
      max_tokens: 8192,
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

// Claude reasons freely (STEP 1/STEP 2) before the final answer, so we
// pull just the <answer>...</answer> block out — far more reliable than
// guessing which square-bracket span in free-form reasoning text is the
// "real" JSON array. Falls back to bracket-matching for robustness in case
// the model ever omits the tags despite instructions.
function parseSuggestions(rawText) {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const jsonText = answerMatch ? answerMatch[1] : rawText;
  const cleaned = jsonText.replace(/```json|```/g, '').trim();

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