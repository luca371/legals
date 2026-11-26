import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { MFA_REQUIRED, sessionAal } from '../_shared/auth.ts';

function generateTempPassword() {
  // Cryptographically random; the user sets their own password from the emailed link.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16) + 'aA1!';
}

const PROFILES = ['admin', 'writer', 'reader'];

function mapCreateUserError(error: { message?: string } | null) {
  const msg = error?.message || '';
  if (msg.includes('already been registered') || msg.includes('already exists')) {
    return 'A user with this email already exists.';
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return 'That email address looks invalid.';
  }
  if (msg.includes('Password') || msg.includes('password')) {
    return 'Password must be at least 6 characters.';
  }
  return msg || 'Something went wrong creating the user.';
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Identify the caller from their JWT (Edge Functions verify the JWT is
  // valid before invoking, but not that the caller is an admin — that check
  // happens here).
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();

  if (!caller) {
    return jsonResponse({ error: 'Not authenticated.' }, 401);
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('users')
    .select('tenant_id, profile, is_active')
    .eq('id', caller.id)
    .single();

  if (callerProfileError || callerProfile?.profile !== 'admin' || !callerProfile.is_active) {
    return jsonResponse({ error: 'Only active admins can create users.' }, 403);
  }
  if (sessionAal(req) !== 'aal2') {
    return jsonResponse({ error: MFA_REQUIRED }, 403);
  }

  const { email, password, firstName, lastName, role, department, employeeId, profile } = await req.json();
  if (profile !== undefined && !PROFILES.includes(profile)) {
    return jsonResponse({ error: 'Profile must be admin, writer or reader.' }, 400);
  }

  if (!email || !firstName || !lastName) {
    return jsonResponse({ error: 'Missing required fields.' }, 400);
  }

  // The caller's own tenant is used, regardless of what (if anything) the
  // client sent — this is what stops an admin of one tenant from creating a
  // user under a different tenant_id.
  const tenantId = callerProfile.tenant_id;

  const finalPassword = password || generateTempPassword();

  // 1. Create the auth user (admin API — bypasses normal signup flow,
  // does NOT affect the currently logged-in admin's session).
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: finalPassword,
    email_confirm: true, // skip the "confirm your email" step
  });

  if (authError || !authUser?.user) {
    return jsonResponse({ error: mapCreateUserError(authError) }, 400);
  }

  // 2. Insert the business-data row into the public `users` table.
  const { error: profileError } = await supabaseAdmin.from('users').insert({
    id: authUser.user.id,
    tenant_id: tenantId,
    first_name: firstName,
    last_name: lastName,
    email,
    role,
    department: department || '',
    employee_id: employeeId || '',
    profile: profile || 'reader',
    is_active: true,
  });

  if (profileError) {
    // Roll back the auth user if the profile insert fails, so we don't end
    // up with an orphaned auth.users row that has no matching profile.
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    return jsonResponse({ error: profileError.message }, 400);
  }

  // 3. Send the "set your password" email.
  await supabaseAdmin.auth.resetPasswordForEmail(email, {
    redirectTo: `${Deno.env.get('APP_URL')}/reset-password`,
  });

  return jsonResponse({ userId: authUser.user.id });
});
