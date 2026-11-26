-- Agent runs. Run once in the SQL Editor (after 005 and 006).
--
-- One row per agent execution (for now only the account brief). Written ONLY
-- by Edge Functions with the service role - there is deliberately no INSERT /
-- UPDATE / DELETE policy, so nobody can forge or erase a run through the API.
-- Users can read their own runs, admins can read every run of their tenant.
-- The Edge Function also uses this table to cap runs per tenant per month.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  actor_email text not null default '',
  agent text not null,
  subject_type text not null,
  subject_id text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  steps integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_tenant_created_idx on public.agent_runs (tenant_id, created_at desc);

alter table public.agent_runs enable row level security;

drop policy if exists agent_runs_read_own on public.agent_runs;
create policy agent_runs_read_own on public.agent_runs
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and (user_id = auth.uid() or public.is_admin_profile()));
