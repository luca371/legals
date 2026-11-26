import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Row } from '../_shared/agent-docs.ts';

// A personal iCalendar feed that Outlook, Google Calendar or Apple Calendar
// subscribe to. Calendar apps cannot sign in, so the secret token in the URL is
// the key: it comes from my_calendar_token() and can be regenerated in
// Settings, which kills the old URL. Deployed with --no-verify-jwt.
//
// The feed holds: the user's open tasks (assigned to them, or created by them
// and assigned to nobody), and the notice deadlines and end dates of the
// organization's live agreements. All-day events.

const ENDED = ['Terminated', 'Expired', 'Cancelled'];

function esc(text: string) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets are folded, as the format requires.
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

// A case-insensitive exact match: "_" and "%" in an address are literal.
const likeExact = (value: string) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

const ymd = (iso: string) => iso.replace(/-/g, '');
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return new Response('Not found', { status: 404 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: owner } = await admin.from('calendar_tokens').select('tenant_id, email').eq('token', token).maybeSingle();
  if (!owner) return new Response('Not found', { status: 404 });

  // A deactivated user's feed stops working.
  const { data: user } = await admin
    .from('users')
    .select('is_active, is_deleted')
    .eq('tenant_id', owner.tenant_id)
    .ilike('email', likeExact(owner.email))
    .maybeSingle();
  if (!user?.is_active || user?.is_deleted) return new Response('Not found', { status: 404 });

  const appUrl = (Deno.env.get('APP_BASE_URL') || '').replace(/\/$/, '');
  const email = likeExact(String(owner.email).toLowerCase());
  const live = `(${ENDED.map((s) => `"${s}"`).join(',')})`;

  const [tasks, agreements] = await Promise.all([
    admin
      .from('tasks')
      .select('id, title, details, due_date, task_type, agreement_id, assignee_email, created_by')
      .eq('tenant_id', owner.tenant_id)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .or(`assignee_email.ilike.${email},and(assignee_email.is.null,created_by.ilike.${email})`)
      .limit(500),
    admin
      .from('agreements')
      .select('id, title, account_name, end_date, notice_deadline, auto_renewal')
      .eq('tenant_id', owner.tenant_id)
      .not('status', 'in', live)
      .or('end_date.not.is.null,notice_deadline.not.is.null')
      .limit(1000),
  ]);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events: string[] = [];
  const add = (uid: string, date: string, summary: string, description: string, link: string) => {
    events.push(
      [
        'BEGIN:VEVENT',
        `UID:${uid}@esovia`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(date)}`,
        `DTEND;VALUE=DATE:${nextDay(date)}`,
        fold(`SUMMARY:${esc(summary)}`),
        fold(`DESCRIPTION:${esc(description)}`),
        appUrl ? fold(`URL:${appUrl}${link}`) : '',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ]
        .filter(Boolean)
        .join('\r\n')
    );
  };

  for (const t of (tasks.data || []) as Row[]) {
    add(`task-${t.id}`, t.due_date, `Task: ${t.title}`, t.details || '', '/dashboard/tasks');
  }
  for (const a of (agreements.data || []) as Row[]) {
    const label = `${a.title || 'Agreement'}${a.account_name ? ` (${a.account_name})` : ''}`;
    if (a.notice_deadline) {
      add(`notice-${a.id}`, a.notice_deadline, `Notice deadline: ${label}`,
        a.auto_renewal ? 'Renews automatically unless notice is given by today.' : 'Last day to give notice.',
        `/dashboard/agreements/${a.id}`);
    }
    if (a.end_date) {
      add(`end-${a.id}`, a.end_date, `Agreement ends: ${label}`, '', `/dashboard/agreements/${a.id}`);
    }
  }

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EsoVia//Contract deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:EsoVia deadlines',
    'X-PUBLISHED-TTL:PT1H',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="esovia.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
});
