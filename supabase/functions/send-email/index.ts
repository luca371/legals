import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { sendActivationEmail, sendApprovalEmail, sendReviewEmail } from '../_shared/notify.ts';

// Emails sent from the signed-in app. The caller names a request or agreement
// of their own tenant; the recipient of approval/review emails and the link
// in every email come from the database, not from the browser.

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function optionalEmail(value: unknown) {
  const email = String(value || '').trim();
  if (!email) return '';
  if (!EMAIL_RE.test(email) || email.length > 320) throw new Error('Invalid CC email.');
  return email;
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, tenantId } = auth;

  try {
    const body = await req.json();
    const kind = body?.kind;
    const ccEmail = optionalEmail(body?.ccEmail);

    if (kind === 'approval' || kind === 'review') {
      const table = kind === 'approval' ? 'approval_requests' : 'review_requests';
      const { data: request } = await admin
        .from(table)
        .select('*')
        .eq('id', String(body?.requestId || ''))
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!request) return jsonResponse({ error: 'Request not found.' }, 404);

      if (kind === 'approval') await sendApprovalEmail(request, ccEmail);
      else await sendReviewEmail(request, ccEmail);
      return jsonResponse({ ok: true });
    }

    if (kind === 'activation') {
      const toEmail = String(body?.toEmail || '').trim();
      if (!EMAIL_RE.test(toEmail) || toEmail.length > 320) {
        return jsonResponse({ error: 'Invalid recipient email.' }, 400);
      }
      const { data: agreement } = await admin
        .from('agreements')
        .select('id, title, created_by')
        .eq('id', String(body?.agreementId || ''))
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!agreement) return jsonResponse({ error: 'Agreement not found.' }, 404);

      await sendActivationEmail({
        toEmail,
        toName: String(body?.toName || '').slice(0, 200),
        fromName: agreement.created_by || 'EsoVia',
        agreement,
        message: String(body?.message || '').slice(0, 5000),
        ccEmail,
      });
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Unknown email kind.' }, 400);
  } catch (err) {
    console.error('Send email error:', err);
    return jsonResponse({ error: 'Email could not be sent.' }, 500);
  }
});
