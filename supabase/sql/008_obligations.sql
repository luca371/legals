-- Obligations register. Run once in the SQL Editor (after 005, 006 and 007_agent_runs).
--
-- One row per obligation of an agreement (who must do what, by when). Rows are
-- written by the app when a writer accepts what the Obligation agent proposed,
-- or adds one by hand. Everybody in the tenant can read them; only admins and
-- writers can create, edit or delete (same profiles as the rest of the app).
-- Deleting an agreement deletes its obligations.

create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  description text not null,
  responsible_party text not null default '',
  due_date date,
  recurrence text,
  trigger_text text,
  clause text,
  source_quote text,
  status text not null default 'open' check (status in ('open', 'done')),
  source text not null default 'ai' check (source in ('ai', 'manual')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists obligations_tenant_due_idx on public.obligations (tenant_id, due_date);
create index if not exists obligations_agreement_idx on public.obligations (agreement_id);

alter table public.obligations enable row level security;

drop policy if exists obligations_read on public.obligations;
create policy obligations_read on public.obligations
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists obligations_insert on public.obligations;
create policy obligations_insert on public.obligations
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.is_writer());

drop policy if exists obligations_update on public.obligations;
create policy obligations_update on public.obligations
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_writer())
  with check (tenant_id = public.current_tenant_id() and public.is_writer());

drop policy if exists obligations_delete on public.obligations;
create policy obligations_delete on public.obligations
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_writer());
