import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { getAccessToken, getEnvelopeStatus } from '../_shared/docusign.ts';

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireUser(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);

  try {
    const { envelopeId } = await req.json();
    if (!envelopeId) {
      return jsonResponse({ error: 'envelopeId is required.' }, 400);
    }

    // All tenants share one DocuSign account, so only envelopes this tenant sent.
    const { data: owned } = await auth.admin
      .from('docusign_envelope_tenants')
      .select('envelope_id')
      .eq('envelope_id', String(envelopeId))
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();
    if (!owned) {
      return jsonResponse({ error: 'Envelope not found.' }, 404);
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
    return jsonResponse({ error: 'DocuSign status check failed.' }, 500);
  }
});
