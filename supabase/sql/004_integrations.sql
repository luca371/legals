-- Per-tenant integration settings (Salesforce first). Run once in the SQL Editor.
--
-- The private key is stored AES-GCM encrypted (key = INTEGRATION_ENC_KEY secret,
-- held only by Edge Functions). RLS is enabled with NO policies on purpose: the
-- browser can never read this table; only Edge Functions (service role) can.

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider text not null,
  environment text not null default 'production',
  instance_url text,
  client_id text,
  username text,
  private_key_enc text,
  certificate_pem text,
  certificate_expires_at timestamptz,
  status text not null default 'pending',
  last_error text,
  last_tested_at timestamptz,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table public.integrations enable row level security;
