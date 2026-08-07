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

  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: finalPassword,
    email_confirm: true, // skip the "confirm your email" step
  });

  if (authError) {
    return res.status(400).json({ error: mapCreateUserError(authError) });
  }

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
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    return res.status(400).json({ error: profileError.message });
  }

  await supabaseAdmin.auth.resetPasswordForEmail(email);

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