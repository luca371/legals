import { createContext, useContext } from 'react';

// The signed-in user's profile. Defaults to the least privileged one, so a
// screen rendered before the profile is known never shows write controls.
// The real enforcement lives in the database (RLS) and Edge Functions; this
// only decides what the UI offers.
export const PROFILES = ['admin', 'writer', 'reader'];

export const PROFILE_LABELS = { admin: 'Admin', writer: 'Writer', reader: 'Reader' };

export function profileFlags(profile) {
  return {
    profile,
    isAdmin: profile === 'admin',
    canWrite: profile === 'admin' || profile === 'writer',
  };
}

export const AuthContext = createContext(profileFlags('reader'));

export const useAuth = () => useContext(AuthContext);
