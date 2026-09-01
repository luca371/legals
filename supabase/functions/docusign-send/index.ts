import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAccessToken, sendEnvelopeForSignature } from '../_shared/docusign.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentBase64, documentName, fileExtension, signers, emailSubject, emailMessage } = await req.json();

    if (!documentBase64 || !Array.isArray(signers) || signers.length === 0) {
      return jsonResponse({ error: 'documentBase64 and at least one signer are required.' }, 400);
    }
    if (signers.some((s: { email?: string; name?: string }) => !s.email || !s.name)) {
      return jsonResponse({ error: 'Every signer needs a name and email.' }, 400);
    }

    const accessToken = await getAccessToken({
      integrationKey: Deno.env.get('DOCUSIGN_INTEGRATION_KEY'),
      userId: Deno.env.get('DOCUSIGN_USER_ID'),
      privateKey: Deno.env.get('DOCUSIGN_PRIVATE_KEY'),
    });

    const envelope = await sendEnvelopeForSignature({
      accountId: Deno.env.get('DOCUSIGN_ACCOUNT_ID'),
      accessToken,
      documentBase64,
      documentName,
      fileExtension,
      signers,
      emailSubject,
      emailMessage,
    });

    return jsonResponse(envelope);
  } catch (err) {
    console.error('DocuSign send error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'DocuSign send failed.' }, 500);
  }
});
