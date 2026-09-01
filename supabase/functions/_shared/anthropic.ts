export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

export async function callAnthropic(apiKey: string, payload: Record<string, unknown>) {
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY secret on the Edge Function.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API error (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json();
}
