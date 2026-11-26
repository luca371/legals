-- Salesforce integration, step 2: remember which agreement attachments
-- were pushed to Salesforce Files, so later pushes add a new version of the
-- same file instead of creating a duplicate.
-- Shape: { "<attachmentId>": { "contentDocumentId": "069...", "contentVersionId": "068...", "syncedAt": "..." } }

alter table public.agreements
  add column if not exists sf_files jsonb not null default '{}'::jsonb;
