import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const loginWithEmail = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const registerWithEmail = (email, password) =>
  supabase.auth.signUp({ email, password });

export const loginWithGoogle = () =>
  supabase.auth.signInWithOAuth({ provider: 'google' });

export const loginWithMicrosoft = () =>
  supabase.auth.signInWithOAuth({ provider: 'azure' });

export const logout = () => supabase.auth.signOut();

export const sendPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

export const updatePassword = (newPassword) =>
  supabase.auth.updateUser({ password: newPassword });

export const getSession = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onAuthStateChange = (callback) => {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => listener.subscription.unsubscribe();
};

export const getUserStatus = async (user) => {
  if (!user) return { isAdmin: false, isActive: true };

  const { data, error } = await supabase
    .from('users')
    .select('is_admin, is_active, is_deleted')
    .eq('id', user.id)
    .single();

  if (error || !data) return { isAdmin: false, isActive: true };

  return {
    isAdmin: data.is_admin === true,
    isActive: data.is_active !== false && data.is_deleted !== true,
  };
};

export const getCurrentTenantId = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', session.user.id)
    .single();
  return data?.tenant_id ?? null;
};

export const listUsers = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((u) => ({
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    role: u.role,
    department: u.department,
    employeeId: u.employee_id,
    isActive: u.is_active,
    isDeleted: u.is_deleted,
  }));
};

export const createUserAsAdmin = async (userData) => {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error('Could not determine your tenant.');

  const response = await fetch('/api/admin-create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...userData, tenantId }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Failed to create user.');
  }
  return result.userId;
};

export const updateUserProfile = (uid, updates) =>
  supabase
    .from('users')
    .update({
      first_name: updates.firstName,
      last_name: updates.lastName,
      role: updates.role,
      department: updates.department || '',
      employee_id: updates.employeeId || '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', uid);

export const sendInviteEmail = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

export const setUserActive = (uid, isActive) =>
  supabase
    .from('users')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', uid);

export const softDeleteUser = (uid) =>
  supabase
    .from('users')
    .update({ is_active: false, is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', uid);