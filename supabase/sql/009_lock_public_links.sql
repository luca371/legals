-- 009: close anonymous access to review/approval requests, and record which
-- tenant owns each DocuSign envelope.
--
-- Before this, the anonymous role could SELECT every row of approval_requests
-- and review_requests (all tenants, documents included) and UPDATE any Pending
-- row with no check on what it changed. The public /approve/:id and /review/:id
-- pages now go through the public-link Edge Function, which serves one row by
-- its random id and allows only the decision / submission.

drop policy if exists approval_requests_public_read on public.approval_requests;
drop policy if exists approval_requests_public_decide on public.approval_requests;
drop policy if exists review_requests_public_read on public.review_requests;
drop policy if exists review_requests_public_submit on public.review_requests;

revoke all on public.approval_requests from anon;
revoke all on public.review_requests from anon;

-- DocuSign: every tenant shares one DocuSign account, so the status and
-- document functions only serve envelopes recorded here for the caller's
-- tenant. Written by docusign-send with the service role; no API access.
create table if not exists public.docusign_envelope_tenants (
  envelope_id text primary key,
  tenant_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.docusign_envelope_tenants enable row level security;
revoke all on public.docusign_envelope_tenants from anon, authenticated;

-- Envelopes sent before this migration.
insert into public.docusign_envelope_tenants (envelope_id, tenant_id)
select distinct e->>'envelopeId', a.tenant_id
from public.agreements a,
     jsonb_array_elements(case when jsonb_typeof(a.docusign_envelopes) = 'array' then a.docusign_envelopes else '[]'::jsonb end) e
where e->>'envelopeId' is not null
  and e->>'envelopeId' not like 'manual-%'
  and a.tenant_id is not null
on conflict (envelope_id) do nothing;
