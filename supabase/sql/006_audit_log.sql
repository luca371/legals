-- Audit log. Run once in the SQL Editor.
--
-- The app already writes to and reads from this table (logAuditEvent /
-- listAuditLog), but it was never created, so every write failed silently.
--
-- Append-only by design: signed-in users can only INSERT entries for their own
-- tenant, under their own email, and only admins can read them. There is no
-- UPDATE or DELETE policy, so nobody can edit or erase history through the API.

create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.users
  where id = auth.uid() and is_active and not coalesce(is_deleted, false)
$$;

grant execute on function public.current_tenant_id() to authenticated;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_email text not null default '',
  action text not null,
  object_type text not null,
  object_id text,
  object_label text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_admin_profile() and tenant_id = public.current_tenant_id());

drop policy if exists audit_log_insert_own on public.audit_log;
create policy audit_log_insert_own on public.audit_log
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and lower(actor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
