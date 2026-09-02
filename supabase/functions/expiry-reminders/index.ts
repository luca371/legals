import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { sendEmailJs } from '../_shared/emailjs.ts';

// Runs across every tenant, on a schedule (see the pg_cron job set up in
// SQL) — not a per-user action, so it always uses the service role key to
// bypass RLS rather than a caller's JWT.
const THRESHOLDS = [30, 14, 7, 1];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Deployed with --no-verify-jwt (this is invoked by pg_cron, not a
    // logged-in user) — gated instead by a shared secret only pg_cron knows.
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized.' }, 401);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: agreements, error } = await supabase
      .from('agreements')
      .select('id, title, account_name, end_date, status, created_by, reminders_sent')
      .eq('status', 'Activated')
      .not('end_date', 'is', null);

    if (error) throw error;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const a of agreements || []) {
      const endDate = new Date(a.end_date);
      if (Number.isNaN(endDate.getTime())) continue;

      const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
      if (daysLeft < 0) continue;

      const alreadySent: number[] = Array.isArray(a.reminders_sent) ? a.reminders_sent : [];
      const crossed = THRESHOLDS.filter((t) => daysLeft <= t && !alreadySent.includes(t));
      if (crossed.length === 0) continue;

      if (!a.created_by) {
        skipped += 1;
        continue;
      }

      try {
        const appBaseUrl = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '');
        await sendEmailJs({
          serviceId: Deno.env.get('EMAILJS_SERVICE_ID') ?? '',
          // Reuses the same generic template as review emails — EmailJS's
          // free plan caps templates at 2, so this isn't a dedicated one.
          templateId: Deno.env.get('EMAILJS_REVIEW_TEMPLATE_ID') ?? '',
          publicKey: Deno.env.get('EMAILJS_PUBLIC_KEY') ?? '',
          privateKey: Deno.env.get('EMAILJS_PRIVATE_KEY') ?? undefined,
          templateParams: {
            to_email: a.created_by,
            to_name: a.created_by,
            from_name: 'Legal Space',
            subject_line: `Contract expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}: ${a.title || ''}`,
            intro_text: `"${a.title || 'This agreement'}"${a.account_name ? ` (${a.account_name})` : ''} is set to expire on ${a.end_date}, in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
            detail_line: 'Renew, amend, or let it lapse — just make sure someone looks at it before then.',
            cta_label: 'View agreement',
            cta_link: appBaseUrl ? `${appBaseUrl}/dashboard/agreements/${a.id}` : '',
            cc_email: '',
          },
        });
        sent += 1;

        const updatedSent = [...new Set([...alreadySent, ...crossed])];
        await supabase.from('agreements').update({ reminders_sent: updatedSent }).eq('id', a.id);
      } catch (err) {
        console.error(`Expiry reminder failed for agreement ${a.id}:`, err);
        failed += 1;
      }
    }

    return jsonResponse({ ok: true, checked: (agreements || []).length, sent, failed, skipped });
  } catch (err) {
    console.error('Expiry reminders error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Expiry reminders failed.' }, 500);
  }
});
