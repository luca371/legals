-- 011: admin powers need a two-factor (aal2) session.
-- is_admin_profile() guards the admin-only write policies (users, object_schemas,
-- tenant_settings, integrations) and admin reads (audit_log, agent_runs). An
-- admin who signed in with only a password, or only Google, keeps writer access
-- until they enter their authenticator code; the app asks for it at sign-in.
-- Lost phone: delete the factor with
--   delete from auth.mfa_factors where user_id = '<user id>';
create or replace function public.is_admin_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile() = 'admin', false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

revoke execute on function public.is_admin_profile() from public, anon;
grant execute on function public.is_admin_profile() to authenticated, service_role;
