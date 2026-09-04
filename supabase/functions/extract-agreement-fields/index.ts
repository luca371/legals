import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are embedded in "Legal Space", a contract lifecycle management tool. The user just uploaded a real contract document (already signed, or prepared offline) to create an agreement record from it. Your job is to read the document and extract the real values for the record's fields, so the user doesn't have to retype what's already in the document.

You are given: the document's plain text, a list of existing accounts (id + name) in the organization, the allowed agreement type and subtype options, and a list of custom fields (id, label, type, and options for dropdowns) the organization tracks on agreements.

Extract ONLY what the document text actually supports — never invent a value. Leave a field null/empty if the document doesn't clearly state it or nothing reasonable matches.

Field-specific rules:
- "title": a short, human title for this agreement (e.g. "NDA - Acme Corp", "Master Services Agreement with Beta LLC") — derive from the document's own heading/parties if there's no explicit title.
- "accountId": match the counterparty/client company named in the document to ONE of the given existing accounts by name (fuzzy match is fine, e.g. minor punctuation/casing differences) — null if none of the given accounts is a plausible match. Never invent a new account id.
- "agreementType" / "agreementSubtype": pick from the given allowed options only, whichever best fits the document's actual subject matter — null if nothing fits well. subtype should make sense together with the chosen type.
- "language": the language the document's own body text is actually written in (e.g. "English", "Romanian") — judge this from the document text itself.
- "effectiveDate" / "endDate": ISO format YYYY-MM-DD, only if the document states an actual date (not a blank/placeholder) — null otherwise.
- "customFields": an object keyed by the given field ids, with a value for each one you can confidently extract from the document text (matching the field's type — plain text, a number, an ISO date, or one of the field's own dropdown options). Omit a key entirely if you can't find it.

Give your final answer as a JSON object, wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields: {"title": "<string or null>", "accountId": "<string or null>", "agreementType": "<string or null>", "agreementSubtype": "<string or null>", "language": "<string or null>", "effectiveDate": "<string or null>", "endDate": "<string or null>", "customFields": {<fieldId>: <value>, ...}}`;

function parseExtraction(rawText: string) {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const jsonText = answerMatch ? answerMatch[1] : rawText;
  const cleaned = jsonText.replace(/```json|```/g, '').trim();

  // deno-lint-ignore no-explicit-any
  let result: any;
  try {
    result = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        result = JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  if (!result || typeof result !== 'object') {
    console.error('Extract agreement fields: could not parse Claude response. Raw text was:\n', rawText);
    throw new Error('Could not parse the AI response as JSON.');
  }

  return {
    title: result.title || null,
    accountId: result.accountId || null,
    agreementType: result.agreementType || null,
    agreementSubtype: result.agreementSubtype || null,
    language: result.language || null,
    effectiveDate: result.effectiveDate || null,
    endDate: result.endDate || null,
    customFields: result.customFields && typeof result.customFields === 'object' ? result.customFields : {},
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentText, accounts, agreementTypeOptions, agreementSubtypeOptions, customFieldDefs } = await req.json();
    if (!documentText || !String(documentText).trim()) {
      return jsonResponse({ error: 'documentText is required.' }, 400);
    }

    const userMessage = `Existing accounts (JSON array of {id, name}):\n${JSON.stringify(accounts || [])}\n\nAllowed agreement types:\n${JSON.stringify(agreementTypeOptions || [])}\n\nAllowed agreement subtypes:\n${JSON.stringify(agreementSubtypeOptions || [])}\n\nCustom fields (JSON array of {id, label, type, options}):\n${JSON.stringify(customFieldDefs || [])}\n\nDocument text:\n"""\n${String(documentText).slice(0, 20000)}\n"""`;

    const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude.');

    return jsonResponse(parseExtraction(textBlock.text));
  } catch (err) {
    console.error('Extract agreement fields error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Field extraction failed.' }, 500);
  }
});
