-- Salesforce integration, step 3: link each agreement to its Salesforce Contract record.

alter table public.agreements
  add column if not exists sf_contract_id text,
  add column if not exists sf_contract_synced_at timestamptz;
