import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are a contract-drafting assistant embedded in "Legal Space", a contract lifecycle management tool. You are given ONE clause from a contract template (its title, its text, and the template's type/subtype) and asked for an in-depth review of that single clause — the kind of detailed note an experienced contract manager would leave for the drafter. You are NOT providing legal advice — keep it practical, not a definitive legal conclusion.

LANGUAGE RULE: every field in your answer is commentary FOR THE DRAFTER, not document content — write ALL of it in English, regardless of what language the clause itself is written in.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{
  "summary": "<2-3 sentence plain-English summary of what this clause does and your overall take on it>",
  "score": <integer 1-10>,
  "risk": "low"|"medium"|"high",
  "pros": ["<specific strength of this clause>", ...],
  "cons": ["<specific weakness or gap>", ...],
  "watchFor": ["<a concrete pitfall or edge case to watch for if this clause is used as-is>", ...],
  "improvements": ["<a specific, actionable way to make this clause better>", ...]
}

Keep each array to at most 4 items, each one specific sentence — no filler. "pros" and "watchFor" may be empty arrays if genuinely not applicable, but "cons" and "improvements" should almost always have at least one item unless the clause is already excellent (score >= 9).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clauseTitle, clauseText, metadata } = await req.json();
    if (!clauseTitle && !clauseText) {
      return jsonResponse({ error: 'clauseTitle or clauseText is required.' }, 400);
    }

    const userMessage = `Template metadata (JSON):\n${JSON.stringify(metadata || {})}\n\nClause title: ${clauseTitle || '(untitled)'}\n\nClause text:\n"""\n${clauseText || '(not available)'}\n"""`;

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
      summary: result.summary || '',
      score: Number(result.score) || 0,
      risk: result.risk || 'medium',
      pros: Array.isArray(result.pros) ? result.pros : [],
      cons: Array.isArray(result.cons) ? result.cons : [],
      watchFor: Array.isArray(result.watchFor) ? result.watchFor : [],
      improvements: Array.isArray(result.improvements) ? result.improvements : [],
    });
  } catch (err) {
    console.error('Analyze clause error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Analyze clause failed.' }, 500);
  }
});
