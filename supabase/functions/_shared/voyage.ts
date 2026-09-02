export const VOYAGE_MODEL = 'voyage-3.5';

export async function embedTexts(apiKey: string, texts: string[], inputType: 'document' | 'query') {
  if (!apiKey) {
    throw new Error('Missing VOYAGE_API_KEY secret on the Edge Function.');
  }

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

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Voyage API error (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  // deno-lint-ignore no-explicit-any
  return (data.data || []).map((d: any) => d.embedding as number[]);
}
