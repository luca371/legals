import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { screenAccountData } from '../_shared/screening.ts';
import { accountPlaybooks, actionAllowed } from '../_shared/playbooks.ts';
import { AI_FUNCTIONS } from '../_shared/ratelimit.ts';
import { sendGenericEmail } from '../_shared/notify.ts';
import type { Row } from '../_shared/agent-docs.ts';

// Weekly portfolio monitoring, for organizations that switched it on (Admin >
// AI features). Screens the accounts with live agreements - least recently
// screened first - and emails a digest of the week: notice deadlines and end
// dates coming up, overdue tasks and obligations, and screening flags.
// Invoked by pg_cron with the shared secret (deployed with --no-verify-jwt).

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const MAX_ACCOUNTS_PER_TENANT = 24;
const PARALLEL = 4;
const TIME_BUDGET_MS = 110_000;
const ENDED = ['Terminated', 'Expired', 'Cancelled'];

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
  const report: Row[] = [];

  try {
    const { data: tenants, error } = await admin
      .from('tenant_settings')
      .select('tenant_id, ai_features, monitoring_recipients')
      .eq('weekly_monitoring', true);
    if (error) throw error;

    for (const t of tenants || []) {
      try {
        report.push(await monitorTenant(admin, t, started));
      } catch (err) {
        console.error(`Monitoring failed for tenant ${t.tenant_id}:`, err);
        report.push({ tenantId: t.tenant_id, error: true });
      }
    }
    return jsonResponse({ ok: true, report });
  } catch (err) {
    console.error('Portfolio monitor error:', err);
    return jsonResponse({ error: 'Portfolio monitor failed.' }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function monitorTenant(admin: any, settings: Row, started: number) {
  const tenantId = settings.tenant_id as string;
  const features = settings.ai_features || {};
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // -- screening ---------------------------------------------------------------
  const screenings: { account: Row; result: Row }[] = [];
  let screeningStopped = '';
  if (features.screening === false) {
    screeningStopped = 'Account screening is turned off.';
  } else {
    const { data: live } = await admin
      .from('agreements')
      .select('account_id')
      .eq('tenant_id', tenantId)
      .not('account_id', 'is', null)
      .not('status', 'in', `(${ENDED.map((s) => `"${s}"`).join(',')})`)
      .limit(1000);
    const accountIds = [...new Set((live || []).map((a: Row) => a.account_id))];
    const { data: accounts } = accountIds.length
      ? await admin
          .from('accounts')
          .select('id, name, country, city, address, tax_registration_number, abbreviation, registered_office, status, custom_fields, created_at, last_screening')
          .eq('tenant_id', tenantId)
          .in('id', accountIds)
      : { data: [] };
    const queue = (accounts || [])
      .sort((a: Row, b: Row) => String(a.last_screening?.generatedAt || '').localeCompare(String(b.last_screening?.generatedAt || '')))
      .slice(0, MAX_ACCOUNTS_PER_TENANT);

    const { feature, cost } = AI_FUNCTIONS['agent-account-screening'];
    const work = async (account: Row) => {
      if (screeningStopped || Date.now() - started > TIME_BUDGET_MS) return;
      const playbooks = await accountPlaybooks(admin, account.id);
      if (!actionAllowed(playbooks, 'screening')) return;

      const { data: gate } = await admin.rpc('ai_consume', {
        p_user: SYSTEM_USER,
        p_tenant: tenantId,
        p_fn: 'portfolio-monitor',
        p_feature: feature,
        p_cost: cost,
        p_limit: 100000,
      });
      if (gate && gate !== 'ok') {
        screeningStopped = gate === 'no_credits' ? 'Out of AI credits.' : 'Account screening is turned off.';
        return;
      }

      const { data: run } = await admin
        .from('agent_runs')
        .insert({ tenant_id: tenantId, user_id: SYSTEM_USER, actor_email: 'weekly monitoring', agent: 'account_screening', subject_type: 'account', subject_id: account.id })
        .select('id')
        .single();
      try {
        const screened = await screenAccountData(admin, tenantId, account, playbooks);
        const result = { ...screened.result, runId: run?.id ?? null, source: 'weekly' };
        await admin.from('accounts').update({ last_screening: result }).eq('id', account.id).eq('tenant_id', tenantId);
        if (run?.id) {
          await admin.from('agent_runs').update({
            status: 'done', steps: 1, input_tokens: screened.inputTokens, output_tokens: screened.outputTokens, finished_at: new Date().toISOString(),
          }).eq('id', run.id);
        }
        screenings.push({ account, result });
      } catch (err) {
        console.error(`Screening failed for account ${account.id}:`, err);
        if (run?.id) {
          await admin.from('agent_runs').update({
            status: 'failed', error: (err instanceof Error ? err.message : 'failed').slice(0, 500), finished_at: new Date().toISOString(),
          }).eq('id', run.id);
        }
      }
    };
    for (let i = 0; i < queue.length; i += PARALLEL) {
      await Promise.all(queue.slice(i, i + PARALLEL).map(work));
    }
  }

  // -- the week ahead ------------------------------------------------------------
  const live = `(${ENDED.map((s) => `"${s}"`).join(',')})`;
  const [notices, endings, overdueTasks, overdueObligations] = await Promise.all([
    admin.from('agreements').select('id, title, account_name, notice_deadline, auto_renewal').eq('tenant_id', tenantId)
      .not('status', 'in', live).gte('notice_deadline', today).lte('notice_deadline', in30).order('notice_deadline').limit(20),
    admin.from('agreements').select('id, title, account_name, end_date').eq('tenant_id', tenantId)
      .not('status', 'in', live).gte('end_date', today).lte('end_date', in30).order('end_date').limit(20),
    admin.from('tasks').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'open').lt('due_date', today),
    admin.from('obligations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'open').lt('due_date', today),
  ]);

  const flagged = screenings
    .filter((s) => s.result.overall !== 'clear')
    .sort((a, b) => (a.result.overall === 'critical' ? -1 : 0) - (b.result.overall === 'critical' ? -1 : 0));

  const lines: string[] = [];
  if ((notices.data || []).length) {
    lines.push('NOTICE DEADLINES IN THE NEXT 30 DAYS');
    for (const a of notices.data) lines.push(`- ${a.notice_deadline}: ${a.title}${a.account_name ? ` (${a.account_name})` : ''}${a.auto_renewal ? ' - renews automatically' : ''}`);
  }
  if ((endings.data || []).length) {
    lines.push('', 'AGREEMENTS ENDING IN THE NEXT 30 DAYS');
    for (const a of endings.data) lines.push(`- ${a.end_date}: ${a.title}${a.account_name ? ` (${a.account_name})` : ''}`);
  }
  if ((overdueTasks.count ?? 0) || (overdueObligations.count ?? 0)) {
    lines.push('', `OVERDUE: ${overdueTasks.count ?? 0} task(s), ${overdueObligations.count ?? 0} obligation(s)`);
  }
  if (flagged.length) {
    lines.push('', 'ACCOUNT SCREENING');
    for (const s of flagged.slice(0, 10)) {
      const top = s.result.flags?.[0];
      lines.push(`- ${s.account.name}: ${s.result.overall === 'critical' ? 'CRITICAL' : 'needs attention'}${top ? ` - ${top.finding}` : ''}`);
    }
  }
  if (screeningStopped) lines.push('', `Screening skipped: ${screeningStopped}`);
  if (!lines.length) lines.push('Nothing needs attention this week.');

  // -- who gets it -----------------------------------------------------------------
  let recipients = String(settings.monitoring_recipients || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^\S+@\S+\.\S+$/.test(e));
  if (!recipients.length) {
    const { data: admins } = await admin
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('profile', 'admin')
      .eq('is_active', true);
    recipients = (admins || []).map((u: Row) => String(u.email || '').toLowerCase()).filter(Boolean);
  }

  const subject = `Weekly portfolio digest: ${(notices.data || []).length} notice deadline(s), ${flagged.length} account(s) flagged`;
  let sent = 0;
  for (const to of [...new Set(recipients)]) {
    try {
      await sendGenericEmail({
        toEmail: to,
        subject,
        intro: 'Here is what needs attention in your contract portfolio this week.',
        detail: lines.join('\n'),
        ctaLabel: 'Open the dashboard',
        ctaPath: '/dashboard/dashboards',
      });
      sent += 1;
    } catch (err) {
      console.error(`Digest email to ${to} failed:`, err);
    }
    await admin.rpc('notify', {
      p_tenant: tenantId,
      p_email: to,
      p_kind: 'digest',
      p_title: subject,
      p_body: lines.slice(0, 12).join('\n'),
      p_link: '/dashboard/dashboards',
    });
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor_email: 'weekly monitoring',
    action: 'agent_run',
    object_type: 'settings',
    object_id: tenantId,
    object_label: 'Weekly portfolio monitoring',
    details: { screened: screenings.length, flagged: flagged.length, recipients: recipients.length, stopped: screeningStopped || null },
  });

  return { tenantId, screened: screenings.length, flagged: flagged.length, emailed: sent };
}
