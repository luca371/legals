import { createClient } from 'npm:@supabase/supabase-js@2';

// Resolves the caller from their JWT. Returns the caller's own tenant (from
// their profile, never from the request body), a service-role client for
// trusted writes, and a client acting as the caller so RLS still applies.
export async function requireUser(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return { error: 'Not authenticated.', status: 401 as const };

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile } = await admin
    .from('users')
    .select('tenant_id, profile, is_active')
    .eq('id', user.id)
    .single();
  if (!profile?.is_active) return { error: 'Account is not active.', status: 403 as const };

  return {
    admin,
    callerClient,
    user,
    tenantId: profile.tenant_id as string,
    profile: profile.profile as 'admin' | 'writer' | 'reader',
    isAdmin: profile.profile === 'admin',
    canWrite: profile.profile === 'admin' || profile.profile === 'writer',
  };
}

// Assurance level of the caller's session: 'aal2' once they passed two-factor.
// Read from the JWT that requireUser has already had verified by Supabase Auth.
export function sessionAal(req: Request) {
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    return (JSON.parse(json).aal as string) || 'aal1';
  } catch {
    return 'aal1';
  }
}

export const MFA_REQUIRED = 'Two-factor verification is required for admin actions. Sign out and sign in again.';

export async function requireAdmin(req: Request) {
  const auth = await requireUser(req);
  if ('error' in auth) return auth;
  if (!auth.isAdmin) return { error: 'Only active admins can do this.', status: 403 as const };
  if (sessionAal(req) !== 'aal2') return { error: MFA_REQUIRED, status: 403 as const };
  return auth;
}

// Admin and Writer. Readers get read-only access.
export async function requireWriter(req: Request) {
  const auth = await requireUser(req);
  if ('error' in auth) return auth;
  if (!auth.canWrite) return { error: 'Your profile is read-only.', status: 403 as const };
  return auth;
}
