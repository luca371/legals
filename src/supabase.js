// Supabase initialization and Auth exports
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ---- Auth ----

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

// Mirrors Firebase's onAuthStateChanged — calls `callback(user)` on every
// login/logout/token refresh. `user` is the Supabase auth.users object, or null.
export const onAuthStateChange = (callback) => {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => listener.subscription.unsubscribe();
};

// Mirrors the old Firestore-based getUserStatus — reads the `users` table
// (public schema, linked 1:1 to auth.users by id) for isAdmin/isActive flags.
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