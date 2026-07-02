// Shared between server/index.js (local dev proxy) and
// api/review-agreement.js (Vercel serverless function). Same pattern as
// lib/aiBuilder.js and lib/askAi.js — the API key only ever lives here.

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are a contract-quality reviewer embedded in "Legal Space", a contract lifecycle management tool. You are given an agreement's metadata and the text of its attached document(s). Review it the way an experienced contract manager (not a lawyer) would when sanity-checking a contract before it goes out — completeness, clarity, internal consistency, and whether it covers the clauses you'd normally expect for this type of agreement.

You are NOT providing legal advice, and you should not present your output as such — keep suggestions at the level of "a contract manager would flag this," not definitive legal conclusions. If the document text is missing, empty, or clearly not a real contract, say so plainly in "summary" and give a low score rather than inventing an assessment.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{"score": <integer 1-10, 10 being excellent>, "summary": "<2-3 sentence overall assessment>", "strengths": ["<short point>", ...], "gaps": ["<short point — missing or weak areas>", ...], "suggestions": ["<short, actionable point>", ...]}

Keep each array to at most 5 items, each a single short sentence. Base everything only on the actual text provided — never invent clauses or facts that aren't there.`;

async function reviewAgreement({ documentText, metadata, apiKey }) {
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY on the server.');
  }
  if (!documentText || !documentText.trim()) {
    throw new Error('documentText is required.');
  }

  const userMessage = `Agreement metadata (JSON):\n${JSON.stringify(metadata || {})}\n\nDocument text:\n"""\n${documentText}\n"""`;

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

  return parseReview(textBlock.text);
}

function parseReview(rawText) {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const jsonText = answerMatch ? answerMatch[1] : rawText;
  const cleaned = jsonText.replace(/```json|```/g, '').trim();

  let review;
  try {
    review = JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        review = JSON.parse(match[0]);
      } catch (err2) {
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

module.exports = { reviewAgreement };