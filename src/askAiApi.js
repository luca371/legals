// Calls our own backend proxy (server/index.js locally, api/ask-ai.js on
// Vercel) — never the Anthropic API directly, and never holds an API key.

export async function sendToClaudeWithTools(messages) {
  const response = await fetch('/api/ask-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Ask AI request failed (${response.status}).`);
  }

  return response.json();
}