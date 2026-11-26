-- 013: automation driven by events, notifications, calendar feed.
--   1. Tasks created and closed automatically (agreement activated, approval /
--      review / signature started and finished) plus admin-defined rules.
--   2. Recurring obligations roll forward when one is done.
--   3. In-app notifications.
--   4. Personal calendar feed tokens.
--   5. Approval rules on playbooks, weekly monitoring setting.
-- Every trigger catches its own errors: an automation that fails must never
-- block the save that set it off.

-- 0. Columns ------------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check check (source in ('manual', 'agent', 'automation'));
-- What an automatic task follows, so it can close itself: 'approval', 'review',
-- 'signature', 'obligation' or 'rule'.
alter table public.tasks add column if not exists auto_kind text;
alter table public.tasks add column if not exists batch_id uuid;

alter table public.playbooks add column if not exists approval_rules text not null default '';

alter table public.tenant_settings add column if not exists weekly_monitoring boolean not null default false;
alter table public.tenant_settings add column if not exists monitoring_recipients text not null default '';

-- 1. Notifications -------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  recipient_email text not null,
  kind text not null default 'info',
  title text not null,
  body text not null default '',
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_recipient on public.notifications (tenant_id, recipient_email, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
revoke insert, delete on public.notifications from authenticated;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
  using (tenant_id = public.current_tenant_id() and recipient_email = lower(auth.jwt() ->> 'email'));
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (tenant_id = public.current_tenant_id() and recipient_email = lower(auth.jwt() ->> 'email'))
  with check (tenant_id = public.current_tenant_id() and recipient_email = lower(auth.jwt() ->> 'email'));

create or replace function public.notify(p_tenant uuid, p_email text, p_kind text, p_title text, p_body text, p_link text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant is null or coalesce(trim(p_email), '') = '' then
    return;
  end if;
  insert into public.notifications (tenant_id, recipient_email, kind, title, body, link)
  values (p_tenant, lower(trim(p_email)), coalesce(p_kind, 'info'), left(p_title, 300), left(coalesce(p_body, ''), 1000), p_link);
end;
$$;
revoke execute on function public.notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- 2. Automation rules ----------------------------------------------------------
-- "When an agreement's status becomes X, create task Y due in N days for Z."
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null default '',
  trigger_status text not null,
  task_title text not null,
  task_type text not null default 'other'
    check (task_type in ('review', 'approval', 'signature', 'renewal', 'obligation', 'other')),
  due_in_days int check (due_in_days is null or due_in_days between 0 and 3650),
  -- 'creator' (whoever created the agreement) or an email address
  assignee text not null default 'creator',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.automation_rules enable row level security;
revoke all on public.automation_rules from anon;
drop policy if exists automation_rules_read on public.automation_rules;
create policy automation_rules_read on public.automation_rules for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin_profile())
  with check (tenant_id = public.current_tenant_id() and public.is_admin_profile());

-- Position in the agreement pipeline (same order as the app).
create or replace function public.pipeline_index(p_status text) returns int
language sql immutable as $$
  select array_position(
    array['Draft', 'Generated', 'Import offline', 'In review', 'Reviewed', 'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated'],
    p_status
  )
$$;

create or replace function public.close_auto_tasks(p_agreement uuid, p_kind text, p_batch uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tasks
  set status = 'done', completed_at = now()
  where agreement_id = p_agreement
    and status = 'open'
    and source = 'automation'
    and auto_kind = p_kind
    and (p_batch is null or batch_id = p_batch);
$$;
revoke execute on function public.close_auto_tasks(uuid, text, uuid) from public, anon, authenticated;

-- 2a. Agreement status changes
create or replace function public.agreements_status_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  idx int := public.pipeline_index(new.status);
begin
  begin
    -- Activated: every open obligation with a date becomes a task.
    if new.status = 'Activated' then
      insert into public.tasks (tenant_id, title, details, task_type, due_date, agreement_id, account_id, obligation_id, source, auto_kind, created_by)
      select new.tenant_id, left(o.description, 200), coalesce(o.clause, ''), 'obligation', o.due_date, new.id, new.account_id, o.id,
             'automation', 'obligation', new.created_by
      from public.obligations o
      where o.agreement_id = new.id and o.status = 'open' and o.due_date is not null
        and not exists (select 1 from public.tasks t where t.obligation_id = o.id and t.status = 'open');
    end if;

    -- Follow-up tasks close once the agreement has moved past their stage.
    if idx is not null then
      if idx >= public.pipeline_index('Reviewed') then perform public.close_auto_tasks(new.id, 'review'); end if;
      if idx >= public.pipeline_index('Approved') then perform public.close_auto_tasks(new.id, 'approval'); end if;
      if idx >= public.pipeline_index('Signed') then perform public.close_auto_tasks(new.id, 'signature'); end if;
    end if;

    if new.status = 'Signed' then
      perform public.notify(new.tenant_id, new.created_by, 'signed', 'Agreement signed: ' || coalesce(new.title, ''),
        'All parties have signed.', '/dashboard/agreements/' || new.id);
    end if;

    -- Admin-defined rules.
    for r in
      select * from public.automation_rules
      where tenant_id = new.tenant_id and enabled and trigger_status = new.status
    loop
      insert into public.tasks (tenant_id, title, task_type, due_date, assignee_email, agreement_id, account_id, source, auto_kind, created_by, details)
      values (
        new.tenant_id,
        left(replace(r.task_title, '{title}', coalesce(new.title, '')), 200),
        r.task_type,
        case when r.due_in_days is null then null else current_date + r.due_in_days end,
        case when r.assignee = 'creator' then null else nullif(trim(r.assignee), '') end,
        new.id, new.account_id, 'automation', 'rule', new.created_by,
        'Created by the automation rule "' || coalesce(nullif(r.name, ''), r.task_title) || '".'
      );
    end loop;
  exception when others then
    raise warning 'agreements_status_automation failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists agreements_status_automation on public.agreements;
create trigger agreements_status_automation
  after update of status on public.agreements
  for each row when (old.status is distinct from new.status)
  execute function public.agreements_status_automation();

-- 2b. A DocuSign envelope was added: follow up on the signatures.
create or replace function public.agreements_envelope_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest jsonb;
begin
  begin
    if jsonb_typeof(new.docusign_envelopes) = 'array'
       and jsonb_array_length(new.docusign_envelopes) > coalesce(case when jsonb_typeof(old.docusign_envelopes) = 'array' then jsonb_array_length(old.docusign_envelopes) end, 0) then
      latest := new.docusign_envelopes -> (jsonb_array_length(new.docusign_envelopes) - 1);
      if coalesce((latest ->> 'manual')::boolean, false) = false then
        insert into public.tasks (tenant_id, title, task_type, due_date, agreement_id, account_id, source, auto_kind, created_by, details)
        values (new.tenant_id, 'Get signatures: ' || left(coalesce(new.title, ''), 170), 'signature', current_date + 5,
                new.id, new.account_id, 'automation', 'signature', new.created_by,
                'Sent for signature with DocuSign. Closes on its own when everyone has signed.');
      end if;
    end if;
  exception when others then
    raise warning 'agreements_envelope_automation failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists agreements_envelope_automation on public.agreements;
create trigger agreements_envelope_automation
  after update of docusign_envelopes on public.agreements
  for each row execute function public.agreements_envelope_automation();

-- 2c. Approval and review requests: one follow-up task per chain, a
-- notification for each answer, and the task closes when the chain is done.
create or replace function public.request_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := case when tg_table_name = 'approval_requests' then 'approval' else 'review' end;
  ag record;
  who text;
  pending int;
begin
  begin
    select id, tenant_id, title, account_id, created_by into ag from public.agreements where id = new.agreement_id;
    if not found then
      return new;
    end if;

    if tg_op = 'INSERT' then
      if coalesce(new.sequence, 1) = 1 then
        insert into public.tasks (tenant_id, title, task_type, due_date, agreement_id, account_id, source, auto_kind, batch_id, created_by, details)
        values (ag.tenant_id,
                (case when kind = 'approval' then 'Get approval: ' else 'Get review: ' end) || left(coalesce(ag.title, ''), 170),
                kind, current_date + 3, ag.id, ag.account_id, 'automation', kind, new.batch_id, ag.created_by,
                'Closes on its own when the ' || kind || ' chain is complete.');
      end if;
      return new;
    end if;

    -- UPDATE: an answer came in.
    if new.status is distinct from old.status and new.status <> 'Pending' then
      -- The two tables name their columns differently; each branch only
      -- touches its own table's fields.
      if kind = 'approval' then
        who := coalesce(nullif(new.approver_name, ''), new.approver_email);
        perform public.notify(ag.tenant_id, ag.created_by, kind,
          coalesce(who, 'Someone') || ' ' || lower(new.status) || ': ' || coalesce(ag.title, ''),
          coalesce(new.comment, ''), '/dashboard/agreements/' || ag.id);
      else
        who := coalesce(nullif(new.reviewer_name, ''), new.reviewer_email);
        perform public.notify(ag.tenant_id, ag.created_by, kind,
          coalesce(who, 'Someone') || ' ' || lower(new.status) || ' changes: ' || coalesce(ag.title, ''),
          'Open the agreement to accept or reject them.', '/dashboard/agreements/' || ag.id);
      end if;

      if tg_table_name = 'approval_requests' then
        select count(*) into pending from public.approval_requests
        where batch_id is not distinct from new.batch_id and agreement_id = new.agreement_id and status = 'Pending';
      else
        select count(*) into pending from public.review_requests
        where batch_id is not distinct from new.batch_id and agreement_id = new.agreement_id and status = 'Pending';
      end if;
      if pending = 0 or new.status = 'Rejected' then
        perform public.close_auto_tasks(ag.id, kind, new.batch_id);
      end if;
    end if;
  exception when others then
    raise warning 'request_automation failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists approval_requests_automation on public.approval_requests;
create trigger approval_requests_automation
  after insert or update of status on public.approval_requests
  for each row execute function public.request_automation();

drop trigger if exists review_requests_automation on public.review_requests;
create trigger review_requests_automation
  after insert or update of status on public.review_requests
  for each row execute function public.request_automation();

-- 2d. A task assigned to someone else tells them.
create or replace function public.tasks_assign_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient text := coalesce(nullif(new.assignee_email, ''), nullif(new.created_by, ''));
begin
  begin
    -- Everyone gets a notification for a new task they own, including the ones
    -- they set for themselves (no assignee = the creator). Automation tasks
    -- notify their owner too. Reassigning notifies the new assignee.
    if recipient is not null
       and recipient like '%@%'
       and (tg_op = 'INSERT' or lower(coalesce(old.assignee_email, '')) <> lower(coalesce(new.assignee_email, ''))) then
      perform public.notify(new.tenant_id, recipient, 'task', 'New task: ' || new.title,
        case when new.due_date is null then '' else 'Due ' || new.due_date end, '/dashboard/tasks');
    end if;
  exception when others then
    raise warning 'tasks_assign_notify failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists tasks_assign_notify on public.tasks;
create trigger tasks_assign_notify
  after insert or update of assignee_email on public.tasks
  for each row execute function public.tasks_assign_notify();

-- 3. Recurring obligations ------------------------------------------------------
create or replace function public.recurrence_interval(p_recurrence text) returns interval
language sql immutable as $$
  select case
    when p_recurrence ~* '(bi-?weekly|every two weeks|fortnight)' then interval '14 days'
    when p_recurrence ~* '(^|\W)(weekly|every week)' then interval '7 days'
    when p_recurrence ~* '(^|\W)(monthly|every month)' then interval '1 month'
    when p_recurrence ~* '(quarter)' then interval '3 months'
    when p_recurrence ~* '(semi-?annual|half-?year|every six months|biannual)' then interval '6 months'
    when p_recurrence ~* '(annual|yearly|every year)' then interval '1 year'
    else null
  end
$$;

create or replace function public.obligations_recur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  step interval := public.recurrence_interval(coalesce(new.recurrence, ''));
  next_due date;
  ends date;
begin
  begin
    if new.status = 'done' and old.status is distinct from 'done' and step is not null and new.due_date is not null then
      next_due := (new.due_date + step)::date;
      select end_date into ends from public.agreements where id = new.agreement_id;
      if (ends is null or next_due <= ends)
         and not exists (select 1 from public.obligations o
                         where o.agreement_id = new.agreement_id and o.description = new.description
                           and o.due_date = next_due) then
        insert into public.obligations (tenant_id, agreement_id, description, responsible_party, due_date, recurrence,
                                        trigger_text, clause, source_quote, status, source, created_by)
        values (new.tenant_id, new.agreement_id, new.description, new.responsible_party, next_due, new.recurrence,
                new.trigger_text, new.clause, new.source_quote, 'open', new.source, new.created_by);
      end if;
    end if;
  exception when others then
    raise warning 'obligations_recur failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists obligations_recur on public.obligations;
create trigger obligations_recur
  after update of status on public.obligations
  for each row execute function public.obligations_recur();

-- 4. Calendar feed tokens ------------------------------------------------------
-- A secret URL per user that Outlook / Google Calendar subscribe to.
create table if not exists public.calendar_tokens (
  user_id uuid primary key,
  tenant_id uuid not null,
  email text not null,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
revoke all on public.calendar_tokens from anon, authenticated;

create or replace function public.my_calendar_token(p_regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  tenant uuid := public.get_my_tenant_id();
begin
  if auth.uid() is null or tenant is null then
    return null;
  end if;
  if not p_regenerate then
    select token into t from public.calendar_tokens where user_id = auth.uid();
    if t is not null then
      return t;
    end if;
  end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.calendar_tokens (user_id, tenant_id, email, token)
  values (auth.uid(), tenant, lower(coalesce(auth.jwt() ->> 'email', '')), t)
  on conflict (user_id) do update set token = excluded.token, tenant_id = excluded.tenant_id, email = excluded.email, created_at = now();
  return t;
end;
$$;
revoke execute on function public.my_calendar_token(boolean) from public, anon;
grant execute on function public.my_calendar_token(boolean) to authenticated;

-- 3b. Obligations and their tasks stay in step: finishing one finishes the
-- other, and the next occurrence of a recurring obligation gets its own task
-- once the agreement is active.
create or replace function public.obligations_recur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  step interval := public.recurrence_interval(coalesce(new.recurrence, ''));
  next_due date;
  ag record;
  next_id uuid;
begin
  begin
    if new.status = 'done' and old.status is distinct from 'done' then
      update public.tasks set status = 'done', completed_at = now()
      where obligation_id = new.id and status = 'open';

      if step is not null and new.due_date is not null then
        next_due := (new.due_date + step)::date;
        select id, tenant_id, end_date, status, account_id, created_by into ag from public.agreements where id = new.agreement_id;
        if (ag.end_date is null or next_due <= ag.end_date)
           and not exists (select 1 from public.obligations o
                           where o.agreement_id = new.agreement_id and o.description = new.description
                             and o.due_date = next_due) then
          insert into public.obligations (tenant_id, agreement_id, description, responsible_party, due_date, recurrence,
                                          trigger_text, clause, source_quote, status, source, created_by)
          values (new.tenant_id, new.agreement_id, new.description, new.responsible_party, next_due, new.recurrence,
                  new.trigger_text, new.clause, new.source_quote, 'open', new.source, new.created_by)
          returning id into next_id;

          if ag.status = 'Activated' then
            insert into public.tasks (tenant_id, title, details, task_type, due_date, agreement_id, account_id, obligation_id, source, auto_kind, created_by)
            values (new.tenant_id, left(new.description, 200), coalesce(new.clause, ''), 'obligation', next_due,
                    new.agreement_id, ag.account_id, next_id, 'automation', 'obligation', ag.created_by);
          end if;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'obligations_recur failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.tasks_obligation_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.obligation_id is not null and new.status = 'done' and old.status is distinct from 'done' then
      update public.obligations set status = 'done', completed_at = now()
      where id = new.obligation_id and status = 'open';
    end if;
  exception when others then
    raise warning 'tasks_obligation_sync failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists tasks_obligation_sync on public.tasks;
create trigger tasks_obligation_sync
  after update of status on public.tasks
  for each row execute function public.tasks_obligation_sync();

-- The Edge Functions (service role) also send notifications.
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;
