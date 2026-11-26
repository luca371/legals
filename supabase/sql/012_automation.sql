-- 012: AI automation add-on.
--   1. Notice periods and deadlines on agreements.
--   2. AI features that can be switched on and off per organization, paid with
--      usage-based credits.
--   3. Structured playbooks: obligations, review and screening criteria, and
--      the agent actions allowed on the accounts they are assigned to.
--   4. Tasks, plus reminder tracking on tasks and obligations.
--   5. Account screening results.

-- 1. Notice -------------------------------------------------------------------
alter table public.agreements add column if not exists notice_period_days int;
alter table public.agreements add column if not exists auto_renewal boolean;
alter table public.agreements add column if not exists notice_reminders_sent jsonb not null default '[]'::jsonb;
-- Last day to give notice: the end date minus the notice period.
alter table public.agreements add column if not exists notice_deadline date
  generated always as (
    case when end_date is not null and notice_period_days is not null
         then end_date - notice_period_days end
  ) stored;

-- 2. Features and credits ---------------------------------------------------
-- Which AI features an organization uses: {"drafting": false, ...}. A missing
-- key means on. Admins change it from the Admin screen.
alter table public.tenant_settings add column if not exists ai_features jsonb not null default '{}'::jsonb;

-- The credit balance. No API write access: credits are added only by the
-- platform owner with grant_credits(), and spent only by ai_consume().
create table if not exists public.tenant_credits (
  tenant_id uuid primary key,
  balance int not null default 0,
  enforced boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.tenant_credits enable row level security;
revoke all on public.tenant_credits from anon, authenticated;

-- Every change to a balance: grants (positive) and charges (negative).
create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  user_id uuid,
  delta int not null,
  feature text,
  fn text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_tenant_time on public.credit_ledger (tenant_id, created_at desc);
alter table public.credit_ledger enable row level security;
revoke all on public.credit_ledger from anon, authenticated;

alter table public.ai_usage add column if not exists feature text;
alter table public.ai_usage add column if not exists credits int not null default 0;

-- The one gate every AI Edge Function passes. Checks, in order: the feature is
-- on for the organization, the user is under the hourly limit, and (when the
-- organization pays with credits) there are enough credits. Then records the
-- call and charges it. Returns 'ok', 'feature_disabled', 'rate_limited' or
-- 'no_credits'.
create or replace function public.ai_consume(
  p_user uuid, p_tenant uuid, p_fn text, p_feature text, p_cost int, p_limit int
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  flag text;
  credits public.tenant_credits%rowtype;
begin
  if p_feature is not null and p_feature <> 'core' then
    select ai_features ->> p_feature into flag from public.tenant_settings where tenant_id = p_tenant;
    if flag = 'false' then
      return 'feature_disabled';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_user::text));
  select count(*) into n from public.ai_usage
  where user_id = p_user and created_at > now() - interval '1 hour';
  if n >= p_limit then
    return 'rate_limited';
  end if;

  select * into credits from public.tenant_credits where tenant_id = p_tenant for update;
  if found and credits.enforced and p_cost > 0 then
    if credits.balance < p_cost then
      return 'no_credits';
    end if;
    update public.tenant_credits set balance = balance - p_cost, updated_at = now() where tenant_id = p_tenant;
    insert into public.credit_ledger (tenant_id, user_id, delta, feature, fn)
    values (p_tenant, p_user, -p_cost, p_feature, p_fn);
  end if;

  insert into public.ai_usage (user_id, tenant_id, fn, feature, credits)
  values (p_user, p_tenant, p_fn, p_feature, greatest(p_cost, 0));

  if random() < 0.01 then
    delete from public.ai_usage where created_at < now() - interval '120 days';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.ai_consume(uuid, uuid, text, text, int, int) from public, anon, authenticated;
grant execute on function public.ai_consume(uuid, uuid, text, text, int, int) to service_role;

-- Platform owner only (SQL editor or service role):
--   select public.grant_credits('<tenant id>', 1000, 'Invoice 2026-001');
--   select public.set_credits_enforced('<tenant id>', true);
create or replace function public.grant_credits(p_tenant uuid, p_amount int, p_note text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  insert into public.tenant_credits (tenant_id, balance) values (p_tenant, p_amount)
  on conflict (tenant_id) do update set balance = public.tenant_credits.balance + p_amount, updated_at = now()
  returning balance into new_balance;
  insert into public.credit_ledger (tenant_id, delta, note) values (p_tenant, p_amount, coalesce(p_note, 'Credits added'));
  return new_balance;
end;
$$;
revoke execute on function public.grant_credits(uuid, int, text) from public, anon, authenticated;

create or replace function public.set_credits_enforced(p_tenant uuid, p_enforced boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.tenant_credits (tenant_id, enforced) values (p_tenant, p_enforced)
  on conflict (tenant_id) do update set enforced = excluded.enforced, updated_at = now();
$$;
revoke execute on function public.set_credits_enforced(uuid, boolean) from public, anon, authenticated;

-- What the Admin screen shows: the caller's own organization only, admins only.
create or replace function public.my_credit_status()
returns table (balance int, enforced boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(c.balance, 0), coalesce(c.enforced, false)
  from (select public.get_my_tenant_id() as tenant_id) t
  left join public.tenant_credits c on c.tenant_id = t.tenant_id
  where public.is_admin_profile()
$$;
revoke execute on function public.my_credit_status() from public, anon;
grant execute on function public.my_credit_status() to authenticated;

create or replace function public.my_ai_usage(p_days int default 30)
returns table (feature text, calls bigint, credits bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(u.feature, 'other'), count(*), coalesce(sum(u.credits), 0)
  from public.ai_usage u
  where u.tenant_id = public.get_my_tenant_id()
    and public.is_admin_profile()
    and u.created_at > now() - make_interval(days => least(greatest(p_days, 1), 120))
  group by 1
  order by 3 desc, 2 desc
$$;
revoke execute on function public.my_ai_usage(int) from public, anon;
grant execute on function public.my_ai_usage(int) to authenticated;

-- 3. Structured playbooks ---------------------------------------------------
alter table public.playbooks add column if not exists obligations text not null default '';
alter table public.playbooks add column if not exists review_criteria text not null default '';
alter table public.playbooks add column if not exists screening_criteria text not null default '';
-- null = every agent action allowed; otherwise the list of allowed actions.
alter table public.playbooks add column if not exists permitted_actions jsonb;

-- 4. Tasks ------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null,
  details text not null default '',
  task_type text not null default 'other'
    check (task_type in ('review', 'approval', 'signature', 'renewal', 'obligation', 'other')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_date date,
  assignee_email text,
  agreement_id uuid references public.agreements(id) on delete cascade,
  account_id uuid,
  obligation_id uuid references public.obligations(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reminder_sent_at timestamptz
);
create index if not exists tasks_tenant_status_due on public.tasks (tenant_id, status, due_date);
create index if not exists tasks_agreement on public.tasks (agreement_id);

alter table public.tasks enable row level security;
revoke all on public.tasks from anon;

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.is_writer());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_writer())
  with check (tenant_id = public.current_tenant_id() and public.is_writer());
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_writer());

alter table public.obligations add column if not exists reminder_sent_at timestamptz;

-- 5. Account screening --------------------------------------------------------
-- Written by the screening agent (service role); read with the account.
alter table public.accounts add column if not exists last_screening jsonb;
