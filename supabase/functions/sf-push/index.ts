import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { pushAttachmentToSalesforce, SF_ID } from '../_shared/sf-files.ts';

// Pushes ONE agreement attachment to Salesforce Files (Account, plus the
// Contract when the agreement has one). The contract sync pushes all of them.
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
    const { agreementId, attachmentId } = await req.json();
    if (!agreementId || !attachmentId) {
      return jsonResponse({ error: 'agreementId and attachmentId are required.' }, 400);
    }

    // Read as the caller so RLS decides whether they may see this agreement,
    // then double-check the tenant.
    const { data: agreement, error: agreementError } = await callerClient
      .from('agreements')
      .select('id, tenant_id, account_id, title, attachments, sf_files, sf_contract_id')
      .eq('id', agreementId)
      .single();
    // PGRST116 = no row visible to the caller (missing id, other tenant, or RLS).
    // Any other error is a real query problem and must not be reported as "not found".
    if (agreementError && agreementError.code !== 'PGRST116') {
      console.error('Agreement lookup failed:', agreementError);
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

    // deno-lint-ignore no-explicit-any
    const attachment = (agreement.attachments || []).find((a: any) => a.id === attachmentId);
    if (!attachment) return jsonResponse({ error: 'Attachment not found.' }, 404);

    const { data: log } = await admin
      .from('sf_sync_log')
      .insert({ tenant_id: tenantId, direction: 'app_to_sf', object_type: 'agreement_file', status: 'running', started_by: user.id })
      .select('id')
      .single();
    logId = log?.id ?? null;

    const result = await pushAttachmentToSalesforce({
      tenantId,
      accountSfId: account.sf_account_id,
      contractSfId: agreement.sf_contract_id,
      attachment,
      existing: (agreement.sf_files || {})[attachmentId],
      fallbackTitle: agreement.title || 'Agreement',
    });

    const { error: saveError } = await admin
      .from('agreements')
      .update({ sf_files: { ...(agreement.sf_files || {}), [attachmentId]: result.entry } })
      .eq('id', agreementId)
      .eq('tenant_id', tenantId);
    if (saveError) throw saveError;

    if (logId) {
      await admin
        .from('sf_sync_log')
        .update({
          status: 'success',
          details: { agreementId, attachmentId, contentDocumentId: result.entry.contentDocumentId, outcome: result.outcome },
          finished_at: new Date().toISOString(),
        })
        .eq('id', logId);
    }
    return jsonResponse({
      ok: true,
      contentDocumentId: result.entry.contentDocumentId,
      contentVersionId: result.entry.contentVersionId,
      outcome: result.outcome,
      newVersion: result.outcome === 'new_version',
      unchanged: result.outcome === 'unchanged',
      linkedToContract: !!agreement.sf_contract_id,
    });
  } catch (err) {
    console.error('Salesforce push error:', err);
    const message = err instanceof Error ? err.message : 'Salesforce push failed.';
    if (logId) {
      await admin
        .from('sf_sync_log')
        .update({ status: 'error', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
        .eq('id', logId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
