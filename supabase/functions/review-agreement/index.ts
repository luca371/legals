import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are the senior contract-quality reviewer embedded in "Legal Space", a contract lifecycle management tool — the kind of review an experienced contract manager (not a lawyer) gives before a contract goes out: thorough, specific, and genuinely useful, not a generic checklist. You are given an agreement's metadata and the text of its attached document(s).

You are NOT providing legal advice, and you should not present your output as such — keep everything at the level of "an experienced contract manager would flag this," not a definitive legal conclusion. If the document text is missing, empty, or clearly not a real contract, say so plainly in "summary", give a low overallScore, and return empty arrays rather than inventing an assessment.

Do a genuinely deep read — go clause by clause, not just a skim. Base everything only on the actual text provided — never invent clauses, terms, or facts that aren't there.

Assess FOUR categories, each scored 1-10:
- "Completeness" — does it cover the clauses you'd normally expect for this type/subtype of agreement?
- "Clarity" — is the language precise and unambiguous, or vague/contradictory in places?
- "Balance" — are obligations, risk, and remedies reasonably balanced between the parties, or is it one-sided?
- "Enforceability" — anything that reads as vague, missing a defined term, or likely unenforceable as written?

Then list:
- strengths: what's genuinely well done.
- risks: specific issues, each with a severity. Point to the actual clause/section when you can.
- suggestions: specific, actionable fixes — not generic advice like "consult a lawyer".

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{
  "overallScore": <integer 1-10>,
  "riskLevel": "low"|"medium"|"high",
  "summary": "<3-4 sentence executive summary — the kind you'd put at the top of a review memo>",
  "categories": [{"name": "Completeness"|"Clarity"|"Balance"|"Enforceability", "score": <1-10>, "note": "<one sentence, specific to this document>"}],
  "strengths": ["<specific, short point>", ...],
  "risks": [{"issue": "<short label>", "severity": "low"|"medium"|"high", "explanation": "<1-2 sentences, specific — cite the clause/section if possible>"}],
  "suggestions": [{"title": "<short label>", "detail": "<1-2 sentences, concrete and actionable>"}]
}

"categories" must have exactly 4 entries, one per category above, in that order. Keep "strengths" to at most 5 items. Keep "risks" and "suggestions" to at most 6 items each, ordered by importance (most important first).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentText, metadata } = await req.json();
    if (!documentText || !String(documentText).trim()) {
      return jsonResponse({ error: 'documentText is required.' }, 400);
    }

    const userMessage = `Agreement metadata (JSON):\n${JSON.stringify(metadata || {})}\n\nDocument text:\n"""\n${documentText}\n"""`;

    const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude.');

    return jsonResponse(parseReview(textBlock.text));
  } catch (err) {
    console.error('Review AI error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Review failed.' }, 500);
  }
});

function parseReview(rawText: string) {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const jsonText = answerMatch ? answerMatch[1] : rawText;
  const cleaned = jsonText.replace(/```json|```/g, '').trim();

  // deno-lint-ignore no-explicit-any
  let review: any;
  try {
    review = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        review = JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  if (!review || typeof review !== 'object') {
    console.error('Review AI: could not parse Claude response. Raw text was:\n', rawText);
    throw new Error('Could not parse the AI response as JSON.');
  }

  return {
    overallScore: Number(review.overallScore) || 0,
    riskLevel: review.riskLevel || 'medium',
    summary: review.summary || '',
    categories: Array.isArray(review.categories) ? review.categories : [],
    strengths: Array.isArray(review.strengths) ? review.strengths : [],
    risks: Array.isArray(review.risks) ? review.risks : [],
    suggestions: Array.isArray(review.suggestions) ? review.suggestions : [],
  };
}
