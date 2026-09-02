import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAccessToken, sendEnvelopeForSignature } from '../_shared/docusign.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documents, signers, ccRecipients, emailSubject, emailMessage } = await req.json();

    if (!Array.isArray(documents) || documents.length === 0 || documents.some((d: { documentBase64?: string }) => !d.documentBase64)) {
      return jsonResponse({ error: 'At least one document (with documentBase64) is required.' }, 400);
    }
    if (!Array.isArray(signers) || signers.length === 0) {
      return jsonResponse({ error: 'At least one signer is required.' }, 400);
    }
    if (signers.some((s: { email?: string; name?: string }) => !s.email || !s.name)) {
      return jsonResponse({ error: 'Every signer needs a name and email.' }, 400);
    }
    if (Array.isArray(ccRecipients) && ccRecipients.some((r: { email?: string }) => !r.email)) {
      return jsonResponse({ error: 'Every recipient in copy needs an email.' }, 400);
    }

    const accessToken = await getAccessToken({
      integrationKey: Deno.env.get('DOCUSIGN_INTEGRATION_KEY'),
      userId: Deno.env.get('DOCUSIGN_USER_ID'),
      privateKey: Deno.env.get('DOCUSIGN_PRIVATE_KEY'),
    });

    const envelope = await sendEnvelopeForSignature({
      accountId: Deno.env.get('DOCUSIGN_ACCOUNT_ID'),
      accessToken,
      documents,
      signers,
      ccRecipients,
      emailSubject,
      emailMessage,
    });

    return jsonResponse(envelope);
  } catch (err) {
    console.error('DocuSign send error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'DocuSign send failed.' }, 500);
  }
});
