// Calls our own backend proxy (server/index.js locally, api/ai-builder.js
// on Vercel) — NEVER the Anthropic API directly, and NEVER holds an API
// key. See server/index.js for local setup instructions.

export async function analyzeTemplateWithAI(documentText, fields) {
  const response = await fetch('/api/ai-builder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentText, fields }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `AI Builder request failed (${response.status}).`);
  }

  const data = await response.json();
  return data.suggestions || [];
}