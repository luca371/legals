import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { sendEmailJs } from '../_shared/emailjs.ts';
import { sendGenericEmail } from '../_shared/notify.ts';

// Runs across every tenant, on a schedule (see the pg_cron job set up in
// SQL) — not a per-user action, so it always uses the service role key to
// bypass RLS rather than a caller's JWT.
const DEFAULT_THRESHOLDS = [30, 14, 7, 1];

serveWithCors(async (req) => {
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
      .select('id, tenant_id, title, account_name, end_date, status, created_by, reminders_sent, reminder_days_override')
      .eq('status', 'Activated')
      .not('end_date', 'is', null);

    if (error) throw error;

    const { data: tenantSettings, error: settingsError } = await supabase
      .from('tenant_settings')
      .select('tenant_id, reminder_days');
    if (settingsError) throw settingsError;

    const thresholdsByTenant = new Map<string, number[]>(
      (tenantSettings || []).map((s: { tenant_id: string; reminder_days: unknown }) => [
        s.tenant_id,
        Array.isArray(s.reminder_days) && s.reminder_days.length > 0 ? (s.reminder_days as number[]) : DEFAULT_THRESHOLDS,
      ])
    );

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

      // null override = use the tenant default; a (possibly empty) array
      // means this agreement has its own custom list, including "none".
      const thresholds = Array.isArray(a.reminder_days_override)
        ? a.reminder_days_override
        : thresholdsByTenant.get(a.tenant_id) || DEFAULT_THRESHOLDS;
      const alreadySent: number[] = Array.isArray(a.reminders_sent) ? a.reminders_sent : [];
      const crossed = thresholds.filter((t) => daysLeft <= t && !alreadySent.includes(t));
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
            from_name: 'EsoVia',
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

    const notices = await sendNoticeDeadlineReminders(supabase, thresholdsByTenant, today);
    const due = await sendDueReminders(supabase, today);

    return jsonResponse({ ok: true, checked: (agreements || []).length, sent, failed, skipped, notices, due });
  } catch (err) {
    console.error('Expiry reminders error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Expiry reminders failed.' }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function daysBetween(from: Date, isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  return Math.ceil((d.getTime() - from.getTime()) / 86400000);
}

// Notice deadlines: the last day to terminate or not renew. Same thresholds as
// the expiry reminders, tracked separately in notice_reminders_sent.
async function sendNoticeDeadlineReminders(supabase: Db, thresholdsByTenant: Map<string, number[]>, today: Date) {
  let sent = 0;
  let failed = 0;
  const { data: rows, error } = await supabase
    .from('agreements')
    .select('id, tenant_id, title, account_name, end_date, notice_deadline, notice_period_days, auto_renewal, created_by, notice_reminders_sent, reminder_days_override')
    .eq('status', 'Activated')
    .not('notice_deadline', 'is', null);
  if (error) {
    console.error('Notice reminders query failed:', error);
    return { sent, failed: 1 };
  }
  for (const a of (rows || []) as Row[]) {
    const daysLeft = daysBetween(today, a.notice_deadline);
    if (daysLeft < 0 || !a.created_by) continue;
    const thresholds: number[] = Array.isArray(a.reminder_days_override)
      ? a.reminder_days_override
      : thresholdsByTenant.get(a.tenant_id) || DEFAULT_THRESHOLDS;
    const already: number[] = Array.isArray(a.notice_reminders_sent) ? a.notice_reminders_sent : [];
    const crossed = thresholds.filter((t) => daysLeft <= t && !already.includes(t));
    if (crossed.length === 0) continue;
    try {
      await sendGenericEmail({
        toEmail: a.created_by,
        subject: `Notice deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}: ${a.title || ''}`,
        intro: `The last day to give notice on "${a.title || 'this agreement'}"${a.account_name ? ` (${a.account_name})` : ''} is ${a.notice_deadline}, in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        detail: a.auto_renewal
          ? 'It renews automatically if nobody gives notice by then.'
          : `The agreement ends on ${a.end_date}. Decide whether to renew, renegotiate or let it end.`,
        ctaLabel: 'View agreement',
        ctaPath: `/dashboard/agreements/${a.id}`,
      });
      sent += 1;
      await supabase
        .from('agreements')
        .update({ notice_reminders_sent: [...new Set([...already, ...crossed])] })
        .eq('id', a.id);
    } catch (err) {
      console.error(`Notice reminder failed for agreement ${a.id}:`, err);
      failed += 1;
    }
  }
  return { sent, failed };
}

// Open tasks due by tomorrow and open obligations due within a week: one email
// each, once.
async function sendDueReminders(supabase: Db, today: Date) {
  let sent = 0;
  let failed = 0;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (n: number) => new Date(today.getTime() + n * 86400000);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, details, due_date, assignee_email, created_by, agreement_id')
    .eq('status', 'open')
    .is('reminder_sent_at', null)
    .not('due_date', 'is', null)
    .lte('due_date', iso(plus(1)));
  for (const t of (tasks || []) as Row[]) {
    const to = t.assignee_email || t.created_by;
    if (!to) continue;
    const daysLeft = daysBetween(today, t.due_date);
    try {
      await sendGenericEmail({
        toEmail: to,
        subject: `${daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today' : 'Due tomorrow'}: ${t.title}`,
        intro: `The task "${t.title}" is due on ${t.due_date}.`,
        detail: t.details || '',
        ctaLabel: 'Open tasks',
        ctaPath: '/dashboard/tasks',
      });
      sent += 1;
      await supabase.from('tasks').update({ reminder_sent_at: new Date().toISOString() }).eq('id', t.id);
    } catch (err) {
      console.error(`Task reminder failed for ${t.id}:`, err);
      failed += 1;
    }
  }

  const { data: obligations } = await supabase
    .from('obligations')
    .select('id, description, due_date, responsible_party, agreement_id, agreements(title, created_by)')
    .eq('status', 'open')
    .is('reminder_sent_at', null)
    .not('due_date', 'is', null)
    .lte('due_date', iso(plus(7)));
  for (const o of (obligations || []) as Row[]) {
    const to = o.agreements?.created_by;
    if (!to) continue;
    try {
      await sendGenericEmail({
        toEmail: to,
        subject: `Obligation due ${o.due_date}: ${o.agreements?.title || 'agreement'}`,
        intro: `An obligation under "${o.agreements?.title || 'an agreement'}" is due on ${o.due_date}.`,
        detail: `${o.description}${o.responsible_party ? ` (responsible: ${o.responsible_party})` : ''}`,
        ctaLabel: 'View agreement',
        ctaPath: `/dashboard/agreements/${o.agreement_id}`,
      });
      sent += 1;
      await supabase.from('obligations').update({ reminder_sent_at: new Date().toISOString() }).eq('id', o.id);
    } catch (err) {
      console.error(`Obligation reminder failed for ${o.id}:`, err);
      failed += 1;
    }
  }
  return { sent, failed };
}
