-- Salesforce integration, step 1: Account sync.
-- Run once in the Supabase SQL Editor.

alter table public.accounts
  add column if not exists sf_account_id text,
  add column if not exists sf_last_synced_at timestamptz;

-- Full (non-partial) unique constraint so PostgREST upsert can use it as
-- onConflict target. NULLs are distinct in Postgres, so accounts created
-- locally (no sf_account_id) never collide.
alter table public.accounts
  add constraint accounts_tenant_sf_account_uniq unique (tenant_id, sf_account_id);

create table if not exists public.sf_sync_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  direction text not null,
  object_type text not null,
  status text not null,
  details jsonb,
  error text,
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.sf_sync_log enable row level security;

-- Writes only come from Edge Functions (service role, bypasses RLS).
-- Admins can read their own tenant's log.
create policy "Admins read own tenant sync log"
  on public.sf_sync_log for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_admin and u.is_active and u.tenant_id = sf_sync_log.tenant_id
    )
  );
