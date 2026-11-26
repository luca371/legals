import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { sendApprovalEmail, sendReviewEmail } from '../_shared/notify.ts';

// The only way the public /approve/:id and /review/:id pages reach the data.
// The anonymous role has no access to approval_requests or review_requests
// (see supabase/sql/009_lock_public_links.sql): knowing a request's random
// UUID, which only its emailed recipient has, is what grants access to that
// one row, and only to the fields and changes the page needs.

const LINK_EXPIRY_DAYS = 30;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_COMMENT = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, any>;

function mapApproval(r: Row) {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    agreementTitle: r.agreement_title,
    attachmentName: r.attachment?.name,
    attachment: r.attachment,
    approverEmail: r.approver_email,
    approverName: r.approver_name,
    message: r.message,
    status: r.status,
    comment: r.comment,
    sequence: r.sequence || 1,
    batchId: r.batch_id,
    requestedBy: r.requested_by,
    createdAt: r.created_at ? { seconds: Math.floor(new Date(r.created_at).getTime() / 1000) } : null,
  };
}

function mapReview(r: Row) {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    agreementTitle: r.agreement_title,
    attachmentId: r.attachment_id,
    attachmentName: r.attachment_name,
    originalHtml: r.original_html,
    reviewerEmail: r.reviewer_email,
    reviewerName: r.reviewer_name,
    message: r.message,
    status: r.status,
    submittedHtml: r.submitted_html,
    redlineTokens: r.redline_tokens,
    submittedAt: r.submitted_at,
    sequence: r.sequence || 1,
    batchId: r.batch_id,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
  };
}

// Unanswered links stop working after 30 days; answered ones stay readable.
function linkExpired(createdAt: string | null) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  return !Number.isNaN(created) && Date.now() - created > LINK_EXPIRY_DAYS * 86400000;
}

const APPROVAL_EXPIRED = 'This approval link has expired. Ask the sender to send a new one.';

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const { action, id } = body || {};
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return jsonResponse({ error: 'Link not found.' }, 404);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'getApproval') {
      const { data } = await admin.from('approval_requests').select('*').eq('id', id).maybeSingle();
      if (!data) return jsonResponse({ error: 'Link not found.' }, 404);
      if (data.status === 'Pending' && linkExpired(data.created_at)) {
        return jsonResponse({ error: APPROVAL_EXPIRED }, 410);
      }
      return jsonResponse({ request: mapApproval(data) });
    }

    if (action === 'decideApproval') {
      const decision = body.decision;
      if (decision !== 'Approved' && decision !== 'Rejected') {
        return jsonResponse({ error: 'Invalid decision.' }, 400);
      }
      const comment = String(body.comment || '').trim().slice(0, MAX_COMMENT);

      const { data: current } = await admin.from('approval_requests').select('created_at').eq('id', id).maybeSingle();
      if (!current) return jsonResponse({ error: 'Link not found.' }, 404);
      if (linkExpired(current.created_at)) return jsonResponse({ error: APPROVAL_EXPIRED }, 410);

      // Only a Pending request can be decided, and only once: the status
      // check is part of the update itself, so two clicks cannot both win.
      const { data: decided } = await admin
        .from('approval_requests')
        .update({ status: decision, comment, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'Pending')
        .select('*')
        .maybeSingle();
      if (!decided) {
        return jsonResponse({ error: 'This request has already been answered or no longer exists.' }, 409);
      }

      // A sequential chain only moves on when this approver says yes.
      if (decision === 'Approved') {
        let next: Row | null = null;
        if (decided.batch_id) {
          const { data } = await admin
            .from('approval_requests')
            .select('*')
            .eq('batch_id', decided.batch_id)
            .eq('tenant_id', decided.tenant_id)
            .eq('sequence', (decided.sequence || 1) + 1)
            .maybeSingle();
          next = data;
        }

        if (next) {
          try {
            await sendApprovalEmail(next);
          } catch (err) {
            console.error('Could not email the next approver:', err);
          }
        } else {
          const { error: updateError } = await admin
            .from('agreements')
            .update({ status: 'Approved', updated_at: new Date().toISOString() })
            .eq('id', decided.agreement_id)
            .eq('tenant_id', decided.tenant_id);
          if (updateError) console.error('Could not mark the agreement approved:', updateError);
        }
      }

      return jsonResponse({ ok: true });
    }

    if (action === 'getReview') {
      const { data } = await admin.from('review_requests').select('*').eq('id', id).maybeSingle();
      if (!data) return jsonResponse({ error: 'Link not found.' }, 404);
      return jsonResponse({ request: mapReview(data) });
    }

    if (action === 'submitReview') {
      const submittedHtml = typeof body.submittedHtml === 'string' ? body.submittedHtml : '';
      const changeTokens = Array.isArray(body.changeTokens) ? body.changeTokens : [];
      if (new TextEncoder().encode(submittedHtml).length > MAX_HTML_BYTES) {
        return jsonResponse({ error: 'The document is too large.' }, 413);
      }

      const { data: current } = await admin.from('review_requests').select('created_at').eq('id', id).maybeSingle();
      if (!current) return jsonResponse({ error: 'Link not found.' }, 404);
      if (linkExpired(current.created_at)) {
        return jsonResponse({ error: 'This review link has expired.' }, 410);
      }

      const now = new Date().toISOString();
      const { data: submitted } = await admin
        .from('review_requests')
        .update({
          submitted_html: submittedHtml,
          redline_tokens: changeTokens,
          status: 'Submitted',
          submitted_at: now,
          updated_at: now,
        })
        .eq('id', id)
        .eq('status', 'Pending')
        .select('*')
        .maybeSingle();
      if (!submitted) {
        return jsonResponse({ error: 'This review has already been submitted or no longer exists.' }, 409);
      }

      if (submitted.batch_id) {
        const { data: next } = await admin
          .from('review_requests')
          .select('*')
          .eq('batch_id', submitted.batch_id)
          .eq('tenant_id', submitted.tenant_id)
          .eq('sequence', (submitted.sequence || 1) + 1)
          .maybeSingle();
        if (next) {
          try {
            await sendReviewEmail(next);
          } catch (err) {
            console.error('Could not email the next reviewer:', err);
          }
        }
      }

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('Public link error:', err);
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
