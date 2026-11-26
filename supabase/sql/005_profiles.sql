-- Profiles: admin / writer / reader.  Run once in the SQL Editor.
--
--   admin   everything a writer can do, plus users, settings, integrations, audit log
--   writer  create / edit / delete / activate / send for signature (agreements, accounts, templates, playbooks, clauses)
--   reader  read only (can still use Ask E and their own conversations)
--
-- The UI hides what a profile cannot do, but THIS file is the real enforcement:
-- RESTRICTIVE policies are ANDed with whatever policies already exist on each
-- table, so they cannot be bypassed by calling the API directly.

-- 1. Column -------------------------------------------------------------------
alter table public.users add column if not exists profile text;

-- Existing admins stay admins; everyone else keeps working as a writer so
-- nobody is locked out by this migration. Demote people to reader from Admin.
update public.users set profile = case when is_admin then 'admin' else 'writer' end where profile is null;

alter table public.users alter column profile set default 'reader';
alter table public.users alter column profile set not null;

alter table public.users drop constraint if exists users_profile_check;
alter table public.users add constraint users_profile_check check (profile in ('admin', 'writer', 'reader'));

-- 2. Keep the legacy is_admin flag in step -----------------------------------
-- Older policies and code still read is_admin; profile is the source of truth.
create or replace function public.users_sync_admin_flag() returns trigger
language plpgsql as $$
begin
  new.is_admin := (new.profile = 'admin');
  return new;
end $$;

drop trigger if exists users_sync_admin_flag on public.users;
create trigger users_sync_admin_flag before insert or update of profile on public.users
  for each row execute function public.users_sync_admin_flag();

-- 3. Never lose the last admin of a tenant ------------------------------------
create or replace function public.users_keep_one_admin() returns trigger
language plpgsql as $$
begin
  if old.profile = 'admin' and old.is_active and not coalesce(old.is_deleted, false)
     and (new.profile <> 'admin' or not new.is_active or coalesce(new.is_deleted, false)) then
    if not exists (
      select 1 from public.users u
      where u.tenant_id = old.tenant_id and u.id <> old.id
        and u.profile = 'admin' and u.is_active and not coalesce(u.is_deleted, false)
    ) then
      raise exception 'A tenant must keep at least one active admin.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists users_keep_one_admin on public.users;
create trigger users_keep_one_admin before update on public.users
  for each row execute function public.users_keep_one_admin();

-- 4. Helpers used by the policies ---------------------------------------------
-- SECURITY DEFINER so the lookup is not itself subject to RLS on users.
create or replace function public.current_profile() returns text
language sql stable security definer set search_path = public as $$
  select profile from public.users
  where id = auth.uid() and is_active and not coalesce(is_deleted, false)
$$;

create or replace function public.is_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile() in ('admin', 'writer'), false)
$$;

create or replace function public.is_admin_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile() = 'admin', false)
$$;

grant execute on function public.current_profile(), public.is_writer(), public.is_admin_profile() to authenticated;

-- 5. Write policies -----------------------------------------------------------
-- Applies to the signed-in role only: public review/approval links (anon) are untouched.
-- Tables that do not exist yet are skipped.
do $$
declare
  t text;
begin
  -- Content: admin + writer
  foreach t in array array['agreements', 'accounts', 'templates', 'playbooks', 'account_playbooks', 'clause_library'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'profile_write_insert', t);
      execute format('drop policy if exists %I on public.%I', 'profile_write_update', t);
      execute format('drop policy if exists %I on public.%I', 'profile_write_delete', t);
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_writer())', 'profile_write_insert', t);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.is_writer()) with check (public.is_writer())', 'profile_write_update', t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.is_writer())', 'profile_write_delete', t);
    end if;
  end loop;

  -- Configuration: admin only
  foreach t in array array['users', 'object_schemas', 'tenant_settings', 'integrations'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'profile_admin_insert', t);
      execute format('drop policy if exists %I on public.%I', 'profile_admin_update', t);
      execute format('drop policy if exists %I on public.%I', 'profile_admin_delete', t);
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_admin_profile())', 'profile_admin_insert', t);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.is_admin_profile()) with check (public.is_admin_profile())', 'profile_admin_update', t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.is_admin_profile())', 'profile_admin_delete', t);
    end if;
  end loop;

  -- Review / approval requests: only writers can CREATE or DELETE them. UPDATE is
  -- left alone on purpose: reviewers and approvers answer through public links.
  foreach t in array array['review_requests', 'approval_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'profile_write_insert', t);
      execute format('drop policy if exists %I on public.%I', 'profile_write_delete', t);
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_writer())', 'profile_write_insert', t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.is_writer())', 'profile_write_delete', t);
    end if;
  end loop;
end $$;

-- Not restricted on purpose: ask_ai_conversations (a reader's own chats) and
-- audit_log (written by the app as a side effect of actions).
