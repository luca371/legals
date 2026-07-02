// Calls our own backend proxy (server/index.js locally, api/review-agreement.js
// on Vercel) — never the Anthropic API directly, and never holds an API key.

export async function reviewAgreementWithAI(documentText, metadata) {
  const response = await fetch('/api/review-agreement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentText, metadata }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Review request failed (${response.status}).`);
  }

  return response.json();
}