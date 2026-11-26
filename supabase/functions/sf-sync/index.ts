import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { sfQuery, sfRequest } from '../_shared/salesforce.ts';

// Pulls Accounts from Salesforce into the caller's tenant. Salesforce is the
// source of truth for the synced fields (name, country, city, address): they
// are overwritten on every run. Local-only fields (status, custom fields, tax
// number, ...) are never touched on existing rows.
const SOQL =
  'SELECT Id, Name, BillingCountry, BillingCity, BillingStreet FROM Account ORDER BY CreatedDate ASC';

// deno-lint-ignore no-explicit-any
async function fetchAllAccounts(tenantId: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const records: any[] = [];
  let page = await sfQuery(tenantId, SOQL);
  records.push(...page.records);
  while (!page.done && page.nextRecordsUrl) {
    // nextRecordsUrl is absolute from the instance root, so strip the /services/data/vXX.X prefix.
    page = await sfRequest(tenantId, page.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, ''));
    records.push(...page.records);
  }
  return records;
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let logId: string | null = null;
  const auth = await requireAdmin(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, user, tenantId } = auth;

  try {
    const { data: log } = await admin
      .from('sf_sync_log')
      .insert({ tenant_id: tenantId, direction: 'sf_to_app', object_type: 'account', status: 'running', started_by: user.id })
      .select('id')
      .single();
    logId = log?.id ?? null;

    const sfAccounts = await fetchAllAccounts(tenantId);

    const { data: existingRows, error: existingError } = await admin
      .from('accounts')
      .select('sf_account_id')
      .eq('tenant_id', tenantId)
      .not('sf_account_id', 'is', null);
    if (existingError) throw existingError;
    const existing = new Set((existingRows || []).map((r: { sf_account_id: string }) => r.sf_account_id));

    const now = new Date().toISOString();
    const base = (a: (typeof sfAccounts)[number]) => ({
      tenant_id: tenantId,
      sf_account_id: a.Id,
      name: a.Name,
      country: a.BillingCountry || '',
      city: a.BillingCity || '',
      address: a.BillingStreet || '',
      sf_last_synced_at: now,
    });

    const updates = sfAccounts.filter((a) => existing.has(a.Id)).map(base);
    const inserts = sfAccounts
      .filter((a) => !existing.has(a.Id))
      .map((a) => ({
        ...base(a),
        tax_registration_number: '',
        abbreviation: '',
        registered_office: '',
        status: 'Active',
        custom_fields: {},
        created_by: 'Salesforce',
      }));

    if (updates.length > 0) {
      const { error } = await admin.from('accounts').upsert(updates, { onConflict: 'tenant_id,sf_account_id' });
      if (error) throw error;
    }
    if (inserts.length > 0) {
      const { error } = await admin.from('accounts').upsert(inserts, { onConflict: 'tenant_id,sf_account_id' });
      if (error) throw error;
    }

    const summary = { fetched: sfAccounts.length, created: inserts.length, updated: updates.length };
    if (logId) {
      await admin.from('sf_sync_log').update({ status: 'success', details: summary, finished_at: now }).eq('id', logId);
    }
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    console.error('Salesforce sync error:', err);
    const message = err instanceof Error ? err.message : 'Salesforce sync failed.';
    if (logId) {
      await admin
        .from('sf_sync_log')
        .update({ status: 'error', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
        .eq('id', logId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
