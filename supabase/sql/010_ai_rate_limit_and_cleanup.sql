-- 010: per-user hourly limit on the AI Edge Functions, plus advisor cleanup.

-- 1. AI usage limit --------------------------------------------------------
-- Every AI call is recorded; ai_usage_hit() refuses once a user has made
-- p_limit calls in the last hour. Only the service role (Edge Functions) can
-- read the table or call the function.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  tenant_id uuid,
  fn text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_time on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.ai_usage_hit(p_user uuid, p_tenant uuid, p_fn text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- One user's calls are counted one at a time, so parallel calls cannot
  -- all slip under the limit together.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_user::text));

  select count(*) into n
  from public.ai_usage
  where user_id = p_user and created_at > now() - interval '1 hour';
  if n >= p_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, tenant_id, fn) values (p_user, p_tenant, p_fn);

  -- Keep the table small.
  if random() < 0.01 then
    delete from public.ai_usage where created_at < now() - interval '2 days';
  end if;
  return true;
end;
$$;

revoke execute on function public.ai_usage_hit(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(uuid, uuid, text, int) to service_role;

-- 2. Advisor: fixed search_path ---------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('users_sync_admin_flag', 'users_keep_one_admin', 'match_objects')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;

-- 3. Advisor: helper functions not callable by signed-out visitors ------------
-- Signed-in users still need them: RLS policies call them.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('current_profile', 'current_tenant_id', 'get_my_tenant_id', 'is_admin_profile', 'is_writer')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;

  -- An event-trigger function: nobody calls it through the API.
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
