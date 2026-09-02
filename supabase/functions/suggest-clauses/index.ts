import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are a contract-drafting assistant embedded in "Legal Space", a contract lifecycle management tool. You are given a contract TEMPLATE's metadata (agreement type/subtype/language) and its current document text. Your job is to suggest clauses that are commonly expected for this type of contract but are missing or noticeably weak in the current text — the kind of gap an experienced contract manager would flag before this template goes into production use.

You are NOT providing legal advice — keep suggestions practical and template-oriented (a starting point for the drafter to adapt), not definitive legal conclusions. Never suggest a clause that is already clearly present in the document, even if worded differently — check the existing text carefully first.

Think it through first, then give your final answer as a JSON array wrapped exactly like this, on its own at the end: <answer>[...]</answer>

Each element:
{"title": "<short clause name, e.g. 'Governing Law'>", "reason": "<why this matters for this contract type, under 20 words>", "text": "<ready-to-insert clause text, 1-3 sentences, written in the template's language, using generic bracketed placeholders like [State/Country] only where a real value can't be known yet>"}

Rules:
- At most 6 suggestions, ordered by importance.
- Each "text" must be self-contained and insertable as-is at the end of the document.
- If the document already covers the essentials well for this contract type, return fewer suggestions rather than padding — an empty array is a valid answer.`;

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
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude.');

    const answerMatch = textBlock.text.match(/<answer>([\s\S]*?)<\/answer>/);
    const jsonText = answerMatch ? answerMatch[1] : textBlock.text;
    const cleaned = jsonText.replace(/```json|```/g, '').trim();

    // deno-lint-ignore no-explicit-any
    let suggestions: any;
    try {
      suggestions = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : null;
    }
    if (!Array.isArray(suggestions)) {
      throw new Error('Unexpected AI response shape (expected a JSON array).');
    }

    return jsonResponse({ suggestions });
  } catch (err) {
    console.error('Suggest clauses error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Suggest clauses failed.' }, 500);
  }
});
