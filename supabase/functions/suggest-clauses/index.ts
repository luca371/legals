import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are a contract-drafting assistant embedded in "Legal Space", a contract lifecycle management tool. You are given a contract TEMPLATE's metadata (agreement type/subtype/language) and its current document text. You are NOT providing legal advice — keep everything practical and template-oriented (a starting point for the drafter to adapt), not definitive legal conclusions.

Do TWO things:

TASK 1 — Missing clauses. Suggest clauses that are commonly expected for this type of contract but are missing or noticeably weak in the current text — the kind of gap an experienced contract manager would flag before this template goes into production use. Never suggest a clause that is already clearly present, even if worded differently — check the existing text carefully first. At most 6, ordered by importance. If the document already covers the essentials well, return fewer rather than padding — an empty array is a valid answer.

TASK 2 — Existing clause analysis. Identify every distinct clause/section already in the document (use its heading or number if the document has one, e.g. "3. Confidentiality" — otherwise a short name you assign based on its content). For EACH one, assess:
- score: integer 1-10, how well-drafted and complete it is for this contract type (10 = excellent, no changes needed).
- risk: "low", "medium", or "high" — the risk to the drafting party if this clause is used as-is (ambiguous language, one-sided terms, missing protections, unenforceable-sounding wording, etc. all raise risk).
- assessment: one sentence on what's good or weak about it.
- improvement: one concrete, specific suggestion for how to make it better — or null if it's already solid and score >= 8.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these two fields:
{
  "missingClauses": [{"title": "<short clause name>", "reason": "<why it matters, under 20 words>", "text": "<ready-to-insert clause text, 1-3 sentences, written in the template's language, using generic bracketed placeholders like [State/Country] only where a real value can't be known yet>"}],
  "existingClauses": [{"title": "<clause name/number as it appears>", "score": <1-10>, "risk": "low"|"medium"|"high", "assessment": "<one sentence>", "improvement": "<one sentence or null>"}]
}

If the document has no identifiable clauses yet (e.g. it's empty or just a title), return {"missingClauses": [...], "existingClauses": []}.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentText, metadata } = await req.json();
    if (!metadata?.agreementType) {
      return jsonResponse({ error: 'metadata.agreementType is required.' }, 400);
    }

    const userMessage = `Template metadata (JSON):\n${JSON.stringify(metadata)}\n\nCurrent document text:\n"""\n${documentText || '(empty document)'}\n"""`;

    const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude.');

    const answerMatch = textBlock.text.match(/<answer>([\s\S]*?)<\/answer>/);
    const jsonText = answerMatch ? answerMatch[1] : textBlock.text;
    const cleaned = jsonText.replace(/```json|```/g, '').trim();

    // deno-lint-ignore no-explicit-any
    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }
    if (!result || typeof result !== 'object') {
      throw new Error('Unexpected AI response shape (expected a JSON object).');
    }

    return jsonResponse({
      missingClauses: Array.isArray(result.missingClauses) ? result.missingClauses : [],
      existingClauses: Array.isArray(result.existingClauses) ? result.existingClauses : [],
    });
  } catch (err) {
    console.error('Suggest clauses error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Suggest clauses failed.' }, 500);
  }
});
