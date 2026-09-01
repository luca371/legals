import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAccessToken, getEnvelopeDocument } from '../_shared/docusign.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { envelopeId, documentId } = await req.json();
    if (!envelopeId) {
      return jsonResponse({ error: 'envelopeId is required.' }, 400);
    }

    const accessToken = await getAccessToken({
      integrationKey: Deno.env.get('DOCUSIGN_INTEGRATION_KEY'),
      userId: Deno.env.get('DOCUSIGN_USER_ID'),
      privateKey: Deno.env.get('DOCUSIGN_PRIVATE_KEY'),
    });

    const document = await getEnvelopeDocument({
      accountId: Deno.env.get('DOCUSIGN_ACCOUNT_ID'),
      accessToken,
      envelopeId,
      documentId,
    });

    return jsonResponse(document);
  } catch (err) {
    console.error('DocuSign document fetch error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'DocuSign document fetch failed.' }, 500);
  }
});
