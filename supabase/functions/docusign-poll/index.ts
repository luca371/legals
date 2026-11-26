import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { getAccessToken, getEnvelopeDocument, getEnvelopeStatus } from '../_shared/docusign.ts';
import type { Row } from '../_shared/agent-docs.ts';

// Keeps signatures up to date without anyone pressing "Refresh": every 30
// minutes (pg_cron, shared secret, --no-verify-jwt) it asks DocuSign about the
// envelopes still out for signature. A completed envelope gets its signed PDF
// attached and moves the agreement to "Signed" - the same thing the Refresh
// button does in the app. Database triggers then close the follow-up task and
// notify the agreement's creator.

const FINAL = ['completed', 'declined', 'voided'];
const MAX_ENVELOPES_PER_RUN = 40;
const TIME_BUDGET_MS = 100_000;
const PIPELINE = ['Draft', 'Generated', 'Import offline', 'In review', 'Reviewed', 'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated'];

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const started = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let checked = 0;
  let completed = 0;
  let failed = 0;

  try {
    const { data: agreements, error } = await admin
      .from('agreements')
      .select('id, tenant_id, title, status, attachments, docusign_envelopes')
      .not('docusign_envelopes', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(500);
    if (error) throw error;

    const open = (agreements || []).filter((a: Row) =>
      (a.docusign_envelopes || []).some((e: Row) => e.envelopeId && !e.manual && !FINAL.includes(e.status))
    );
    if (!open.length) return jsonResponse({ ok: true, checked, completed, failed });

    const accessToken = await getAccessToken({
      integrationKey: Deno.env.get('DOCUSIGN_INTEGRATION_KEY'),
      userId: Deno.env.get('DOCUSIGN_USER_ID'),
      privateKey: Deno.env.get('DOCUSIGN_PRIVATE_KEY'),
    });
    const accountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');

    for (const agreement of open) {
      if (checked >= MAX_ENVELOPES_PER_RUN || Date.now() - started > TIME_BUDGET_MS) break;
      let envelopes: Row[] = agreement.docusign_envelopes || [];
      let attachments: Row[] = agreement.attachments || [];
      let changed = false;
      let signed = false;

      for (const env of envelopes) {
        if (!env.envelopeId || env.manual || FINAL.includes(env.status)) continue;
        if (checked >= MAX_ENVELOPES_PER_RUN) break;
        checked += 1;
        try {
          const status = await getEnvelopeStatus({ accountId, accessToken, envelopeId: env.envelopeId });
          if (!status?.status || status.status === env.status) continue;
          const patch: Row = { status: status.status };

          if (status.status === 'completed') {
            patch.completedAt = new Date().toISOString();
            if (!env.signedAttachmentId) {
              const documentId = (env.documentCount || 1) > 1 ? 'combined' : undefined;
              const doc = await getEnvelopeDocument({ accountId, accessToken, envelopeId: env.envelopeId, documentId });
              const baseName = String(env.attachmentName || 'document').replace(/\.[^./]+$/, '');
              const attachment = {
                id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: `${baseName} - signed.pdf`,
                size: Math.round((doc.dataBase64.length * 3) / 4),
                mimeType: doc.mimeType,
                dataBase64: doc.dataBase64,
                uploadedAt: new Date().toISOString(),
              };
              attachments = [...attachments, attachment];
              patch.signedAttachmentId = attachment.id;
            }
            signed = true;
            completed += 1;
          }
          envelopes = envelopes.map((e) => (e.envelopeId === env.envelopeId ? { ...e, ...patch } : e));
          changed = true;
        } catch (err) {
          console.error(`Envelope ${env.envelopeId} check failed:`, err);
          failed += 1;
        }
      }

      if (!changed) continue;
      const update: Row = { docusign_envelopes: envelopes, attachments, updated_at: new Date().toISOString() };
      const current = PIPELINE.indexOf(agreement.status);
      if (signed && (current === -1 || current < PIPELINE.indexOf('Signed'))) update.status = 'Signed';
      const { error: updateError } = await admin.from('agreements').update(update).eq('id', agreement.id);
      if (updateError) {
        console.error(`Could not update agreement ${agreement.id}:`, updateError);
        continue;
      }
      if (signed) {
        await admin.from('audit_log').insert({
          tenant_id: agreement.tenant_id,
          actor_email: 'DocuSign',
          action: 'signed',
          object_type: 'agreement',
          object_id: agreement.id,
          object_label: agreement.title ?? '',
          details: { automatic: true },
        });
      }
    }

    return jsonResponse({ ok: true, checked, completed, failed });
  } catch (err) {
    console.error('DocuSign poll error:', err);
    return jsonResponse({ error: 'DocuSign poll failed.' }, 500);
  }
});
