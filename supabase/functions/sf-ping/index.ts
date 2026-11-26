import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { sfQuery } from '../_shared/salesforce.ts';

// Connectivity check: verifies the caller is a logged-in active admin, then
// reads a few Accounts from Salesforce. Use it to confirm the app,
// certificate and permission set are wired up correctly.
serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await requireAdmin(req);
    if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);

    const result = await sfQuery(auth.tenantId, 'SELECT Id, Name, BillingCountry, BillingCity FROM Account ORDER BY CreatedDate DESC LIMIT 5');
    return jsonResponse({ ok: true, totalSize: result.totalSize, accounts: result.records });
  } catch (err) {
    console.error('Salesforce ping error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Salesforce ping failed.' }, 500);
  }
});
