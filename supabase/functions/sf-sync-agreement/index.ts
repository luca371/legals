import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { sfQuery, sfRequest } from '../_shared/salesforce.ts';
import { pushAttachmentToSalesforce, type SfFileEntry } from '../_shared/sf-files.ts';

// Creates or updates the Salesforce Contract (standard object) that mirrors an
// agreement, under the agreement's Account. The app is the source of truth for
// agreements, so the synced fields are overwritten in Salesforce.
const SF_ID = /^[a-zA-Z0-9]{15,18}$/;

// Standard Contract.Status values are Draft / In Approval Process / Activated.
// If the org added a picklist value equal to our status (e.g. "Signed"), that
// is used as-is; otherwise we fall back to the nearest standard one.
const STATUS_FALLBACK: Record<string, string> = {
  'Draft': 'Draft',
  'Generated': 'Draft',
  'Import offline': 'Draft',
  'In review': 'Draft',
  'Reviewed': 'Draft',
  'In approval': 'In Approval Process',
  'Approved': 'In Approval Process',
  'Pending signatures': 'In Approval Process',
  'Signed': 'In Approval Process',
  'Activated': 'Activated',
};

// deno-lint-ignore no-explicit-any
const describeCache = new Map<string, { at: number; fields: Map<string, any> }>();

async function describeContract(tenantId: string) {
  const cached = describeCache.get(tenantId);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.fields;
  const describe = await sfRequest(tenantId, '/sobjects/Contract/describe');
  // deno-lint-ignore no-explicit-any
  const fields = new Map<string, any>(describe.fields.map((f: any) => [f.name, f]));
  describeCache.set(tenantId, { at: Date.now(), fields });
  return fields;
}

function monthsBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000 / 30.4375));
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, callerClient, user, tenantId } = auth;

  let logId: string | null = null;
  try {
    const { agreementId } = await req.json();
    if (!agreementId) return jsonResponse({ error: 'agreementId is required.' }, 400);

    // Read as the caller so RLS decides whether they may see it, then check the tenant.
    const { data: agreement, error: agreementError } = await callerClient
      .from('agreements')
      .select('id, tenant_id, account_id, title, agreement_type, agreement_subtype, language, status, effective_date, end_date, sf_contract_id, sf_files, attachments')
      .eq('id', agreementId)
      .single();
    if (agreementError && agreementError.code !== 'PGRST116') {
      return jsonResponse({ error: `Agreement lookup failed: ${agreementError.message}` }, 500);
    }
    if (!agreement || agreement.tenant_id !== tenantId) {
      return jsonResponse({ error: 'Agreement not found.' }, 404);
    }
    if (!agreement.account_id) {
      return jsonResponse({ error: 'This agreement is not linked to an account.' }, 400);
    }

    const { data: account } = await admin
      .from('accounts')
      .select('sf_account_id')
      .eq('id', agreement.account_id)
      .eq('tenant_id', tenantId)
      .single();
    if (!account?.sf_account_id || !SF_ID.test(account.sf_account_id)) {
      return jsonResponse({ error: 'The linked account is not synced from Salesforce.' }, 400);
    }

    const { data: log } = await admin
      .from('sf_sync_log')
      .insert({ tenant_id: tenantId, direction: 'app_to_sf', object_type: 'agreement', status: 'running', started_by: user.id })
      .select('id')
      .single();
    logId = log?.id ?? null;

    const fields = await describeContract(tenantId);
    const picklist: string[] = (fields.get('Status')?.picklistValues || [])
      // deno-lint-ignore no-explicit-any
      .filter((p: any) => p.active)
      // deno-lint-ignore no-explicit-any
      .map((p: any) => p.value);

    const appStatus: string = agreement.status || 'Draft';
    const targetStatus = picklist.includes(appStatus) ? appStatus : STATUS_FALLBACK[appStatus] || 'Draft';
    const targetIsActivated = targetStatus === 'Activated';

    const appUrl = Deno.env.get('APP_URL');
    const description = [
      `Type: ${agreement.agreement_type || '-'} / ${agreement.agreement_subtype || '-'}`,
      `Language: ${agreement.language || '-'}`,
      // Salesforce derives End Date from StartDate + whole months, so it can be
      // a few days off; the exact dates from the app are kept here.
      `Start date: ${agreement.effective_date || '-'}`,
      `End date: ${agreement.end_date || '-'}`,
      `App status: ${appStatus}`,
      appUrl ? `Open in EsoVia: ${appUrl}/dashboard/agreements/${agreement.id}` : '',
    ].filter(Boolean).join('\n');

    const wanted: Record<string, unknown> = {
      AccountId: account.sf_account_id,
      Name: agreement.title,
      StartDate: agreement.effective_date || null,
      ContractTerm: monthsBetween(agreement.effective_date, agreement.end_date),
      Description: description,
    };
    // Keep only fields this org has and lets us write; EndDate is calculated by
    // Salesforce from StartDate + ContractTerm so it is never sent.
    const pick = (mode: 'createable' | 'updateable', extra: Record<string, unknown>) => {
      const all = { ...wanted, ...extra };
      return Object.fromEntries(
        Object.entries(all).filter(([k, v]) => v !== null && v !== undefined && fields.get(k)?.[mode]),
      );
    };
    const json = { 'Content-Type': 'application/json' };

    let contractId: string | null = null;
    let existingStatusActivated = false;
    if (agreement.sf_contract_id && SF_ID.test(agreement.sf_contract_id)) {
      const found = await sfQuery(tenantId, `SELECT Id, StatusCode FROM Contract WHERE Id = '${agreement.sf_contract_id}'`);
      if (found.records?.length) {
        contractId = found.records[0].Id;
        existingStatusActivated = found.records[0].StatusCode === 'Activated';
      }
    }

    let action: 'created' | 'updated' | 'unchanged';
    if (!contractId) {
      // Contracts cannot be created Activated: create as Draft, then activate.
      const created = await sfRequest(tenantId, '/sobjects/Contract', {
        method: 'POST',
        headers: json,
        body: JSON.stringify(pick('createable', { Status: targetIsActivated ? 'Draft' : targetStatus })),
      });
      if (!created?.success || !SF_ID.test(created.id)) throw new Error('Salesforce did not confirm the contract creation.');
      contractId = created.id as string;
      if (targetIsActivated) {
        await sfRequest(tenantId, `/sobjects/Contract/${contractId}`, { method: 'PATCH', headers: json, body: JSON.stringify({ Status: 'Activated' }) });
      }
      action = 'created';
    } else if (existingStatusActivated && targetIsActivated) {
      // Salesforce locks Activated contracts against edits; nothing to change.
      action = 'unchanged';
    } else {
      if (existingStatusActivated) {
        // Un-activate first so the other fields can be edited.
        await sfRequest(tenantId, `/sobjects/Contract/${contractId}`, { method: 'PATCH', headers: json, body: JSON.stringify({ Status: targetStatus }) });
      }
      await sfRequest(tenantId, `/sobjects/Contract/${contractId}`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify(pick('updateable', { Status: targetStatus })),
      });
      action = 'updated';
    }

    // Send every document of the agreement: on the Account and on the Contract.
    // A document that fails must not undo the contract sync, so errors are
    // collected and reported instead of thrown.
    const sfFiles: Record<string, SfFileEntry> = { ...(agreement.sf_files || {}) };
    const files = { created: 0, newVersion: 0, unchanged: 0, failed: [] as string[] };
    // deno-lint-ignore no-explicit-any
    for (const attachment of (agreement.attachments || []) as any[]) {
      if (!attachment?.id || (!attachment.dataBase64 && !attachment.sourceHtml)) continue;
      try {
        const result = await pushAttachmentToSalesforce({
          tenantId,
          accountSfId: account.sf_account_id,
          contractSfId: contractId,
          attachment,
          existing: sfFiles[attachment.id],
          fallbackTitle: agreement.title || 'Agreement',
        });
        sfFiles[attachment.id] = result.entry;
        if (result.outcome === 'created') files.created++;
        else if (result.outcome === 'new_version') files.newVersion++;
        else files.unchanged++;
      } catch (err) {
        console.error('Attachment push failed:', attachment.name, err);
        files.failed.push(`${attachment.name || attachment.id}: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 200));
      }
    }

    const syncedAt = new Date().toISOString();
    const { error: saveError } = await admin
      .from('agreements')
      .update({ sf_contract_id: contractId, sf_contract_synced_at: syncedAt, sf_files: sfFiles })
      .eq('id', agreementId)
      .eq('tenant_id', tenantId);
    if (saveError) throw saveError;

    if (logId) {
      await admin
        .from('sf_sync_log')
        .update({ status: 'success', details: { agreementId, contractId, action, sfStatus: targetStatus, files }, finished_at: syncedAt })
        .eq('id', logId);
    }
    return jsonResponse({ ok: true, contractId, action, sfStatus: targetStatus, files });
  } catch (err) {
    console.error('Salesforce agreement sync error:', err);
    const message = err instanceof Error ? err.message : 'Salesforce agreement sync failed.';
    if (logId) {
      await admin
        .from('sf_sync_log')
        .update({ status: 'error', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
        .eq('id', logId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
