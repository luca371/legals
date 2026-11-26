import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { getAccessToken, sendEnvelopeForSignature } from '../_shared/docusign.ts';

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);

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

    // Remember which tenant owns this envelope: status and document lookups
    // only serve envelopes recorded here for the caller's tenant.
    if (envelope?.envelopeId) {
      const { error: recordError } = await auth.admin
        .from('docusign_envelope_tenants')
        .insert({ envelope_id: envelope.envelopeId, tenant_id: auth.tenantId });
      if (recordError) console.error('Could not record envelope owner:', recordError);
    }

    return jsonResponse(envelope);
  } catch (err) {
    console.error('DocuSign send error:', err);
    return jsonResponse({ error: 'DocuSign send failed.' }, 500);
  }
});
