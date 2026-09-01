import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAccessToken, getEnvelopeStatus } from '../_shared/docusign.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { envelopeId } = await req.json();
    if (!envelopeId) {
      return jsonResponse({ error: 'envelopeId is required.' }, 400);
    }

    const accessToken = await getAccessToken({
      integrationKey: Deno.env.get('DOCUSIGN_INTEGRATION_KEY'),
      userId: Deno.env.get('DOCUSIGN_USER_ID'),
      privateKey: Deno.env.get('DOCUSIGN_PRIVATE_KEY'),
    });

    const status = await getEnvelopeStatus({
      accountId: Deno.env.get('DOCUSIGN_ACCOUNT_ID'),
      accessToken,
      envelopeId,
    });

    return jsonResponse(status);
  } catch (err) {
    console.error('DocuSign status error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'DocuSign status check failed.' }, 500);
  }
});
