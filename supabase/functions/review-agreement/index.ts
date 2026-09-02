import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are a contract-quality reviewer embedded in "Legal Space", a contract lifecycle management tool. You are given an agreement's metadata and the text of its attached document(s). Review it the way an experienced contract manager (not a lawyer) would when sanity-checking a contract before it goes out — completeness, clarity, internal consistency, and whether it covers the clauses you'd normally expect for this type of agreement.

You are NOT providing legal advice, and you should not present your output as such — keep suggestions at the level of "a contract manager would flag this," not definitive legal conclusions. If the document text is missing, empty, or clearly not a real contract, say so plainly in "summary" and give a low score rather than inventing an assessment.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{"score": <integer 1-10, 10 being excellent>, "summary": "<2-3 sentence overall assessment>", "strengths": ["<short point>", ...], "gaps": ["<short point — missing or weak areas>", ...], "suggestions": ["<short, actionable point>", ...]}

Keep each array to at most 5 items, each a single short sentence. Base everything only on the actual text provided — never invent clauses or facts that aren't there.`;

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
    score: Number(review.score) || 0,
    summary: review.summary || '',
    strengths: Array.isArray(review.strengths) ? review.strengths : [],
    gaps: Array.isArray(review.gaps) ? review.gaps : [],
    suggestions: Array.isArray(review.suggestions) ? review.suggestions : [],
  };
}

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
      max_tokens: 4096,
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
