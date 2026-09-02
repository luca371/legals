export const VOYAGE_MODEL = 'voyage-3.5';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Voyage throttles accounts with no payment method on file to 3 requests
// per minute — well within normal reach when several records get indexed
// back to back (e.g. from the "Reindex everything" button). Retry with
// backoff on 429 instead of failing outright.
export async function embedTexts(apiKey: string, texts: string[], inputType: 'document' | 'query') {
  if (!apiKey) {
    throw new Error('Missing VOYAGE_API_KEY secret on the Edge Function.');
  }

  const maxAttempts = 4;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: VOYAGE_MODEL,
        input_type: inputType,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      // deno-lint-ignore no-explicit-any
      return (data.data || []).map((d: any) => d.embedding as number[]);
    }

    const text = await response.text().catch(() => '');
    lastError = `Voyage API error (${response.status}): ${text.slice(0, 300)}`;

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : attempt * 15000; // 15s, 30s, 45s backoff if no Retry-After header
      await sleep(waitMs);
      continue;
    }

    throw new Error(lastError);
  }

  throw new Error(lastError);
}
