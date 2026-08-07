// api/admin-create-user.js
// Runs server-side only (Vercel serverless function) — this is the ONE place
// the service_role key is allowed to be used. Never import this key into
// React/client code.
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateTempPassword() {
  return Math.random().toString(36).slice(-8) + 'A1!';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    email,
    password,
    firstName,
    lastName,
    role,
    department,
    employeeId,
    tenantId,
  } = req.body;

  if (!email || !firstName || !lastName || !tenantId) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const finalPassword = password || generateTempPassword();

  // 1. Create the auth user (admin API — bypasses normal signup flow,
  // does NOT affect the currently logged-in admin's session).
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: finalPassword,
    email_confirm: true, // skip the "confirm your email" step
  });

  if (authError) {
    return res.status(400).json({ error: mapCreateUserError(authError) });
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
    is_admin: false,
    is_active: true,
  });

  if (profileError) {
    // Roll back the auth user if the profile insert fails, so we don't end
    // up with an orphaned auth.users row that has no matching profile.
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    return res.status(400).json({ error: profileError.message });
  }

  // 3. Send the "set your password" email — same purpose as the old
  // sendInviteEmail (Firebase's sendPasswordResetEmail), just via Supabase.
  await supabaseAdmin.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_URL}/reset-password`,
  });

  return res.status(200).json({ userId: authUser.user.id });
}

function mapCreateUserError(error) {
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