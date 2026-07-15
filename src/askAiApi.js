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