-- Second account on an agreement. Run once in the SQL Editor.
alter table public.agreements
  add column if not exists account2_id uuid references public.accounts(id) on delete set null,
  add column if not exists account2_name text not null default '';
